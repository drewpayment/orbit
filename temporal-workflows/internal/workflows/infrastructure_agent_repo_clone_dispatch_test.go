package workflows

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/testsuite"

	agentactivity "github.com/drewpayment/orbit/temporal-workflows/internal/activities/agent"
	"github.com/drewpayment/orbit/temporal-workflows/internal/agent/providers"
	"github.com/drewpayment/orbit/temporal-workflows/pkg/agentcontract"
)

// TestOrbitRepoCloneDispatch_ThreadsWorkflowAndShapesResult confirms the
// orbit_repo_clone tool dispatch:
//   - threads the workflow's WorkflowID + WorkspaceID into the activity
//     (the LLM only supplies app_id / repo_url / revision so it can't
//     reach across workspaces),
//   - forwards the LLM-supplied repo_url + revision unchanged,
//   - shapes the activity result into the JSON the agent sees,
//   - never includes a `token` field in the LLM-visible result.
func TestOrbitRepoCloneDispatch_ThreadsWorkflowAndShapesResult(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)

	var captured agentactivity.OrbitRepoCloneInput
	env.RegisterActivityWithOptions(
		func(_ context.Context, in agentactivity.OrbitRepoCloneInput) (agentactivity.OrbitRepoCloneResult, error) {
			captured = in
			return agentactivity.OrbitRepoCloneResult{
				ClonePath:      "repo/drewpayment-verofront",
				Owner:          "drewpayment",
				Repo:           "verofront",
				Branch:         "main",
				HeadSHA:        "abc123",
				InstallationID: 42,
				DurationMs:     321,
			}, nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivityOrbitRepoClone},
	)

	llm := &scriptedLLM{
		steps: []agentactivity.LLMNextStepResult{
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-clone", Name: ToolOrbitRepoClone, Arguments: map[string]any{
						"repo_url": "https://github.com/drewpayment/verofront",
						"revision": "main",
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
		AgentRunID:    "run-orbit-clone",
		WorkspaceID:   "ws-orbit",
		LLMProviderID: "prov-1",
		InitialPrompt: "clone the verofront repo so you can read it",
	})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	require.Equal(t, "ws-orbit", captured.WorkspaceID,
		"workspace id must come from workflow input, not LLM args")
	require.NotEmpty(t, captured.WorkflowID,
		"workflow id must be threaded into the activity for sandbox routing")
	require.Equal(t, "https://github.com/drewpayment/verofront", captured.RepoURL)
	require.Equal(t, "main", captured.Revision)

	require.Len(t, llm.captured, 2)
	var found bool
	for _, m := range llm.captured[1].Messages {
		if m.Role == providers.RoleTool && m.ToolCallID == "tc-clone" {
			require.Contains(t, m.Content, `"clone_path":"repo/drewpayment-verofront"`)
			require.Contains(t, m.Content, `"head_sha":"abc123"`)
			require.Contains(t, m.Content, `"installation_id":42`)
			// Token must never enter LLM context.
			require.NotContains(t, m.Content, `"token"`)
			require.NotContains(t, m.Content, "x-access-token")
			found = true
		}
	}
	require.True(t, found, "orbit_repo_clone result not in LLM history")
}
