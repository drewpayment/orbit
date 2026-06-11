package workflows

import (
	"context"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/testsuite"

	agentactivity "github.com/drewpayment/orbit/temporal-workflows/internal/activities/agent"
	"github.com/drewpayment/orbit/temporal-workflows/internal/agent/providers"
)

// Runaway-loop regression (run agent-4d50c96e): a text-only assistant reply
// — no tool calls — must end the agent's turn and park the run awaiting the
// user. Before the fix the loop re-prompted the LLM immediately, and because
// the provider layer drops empty turns from the wire payload, a deterministic
// model replied identically forever (~2.5 Hz until abort/max_iterations).

func TestAwaitingUser_TextOnlyAssistantTurnParks(t *testing.T) {
	t.Run("text-only assistant turn parks", func(t *testing.T) {
		s := &agentState{history: []ConversationTurn{
			{Role: "user", Content: "hi"},
			{Role: "assistant", Content: "Hello! What would you like to deploy?"},
		}}
		require.True(t, awaitingUser(s))
	})
	t.Run("assistant turn with tool calls does not park", func(t *testing.T) {
		s := &agentState{history: []ConversationTurn{
			{Role: "user", Content: "hi"},
			{Role: "assistant", Content: "Checking.", ToolCalls: []ToolCallRecord{{ID: "x", Name: "shell_exec"}}},
		}}
		require.False(t, awaitingUser(s))
	})
	t.Run("last turn user does not park", func(t *testing.T) {
		s := &agentState{history: []ConversationTurn{
			{Role: "assistant", Content: "Hello!"},
			{Role: "user", Content: "deploy it"},
		}}
		require.False(t, awaitingUser(s))
	})
}

func TestInfraAgent_TextOnlyReplyParksAwaitingUser(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)

	llm := &scriptedLLM{
		steps: []agentactivity.LLMNextStepResult{
			// 0: conversational greeting — no tool calls. Must park.
			{Text: "Hello! What would you like to deploy?", StopReason: "end_turn"},
			// 1: after the user's follow-up, finish.
			{
				ToolCalls:  []providers.ToolCall{{ID: "tc-done", Name: ToolDone, Arguments: map[string]any{"summary": "ok"}}},
				StopReason: "tool_use",
			},
		},
	}
	env.RegisterActivityWithOptions(llm.Run, activity.RegisterOptions{Name: ActivityLLMNextStep})

	env.RegisterDelayedCallback(func() {
		var snap AgentSnapshot
		for i := 0; i < 20; i++ {
			q, err := env.QueryWorkflow(AgentQuerySnapshot)
			require.NoError(t, err)
			require.NoError(t, q.Get(&snap))
			if snap.Status == "awaiting_user" {
				break
			}
		}
		require.Equal(t, "awaiting_user", snap.Status, "text-only reply must park the run awaiting the user")
		env.SignalWorkflow(AgentSignalUserMessage, UserMessageSignalPayload{
			TurnID: "u-2", UserID: "u1", Message: "deploy the api service",
		})
	}, 100*time.Millisecond)

	env.ExecuteWorkflow(InfrastructureAgentWorkflow, InfrastructureAgentInput{
		AgentRunID:    "run-text-park",
		WorkspaceID:   "ws-1",
		LLMProviderID: "prov-1",
		InitialPrompt: "hi",
	})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
	require.Equal(t, int32(2), llm.calls.Load(), "greeting parks; exactly one more step after the user replies")

	// The second LLM step must see the user's follow-up — proof the run
	// waited instead of re-prompting on unchanged history.
	require.Len(t, llm.captured, 2)
	var sawFollowUp bool
	for _, m := range llm.captured[1].Messages {
		if strings.Contains(m.Content, "deploy the api service") {
			sawFollowUp = true
		}
	}
	require.True(t, sawFollowUp, "second LLM step must include the user's follow-up message")
}

// alwaysEmptyLLM returns an empty result — no text, no tool calls — on every
// call, mimicking the deterministic local-model behavior from the runaway run.
type alwaysEmptyLLM struct {
	calls    atomic.Int32
	captured []agentactivity.LLMNextStepInput
}

func (s *alwaysEmptyLLM) Run(_ context.Context, in agentactivity.LLMNextStepInput) (agentactivity.LLMNextStepResult, error) {
	s.calls.Add(1)
	s.captured = append(s.captured, in)
	return agentactivity.LLMNextStepResult{StopReason: "end_turn"}, nil
}

func TestInfraAgent_ConsecutiveEmptyResponsesParkRecoverable(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)
	rec := &eventRecorder{}
	registerEventRecorder(env, rec)

	llm := &alwaysEmptyLLM{}
	env.RegisterActivityWithOptions(llm.Run, activity.RegisterOptions{Name: ActivityLLMNextStep})

	// Once parked in the recoverable-error wait, /done closes the run out.
	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow(AgentSignalUserMessage, UserMessageSignalPayload{
			TurnID: "u-done", UserID: "u1", Message: "/done",
		})
	}, 200*time.Millisecond)

	env.ExecuteWorkflow(InfrastructureAgentWorkflow, InfrastructureAgentInput{
		AgentRunID:    "run-empty-park",
		WorkspaceID:   "ws-1",
		LLMProviderID: "prov-1",
		InitialPrompt: "hi",
	})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
	require.Equal(t, int32(maxConsecutiveEmptyLLMResponses), llm.calls.Load(),
		"empty responses must park after the bounded re-prompt budget, not loop to max_iterations")

	// Re-prompts must not grow history: an empty turn appended each pass is
	// what made the runaway transcript. Every call sees identical messages.
	require.Len(t, llm.captured, maxConsecutiveEmptyLLMResponses)
	for i := 1; i < len(llm.captured); i++ {
		require.Equal(t, len(llm.captured[0].Messages), len(llm.captured[i].Messages),
			"empty assistant turns must not accumulate in history")
	}

	// Zero-content assistant turns must not reach the durable transcript —
	// they rendered as the wall of empty AGENT bubbles.
	var sawRecoverableBanner bool
	for _, e := range rec.allEvents() {
		switch e.Kind {
		case string(EventKindConversationTurn):
			if e.Payload["role"] == "assistant" {
				content, _ := e.Payload["content"].(string)
				require.NotEmpty(t, strings.TrimSpace(content), "empty assistant turn must not be persisted")
			}
		case string(EventKindStatusUpdate):
			if msg, _ := e.Payload["message"].(string); strings.HasPrefix(msg, recoverableErrorPrefix) {
				sawRecoverableBanner = true
			}
		}
	}
	require.True(t, sawRecoverableBanner, "consecutive empty responses must surface the recoverable-error banner")
}

// A single empty response followed by a real one recovers transparently —
// the user never sees a banner and the run proceeds.
func TestInfraAgent_SingleEmptyResponseRetriesTransparently(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)

	llm := &scriptedLLM{
		steps: []agentactivity.LLMNextStepResult{
			// 0: empty — re-prompt within budget.
			{StopReason: "end_turn"},
			// 1: real completion.
			{
				ToolCalls:  []providers.ToolCall{{ID: "tc-done", Name: ToolDone, Arguments: map[string]any{"summary": "ok"}}},
				StopReason: "tool_use",
			},
		},
	}
	env.RegisterActivityWithOptions(llm.Run, activity.RegisterOptions{Name: ActivityLLMNextStep})

	env.ExecuteWorkflow(InfrastructureAgentWorkflow, InfrastructureAgentInput{
		AgentRunID:    "run-empty-recover",
		WorkspaceID:   "ws-1",
		LLMProviderID: "prov-1",
		InitialPrompt: "hi",
	})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
	require.Equal(t, int32(2), llm.calls.Load())
}
