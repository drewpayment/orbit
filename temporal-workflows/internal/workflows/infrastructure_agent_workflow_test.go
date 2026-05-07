package workflows

import (
	"context"
	"fmt"
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

// registerSandboxStubs satisfies the workflow's EnsureSandbox / Teardown /
// ListApprovedAgentTools activity calls in the test environment with no-op
// implementations. The list-approved stub returns an empty catalog; tests
// that exercise registered-tool dispatch override it explicitly.
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
