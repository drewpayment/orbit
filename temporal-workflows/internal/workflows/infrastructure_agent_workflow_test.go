package workflows

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/testsuite"

	agentactivity "github.com/drewpayment/orbit/temporal-workflows/internal/activities/agent"
	"github.com/drewpayment/orbit/temporal-workflows/internal/agent/providers"
	"github.com/drewpayment/orbit/temporal-workflows/pkg/agentcontract"
)

// registerSandboxStubs satisfies the workflow's EnsureSandbox/Teardown
// activity calls in the test environment with no-op implementations.
func registerSandboxStubs(env *testsuite.TestWorkflowEnvironment) {
	env.RegisterActivityWithOptions(
		func(_ context.Context, _ agentactivity.EnsureSandboxInput) (agentactivity.EnsureSandboxResult, error) {
			return agentactivity.EnsureSandboxResult{SandboxID: "stub", Backend: "stub", Ref: "/tmp/stub"}, nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivityEnsureSandbox},
	)
	env.RegisterActivityWithOptions(
		func(_ context.Context, _ agentactivity.TeardownSandboxInput) error { return nil },
		activity.RegisterOptions{Name: agentcontract.ActivityTeardownSandbox},
	)
}

type scriptedLLM struct {
	calls    atomic.Int32
	steps    []agentactivity.LLMNextStepResult
	captured []agentactivity.LLMNextStepInput
}

func (s *scriptedLLM) Run(_ context.Context, in agentactivity.LLMNextStepInput) (agentactivity.LLMNextStepResult, error) {
	idx := int(s.calls.Add(1)) - 1
	s.captured = append(s.captured, in)
	if idx >= len(s.steps) {
		// Default tail: end with done
		return agentactivity.LLMNextStepResult{
			ToolCalls: []providers.ToolCall{{ID: "done-final", Name: ToolDone, Arguments: map[string]any{"summary": "default tail"}}},
			StopReason: "tool_use",
		}, nil
	}
	return s.steps[idx], nil
}

func TestInfrastructureAgentWorkflow_ProposeWaitsForUserThenDone(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)

	llm := &scriptedLLM{
		steps: []agentactivity.LLMNextStepResult{
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-1", Name: ToolProposeToUser, Arguments: map[string]any{
						"title":         "Plan",
						"summary":       "Deploy app",
						"body_markdown": "## Plan\nDo the thing.",
					}},
				},
				StopReason: "tool_use",
				Backend:    "test", Model: "test-model",
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

	// After LLM emits propose_to_user, the workflow waits for a UserMessage.
	// Schedule it shortly into the run.
	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow(AgentSignalUserMessage, UserMessageSignalPayload{
			TurnID:  "user-2",
			UserID:  "u1",
			Message: "Looks good, go ahead.",
		})
	}, 100*time.Millisecond)

	env.ExecuteWorkflow(InfrastructureAgentWorkflow, InfrastructureAgentInput{
		AgentRunID:    "run-1",
		WorkspaceID:   "ws-1",
		RepositoryID:  "repo-1",
		UserID:        "u1",
		LLMProviderID: "prov-1",
		InitialPrompt: "Deploy this app.",
	})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
	require.Equal(t, int32(2), llm.calls.Load(), "expected 2 LLM steps")

	// Verify second LLM call saw the user reply in history.
	require.Len(t, llm.captured, 2)
	last := llm.captured[1].Messages
	require.GreaterOrEqual(t, len(last), 3, "expected user, assistant, tool, user messages")
	// The most recent user message should be our reply.
	var foundReply bool
	for _, m := range last {
		if m.Role == providers.RoleUser && m.Content == "Looks good, go ahead." {
			foundReply = true
		}
	}
	require.True(t, foundReply, "reply not in history fed to LLM")
}

func TestInfrastructureAgentWorkflow_AbortBeforeFirstLLMCall(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)

	llm := &scriptedLLM{}
	env.RegisterActivityWithOptions(llm.Run, activity.RegisterOptions{Name: ActivityLLMNextStep})

	// Send abort almost immediately. The workflow should never call LLM.
	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow(AgentSignalAbort, AbortSignalPayload{
			RequestedBy: "u1",
			Reason:      "user changed their mind",
		})
	}, 1*time.Millisecond)

	env.ExecuteWorkflow(InfrastructureAgentWorkflow, InfrastructureAgentInput{
		AgentRunID:    "run-2",
		WorkspaceID:   "ws-1",
		RepositoryID:  "repo-1",
		UserID:        "u1",
		LLMProviderID: "prov-1",
		InitialPrompt: "anything",
	})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
}

func TestInfrastructureAgentWorkflow_UnknownToolFedBackToAgent(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)

	llm := &scriptedLLM{
		steps: []agentactivity.LLMNextStepResult{
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-1", Name: "definitely_not_a_real_tool", Arguments: map[string]any{}},
				},
				StopReason: "tool_use",
			},
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-2", Name: ToolDone, Arguments: map[string]any{"summary": "nope"}},
				},
				StopReason: "tool_use",
			},
		},
	}
	env.RegisterActivityWithOptions(llm.Run, activity.RegisterOptions{Name: ActivityLLMNextStep})

	env.ExecuteWorkflow(InfrastructureAgentWorkflow, InfrastructureAgentInput{
		AgentRunID:    "run-3",
		WorkspaceID:   "ws-1",
		RepositoryID:  "repo-1",
		UserID:        "u1",
		LLMProviderID: "prov-1",
		InitialPrompt: "do shell stuff",
	})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
	require.Equal(t, int32(2), llm.calls.Load())

	require.Len(t, llm.captured, 2)
	var foundToolErr bool
	for _, m := range llm.captured[1].Messages {
		if m.Role == providers.RoleTool && m.ToolCallID == "tc-1" {
			require.Contains(t, m.Content, "unknown tool")
			foundToolErr = true
		}
	}
	require.True(t, foundToolErr, "missing tool error feedback")
}

func TestInfrastructureAgentWorkflow_ShellExecDispatchesToActivity(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)

	// Stub the shell activity so we can assert what the workflow passes in.
	var shellInputs []agentactivity.SandboxedShellInput
	env.RegisterActivityWithOptions(
		func(_ context.Context, in agentactivity.SandboxedShellInput) (agentactivity.SandboxedShellResult, error) {
			shellInputs = append(shellInputs, in)
			return agentactivity.SandboxedShellResult{
				ExitCode:   0,
				Stdout:     "hello\n",
				DurationMs: 12,
			}, nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivitySandboxedShell},
	)

	llm := &scriptedLLM{
		steps: []agentactivity.LLMNextStepResult{
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-1", Name: ToolShellExec, Arguments: map[string]any{"command": "echo hello"}},
				},
				StopReason: "tool_use",
			},
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-2", Name: ToolDone, Arguments: map[string]any{"summary": "ok"}},
				},
				StopReason: "tool_use",
			},
		},
	}
	env.RegisterActivityWithOptions(llm.Run, activity.RegisterOptions{Name: ActivityLLMNextStep})

	env.ExecuteWorkflow(InfrastructureAgentWorkflow, InfrastructureAgentInput{
		AgentRunID:    "run-shell",
		WorkspaceID:   "ws-1",
		LLMProviderID: "prov-1",
		InitialPrompt: "run echo",
	})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
	require.Len(t, shellInputs, 1)
	require.Equal(t, "echo hello", shellInputs[0].Command)

	// Second LLM call should have received the JSON tool result containing
	// stdout "hello".
	require.Len(t, llm.captured, 2)
	var found bool
	for _, m := range llm.captured[1].Messages {
		if m.Role == providers.RoleTool && m.ToolCallID == "tc-1" {
			require.Contains(t, m.Content, `"stdout":"hello\n"`)
			require.Contains(t, m.Content, `"exit_code":0`)
			found = true
		}
	}
	require.True(t, found, "shell tool result not in history")
}
