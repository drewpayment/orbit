package workflows

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/testsuite"

	"github.com/drewpayment/orbit/temporal-workflows/internal/activities"
	agentactivity "github.com/drewpayment/orbit/temporal-workflows/internal/activities/agent"
	"github.com/drewpayment/orbit/temporal-workflows/internal/agent/providers"
	"github.com/drewpayment/orbit/temporal-workflows/pkg/agentcontract"
)

// registerSandboxStubs satisfies the workflow's infrastructure-side
// activity calls in the test environment with no-op implementations:
// EnsureSandbox / Teardown / ListApprovedAgentTools / UpdateAgentRun.
// Tests that exercise specific dispatches (e.g. shell_exec, register_tool)
// override individual activities explicitly.
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
	env.RegisterActivityWithOptions(
		func(_ context.Context, _ agentactivity.ListApprovedToolsInput) (agentactivity.ListApprovedToolsResult, error) {
			return agentactivity.ListApprovedToolsResult{}, nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivityListApprovedAgentTools},
	)
	// Phase-2 Patterns catalog refresh — called at the top of every LLM
	// iteration alongside ListApprovedAgentTools. Empty result by default
	// so tests that don't care just see an empty catalog.
	env.RegisterActivityWithOptions(
		func(_ context.Context, _ agentactivity.ListApprovedPatternsInput) (agentactivity.ListApprovedPatternsResult, error) {
			return agentactivity.ListApprovedPatternsResult{}, nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivityListApprovedPatterns},
	)
	env.RegisterActivityWithOptions(
		func(_ context.Context, _ agentactivity.UpdateAgentRunInput) error { return nil },
		activity.RegisterOptions{Name: agentcontract.ActivityUpdateAgentRun},
	)
	// Orbit introspection: empty results unless a test overrides.
	env.RegisterActivityWithOptions(
		func(_ context.Context, _ agentactivity.OrbitListAppsInput) (agentactivity.OrbitListAppsResult, error) {
			return agentactivity.OrbitListAppsResult{}, nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivityOrbitListApps},
	)
	env.RegisterActivityWithOptions(
		func(_ context.Context, _ agentactivity.OrbitGetAppInput) (agentactivity.OrbitGetAppResult, error) {
			return agentactivity.OrbitGetAppResult{}, nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivityOrbitGetApp},
	)
	env.RegisterActivityWithOptions(
		func(_ context.Context, _ agentactivity.OrbitListCloudAccountsInput) (agentactivity.OrbitListCloudAccountsResult, error) {
			return agentactivity.OrbitListCloudAccountsResult{}, nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivityOrbitListCloudAccounts},
	)
	// Spike 7 commit γ — pending-approvals queue activities. Stubs return
	// a synthetic row id; tests that care assert on an explicit override.
	env.RegisterActivityWithOptions(
		func(_ context.Context, _ agentactivity.OpenPendingApprovalInput) (agentactivity.OpenPendingApprovalResult, error) {
			return agentactivity.OpenPendingApprovalResult{ID: "row-stub"}, nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivityOpenPendingApproval},
	)
	env.RegisterActivityWithOptions(
		func(_ context.Context, _ agentactivity.ResolvePendingApprovalInput) error { return nil },
		activity.RegisterOptions{Name: agentcontract.ActivityResolvePendingApproval},
	)
	// Durable transcript persistence — the workflow flushes batches at every
	// barrier and before continue-as-new / return. No-op stub unless a test
	// installs a capturing recorder via registerEventRecorder.
	env.RegisterActivityWithOptions(
		func(_ context.Context, _ agentactivity.PersistAgentEventsInput) error { return nil },
		activity.RegisterOptions{Name: agentcontract.ActivityPersistAgentEvents},
	)
}

// eventRecorder captures every PersistAgentEvents batch the workflow flushes,
// so flush-barrier tests can assert the durable transcript is complete and
// monotonic. Safe for concurrent activity invocations.
type eventRecorder struct {
	mu       sync.Mutex
	batches  [][]agentactivity.AgentEventWire
	failNext atomic.Int32 // when >0, the next N calls return an error (decremented)
}

func (r *eventRecorder) persist(_ context.Context, in agentactivity.PersistAgentEventsInput) error {
	if r.failNext.Load() > 0 {
		r.failNext.Add(-1)
		return fmt.Errorf("simulated transient persist failure")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.batches = append(r.batches, in.Events)
	return nil
}

// allEvents flattens the captured batches in flush order.
func (r *eventRecorder) allEvents() []agentactivity.AgentEventWire {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []agentactivity.AgentEventWire
	for _, b := range r.batches {
		out = append(out, b...)
	}
	return out
}

// registerEventRecorder overrides the no-op PersistAgentEvents stub with the
// capturing recorder. Must be called AFTER registerSandboxStubs.
func registerEventRecorder(env *testsuite.TestWorkflowEnvironment, r *eventRecorder) {
	env.RegisterActivityWithOptions(r.persist, activity.RegisterOptions{Name: agentcontract.ActivityPersistAgentEvents})
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

func TestInfrastructureAgentWorkflow_RequestApprovalBlocksThenResolves(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)

	llm := &scriptedLLM{
		steps: []agentactivity.LLMNextStepResult{
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-approve", Name: ToolRequestApproval, Arguments: map[string]any{
						"title":         "Run terraform apply",
						"kind":          "destructive_command",
						"body_markdown": "About to apply 17 changes.",
					}},
				},
				StopReason: "tool_use",
			},
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-done", Name: ToolDone, Arguments: map[string]any{"summary": "applied"}},
				},
				StopReason: "tool_use",
			},
		},
	}
	env.RegisterActivityWithOptions(llm.Run, activity.RegisterOptions{Name: ActivityLLMNextStep})

	// Approval signal arrives a moment after the workflow surfaces the
	// approval request. The workflow should block in awaitApproval until it
	// arrives, then resume.
	env.RegisterDelayedCallback(func() {
		// Read the workflow's pending approvals to discover the approval id
		// the workflow generated, then signal it.
		queryRes, err := env.QueryWorkflow(AgentQuerySnapshot)
		require.NoError(t, err)
		var snap AgentSnapshot
		require.NoError(t, queryRes.Get(&snap))
		require.Len(t, snap.PendingApprovals, 1, "expected one pending approval")

		env.SignalWorkflow(AgentSignalApproval, ApprovalSignalPayload{
			ApprovalID: snap.PendingApprovals[0].ApprovalID,
			Approved:   true,
			ResolvedBy: "admin-1",
			Notes:      "lgtm",
		})
	}, 100*time.Millisecond)

	env.ExecuteWorkflow(InfrastructureAgentWorkflow, InfrastructureAgentInput{
		AgentRunID:    "run-approve",
		WorkspaceID:   "ws-1",
		LLMProviderID: "prov-1",
		InitialPrompt: "do destructive thing",
	})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
	require.Equal(t, int32(2), llm.calls.Load(), "expected 2 LLM steps")

	// The second LLM call must have seen the approval result in its history.
	require.Len(t, llm.captured, 2)
	var found bool
	for _, m := range llm.captured[1].Messages {
		if m.Role == providers.RoleTool && m.ToolCallID == "tc-approve" {
			require.Contains(t, m.Content, `"approved":true`)
			require.Contains(t, m.Content, `"resolved_by":"admin-1"`)
			found = true
		}
	}
	require.True(t, found, "approval result not in LLM history")
}

func TestInfrastructureAgentWorkflow_RequestApprovalRejectionFedBack(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)

	llm := &scriptedLLM{
		steps: []agentactivity.LLMNextStepResult{
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-approve", Name: ToolRequestApproval, Arguments: map[string]any{
						"title":         "Drop the prod database",
						"kind":          "destructive_command",
						"body_markdown": "DROP TABLE users;",
					}},
				},
				StopReason: "tool_use",
			},
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-done", Name: ToolDone, Arguments: map[string]any{"summary": "aborted"}},
				},
				StopReason: "tool_use",
			},
		},
	}
	env.RegisterActivityWithOptions(llm.Run, activity.RegisterOptions{Name: ActivityLLMNextStep})

	env.RegisterDelayedCallback(func() {
		q, err := env.QueryWorkflow(AgentQuerySnapshot)
		require.NoError(t, err)
		var snap AgentSnapshot
		require.NoError(t, q.Get(&snap))
		require.Len(t, snap.PendingApprovals, 1)
		env.SignalWorkflow(AgentSignalApproval, ApprovalSignalPayload{
			ApprovalID: snap.PendingApprovals[0].ApprovalID,
			Approved:   false,
			ResolvedBy: "admin-2",
			Notes:      "absolutely not",
		})
	}, 50*time.Millisecond)

	env.ExecuteWorkflow(InfrastructureAgentWorkflow, InfrastructureAgentInput{
		AgentRunID:    "run-reject",
		WorkspaceID:   "ws-1",
		LLMProviderID: "prov-1",
		InitialPrompt: "drop the table",
	})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	require.Len(t, llm.captured, 2)
	var found bool
	for _, m := range llm.captured[1].Messages {
		if m.Role == providers.RoleTool && m.ToolCallID == "tc-approve" {
			require.Contains(t, m.Content, `"approved":false`)
			require.Contains(t, m.Content, "absolutely not")
			found = true
		}
	}
	require.True(t, found, "rejection result not in LLM history")
}

func TestInfrastructureAgentWorkflow_RegisterToolFullRoundTrip(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()

	// Default sandbox stubs.
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
	env.RegisterActivityWithOptions(
		func(_ context.Context, _ agentactivity.UpdateAgentRunInput) error { return nil },
		activity.RegisterOptions{Name: agentcontract.ActivityUpdateAgentRun},
	)

	// Mutable shared state: registry "database".
	type entry struct {
		ID, Name, TemplateKind, TemplateJSON, Description, InputSchemaJSON string
		Approved                                                           bool
	}
	rows := []entry{}

	// list-approved returns rows that have been Approved.
	env.RegisterActivityWithOptions(
		func(_ context.Context, _ agentactivity.ListApprovedToolsInput) (agentactivity.ListApprovedToolsResult, error) {
			out := []agentactivity.ApprovedAgentTool{}
			for _, r := range rows {
				if r.Approved {
					out = append(out, agentactivity.ApprovedAgentTool{
						ID: r.ID, Name: r.Name, TemplateKind: r.TemplateKind, TemplateJSON: r.TemplateJSON,
						Description: r.Description, InputSchemaJSON: r.InputSchemaJSON,
					})
				}
			}
			return agentactivity.ListApprovedToolsResult{Tools: out}, nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivityListApprovedAgentTools},
	)

	// Phase-2 patterns refresh — called at the top of every LLM iteration.
	// This test doesn't exercise the catalog so an empty stub suffices.
	env.RegisterActivityWithOptions(
		func(_ context.Context, _ agentactivity.ListApprovedPatternsInput) (agentactivity.ListApprovedPatternsResult, error) {
			return agentactivity.ListApprovedPatternsResult{}, nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivityListApprovedPatterns},
	)

	// register-pending appends a row.
	env.RegisterActivityWithOptions(
		func(_ context.Context, in agentactivity.RegisterPendingToolInput) (agentactivity.RegisterPendingToolResult, error) {
			rows = append(rows, entry{
				ID:              fmt.Sprintf("row-%d", len(rows)),
				Name:            in.Name,
				TemplateKind:    in.TemplateKind,
				TemplateJSON:    in.TemplateJSON,
				Description:     in.Description,
				InputSchemaJSON: in.InputSchemaJSON,
			})
			return agentactivity.RegisterPendingToolResult{ID: rows[len(rows)-1].ID}, nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivityRegisterPendingAgentTool},
	)

	// resolve flips approved on the matching row.
	env.RegisterActivityWithOptions(
		func(_ context.Context, in agentactivity.ResolveAgentToolInput) error {
			for i := range rows {
				if rows[i].ID == in.ID {
					rows[i].Approved = in.Approved
				}
			}
			return nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivityResolveAgentTool},
	)

	// shell stub; capture invocations to assert the registered tool's
	// template was expanded correctly.
	var shellCalls []agentactivity.SandboxedShellInput
	env.RegisterActivityWithOptions(
		func(_ context.Context, in agentactivity.SandboxedShellInput) (agentactivity.SandboxedShellResult, error) {
			shellCalls = append(shellCalls, in)
			return agentactivity.SandboxedShellResult{ExitCode: 0, Stdout: "deployed\n"}, nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivitySandboxedShell},
	)

	llm := &scriptedLLM{
		steps: []agentactivity.LLMNextStepResult{
			// Step 1: register a new shell-kind tool.
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-reg", Name: ToolRegisterTool, Arguments: map[string]any{
						"name":              "deploy_thing",
						"description":       "Deploy a thing.",
						"template_kind":     "shell",
						"template_json":     `{"command":"echo deploying {{name}}"}`,
						"input_schema_json": `{"type":"object","properties":{"name":{"type":"string"}}}`,
						"reasoning":         "useful procedure",
					}},
				},
				StopReason: "tool_use",
			},
			// Step 2: invoke the now-approved tool by name.
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-invoke", Name: "deploy_thing", Arguments: map[string]any{"name": "demo"}},
				},
				StopReason: "tool_use",
			},
			// Step 3: done.
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-done", Name: ToolDone, Arguments: map[string]any{"summary": "done"}},
				},
				StopReason: "tool_use",
			},
		},
	}
	env.RegisterActivityWithOptions(llm.Run, activity.RegisterOptions{Name: ActivityLLMNextStep})

	// Approve the registration once it appears in pending.
	env.RegisterDelayedCallback(func() {
		q, err := env.QueryWorkflow(AgentQuerySnapshot)
		require.NoError(t, err)
		var snap AgentSnapshot
		require.NoError(t, q.Get(&snap))
		require.Len(t, snap.PendingApprovals, 1)
		require.Equal(t, agentcontract.ApprovalKindToolRegistration, snap.PendingApprovals[0].Kind)
		env.SignalWorkflow(AgentSignalApproval, ApprovalSignalPayload{
			ApprovalID: snap.PendingApprovals[0].ApprovalID,
			Approved:   true,
			ResolvedBy: "admin",
		})
	}, 100*time.Millisecond)

	env.ExecuteWorkflow(InfrastructureAgentWorkflow, InfrastructureAgentInput{
		AgentRunID:    "run-reg",
		WorkspaceID:   "ws-1",
		LLMProviderID: "prov-1",
		InitialPrompt: "register a tool then use it",
	})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
	require.Equal(t, int32(3), llm.calls.Load(), "expected 3 LLM steps")

	// Row was created and approved.
	require.Len(t, rows, 1)
	require.True(t, rows[0].Approved, "row should be approved post-resolve")

	// Step 3's LLM call must have seen the registered tool in its catalog.
	require.Len(t, llm.captured, 3)
	var sawRegisteredInCatalog bool
	for _, t := range llm.captured[1].Tools {
		if t.Name == "deploy_thing" {
			sawRegisteredInCatalog = true
		}
	}
	require.True(t, sawRegisteredInCatalog, "registered tool not in catalog for step 2")

	// The registered tool's template expanded: shell_exec should have been
	// called with the substituted command.
	require.Len(t, shellCalls, 1)
	require.Contains(t, shellCalls[0].Command, "echo deploying 'demo'")
}

func TestInfrastructureAgentWorkflow_RegisterToolRejectionDoesNotApprove(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)

	rejected := false
	env.RegisterActivityWithOptions(
		func(_ context.Context, in agentactivity.RegisterPendingToolInput) (agentactivity.RegisterPendingToolResult, error) {
			return agentactivity.RegisterPendingToolResult{ID: "row-1"}, nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivityRegisterPendingAgentTool},
	)
	env.RegisterActivityWithOptions(
		func(_ context.Context, in agentactivity.ResolveAgentToolInput) error {
			require.False(t, in.Approved)
			require.Equal(t, "row-1", in.ID)
			rejected = true
			return nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivityResolveAgentTool},
	)

	llm := &scriptedLLM{
		steps: []agentactivity.LLMNextStepResult{
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-reg", Name: ToolRegisterTool, Arguments: map[string]any{
						"name":          "danger_tool",
						"description":   "drops all data",
						"template_kind": "shell",
						"template_json": `{"command":"rm -rf /"}`,
					}},
				},
				StopReason: "tool_use",
			},
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-done", Name: ToolDone, Arguments: map[string]any{"summary": "blocked"}},
				},
				StopReason: "tool_use",
			},
		},
	}
	env.RegisterActivityWithOptions(llm.Run, activity.RegisterOptions{Name: ActivityLLMNextStep})

	env.RegisterDelayedCallback(func() {
		q, err := env.QueryWorkflow(AgentQuerySnapshot)
		require.NoError(t, err)
		var snap AgentSnapshot
		require.NoError(t, q.Get(&snap))
		require.Len(t, snap.PendingApprovals, 1)
		env.SignalWorkflow(AgentSignalApproval, ApprovalSignalPayload{
			ApprovalID: snap.PendingApprovals[0].ApprovalID,
			Approved:   false,
			ResolvedBy: "admin",
			Notes:      "no",
		})
	}, 100*time.Millisecond)

	env.ExecuteWorkflow(InfrastructureAgentWorkflow, InfrastructureAgentInput{
		AgentRunID:    "run-reg-rej",
		WorkspaceID:   "ws-1",
		LLMProviderID: "prov-1",
		InitialPrompt: "try to register danger",
	})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
	require.True(t, rejected, "resolve should have been called with approved=false")
}

func TestInfrastructureAgentWorkflow_StartHealthCheckWritesAppHealthConfig(t *testing.T) {
	// Unified path (GitHub issue #44): start_child_health_check no longer
	// spawns a child workflow. It executes the ConfigureAppHealthCheck
	// activity, which writes app.healthConfig via Payload's internal API.
	// The Apps afterChange hook then drives the canonical HealthCheckWorkflow.
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)

	// Capture the activity invocation. If the workflow still tried to
	// spawn a child HealthCheckWorkflow, the test environment would fail
	// because we haven't registered it.
	var configureCalls int
	var capturedInput activities.ConfigureAppHealthCheckInput
	env.RegisterActivityWithOptions(
		func(_ context.Context, in activities.ConfigureAppHealthCheckInput) error {
			configureCalls++
			capturedInput = in
			return nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivityConfigureAppHealthCheck},
	)

	llm := &scriptedLLM{
		steps: []agentactivity.LLMNextStepResult{
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-hc", Name: ToolStartHealthCheck, Arguments: map[string]any{
						"app_id":   "app-123",
						"url":      "https://example.com/healthz",
						"interval": float64(45),
					}},
				},
				StopReason: "tool_use",
			},
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-done", Name: ToolDone, Arguments: map[string]any{"summary": "monitored"}},
				},
				StopReason: "tool_use",
			},
		},
	}
	env.RegisterActivityWithOptions(llm.Run, activity.RegisterOptions{Name: ActivityLLMNextStep})

	env.ExecuteWorkflow(InfrastructureAgentWorkflow, InfrastructureAgentInput{
		AgentRunID:    "run-hc",
		WorkspaceID:   "ws-1",
		LLMProviderID: "prov-1",
		InitialPrompt: "deploy and monitor",
	})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
	require.Equal(t, 1, configureCalls, "expected ConfigureAppHealthCheck to be called exactly once")
	require.Equal(t, "app-123", capturedInput.AppID)
	require.Equal(t, "https://example.com/healthz", capturedInput.Spec.URL)
	require.Equal(t, 45, capturedInput.Spec.Interval)
	// Defaults from the dispatcher.
	require.Equal(t, "GET", capturedInput.Spec.Method)
	require.Equal(t, 200, capturedInput.Spec.ExpectedStatus)
	require.Equal(t, 10, capturedInput.Spec.Timeout)

	// Tool result fed back to the second LLM call must reference the
	// canonical workflow id (stable, no timestamp) and the managed_by tag
	// so the LLM understands lifecycle isn't its problem.
	require.Len(t, llm.captured, 2)
	var found bool
	for _, m := range llm.captured[1].Messages {
		if m.Role == providers.RoleTool && m.ToolCallID == "tc-hc" {
			require.Contains(t, m.Content, `"workflow_id":"health-check-app-123"`)
			require.Contains(t, m.Content, `"managed_by":"orbit-apps-hook"`)
			require.Contains(t, m.Content, `"interval_seconds":45`)
			found = true
		}
	}
	require.True(t, found, "health check result not in LLM history")
}

func TestInfrastructureAgentWorkflow_StartHealthCheckRequiresAppIDAndURL(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)

	llm := &scriptedLLM{
		steps: []agentactivity.LLMNextStepResult{
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-hc", Name: ToolStartHealthCheck, Arguments: map[string]any{}},
				},
				StopReason: "tool_use",
			},
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-done", Name: ToolDone, Arguments: map[string]any{"summary": "n/a"}},
				},
				StopReason: "tool_use",
			},
		},
	}
	env.RegisterActivityWithOptions(llm.Run, activity.RegisterOptions{Name: ActivityLLMNextStep})

	env.ExecuteWorkflow(InfrastructureAgentWorkflow, InfrastructureAgentInput{
		AgentRunID:    "run-hc-bad",
		WorkspaceID:   "ws-1",
		LLMProviderID: "prov-1",
		InitialPrompt: "monitor without args",
	})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	// The agent should see an error result and adapt.
	require.Len(t, llm.captured, 2)
	var found bool
	for _, m := range llm.captured[1].Messages {
		if m.Role == providers.RoleTool && m.ToolCallID == "tc-hc" {
			require.Contains(t, m.Content, `"error"`)
			require.Contains(t, m.Content, "app_id and url are required")
			found = true
		}
	}
	require.True(t, found, "validation error not in LLM history")
}

func TestInfrastructureAgentWorkflow_AuditTrailTracksTerminalCompletion(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()

	// Sandbox + tools stubs.
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
	env.RegisterActivityWithOptions(
		func(_ context.Context, _ agentactivity.ListApprovedToolsInput) (agentactivity.ListApprovedToolsResult, error) {
			return agentactivity.ListApprovedToolsResult{}, nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivityListApprovedAgentTools},
	)

	// Capture every UpdateAgentRun call so the test can assert on the
	// shape of the audit-trail patches.
	var auditCalls []agentactivity.UpdateAgentRunInput
	env.RegisterActivityWithOptions(
		func(_ context.Context, in agentactivity.UpdateAgentRunInput) error {
			auditCalls = append(auditCalls, in)
			return nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivityUpdateAgentRun},
	)

	llm := &scriptedLLM{
		steps: []agentactivity.LLMNextStepResult{
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-done", Name: ToolDone, Arguments: map[string]any{"summary": "audit-test summary"}},
				},
				StopReason: "tool_use",
			},
		},
	}
	env.RegisterActivityWithOptions(llm.Run, activity.RegisterOptions{Name: ActivityLLMNextStep})

	env.ExecuteWorkflow(InfrastructureAgentWorkflow, InfrastructureAgentInput{
		AgentRunID:    "run-audit",
		WorkspaceID:   "ws-1",
		LLMProviderID: "prov-1",
		InitialPrompt: "do nothing then finish",
	})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	// Expect at minimum: status=running (post-EnsureSandbox) → status=completed (ToolDone).
	var sawRunning, sawCompleted bool
	for _, c := range auditCalls {
		if c.Status == "running" {
			sawRunning = true
		}
		if c.Status == "completed" && c.Summary == "audit-test summary" && c.EndedAt != "" {
			sawCompleted = true
		}
	}
	require.True(t, sawRunning, "expected running status update; got %+v", auditCalls)
	require.True(t, sawCompleted, "expected completed status update with summary + endedAt; got %+v", auditCalls)
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
