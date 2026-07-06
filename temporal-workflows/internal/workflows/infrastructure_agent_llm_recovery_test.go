package workflows

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/testsuite"

	agentactivity "github.com/drewpayment/orbit/temporal-workflows/internal/activities/agent"
	"github.com/drewpayment/orbit/temporal-workflows/internal/agent/providers"
)

// scriptedLLMWithErrors is a scriptedLLM variant that can be told to
// return an error on specific 1-indexed call numbers. Used to verify the
// recoverable-LLM-error path (issue #42 interim mitigation A).
type scriptedLLMWithErrors struct {
	calls       atomic.Int32
	steps       []agentactivity.LLMNextStepResult
	captured    []agentactivity.LLMNextStepInput
	errorOnCall map[int]error // 1-indexed call number → err to return
}

func (s *scriptedLLMWithErrors) Run(_ context.Context, in agentactivity.LLMNextStepInput) (agentactivity.LLMNextStepResult, error) {
	idx := int(s.calls.Add(1))
	s.captured = append(s.captured, in)
	if err, ok := s.errorOnCall[idx]; ok {
		return agentactivity.LLMNextStepResult{}, err
	}
	if idx-1 >= len(s.steps) {
		return agentactivity.LLMNextStepResult{
			ToolCalls: []providers.ToolCall{
				{ID: "done-final", Name: ToolDone, Arguments: map[string]any{"summary": "default tail"}},
			},
			StopReason: "tool_use",
		}, nil
	}
	return s.steps[idx-1], nil
}

// Non-retryable so the workflow sees the error on the first attempt
// instead of grinding through the LLMNextStep retry policy.
func nonRetryableLLMErr(msg string) error {
	return temporal.NewNonRetryableApplicationError(msg, "LLMNonRetryable", errors.New(msg))
}

// BUG-2b: a NON-retryable first-call LLM error must NOT silently fail the
// run. It surfaces in chat via the recoverable-error sentinel status_update
// and parks awaiting_user so the user can /done to close out (or /retry).
// Previously this failed the workflow with no user-visible signal.
func TestInfraAgentLLMRecovery_FirstCallNonRetryableSurfacesAndParks(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)

	llm := &scriptedLLMWithErrors{
		errorOnCall: map[int]error{
			1: nonRetryableLLMErr("openai_compat: HTTP 400: invalid message content type: <nil>"),
		},
	}
	env.RegisterActivityWithOptions(llm.Run, activity.RegisterOptions{Name: ActivityLLMNextStep})

	// The run parks awaiting_user; send /done to finalize cleanly.
	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow(AgentSignalUserMessage, UserMessageSignalPayload{
			TurnID: "u-done", UserID: "u1", Message: "/done",
		})
	}, 100*time.Millisecond)

	env.ExecuteWorkflow(InfrastructureAgentWorkflow, InfrastructureAgentInput{
		AgentRunID:    "run-rec-1",
		WorkspaceID:   "ws-1",
		RepositoryID:  "repo-1",
		UserID:        "u1",
		LLMProviderID: "prov-1",
		InitialPrompt: "Deploy this app.",
	})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError(), "non-retryable LLM error must surface, not fail the run")
	require.Equal(t, int32(1), llm.calls.Load())
}

func TestInfraAgentLLMRecovery_DoneSentinelCompletesRun(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)

	llm := &scriptedLLMWithErrors{
		steps: []agentactivity.LLMNextStepResult{
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-prop", Name: ToolProposeToUser, Arguments: map[string]any{
						"title": "Plan", "summary": "Deploy", "body_markdown": "## Plan",
					}},
				},
				StopReason: "tool_use",
			},
		},
		errorOnCall: map[int]error{
			2: nonRetryableLLMErr("anthropic: HTTP 400: context too long"),
		},
	}
	env.RegisterActivityWithOptions(llm.Run, activity.RegisterOptions{Name: ActivityLLMNextStep})

	// After propose_to_user, send the user reply that triggers LLM step 2.
	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow(AgentSignalUserMessage, UserMessageSignalPayload{
			TurnID: "u-2", UserID: "u1", Message: "Looks good.",
		})
	}, 100*time.Millisecond)

	// After LLM step 2 errors, the workflow parks in awaiting_user. Send
	// /done to finalize without another LLM call.
	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow(AgentSignalUserMessage, UserMessageSignalPayload{
			TurnID: "u-done", UserID: "u1", Message: "/done",
		})
	}, 600*time.Millisecond)

	env.ExecuteWorkflow(InfrastructureAgentWorkflow, InfrastructureAgentInput{
		AgentRunID:    "run-rec-2",
		WorkspaceID:   "ws-1",
		RepositoryID:  "repo-1",
		UserID:        "u1",
		LLMProviderID: "prov-1",
		InitialPrompt: "Deploy this app.",
	})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError(), "/done should finalize the run cleanly")
	require.Equal(t, int32(2), llm.calls.Load(), "LLM called once for propose, once that errored")
}

func TestInfraAgentLLMRecovery_RetrySentinelRetriesLLMStep(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)

	llm := &scriptedLLMWithErrors{
		steps: []agentactivity.LLMNextStepResult{
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-prop", Name: ToolProposeToUser, Arguments: map[string]any{
						"title": "Plan", "summary": "Deploy", "body_markdown": "## Plan",
					}},
				},
				StopReason: "tool_use",
			},
			// step 2 errors via errorOnCall — entry skipped past.
			{},
			// step 3 (after /retry) succeeds with done.
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-done", Name: ToolDone, Arguments: map[string]any{"summary": "all set after retry"}},
				},
				StopReason: "tool_use",
			},
		},
		errorOnCall: map[int]error{
			2: nonRetryableLLMErr("anthropic: HTTP 400: transient"),
		},
	}
	env.RegisterActivityWithOptions(llm.Run, activity.RegisterOptions{Name: ActivityLLMNextStep})

	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow(AgentSignalUserMessage, UserMessageSignalPayload{
			TurnID: "u-2", UserID: "u1", Message: "Looks good.",
		})
	}, 100*time.Millisecond)

	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow(AgentSignalUserMessage, UserMessageSignalPayload{
			TurnID: "u-retry", UserID: "u1", Message: "/retry",
		})
	}, 600*time.Millisecond)

	env.ExecuteWorkflow(InfrastructureAgentWorkflow, InfrastructureAgentInput{
		AgentRunID:    "run-rec-3",
		WorkspaceID:   "ws-1",
		RepositoryID:  "repo-1",
		UserID:        "u1",
		LLMProviderID: "prov-1",
		InitialPrompt: "Deploy this app.",
	})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError(), "/retry → successful retry should complete cleanly")
	require.Equal(t, int32(3), llm.calls.Load(), "expected 3 LLM calls (propose, errored step, retried step)")

	// /retry must NOT append a user turn to history — verify the third
	// LLM call doesn't see "/retry" as a message.
	require.GreaterOrEqual(t, len(llm.captured), 3)
	for _, m := range llm.captured[2].Messages {
		require.NotEqual(t, "/retry", m.Content, "/retry sentinel must not appear in LLM history")
	}
}

// retryableLLMErr is a plain error (not a temporal.ApplicationError), so the
// LLM activity's retry policy retries it — exercising the backoff window an
// abort must be able to preempt.
func retryableLLMErr(msg string) error { return errors.New(msg) }

// Abort-during-LLM-retry (the QA-reported wedge): an abort delivered while
// the LLM activity is grinding through its retry backoff must preempt the
// activity and terminate the run promptly as aborted. Before the fix the LLM
// activity ran on a context derived from the parent ctx (not loopCtx), so
// cancelLoop() on abort never reached it and the run hung until retries
// exhausted (or forever on a long backoff).
func TestInfraAgentAbort_PreemptsLLMRetryBackoff(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)

	var attempts atomic.Int32
	// Always-failing retryable LLM: keeps the activity in retry until either
	// MaximumAttempts or an abort-driven context cancellation preempts it.
	env.RegisterActivityWithOptions(
		func(ctx context.Context, _ agentactivity.LLMNextStepInput) (agentactivity.LLMNextStepResult, error) {
			attempts.Add(1)
			return agentactivity.LLMNextStepResult{}, retryableLLMErr("provider unavailable, will retry")
		},
		activity.RegisterOptions{Name: ActivityLLMNextStep},
	)

	// Abort during the first retry backoff window (InitialInterval is 2s).
	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow(AgentSignalAbort, AbortSignalPayload{
			RequestedBy: "u1", Reason: "user gave up on the wedged run",
		})
	}, 500*time.Millisecond)

	env.ExecuteWorkflow(InfrastructureAgentWorkflow, InfrastructureAgentInput{
		AgentRunID:    "run-abort-retry",
		WorkspaceID:   "ws-1",
		LLMProviderID: "prov-1",
		InitialPrompt: "do something",
	})

	require.True(t, env.IsWorkflowCompleted(), "workflow must terminate, not hang")
	// Abort path returns nil (graceful termination), not a workflow error.
	require.NoError(t, env.GetWorkflowError())
}

func TestHasExecutedAnyTools(t *testing.T) {
	t.Run("empty history", func(t *testing.T) {
		s := &agentState{}
		require.False(t, hasExecutedAnyTools(s))
	})
	t.Run("only user + assistant turns", func(t *testing.T) {
		s := &agentState{history: []ConversationTurn{
			{Role: "user", Content: "go"},
			{Role: "assistant", Content: "ok"},
		}}
		require.False(t, hasExecutedAnyTools(s))
	})
	t.Run("at least one tool turn", func(t *testing.T) {
		s := &agentState{history: []ConversationTurn{
			{Role: "user", Content: "go"},
			{Role: "assistant", ToolCalls: []ToolCallRecord{{ID: "x", Name: "shell_exec"}}},
			{Role: "tool", ToolCallID: "x", ToolName: "shell_exec", Content: "{\"ok\":true}"},
		}}
		require.True(t, hasExecutedAnyTools(s))
	})
}

func TestAwaitingUser_RecoveryFlagShortCircuits(t *testing.T) {
	// awaitingLLMRecovery should park awaitingUser=true even when the
	// history shape doesn't otherwise indicate we're waiting on a reply.
	// History ends on a user turn — a shape that never gates on its own —
	// so the assertion isolates the flag. (A trailing text-only assistant
	// turn now gates by itself; see TestAwaitingUser_TextOnlyAssistantTurnParks.)
	s := &agentState{
		awaitingLLMRecovery: true,
		history: []ConversationTurn{
			{Role: "assistant", Content: "ok"},
			{Role: "user", Content: "go"},
		},
	}
	require.True(t, awaitingUser(s))

	s.awaitingLLMRecovery = false
	require.False(t, awaitingUser(s))
}
