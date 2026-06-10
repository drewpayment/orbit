package workflows

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/testsuite"

	agentactivity "github.com/drewpayment/orbit/temporal-workflows/internal/activities/agent"
	"github.com/drewpayment/orbit/temporal-workflows/internal/agent/providers"
	"github.com/drewpayment/orbit/temporal-workflows/pkg/agentcontract"
)

// TestInfrastructureAgentWorkflow_ProposePatternFullRoundTrip walks the
// propose_pattern flow end-to-end with stubbed activities:
//   - agent proposes a pattern via the tool call
//   - workflow registers it as pending, opens a pattern_registration gate
//   - test signals an approval-with-edits (admin renamed the pattern)
//   - workflow resolves with edited fields, agent sees the diff
//
// This is the Patterns spike's mirror of the existing
// TestInfrastructureAgentWorkflow_RegisterToolFullRoundTrip test.
func TestInfrastructureAgentWorkflow_ProposePatternFullRoundTrip(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)

	// Pattern registry "database" we mutate from the activity stubs.
	type entry struct {
		ID, Name, DisplayName, Category, TemplateKind, TemplateJSON, Description, InputSchemaJSON string
		Approved, Edited                                                                          bool
		EditedFields                                                                              []string
	}
	rows := []entry{}

	env.RegisterActivityWithOptions(
		func(_ context.Context, _ agentactivity.ListApprovedPatternsInput) (agentactivity.ListApprovedPatternsResult, error) {
			out := []agentactivity.ApprovedPattern{}
			for _, r := range rows {
				if r.Approved {
					out = append(out, agentactivity.ApprovedPattern{
						ID: r.ID, Name: r.Name, DisplayName: r.DisplayName,
						Category: r.Category, Description: r.Description,
						TemplateKind: r.TemplateKind, TemplateJSON: r.TemplateJSON,
						InputSchemaJSON: r.InputSchemaJSON, CurrentVersion: 1,
					})
				}
			}
			return agentactivity.ListApprovedPatternsResult{Patterns: out}, nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivityListApprovedPatterns},
	)
	env.RegisterActivityWithOptions(
		func(_ context.Context, in agentactivity.RegisterPendingPatternInput) (agentactivity.RegisterPendingPatternResult, error) {
			rows = append(rows, entry{
				ID: fmt.Sprintf("pat-%d", len(rows)),
				Name: in.Name, DisplayName: in.DisplayName, Description: in.Description,
				Category: in.Category, TemplateKind: in.TemplateKind, TemplateJSON: in.TemplateJSON,
				InputSchemaJSON: in.InputSchemaJSON,
			})
			return agentactivity.RegisterPendingPatternResult{ID: rows[len(rows)-1].ID}, nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivityRegisterPendingPattern},
	)
	env.RegisterActivityWithOptions(
		func(_ context.Context, in agentactivity.ResolvePatternInput) (agentactivity.ResolvePatternResult, error) {
			for i := range rows {
				if rows[i].ID == in.ID {
					rows[i].Approved = in.Approved
					rows[i].Edited = in.Edited
					if in.Edited {
						edited := []string{}
						if in.EditedName != "" && in.EditedName != rows[i].Name {
							rows[i].Name = in.EditedName
							edited = append(edited, "name")
						}
						if in.EditedDisplayName != "" && in.EditedDisplayName != rows[i].DisplayName {
							rows[i].DisplayName = in.EditedDisplayName
							edited = append(edited, "display_name")
						}
						if in.EditedDescription != "" && in.EditedDescription != rows[i].Description {
							rows[i].Description = in.EditedDescription
							edited = append(edited, "description")
						}
						if in.EditedCategory != "" && in.EditedCategory != rows[i].Category {
							rows[i].Category = in.EditedCategory
							edited = append(edited, "category")
						}
						if in.EditedTemplateJSON != "" && in.EditedTemplateJSON != rows[i].TemplateJSON {
							rows[i].TemplateJSON = in.EditedTemplateJSON
							edited = append(edited, "template_json")
						}
						rows[i].EditedFields = edited
						return agentactivity.ResolvePatternResult{
							ID:               in.ID,
							Status:           "approved",
							PatternVersionID: "ver-" + in.ID,
							EditedFields:     edited,
						}, nil
					}
					return agentactivity.ResolvePatternResult{ID: in.ID, Status: "approved"}, nil
				}
			}
			return agentactivity.ResolvePatternResult{ID: in.ID, Status: "approved"}, nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivityResolvePattern},
	)

	llm := &scriptedLLM{
		steps: []agentactivity.LLMNextStepResult{
			// Step 1: propose a new pattern.
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-pat", Name: ToolProposePattern, Arguments: map[string]any{
						"name":              "static_site_render",
						"display_name":      "Static site on Render",
						"description":       "Deploy a static site to render.com.",
						"category":          "static-site",
						"template_kind":     "shell",
						"template_json":     `{"command":"render deploy --project={{project}}"}`,
						"input_schema_json": `{"type":"object","properties":{"project":{"type":"string"}}}`,
						"reasoning":         "Common deployment we should productize.",
					}},
				},
				StopReason: "tool_use",
			},
			// Step 2: done.
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-done", Name: ToolDone, Arguments: map[string]any{"summary": "proposed"}},
				},
				StopReason: "tool_use",
			},
		},
	}
	env.RegisterActivityWithOptions(llm.Run, activity.RegisterOptions{Name: ActivityLLMNextStep})

	// Approve with admin edits: rename display name + tweak template.
	env.RegisterDelayedCallback(func() {
		q, err := env.QueryWorkflow(AgentQuerySnapshot)
		require.NoError(t, err)
		var snap AgentSnapshot
		require.NoError(t, q.Get(&snap))
		require.Len(t, snap.PendingApprovals, 1)
		require.Equal(t, agentcontract.ApprovalKindPatternRegistration, snap.PendingApprovals[0].Kind)
		env.SignalWorkflow(AgentSignalApproval, ApprovalSignalPayload{
			ApprovalID:         snap.PendingApprovals[0].ApprovalID,
			Approved:           true,
			ResolvedBy:         "platform-admin",
			Edited:             true,
			EditedDisplayName:  "Render Static Site",
			EditedTemplateJSON: `{"command":"render-cli deploy --project={{project}} --confirm"}`,
		})
	}, 100*time.Millisecond)

	env.ExecuteWorkflow(InfrastructureAgentWorkflow, InfrastructureAgentInput{
		AgentRunID:    "run-pat",
		WorkspaceID:   "ws-1",
		LLMProviderID: "prov-1",
		InitialPrompt: "propose a pattern",
	})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
	require.Equal(t, int32(2), llm.calls.Load(), "expected 2 LLM steps")

	// Row was created with the admin-curated values.
	require.Len(t, rows, 1)
	require.True(t, rows[0].Approved)
	require.Equal(t, "Render Static Site", rows[0].DisplayName, "edited display name should land")
	require.Contains(t, rows[0].TemplateJSON, "render-cli", "edited template should land")
	require.ElementsMatch(t, []string{"display_name", "template_json"}, rows[0].EditedFields)

	// The tool result fed back to the agent on step 2 must include the
	// final + agent_proposed diff so the LLM can adapt.
	require.Len(t, llm.captured, 2)
	var resultContent string
	for _, m := range llm.captured[1].Messages {
		if m.Role == providers.RoleTool && m.ToolCallID == "tc-pat" {
			resultContent = m.Content
		}
	}
	require.NotEmpty(t, resultContent, "pattern tool result missing from step 2 history")
	require.Contains(t, resultContent, `"approved":true`)
	require.Contains(t, resultContent, `"edited":true`)
	require.Contains(t, resultContent, `"display_name":"Render Static Site"`)
	require.Contains(t, resultContent, `"pattern_id":"pat-0"`)
}

func TestInfrastructureAgentWorkflow_ProposePatternRejectsBuiltInNameCollision(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)

	// We do NOT register the pattern registry activities — the dispatch
	// must short-circuit on the built-in-name check before calling them.
	llm := &scriptedLLM{
		steps: []agentactivity.LLMNextStepResult{
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-pat", Name: ToolProposePattern, Arguments: map[string]any{
						// shell_exec is a built-in tool — must be rejected.
						"name":              "shell_exec",
						"display_name":      "Shell exec via pattern",
						"description":       "trying to shadow a built-in",
						"category":          "compute",
						"template_kind":     "shell",
						"template_json":     `{"command":"echo {{x}}"}`,
						"input_schema_json": `{"type":"object","properties":{"x":{"type":"string"}}}`,
					}},
				},
				StopReason: "tool_use",
			},
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-done", Name: ToolDone, Arguments: map[string]any{"summary": "tried"}},
				},
				StopReason: "tool_use",
			},
		},
	}
	env.RegisterActivityWithOptions(llm.Run, activity.RegisterOptions{Name: ActivityLLMNextStep})

	env.ExecuteWorkflow(InfrastructureAgentWorkflow, InfrastructureAgentInput{
		AgentRunID:    "run-pat-collide",
		WorkspaceID:   "ws-1",
		LLMProviderID: "prov-1",
		InitialPrompt: "propose a colliding pattern",
	})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
	// The tool result on step 2 must carry the collision error and NOT a
	// pattern_id (since the dispatch short-circuited before the activity).
	require.GreaterOrEqual(t, len(llm.captured), 2)
	var resultContent string
	for _, m := range llm.captured[1].Messages {
		if m.Role == providers.RoleTool && m.ToolCallID == "tc-pat" {
			resultContent = m.Content
		}
	}
	require.Contains(t, resultContent, "built-in tool", "should explain the collision to the agent")
	require.NotContains(t, resultContent, `"pattern_id"`)
}
