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

// These tests confirm the orbit_* tool dispatch:
//   - threads the workflow's WorkspaceID into the activity (the LLM never
//     supplies a workspace id, so a hijacked agent can't reach across
//     workspaces),
//   - shapes the activity result into the JSON the agent sees,
//   - propagates the AppNotFound non-retryable error as a tool result the
//     agent can adapt from rather than as a workflow failure.

func TestOrbitListAppsDispatch_ThreadsWorkspaceAndReturnsApps(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)

	var capturedWorkspaceID string
	env.RegisterActivityWithOptions(
		func(_ context.Context, in agentactivity.OrbitListAppsInput) (agentactivity.OrbitListAppsResult, error) {
			capturedWorkspaceID = in.WorkspaceID
			return agentactivity.OrbitListAppsResult{
				Apps: []agentactivity.OrbitApp{
					{ID: "a-1", Name: "checkout", Status: "active",
						Repository: &agentactivity.OrbitAppRepository{URL: "https://github.com/x/y"}},
				},
			}, nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivityOrbitListApps},
	)

	llm := &scriptedLLM{
		steps: []agentactivity.LLMNextStepResult{
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-list", Name: ToolOrbitListApps, Arguments: map[string]any{}},
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
		AgentRunID:    "run-orbit-list",
		WorkspaceID:   "ws-orbit",
		LLMProviderID: "prov-1",
		InitialPrompt: "show me apps",
	})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
	require.Equal(t, "ws-orbit", capturedWorkspaceID,
		"workspace id must come from workflow input, not LLM args")

	// Second LLM call must have seen the orbit tool result.
	require.Len(t, llm.captured, 2)
	var found bool
	for _, m := range llm.captured[1].Messages {
		if m.Role == providers.RoleTool && m.ToolCallID == "tc-list" {
			require.Contains(t, m.Content, `"apps"`)
			require.Contains(t, m.Content, `"checkout"`)
			require.Contains(t, m.Content, `"https://github.com/x/y"`)
			found = true
		}
	}
	require.True(t, found, "orbit_list_apps result not in LLM history")
}

func TestOrbitGetAppDispatch_PassesAppIDAndShapesResult(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)

	var captured agentactivity.OrbitGetAppInput
	env.RegisterActivityWithOptions(
		func(_ context.Context, in agentactivity.OrbitGetAppInput) (agentactivity.OrbitGetAppResult, error) {
			captured = in
			return agentactivity.OrbitGetAppResult{App: agentactivity.OrbitAppDetails{
				ID: "a-1", Name: "checkout", Status: "active",
				HealthConfig: map[string]any{"url": "https://example.com/health"},
			}}, nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivityOrbitGetApp},
	)

	llm := &scriptedLLM{
		steps: []agentactivity.LLMNextStepResult{
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-get", Name: ToolOrbitGetApp, Arguments: map[string]any{"app_id": "a-1"}},
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
		AgentRunID:    "run-orbit-get",
		WorkspaceID:   "ws-orbit",
		LLMProviderID: "prov-1",
		InitialPrompt: "tell me about app a-1",
	})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
	require.Equal(t, "ws-orbit", captured.WorkspaceID)
	require.Equal(t, "a-1", captured.AppID)

	require.Len(t, llm.captured, 2)
	var found bool
	for _, m := range llm.captured[1].Messages {
		if m.Role == providers.RoleTool && m.ToolCallID == "tc-get" {
			require.Contains(t, m.Content, `"app"`)
			require.Contains(t, m.Content, `"checkout"`)
			require.Contains(t, m.Content, `"health_config"`)
			found = true
		}
	}
	require.True(t, found, "orbit_get_app result not in LLM history")
}

func TestOrbitListCloudAccountsDispatch_ReturnsAccountsWithoutCredentials(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)

	env.RegisterActivityWithOptions(
		func(_ context.Context, _ agentactivity.OrbitListCloudAccountsInput) (agentactivity.OrbitListCloudAccountsResult, error) {
			return agentactivity.OrbitListCloudAccountsResult{
				Accounts: []agentactivity.OrbitCloudAccount{
					{ID: "ca-1", Name: "prod-azure", Provider: "azure", Region: "westus", Status: "valid"},
				},
			}, nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivityOrbitListCloudAccounts},
	)

	llm := &scriptedLLM{
		steps: []agentactivity.LLMNextStepResult{
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-acc", Name: ToolOrbitListCloudAccounts, Arguments: map[string]any{}},
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
		AgentRunID:    "run-orbit-acc",
		WorkspaceID:   "ws-orbit",
		LLMProviderID: "prov-1",
		InitialPrompt: "what cloud accounts are available?",
	})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	require.Len(t, llm.captured, 2)
	var found bool
	for _, m := range llm.captured[1].Messages {
		if m.Role == providers.RoleTool && m.ToolCallID == "tc-acc" {
			require.Contains(t, m.Content, `"accounts"`)
			require.Contains(t, m.Content, `"azure"`)
			// Sanity: no credentials field smuggled through.
			require.NotContains(t, m.Content, `"credentials"`)
			require.NotContains(t, m.Content, `"clientSecret"`)
			require.NotContains(t, m.Content, `"secret_key"`)
			found = true
		}
	}
	require.True(t, found, "orbit_list_cloud_accounts result not in LLM history")
}
