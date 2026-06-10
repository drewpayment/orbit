package workflows

import (
	"context"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/testsuite"

	agentactivity "github.com/drewpayment/orbit/temporal-workflows/internal/activities/agent"
	"github.com/drewpayment/orbit/temporal-workflows/internal/agent/providers"
	"github.com/drewpayment/orbit/temporal-workflows/pkg/agentcontract"
)

// orbit_cloud_login dispatches to SandboxedShell with the provider's
// canonical no-browser device-code command. We assert on the command
// string the activity sees (rather than running an actual CLI) so the
// test is fast and hermetic.

func TestCloudLogin_Azure_BuildsDeviceCodeCommand(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)

	var got agentactivity.SandboxedShellInput
	env.RegisterActivityWithOptions(
		func(_ context.Context, in agentactivity.SandboxedShellInput) (agentactivity.SandboxedShellResult, error) {
			got = in
			return agentactivity.SandboxedShellResult{ExitCode: 0, Stdout: `{"id":"sub-1"}`, DurationMs: 1}, nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivitySandboxedShell},
	)

	llm := &scriptedLLM{
		steps: []agentactivity.LLMNextStepResult{
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-login", Name: ToolOrbitCloudLogin, Arguments: map[string]any{
						"provider": "azure",
						"tenant":   "contoso.onmicrosoft.com",
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
		AgentRunID:    "run-cl",
		WorkspaceID:   "ws-1",
		LLMProviderID: "prov-1",
		InitialPrompt: "log into azure",
	})
	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	require.Contains(t, got.Command, "az login --use-device-code")
	require.Contains(t, got.Command, "--tenant 'contoso.onmicrosoft.com'")
	require.Contains(t, got.Command, "--output json")
	require.Equal(t, "tc-login", got.CallID, "CallID must be threaded through so streaming output attaches to the right chat bubble")
	require.Equal(t, 1200, got.TimeoutSeconds, "device code flow gets a 20-minute timeout")

	// Tool result must surface the success bool to the agent.
	require.Len(t, llm.captured, 2)
	var found bool
	for _, m := range llm.captured[1].Messages {
		if m.Role == providers.RoleTool && m.ToolCallID == "tc-login" {
			require.Contains(t, m.Content, `"authenticated":true`)
			require.Contains(t, m.Content, `"provider":"azure"`)
			found = true
		}
	}
	require.True(t, found, "cloud-login result not in LLM history")
}

func TestCloudLogin_GCP_NoLaunchBrowser(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)

	var got agentactivity.SandboxedShellInput
	env.RegisterActivityWithOptions(
		func(_ context.Context, in agentactivity.SandboxedShellInput) (agentactivity.SandboxedShellResult, error) {
			got = in
			return agentactivity.SandboxedShellResult{ExitCode: 0}, nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivitySandboxedShell},
	)
	llm := &scriptedLLM{
		steps: []agentactivity.LLMNextStepResult{
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc", Name: ToolOrbitCloudLogin, Arguments: map[string]any{"provider": "gcp"}},
				},
				StopReason: "tool_use",
			},
			{
				ToolCalls: []providers.ToolCall{
					{ID: "done", Name: ToolDone, Arguments: map[string]any{"summary": "ok"}},
				},
				StopReason: "tool_use",
			},
		},
	}
	env.RegisterActivityWithOptions(llm.Run, activity.RegisterOptions{Name: ActivityLLMNextStep})

	env.ExecuteWorkflow(InfrastructureAgentWorkflow, InfrastructureAgentInput{
		AgentRunID: "run", WorkspaceID: "ws", LLMProviderID: "p", InitialPrompt: "x",
	})
	require.NoError(t, env.GetWorkflowError())
	require.Equal(t, "gcloud auth login --no-launch-browser", got.Command)
}

func TestCloudLogin_RejectsUnknownProvider(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)

	// Shell stub MUST NOT be invoked — validation happens before the
	// activity call.
	called := false
	env.RegisterActivityWithOptions(
		func(_ context.Context, _ agentactivity.SandboxedShellInput) (agentactivity.SandboxedShellResult, error) {
			called = true
			return agentactivity.SandboxedShellResult{}, nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivitySandboxedShell},
	)

	llm := &scriptedLLM{
		steps: []agentactivity.LLMNextStepResult{
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc", Name: ToolOrbitCloudLogin, Arguments: map[string]any{"provider": "ibm"}},
				},
				StopReason: "tool_use",
			},
			{
				ToolCalls: []providers.ToolCall{
					{ID: "done", Name: ToolDone, Arguments: map[string]any{"summary": "ok"}},
				},
				StopReason: "tool_use",
			},
		},
	}
	env.RegisterActivityWithOptions(llm.Run, activity.RegisterOptions{Name: ActivityLLMNextStep})

	env.ExecuteWorkflow(InfrastructureAgentWorkflow, InfrastructureAgentInput{
		AgentRunID: "run", WorkspaceID: "ws", LLMProviderID: "p", InitialPrompt: "x",
	})
	require.NoError(t, env.GetWorkflowError())
	require.False(t, called, "unknown provider must not invoke the shell activity")

	// Agent sees an error tool result.
	require.Len(t, llm.captured, 2)
	for _, m := range llm.captured[1].Messages {
		if m.Role == providers.RoleTool && m.ToolCallID == "tc" {
			require.Contains(t, m.Content, "unknown provider")
			require.Contains(t, m.Content, "ibm")
		}
	}
}

func TestCloudLogin_TenantQuotedForBash(t *testing.T) {
	// Adversarial input: a tenant string that would be a shell injection
	// if not quoted. The bashQuote helper must neutralize it.
	got := bashQuote("contoso'; rm -rf /; echo ")
	require.True(t, strings.HasPrefix(got, "'") && strings.HasSuffix(got, "'"), "must wrap in single quotes")
	require.Contains(t, got, `'\''`, "must escape embedded single quotes via the classic '\\'' trick")
}
