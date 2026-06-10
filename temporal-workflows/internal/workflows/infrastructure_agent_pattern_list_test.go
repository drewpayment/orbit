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

// TestInfrastructureAgentWorkflow_ListPatternsReturnsCachedCatalog drives
// the Phase-2 catalog-discovery path: the workflow refreshes the platform
// Patterns catalog at the top of every LLM iteration, and the agent
// retrieves it via the list_patterns tool. The tool must return the
// metadata fields the agent needs to pick (name, display_name,
// description, category, current_version, input_schema_json) but not the
// full template_json (which stays bounded for context size).
func TestInfrastructureAgentWorkflow_ListPatternsReturnsCachedCatalog(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)

	// Two patterns in the catalog; refresh activity returns both.
	catalog := []agentactivity.ApprovedPattern{
		{
			ID: "pat-render", Name: "static_site_render", DisplayName: "Render static site",
			Description: "Deploy a static site to render.com.", Category: "static-site",
			TemplateKind: "shell", TemplateJSON: `{"command":"render deploy"}`,
			InputSchemaJSON: `{"type":"object","properties":{"project":{"type":"string"}}}`,
			CurrentVersion:  1,
		},
		{
			ID: "pat-pg", Name: "postgres_small", DisplayName: "Small Postgres",
			Description: "Provision a small managed Postgres.", Category: "data",
			TemplateKind: "shell", TemplateJSON: `{"command":"echo prov"}`,
			InputSchemaJSON: `{"type":"object","properties":{"name":{"type":"string"}}}`,
			CurrentVersion:  2,
		},
	}
	env.RegisterActivityWithOptions(
		func(_ context.Context, _ agentactivity.ListApprovedPatternsInput) (agentactivity.ListApprovedPatternsResult, error) {
			return agentactivity.ListApprovedPatternsResult{Patterns: catalog}, nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivityListApprovedPatterns},
	)

	llm := &scriptedLLM{
		steps: []agentactivity.LLMNextStepResult{
			// Step 1: agent calls list_patterns without a filter.
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-list", Name: ToolListPatterns, Arguments: map[string]any{}},
				},
				StopReason: "tool_use",
			},
			// Step 2: agent calls list_patterns with category filter.
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-list-filter", Name: ToolListPatterns, Arguments: map[string]any{"category": "data"}},
				},
				StopReason: "tool_use",
			},
			// Step 3: done.
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-done", Name: ToolDone, Arguments: map[string]any{"summary": "browsed"}},
				},
				StopReason: "tool_use",
			},
		},
	}
	env.RegisterActivityWithOptions(llm.Run, activity.RegisterOptions{Name: ActivityLLMNextStep})

	env.ExecuteWorkflow(InfrastructureAgentWorkflow, InfrastructureAgentInput{
		AgentRunID:    "run-list",
		WorkspaceID:   "ws-1",
		LLMProviderID: "prov-1",
		InitialPrompt: "what patterns are available",
	})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
	require.Equal(t, int32(3), llm.calls.Load())

	// Step 2's LLM call sees the tool_result of step 1's list_patterns —
	// must contain both catalog entries.
	require.Len(t, llm.captured, 3)
	var unfiltered string
	for _, m := range llm.captured[1].Messages {
		if m.Role == providers.RoleTool && m.ToolCallID == "tc-list" {
			unfiltered = m.Content
		}
	}
	require.NotEmpty(t, unfiltered, "list_patterns result missing from step 2 history")
	require.Contains(t, unfiltered, `"static_site_render"`)
	require.Contains(t, unfiltered, `"postgres_small"`)
	require.Contains(t, unfiltered, `"display_name":"Render static site"`)
	require.Contains(t, unfiltered, `"category":"static-site"`)
	require.Contains(t, unfiltered, `"count":2`)
	// Lightweight metadata only — template_json must NOT be on the wire.
	require.NotContains(t, unfiltered, `"template_json"`)

	// Step 3's LLM call sees the filtered result — only the "data" entry.
	var filtered string
	for _, m := range llm.captured[2].Messages {
		if m.Role == providers.RoleTool && m.ToolCallID == "tc-list-filter" {
			filtered = m.Content
		}
	}
	require.NotEmpty(t, filtered, "filtered list_patterns result missing")
	require.Contains(t, filtered, `"postgres_small"`)
	require.NotContains(t, filtered, `"static_site_render"`)
	require.Contains(t, filtered, `"count":1`)
}

// TestInfrastructureAgentWorkflow_ListPatternsRefreshFailureUsesEmptyCache
// verifies the non-fatal refresh behavior: a failing ListApprovedPatterns
// activity must NOT crash the workflow; list_patterns simply returns an
// empty catalog. (Refresh is best-effort; the agent still has built-ins
// and registered tools.)
func TestInfrastructureAgentWorkflow_ListPatternsRefreshFailureUsesEmptyCache(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)

	env.RegisterActivityWithOptions(
		func(_ context.Context, _ agentactivity.ListApprovedPatternsInput) (agentactivity.ListApprovedPatternsResult, error) {
			return agentactivity.ListApprovedPatternsResult{}, errPatternsUnreachable
		},
		activity.RegisterOptions{Name: agentcontract.ActivityListApprovedPatterns},
	)

	llm := &scriptedLLM{
		steps: []agentactivity.LLMNextStepResult{
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-list", Name: ToolListPatterns, Arguments: map[string]any{}},
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
		AgentRunID:    "run-list-fail",
		WorkspaceID:   "ws-1",
		LLMProviderID: "prov-1",
		InitialPrompt: "what's available",
	})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError(), "refresh failure must be non-fatal")
	require.Equal(t, int32(2), llm.calls.Load())

	// list_patterns result must report empty catalog, not error.
	var content string
	for _, m := range llm.captured[1].Messages {
		if m.Role == providers.RoleTool && m.ToolCallID == "tc-list" {
			content = m.Content
		}
	}
	require.NotEmpty(t, content)
	require.Contains(t, content, `"count":0`)
}

// TestInfrastructureAgentWorkflow_NewlyApprovedPatternVisibleNextIteration
// confirms the catalog refreshes between iterations — a pattern that
// becomes "approved" between step N and step N+1 must appear in step
// N+1's list_patterns result without restarting the run.
func TestInfrastructureAgentWorkflow_NewlyApprovedPatternVisibleNextIteration(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)

	var refreshCalls int
	approved := []agentactivity.ApprovedPattern{}
	env.RegisterActivityWithOptions(
		func(_ context.Context, _ agentactivity.ListApprovedPatternsInput) (agentactivity.ListApprovedPatternsResult, error) {
			refreshCalls++
			return agentactivity.ListApprovedPatternsResult{
				Patterns: append([]agentactivity.ApprovedPattern(nil), approved...),
			}, nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivityListApprovedPatterns},
	)

	// Flip a pattern into "approved" 75ms in, while the workflow is
	// blocked on its first user-message wait — i.e., between iterations.
	env.RegisterDelayedCallback(func() {
		approved = append(approved, agentactivity.ApprovedPattern{
			ID: "pat-late", Name: "late_arrival", DisplayName: "Late arrival",
			Description: "Approved mid-run.", Category: "other",
			TemplateKind: "shell", TemplateJSON: `{"command":"true"}`,
			InputSchemaJSON: `{"type":"object"}`, CurrentVersion: 1,
		})
		env.SignalWorkflow(AgentSignalUserMessage, UserMessageSignalPayload{
			TurnID: "u1", UserID: "u1", Message: "now list again",
		})
	}, 75*time.Millisecond)

	llm := &scriptedLLM{
		steps: []agentactivity.LLMNextStepResult{
			// Iter 1: list_patterns — catalog is empty.
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-l1", Name: ToolListPatterns, Arguments: map[string]any{}},
				},
				StopReason: "tool_use",
			},
			// Iter 2: propose_to_user (blocks awaiting user). The delayed
			// callback above approves a pattern AND sends the user reply.
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-prop", Name: ToolProposeToUser, Arguments: map[string]any{
						"title": "wait", "summary": "wait", "body_markdown": "...",
					}},
				},
				StopReason: "tool_use",
			},
			// Iter 3: list_patterns — must now see the late_arrival entry.
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-l2", Name: ToolListPatterns, Arguments: map[string]any{}},
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
		AgentRunID:    "run-list-refresh",
		WorkspaceID:   "ws-1",
		LLMProviderID: "prov-1",
		InitialPrompt: "list patterns please",
	})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
	require.GreaterOrEqual(t, refreshCalls, 3, "refresh should run at the top of each LLM iteration")

	// Iter 1's list_patterns result: empty.
	require.GreaterOrEqual(t, len(llm.captured), 4)
	var iter1, iter3 string
	for _, m := range llm.captured[1].Messages {
		if m.Role == providers.RoleTool && m.ToolCallID == "tc-l1" {
			iter1 = m.Content
		}
	}
	for _, m := range llm.captured[3].Messages {
		if m.Role == providers.RoleTool && m.ToolCallID == "tc-l2" {
			iter3 = m.Content
		}
	}
	require.Contains(t, iter1, `"count":0`, "iter 1 must see empty catalog")
	require.Contains(t, iter3, `"late_arrival"`, "iter 3 must see the newly-approved pattern")
	require.Contains(t, iter3, `"count":1`)
}

// errPatternsUnreachable is the synthetic error the refresh-failure test
// returns to simulate an internal-API outage.
var errPatternsUnreachable = newSimpleErr("patterns api unreachable")

type simpleErr string

func (s simpleErr) Error() string { return string(s) }
func newSimpleErr(s string) error { return simpleErr(s) }
