package workflows

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/testsuite"

	agentactivity "github.com/drewpayment/orbit/temporal-workflows/internal/activities/agent"
	"github.com/drewpayment/orbit/temporal-workflows/internal/agent/providers"
	"github.com/drewpayment/orbit/temporal-workflows/pkg/agentcontract"
)

// TestApprovalTimeout_RegisterToolAutoRejects verifies AC-9: a
// tool-registration gate left unresolved past the configured timeout
// auto-rejects — the tool row is resolved rejected with the expiry reason,
// the pending-approval row is closed (notes "approval timed out"), an
// approval_resolution event is emitted, and the run continues to completion.
func TestApprovalTimeout_RegisterToolAutoRejects(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)
	rec := &eventRecorder{}
	registerEventRecorder(env, rec)

	env.RegisterActivityWithOptions(
		func(_ context.Context, _ agentactivity.RegisterPendingToolInput) (agentactivity.RegisterPendingToolResult, error) {
			return agentactivity.RegisterPendingToolResult{ID: "row-1"}, nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivityRegisterPendingAgentTool},
	)

	var resolveInput agentactivity.ResolveAgentToolInput
	env.RegisterActivityWithOptions(
		func(_ context.Context, in agentactivity.ResolveAgentToolInput) (agentactivity.ResolveAgentToolResult, error) {
			resolveInput = in
			return agentactivity.ResolveAgentToolResult{ID: in.ID, Status: "rejected"}, nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivityResolveAgentTool},
	)

	var pendingResolve agentactivity.ResolvePendingApprovalInput
	env.RegisterActivityWithOptions(
		func(_ context.Context, in agentactivity.ResolvePendingApprovalInput) error {
			pendingResolve = in
			return nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivityResolvePendingApproval},
	)

	llm := &scriptedLLM{
		steps: []agentactivity.LLMNextStepResult{
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-reg", Name: ToolRegisterTool, Arguments: map[string]any{
						"name":          "deploy_thing",
						"description":   "do it",
						"template_kind": "shell",
						"template_json": `{"command":"echo hi"}`,
					}},
				},
				StopReason: "tool_use",
			},
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-done", Name: ToolDone, Arguments: map[string]any{"summary": "ok"}},
				},
				StopReason: "tool_use",
			},
		},
	}
	env.RegisterActivityWithOptions(llm.Run, activity.RegisterOptions{Name: ActivityLLMNextStep})

	// No approval signal is ever sent — the gate must expire. Use a short
	// per-run override so the test env's mock clock fires the deadline.
	env.ExecuteWorkflow(InfrastructureAgentWorkflow, InfrastructureAgentInput{
		AgentRunID:      "run-timeout",
		WorkspaceID:     "ws-1",
		LLMProviderID:   "p",
		InitialPrompt:   "register a tool",
		ApprovalTimeout: time.Hour,
	})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError(), "timeout must not fail the run")

	// Tool row resolved as rejected with the expiry reason.
	require.False(t, resolveInput.Approved, "expired gate must reject the tool")
	require.Equal(t, "ws-1", resolveInput.WorkspaceID)
	require.Equal(t, approvalTimedOutReason, resolveInput.Reason)

	// Pending-approval row closed as resolved/rejected with the expiry note.
	require.Equal(t, "resolved", pendingResolve.Status)
	require.Equal(t, "rejected", pendingResolve.Resolution)
	require.Equal(t, approvalTimedOutReason, pendingResolve.Notes)
	require.Equal(t, "ws-1", pendingResolve.WorkspaceID)

	// approval_resolution event emitted + persisted, marked not approved.
	var sawResolution bool
	for _, e := range rec.allEvents() {
		if e.Kind == agentcontract.EventKindApprovalResolved {
			sawResolution = true
			require.Equal(t, false, e.Payload["approved"])
		}
	}
	require.True(t, sawResolution, "approval_resolution event not persisted on timeout")
}

// TestApprovalTimeout_DestructiveCommandAutoRejects verifies the destructive
// command gate also expires cleanly (command denied, run continues).
func TestApprovalTimeout_DestructiveCommandAutoRejects(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)

	var pendingResolve agentactivity.ResolvePendingApprovalInput
	env.RegisterActivityWithOptions(
		func(_ context.Context, in agentactivity.ResolvePendingApprovalInput) error {
			pendingResolve = in
			return nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivityResolvePendingApproval},
	)

	llm := &scriptedLLM{
		steps: []agentactivity.LLMNextStepResult{
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-shell", Name: ToolShellExec, Arguments: map[string]any{
						"command": "terraform destroy -auto-approve",
					}},
				},
				StopReason: "tool_use",
			},
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-done", Name: ToolDone, Arguments: map[string]any{"summary": "ok"}},
				},
				StopReason: "tool_use",
			},
		},
	}
	env.RegisterActivityWithOptions(llm.Run, activity.RegisterOptions{Name: ActivityLLMNextStep})

	env.ExecuteWorkflow(InfrastructureAgentWorkflow, InfrastructureAgentInput{
		AgentRunID:      "run-destructive-timeout",
		WorkspaceID:     "ws-1",
		LLMProviderID:   "p",
		InitialPrompt:   "destroy stuff",
		ApprovalTimeout: time.Hour,
	})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
	require.Equal(t, approvalTimedOutReason, pendingResolve.Notes)
	require.Equal(t, "rejected", pendingResolve.Resolution)
}
