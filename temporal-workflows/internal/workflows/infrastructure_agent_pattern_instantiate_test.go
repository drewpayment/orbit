package workflows

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/testsuite"

	agentactivity "github.com/drewpayment/orbit/temporal-workflows/internal/activities/agent"
	"github.com/drewpayment/orbit/temporal-workflows/internal/agent/providers"
	"github.com/drewpayment/orbit/temporal-workflows/pkg/agentcontract"
)

// TestInstantiatePattern_HappyPath drives the full Phase-3 dispatch:
//   1. agent calls instantiate_pattern with valid parameters
//   2. workflow fetches the pattern, creates a row, transitions through
//      validating → provisioning → active
//   3. expanded shell primitive runs and captures stdout into outputs
//   4. final UpdateStatus(active, outputs) lands on the row
func TestInstantiatePattern_HappyPath(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)

	// Approved pattern: a single shell command that echoes the parameter.
	pattern := agentactivity.PatternFullForWorkflow{
		ID: "pat-static", Name: "static_site", DisplayName: "Static site",
		Description: "Deploy a static site.", Category: "static-site",
		TemplateKind:    "shell",
		TemplateJSON:    `{"command":"echo deploying {{project}}"}`,
		InputSchemaJSON: `{"type":"object","properties":{"project":{"type":"string"}},"required":["project"]}`,
		Status:          "approved",
		CurrentVersion:  1,
	}
	env.RegisterActivityWithOptions(
		func(_ context.Context, in agentactivity.GetPatternByIDInput) (agentactivity.GetPatternByIDResult, error) {
			require.Equal(t, "pat-static", in.ID)
			return agentactivity.GetPatternByIDResult{Pattern: pattern}, nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivityGetPatternByID},
	)

	var createInput agentactivity.CreatePatternInstanceInput
	env.RegisterActivityWithOptions(
		func(_ context.Context, in agentactivity.CreatePatternInstanceInput) (agentactivity.CreatePatternInstanceResult, error) {
			createInput = in
			return agentactivity.CreatePatternInstanceResult{ID: "inst-1"}, nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivityCreatePatternInstance},
	)

	statusCalls := []agentactivity.UpdatePatternInstanceStatusInput{}
	env.RegisterActivityWithOptions(
		func(_ context.Context, in agentactivity.UpdatePatternInstanceStatusInput) error {
			statusCalls = append(statusCalls, in)
			return nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivityUpdatePatternInstanceStatus},
	)

	// Shell primitive succeeds. The expanded template should land here.
	var shellCalls []agentactivity.SandboxedShellInput
	env.RegisterActivityWithOptions(
		func(_ context.Context, in agentactivity.SandboxedShellInput) (agentactivity.SandboxedShellResult, error) {
			shellCalls = append(shellCalls, in)
			return agentactivity.SandboxedShellResult{
				ExitCode: 0,
				Stdout:   "deploying demo\n",
			}, nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivitySandboxedShell},
	)

	llm := &scriptedLLM{
		steps: []agentactivity.LLMNextStepResult{
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-inst", Name: ToolInstantiatePattern, Arguments: map[string]any{
						"pattern_id":   "pat-static",
						"workspace_id": "ws-1",
						"name":         "demo-site",
						"parameters":   map[string]any{"project": "demo"},
					}},
				},
				StopReason: "tool_use",
			},
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-done", Name: ToolDone, Arguments: map[string]any{"summary": "provisioned"}},
				},
				StopReason: "tool_use",
			},
		},
	}
	env.RegisterActivityWithOptions(llm.Run, activity.RegisterOptions{Name: ActivityLLMNextStep})

	env.ExecuteWorkflow(InfrastructureAgentWorkflow, InfrastructureAgentInput{
		AgentRunID:    "run-inst-1",
		WorkspaceID:   "ws-1",
		LLMProviderID: "prov-1",
		UserID:        "user-1",
		InitialPrompt: "deploy a static site",
	})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	// Row creation captured the parameters + version snapshot.
	require.Equal(t, "ws-1", createInput.WorkspaceID)
	require.Equal(t, "demo-site", createInput.Name)
	require.Equal(t, 1, createInput.PatternVersion)
	require.Equal(t, "demo", createInput.Parameters["project"])
	require.Equal(t, "user-1", createInput.CreatedByUser)

	// Status walked through validating → provisioning → active.
	require.GreaterOrEqual(t, len(statusCalls), 3)
	statuses := make([]string, 0, len(statusCalls))
	for _, c := range statusCalls {
		statuses = append(statuses, c.Status)
	}
	require.Equal(t, []string{"validating", "provisioning", "active"}, statuses)
	// Final call has outputs populated.
	final := statusCalls[len(statusCalls)-1]
	require.Equal(t, "active", final.Status)
	require.NotNil(t, final.Outputs)
	require.Contains(t, final.Outputs, "steps")

	// Template expansion sent the user-supplied "demo" into the shell —
	// shell-escaped, so it appears as `'demo'`.
	require.Len(t, shellCalls, 1)
	require.Contains(t, shellCalls[0].Command, "echo deploying")
	require.Contains(t, shellCalls[0].Command, "demo")

	// Tool result fed back to the LLM includes the canonical fields.
	require.Len(t, llm.captured, 2)
	var resultJSON string
	for _, m := range llm.captured[1].Messages {
		if m.Role == providers.RoleTool && m.ToolCallID == "tc-inst" {
			resultJSON = m.Content
		}
	}
	require.NotEmpty(t, resultJSON)
	require.Contains(t, resultJSON, `"instance_id":"inst-1"`)
	require.Contains(t, resultJSON, `"status":"active"`)
	require.Contains(t, resultJSON, `"pattern_name":"static_site"`)
	require.Contains(t, resultJSON, `"pattern_version":1`)
}

// TestInstantiatePattern_RejectsMissingRequiredParameters short-circuits
// BEFORE creating a row. The Patterns row, shell, and status activities
// are not registered — if the dispatch tried to call any of them, the
// test would fail with an "unregistered activity" error.
func TestInstantiatePattern_RejectsMissingRequiredParameters(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)

	env.RegisterActivityWithOptions(
		func(_ context.Context, _ agentactivity.GetPatternByIDInput) (agentactivity.GetPatternByIDResult, error) {
			return agentactivity.GetPatternByIDResult{Pattern: agentactivity.PatternFullForWorkflow{
				ID: "pat-1", Name: "p", DisplayName: "P", Category: "compute",
				TemplateKind:    "shell",
				TemplateJSON:    `{"command":"echo {{required_field}}"}`,
				InputSchemaJSON: `{"type":"object","required":["required_field"]}`,
				Status:          "approved", CurrentVersion: 1,
			}}, nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivityGetPatternByID},
	)

	llm := &scriptedLLM{
		steps: []agentactivity.LLMNextStepResult{
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-inst", Name: ToolInstantiatePattern, Arguments: map[string]any{
						"pattern_id": "pat-1",
						"name":       "x",
						"parameters": map[string]any{}, // missing required_field
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
		AgentRunID:    "run-inst-missing",
		WorkspaceID:   "ws-1",
		LLMProviderID: "prov-1",
		InitialPrompt: "try invalid",
	})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
	// Tool result must explain the missing parameter and NOT include
	// an instance_id (no row was created).
	require.Len(t, llm.captured, 2)
	var resultJSON string
	for _, m := range llm.captured[1].Messages {
		if m.Role == providers.RoleTool && m.ToolCallID == "tc-inst" {
			resultJSON = m.Content
		}
	}
	require.Contains(t, resultJSON, "required_field")
	require.NotContains(t, resultJSON, `"instance_id"`)
}

// TestInstantiatePattern_RejectsNonApprovedPattern: a pattern that's
// still pending or has been deprecated cannot be instantiated. The
// dispatch fetches the pattern (one activity call) then short-circuits
// without creating a row.
func TestInstantiatePattern_RejectsNonApprovedPattern(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)

	env.RegisterActivityWithOptions(
		func(_ context.Context, _ agentactivity.GetPatternByIDInput) (agentactivity.GetPatternByIDResult, error) {
			return agentactivity.GetPatternByIDResult{Pattern: agentactivity.PatternFullForWorkflow{
				ID: "pat-pending", Name: "wip",
				TemplateKind: "shell", TemplateJSON: `{"command":"true"}`,
				InputSchemaJSON: `{"type":"object"}`,
				Status:          "pending", CurrentVersion: 1,
			}}, nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivityGetPatternByID},
	)

	llm := &scriptedLLM{
		steps: []agentactivity.LLMNextStepResult{
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-inst", Name: ToolInstantiatePattern, Arguments: map[string]any{
						"pattern_id": "pat-pending",
						"name":       "x",
						"parameters": map[string]any{},
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
		AgentRunID:    "run-inst-pending",
		WorkspaceID:   "ws-1",
		LLMProviderID: "prov-1",
		InitialPrompt: "try pending",
	})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	var resultJSON string
	for _, m := range llm.captured[1].Messages {
		if m.Role == providers.RoleTool && m.ToolCallID == "tc-inst" {
			resultJSON = m.Content
		}
	}
	require.Contains(t, resultJSON, "only approved patterns")
	require.NotContains(t, resultJSON, `"instance_id"`)
}

// TestInstantiatePattern_PrimitiveFailureMarksFailed: when the
// underlying primitive activity errors out, the dispatch must
// transition the instance row to failed and surface the error to the
// agent (no active status, no outputs).
func TestInstantiatePattern_PrimitiveFailureMarksFailed(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)

	env.RegisterActivityWithOptions(
		func(_ context.Context, _ agentactivity.GetPatternByIDInput) (agentactivity.GetPatternByIDResult, error) {
			return agentactivity.GetPatternByIDResult{Pattern: agentactivity.PatternFullForWorkflow{
				ID: "pat-broken", Name: "broken",
				TemplateKind:    "shell",
				TemplateJSON:    `{"command":"echo hi"}`,
				InputSchemaJSON: `{"type":"object"}`,
				Status:          "approved", CurrentVersion: 1,
			}}, nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivityGetPatternByID},
	)
	env.RegisterActivityWithOptions(
		func(_ context.Context, _ agentactivity.CreatePatternInstanceInput) (agentactivity.CreatePatternInstanceResult, error) {
			return agentactivity.CreatePatternInstanceResult{ID: "inst-broken"}, nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivityCreatePatternInstance},
	)
	statusCalls := []agentactivity.UpdatePatternInstanceStatusInput{}
	env.RegisterActivityWithOptions(
		func(_ context.Context, in agentactivity.UpdatePatternInstanceStatusInput) error {
			statusCalls = append(statusCalls, in)
			return nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivityUpdatePatternInstanceStatus},
	)
	// Shell activity itself returns an error (sandbox unreachable,
	// timeout, etc.). The shell_exec dispatcher wraps this in a
	// jsonError({"error": "..."}) which dispatchInstantiatePattern
	// detects and transitions the instance to failed.
	env.RegisterActivityWithOptions(
		func(_ context.Context, _ agentactivity.SandboxedShellInput) (agentactivity.SandboxedShellResult, error) {
			return agentactivity.SandboxedShellResult{}, errors.New("sandbox unreachable")
		},
		activity.RegisterOptions{Name: agentcontract.ActivitySandboxedShell},
	)

	llm := &scriptedLLM{
		steps: []agentactivity.LLMNextStepResult{
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-inst", Name: ToolInstantiatePattern, Arguments: map[string]any{
						"pattern_id": "pat-broken",
						"name":       "boom",
						"parameters": map[string]any{},
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
		AgentRunID:    "run-inst-broken",
		WorkspaceID:   "ws-1",
		LLMProviderID: "prov-1",
		InitialPrompt: "try broken",
	})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	// Final status must be failed.
	require.GreaterOrEqual(t, len(statusCalls), 1)
	final := statusCalls[len(statusCalls)-1]
	require.Equal(t, "failed", final.Status)
	require.NotEmpty(t, final.ErrorMessage)

	// Tool result must NOT claim active.
	var resultJSON string
	for _, m := range llm.captured[1].Messages {
		if m.Role == providers.RoleTool && m.ToolCallID == "tc-inst" {
			resultJSON = m.Content
		}
	}
	require.NotContains(t, resultJSON, `"status":"active"`)
}
