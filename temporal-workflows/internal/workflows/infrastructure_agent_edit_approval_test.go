package workflows

import (
	"context"
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

// α — approve-with-edits regression tests. Each one mounts the same
// shape: agent emits register_tool with a slightly-wrong template;
// reviewer signals an Approved+Edited resolution; we assert that the
// activity sees the edited values, the in-memory catalog entry uses
// the edited values, and the agent's tool result includes both
// proposed and final.

func TestApproveWithEdits_AppliesReviewerCorrections(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)

	// Capture register-pending + resolve activity calls.
	var registered agentactivity.RegisterPendingToolInput
	env.RegisterActivityWithOptions(
		func(_ context.Context, in agentactivity.RegisterPendingToolInput) (agentactivity.RegisterPendingToolResult, error) {
			registered = in
			return agentactivity.RegisterPendingToolResult{ID: "row-1"}, nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivityRegisterPendingAgentTool},
	)

	var resolveInput agentactivity.ResolveAgentToolInput
	env.RegisterActivityWithOptions(
		func(_ context.Context, in agentactivity.ResolveAgentToolInput) (agentactivity.ResolveAgentToolResult, error) {
			resolveInput = in
			return agentactivity.ResolveAgentToolResult{
				ID: "row-1", Status: "approved",
				AgentToolVersionID: "v-2",
				EditedFields:       []string{"template_json", "description"},
			}, nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivityResolveAgentTool},
	)

	llm := &scriptedLLM{
		steps: []agentactivity.LLMNextStepResult{
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-reg", Name: ToolRegisterTool, Arguments: map[string]any{
						"name":              "vercel_deploy",
						"description":       "Ship to Vercel.",
						"template_kind":     "shell",
						"template_json":     `{"command":"vercel deploy --prod"}`,
						"input_schema_json": `{"type":"object","properties":{"name":{"type":"string"}}}`,
						"reasoning":         "useful",
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

	// Reviewer signals an Approved+Edited resolution that tightens the
	// template (--prod → --target=preview) and rewrites the description.
	env.RegisterDelayedCallback(func() {
		var snap AgentSnapshot
		for i := 0; i < 20; i++ {
			q, err := env.QueryWorkflow(AgentQuerySnapshot)
			require.NoError(t, err)
			require.NoError(t, q.Get(&snap))
			if len(snap.PendingApprovals) == 1 {
				break
			}
		}
		require.Len(t, snap.PendingApprovals, 1, "expected tool-registration gate")
		env.SignalWorkflow(AgentSignalApproval, ApprovalSignalPayload{
			ApprovalID:         snap.PendingApprovals[0].ApprovalID,
			Approved:           true,
			ResolvedBy:         "admin",
			Edited:             true,
			EditedTemplateJSON: `{"command":"vercel deploy --target=preview"}`,
			EditedDescription:  "Ship to Vercel preview environment.",
		})
	}, 100*time.Millisecond)

	env.ExecuteWorkflow(InfrastructureAgentWorkflow, InfrastructureAgentInput{
		AgentRunID:    "run-edit",
		WorkspaceID:   "ws",
		LLMProviderID: "p",
		InitialPrompt: "register a tool",
	})
	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	// Activity received the edits + the original proposed values.
	require.Equal(t, "vercel_deploy", registered.Name)
	require.True(t, resolveInput.Edited)
	require.Equal(t, `{"command":"vercel deploy --target=preview"}`, resolveInput.EditedTemplateJSON)
	require.Equal(t, "Ship to Vercel preview environment.", resolveInput.EditedDescription)
	// Untouched fields stayed empty so the route knows not to flag them.
	require.Equal(t, "", resolveInput.EditedName)
	require.Equal(t, "", resolveInput.EditedSchemaJSON)

	// Tool result fed back to the agent on its final turn must contain
	// both proposed and final templates so the model can reason about
	// the correction.
	require.Len(t, llm.captured, 2)
	var found bool
	for _, m := range llm.captured[1].Messages {
		if m.Role == providers.RoleTool && m.ToolCallID == "tc-reg" {
			require.Contains(t, m.Content, `"edited":true`)
			require.Contains(t, m.Content, `"agent_proposed"`)
			require.Contains(t, m.Content, `"final"`)
			require.Contains(t, m.Content, `--target=preview`)
			require.Contains(t, m.Content, `Ship to Vercel preview environment.`)
			found = true
		}
	}
	require.True(t, found, "edited tool result not in LLM history")
}

func TestApproveWithEdits_RejectsBuiltInNameCollision(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)

	env.RegisterActivityWithOptions(
		func(_ context.Context, _ agentactivity.RegisterPendingToolInput) (agentactivity.RegisterPendingToolResult, error) {
			return agentactivity.RegisterPendingToolResult{ID: "row-x"}, nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivityRegisterPendingAgentTool},
	)
	resolved := false
	env.RegisterActivityWithOptions(
		func(_ context.Context, _ agentactivity.ResolveAgentToolInput) (agentactivity.ResolveAgentToolResult, error) {
			resolved = true
			return agentactivity.ResolveAgentToolResult{}, nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivityResolveAgentTool},
	)

	llm := &scriptedLLM{
		steps: []agentactivity.LLMNextStepResult{
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-reg", Name: ToolRegisterTool, Arguments: map[string]any{
						"name":          "deploy_safe",
						"description":   "x",
						"template_kind": "shell",
						"template_json": `{"command":"echo {{thing}}"}`,
						"input_schema_json": `{"type":"object","properties":{"thing":{"type":"string"}}}`,
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

	// Reviewer renames it to a built-in via edits. Workflow must reject
	// the edit BEFORE calling the resolve activity so the registry stays
	// consistent.
	env.RegisterDelayedCallback(func() {
		var snap AgentSnapshot
		for i := 0; i < 20; i++ {
			q, _ := env.QueryWorkflow(AgentQuerySnapshot)
			require.NoError(t, q.Get(&snap))
			if len(snap.PendingApprovals) == 1 {
				break
			}
		}
		require.Len(t, snap.PendingApprovals, 1)
		env.SignalWorkflow(AgentSignalApproval, ApprovalSignalPayload{
			ApprovalID: snap.PendingApprovals[0].ApprovalID,
			Approved:   true,
			Edited:     true,
			EditedName: "shell_exec", // collides with a built-in
		})
	}, 100*time.Millisecond)

	env.ExecuteWorkflow(InfrastructureAgentWorkflow, InfrastructureAgentInput{
		AgentRunID: "run-collide", WorkspaceID: "ws", LLMProviderID: "p", InitialPrompt: "x",
	})
	require.NoError(t, env.GetWorkflowError())
	require.False(t, resolved, "resolve activity must NOT be called when edit fails validation")

	// Agent sees the validation error.
	require.Len(t, llm.captured, 2)
	for _, m := range llm.captured[1].Messages {
		if m.Role == providers.RoleTool && m.ToolCallID == "tc-reg" {
			require.True(t, strings.Contains(m.Content, "collides with a built-in"),
				"expected collision error in tool result; got %q", m.Content)
		}
	}
}

func TestApproveWithEdits_NoEditsTreatedAsUnedited(t *testing.T) {
	// Reviewer toggled the edit form but didn't change anything — the
	// signal carries Edited=true but all field values are empty. The
	// workflow should treat it as a regular approval and NOT signal the
	// activity with an edits payload.
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)

	env.RegisterActivityWithOptions(
		func(_ context.Context, _ agentactivity.RegisterPendingToolInput) (agentactivity.RegisterPendingToolResult, error) {
			return agentactivity.RegisterPendingToolResult{ID: "row-1"}, nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivityRegisterPendingAgentTool},
	)
	var saw agentactivity.ResolveAgentToolInput
	env.RegisterActivityWithOptions(
		func(_ context.Context, in agentactivity.ResolveAgentToolInput) (agentactivity.ResolveAgentToolResult, error) {
			saw = in
			// Route returns no editedFields when no fields actually changed.
			return agentactivity.ResolveAgentToolResult{ID: "row-1", Status: "approved"}, nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivityResolveAgentTool},
	)

	llm := &scriptedLLM{
		steps: []agentactivity.LLMNextStepResult{
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-reg", Name: ToolRegisterTool, Arguments: map[string]any{
						"name":              "foo",
						"description":       "bar",
						"template_kind":     "shell",
						"template_json":     `{"command":"echo hi"}`,
						"input_schema_json": `{"type":"object"}`,
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

	env.RegisterDelayedCallback(func() {
		var snap AgentSnapshot
		for i := 0; i < 20; i++ {
			q, _ := env.QueryWorkflow(AgentQuerySnapshot)
			require.NoError(t, q.Get(&snap))
			if len(snap.PendingApprovals) == 1 {
				break
			}
		}
		env.SignalWorkflow(AgentSignalApproval, ApprovalSignalPayload{
			ApprovalID: snap.PendingApprovals[0].ApprovalID,
			Approved:   true,
			Edited:     true, // toggled, but no fields actually changed
		})
	}, 100*time.Millisecond)

	env.ExecuteWorkflow(InfrastructureAgentWorkflow, InfrastructureAgentInput{
		AgentRunID: "run-noop", WorkspaceID: "ws", LLMProviderID: "p", InitialPrompt: "x",
	})
	require.NoError(t, env.GetWorkflowError())
	// The activity still receives Edited=true (the route filters fields
	// anyway), but the agent's tool result must NOT claim edited:true
	// since the route reported zero edited fields.
	require.True(t, saw.Edited)
	require.Len(t, llm.captured, 2)
	for _, m := range llm.captured[1].Messages {
		if m.Role == providers.RoleTool && m.ToolCallID == "tc-reg" {
			require.Contains(t, m.Content, `"edited":false`,
				"with no fields changed, edited flag in tool result should be false")
		}
	}
}
