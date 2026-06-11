package workflows

import (
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/testsuite"

	agentactivity "github.com/drewpayment/orbit/temporal-workflows/internal/activities/agent"
	"github.com/drewpayment/orbit/temporal-workflows/internal/agent/providers"
	"github.com/drewpayment/orbit/temporal-workflows/pkg/agentcontract"
)

// durableKinds is the set the workflow is expected to persist. Mirrors the
// plan's "Durable kinds only" list.
var durableKinds = map[string]bool{
	agentcontract.EventKindConversationTurn: true,
	agentcontract.EventKindProposalUpdate:   true,
	agentcontract.EventKindApprovalRequest:  true,
	agentcontract.EventKindApprovalResolved: true,
	agentcontract.EventKindStatusUpdate:     true,
	"tool_call_output":                      true,
}

// assertMonotonicDurable checks the captured events are strictly increasing
// by sequence and are all durable kinds (no token_delta / chunk leakage).
func assertMonotonicDurable(t *testing.T, events []agentactivity.AgentEventWire) {
	t.Helper()
	var prev uint64
	for i, e := range events {
		require.Truef(t, durableKinds[e.Kind], "event %d has non-durable kind %q", i, e.Kind)
		if i > 0 {
			require.Greaterf(t, e.Sequence, prev, "sequence not strictly increasing at index %d (prev=%d cur=%d)", i, prev, e.Sequence)
		}
		prev = e.Sequence
	}
}

func TestPersistence_FlushesDurableTranscript(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)
	rec := &eventRecorder{}
	registerEventRecorder(env, rec)

	llm := &scriptedLLM{
		steps: []agentactivity.LLMNextStepResult{
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-1", Name: ToolProposeToUser, Arguments: map[string]any{
						"title": "Plan", "summary": "Deploy app", "body_markdown": "## Plan",
					}},
				},
				StopReason: "tool_use", Backend: "test", Model: "test-model",
			},
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-2", Name: ToolDone, Arguments: map[string]any{"summary": "All set."}},
				},
				StopReason: "tool_use",
			},
		},
	}
	env.RegisterActivityWithOptions(llm.Run, activity.RegisterOptions{Name: ActivityLLMNextStep})

	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow(AgentSignalUserMessage, UserMessageSignalPayload{
			TurnID: "user-2", UserID: "u1", Message: "go ahead",
		})
	}, 100*time.Millisecond)

	env.ExecuteWorkflow(InfrastructureAgentWorkflow, InfrastructureAgentInput{
		AgentRunID: "run-1", WorkspaceID: "ws-1", RepositoryID: "repo-1",
		UserID: "u1", LLMProviderID: "prov-1", InitialPrompt: "Deploy this app.",
	})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	events := rec.allEvents()
	require.NotEmpty(t, events, "expected durable events to be flushed")
	assertMonotonicDurable(t, events)

	// The transcript must include the initial user turn, the proposal, the
	// follow-up user turn, and a terminal completed status.
	var sawProposal, sawCompleted, sawUserReply bool
	for _, e := range events {
		switch e.Kind {
		case agentcontract.EventKindProposalUpdate:
			sawProposal = true
		case agentcontract.EventKindStatusUpdate:
			if e.Payload["status"] == "completed" {
				sawCompleted = true
			}
		case agentcontract.EventKindConversationTurn:
			if e.Payload["role"] == "user" && e.Payload["content"] == "go ahead" {
				sawUserReply = true
			}
		}
	}
	require.True(t, sawProposal, "proposal_update not persisted")
	require.True(t, sawCompleted, "terminal completed status not persisted")
	require.True(t, sawUserReply, "follow-up user turn not persisted")

	// No token_delta or tool_call_output_chunk must ever be persisted.
	for _, e := range events {
		require.NotEqual(t, agentcontract.EventKindTokenDelta, e.Kind)
		require.NotEqual(t, agentcontract.EventKindToolCallOutputChunk, e.Kind)
	}
}

// BUG-2b: a non-retryable LLM failure must persist a user-visible status
// update carrying the recoverable-error sentinel so the UI renders the
// banner + /retry//done affordance instead of leaving the user in silence.
func TestPersistence_NonRetryableLLMErrorPersistsSentinelStatus(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)
	rec := &eventRecorder{}
	registerEventRecorder(env, rec)

	llm := &scriptedLLMWithErrors{
		errorOnCall: map[int]error{1: nonRetryableLLMErr("openai_compat: HTTP 400: bad content")},
	}
	env.RegisterActivityWithOptions(llm.Run, activity.RegisterOptions{Name: ActivityLLMNextStep})
	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow(AgentSignalUserMessage, UserMessageSignalPayload{
			TurnID: "u-done", UserID: "u1", Message: "/done",
		})
	}, 100*time.Millisecond)

	env.ExecuteWorkflow(InfrastructureAgentWorkflow, InfrastructureAgentInput{
		AgentRunID: "run-2b", WorkspaceID: "ws-1", LLMProviderID: "p", InitialPrompt: "x",
	})
	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	var sawSentinel bool
	for _, e := range rec.allEvents() {
		if e.Kind == agentcontract.EventKindStatusUpdate {
			if msg, _ := e.Payload["message"].(string); strings.HasPrefix(msg, recoverableErrorPrefix) {
				sawSentinel = true
				require.Contains(t, msg, "HTTP 400")
			}
		}
	}
	require.True(t, sawSentinel, "recoverable-error sentinel status_update was not persisted")
}

func TestPersistence_FlushFailureDoesNotFailRun(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)
	rec := &eventRecorder{}
	// Fail the first several flush attempts; the run must still complete and
	// the buffered events must eventually land on a later flush.
	rec.failNext.Store(2)
	registerEventRecorder(env, rec)

	llm := &scriptedLLM{
		steps: []agentactivity.LLMNextStepResult{
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-1", Name: ToolDone, Arguments: map[string]any{"summary": "done"}},
				},
				StopReason: "tool_use", Backend: "test", Model: "test-model",
			},
		},
	}
	env.RegisterActivityWithOptions(llm.Run, activity.RegisterOptions{Name: ActivityLLMNextStep})

	env.ExecuteWorkflow(InfrastructureAgentWorkflow, InfrastructureAgentInput{
		AgentRunID: "run-2", WorkspaceID: "ws-1", RepositoryID: "repo-1",
		UserID: "u1", LLMProviderID: "prov-1", InitialPrompt: "do it",
	})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError(), "transient persist failures must not fail the run")

	events := rec.allEvents()
	require.NotEmpty(t, events, "buffered events should eventually flush after failures clear")
	var sawCompleted bool
	for _, e := range events {
		if e.Kind == agentcontract.EventKindStatusUpdate && e.Payload["status"] == "completed" {
			sawCompleted = true
		}
	}
	require.True(t, sawCompleted, "terminal status lost across flush retries")
}
