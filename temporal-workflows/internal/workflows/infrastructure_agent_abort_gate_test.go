package workflows

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/testsuite"

	agentactivity "github.com/drewpayment/orbit/temporal-workflows/internal/activities/agent"
	"github.com/drewpayment/orbit/temporal-workflows/internal/agent/providers"
	"github.com/drewpayment/orbit/temporal-workflows/pkg/agentcontract"
)

// BUG-3: aborting a run parked at an approval gate must preempt the gate
// wait promptly — even when the audit (UpdateAgentRun) write is slow/hung.
// The abort goroutine previously ran the BLOCKING markRun activity BEFORE
// cancelLoop(), so a slow agent-runs API kept the gate parked (QA saw the
// run stay awaiting_approval for >21s despite repeated SignalAbort).
//
// This test makes the aborted-status audit write block on a latch the test
// only releases AFTER asserting the workflow already terminated. If
// cancelLoop() were still gated behind that audit write, the workflow could
// not complete and the test would deadlock/time out.
func TestAbortAtGate_PreemptsBeforeSlowAudit(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)

	var (
		mu              sync.Mutex
		abortAuditSeen  bool
		releaseAudit    = make(chan struct{})
	)
	// Override UpdateAgentRun: the terminal "aborted" write blocks until the
	// test releases it; all other writes pass through instantly.
	env.RegisterActivityWithOptions(
		func(_ context.Context, in agentactivity.UpdateAgentRunInput) error {
			if in.Status == "aborted" {
				mu.Lock()
				abortAuditSeen = true
				mu.Unlock()
				<-releaseAudit
			}
			return nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivityUpdateAgentRun},
	)

	llm := &scriptedLLM{
		steps: []agentactivity.LLMNextStepResult{
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-req", Name: ToolRequestApproval, Arguments: map[string]any{
						"title": "Confirm", "kind": "custom", "body_markdown": "?",
					}},
				},
				StopReason: "tool_use",
			},
		},
	}
	env.RegisterActivityWithOptions(llm.Run, activity.RegisterOptions{Name: ActivityLLMNextStep})

	env.RegisterDelayedCallback(func() {
		var snap AgentSnapshot
		for i := 0; i < 20; i++ {
			q, err := env.QueryWorkflow(AgentQuerySnapshot)
			require.NoError(t, err)
			require.NoError(t, q.Get(&snap))
			if snap.Status == "awaiting_approval" {
				break
			}
		}
		require.Equal(t, "awaiting_approval", snap.Status)
		env.SignalWorkflow(AgentSignalAbort, AbortSignalPayload{RequestedBy: "u", Reason: "stop"})
		// Release the (slow) aborted-status audit shortly after, so the test
		// doesn't hang regardless of ordering; the key assertion is that the
		// run terminates rather than wedging.
		go func() {
			time.Sleep(50 * time.Millisecond)
			close(releaseAudit)
		}()
	}, 100*time.Millisecond)

	env.ExecuteWorkflow(InfrastructureAgentWorkflow, InfrastructureAgentInput{
		AgentRunID: "run-abort-gate", WorkspaceID: "ws-1", LLMProviderID: "p", InitialPrompt: "x",
	})

	require.True(t, env.IsWorkflowCompleted(), "abort at gate must terminate the run, not wedge")
	require.NoError(t, env.GetWorkflowError())
	mu.Lock()
	require.True(t, abortAuditSeen, "expected the aborted-status audit write to be attempted")
	mu.Unlock()
}

// Abort while parked at a tool_registration gate: the run terminates aborted
// and the tool row + pending-approval row are resolved as aborted.
func TestAbortAtGate_ToolRegistration(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)
	rec := &pendingApprovalsRecorder{}
	rec.Register(env, "row-reg")

	var toolResolved agentactivity.ResolveAgentToolInput
	var toolMu sync.Mutex
	env.RegisterActivityWithOptions(
		func(_ context.Context, _ agentactivity.RegisterPendingToolInput) (agentactivity.RegisterPendingToolResult, error) {
			return agentactivity.RegisterPendingToolResult{ID: "tool-1"}, nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivityRegisterPendingAgentTool},
	)
	env.RegisterActivityWithOptions(
		func(_ context.Context, in agentactivity.ResolveAgentToolInput) (agentactivity.ResolveAgentToolResult, error) {
			toolMu.Lock()
			toolResolved = in
			toolMu.Unlock()
			return agentactivity.ResolveAgentToolResult{ID: in.ID, Status: "rejected"}, nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivityResolveAgentTool},
	)

	llm := &scriptedLLM{
		steps: []agentactivity.LLMNextStepResult{
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-reg", Name: ToolRegisterTool, Arguments: map[string]any{
						"name": "deploy_thing", "description": "d", "template_kind": "shell",
						"template_json": `{"command":"echo hi"}`,
					}},
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
			_ = q.Get(&snap)
			if len(snap.PendingApprovals) == 1 {
				break
			}
		}
		require.Len(t, snap.PendingApprovals, 1)
		env.SignalWorkflow(AgentSignalAbort, AbortSignalPayload{RequestedBy: "u", Reason: "stop"})
	}, 100*time.Millisecond)

	env.ExecuteWorkflow(InfrastructureAgentWorkflow, InfrastructureAgentInput{
		AgentRunID: "run-abort-reg", WorkspaceID: "ws-1", LLMProviderID: "p", InitialPrompt: "register",
	})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	toolMu.Lock()
	require.False(t, toolResolved.Approved, "aborted tool gate must reject the tool row")
	toolMu.Unlock()

	rec.mu.Lock()
	defer rec.mu.Unlock()
	require.GreaterOrEqual(t, len(rec.resolves), 1)
	require.Equal(t, "aborted", rec.resolves[len(rec.resolves)-1].in.Status)
}

// Abort while parked at a destructive_command gate (the synthesized gate
// that fires when shell_exec hits a destructive pattern). QA: abort here was
// still a no-op (stuck awaiting_approval >25s) after the tool_registration
// fix. The run must terminate aborted and the pending row resolved aborted.
func TestAbortAtGate_DestructiveCommand(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)
	rec := &pendingApprovalsRecorder{}
	rec.Register(env, "row-destr")

	// SandboxedShell must NOT run for a rejected/aborted destructive command.
	var shellRan bool
	var shellMu sync.Mutex
	env.RegisterActivityWithOptions(
		func(_ context.Context, _ agentactivity.SandboxedShellInput) (agentactivity.SandboxedShellResult, error) {
			shellMu.Lock()
			shellRan = true
			shellMu.Unlock()
			return agentactivity.SandboxedShellResult{ExitCode: 0}, nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivitySandboxedShell},
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
		},
	}
	env.RegisterActivityWithOptions(llm.Run, activity.RegisterOptions{Name: ActivityLLMNextStep})

	env.RegisterDelayedCallback(func() {
		var snap AgentSnapshot
		for i := 0; i < 20; i++ {
			q, _ := env.QueryWorkflow(AgentQuerySnapshot)
			_ = q.Get(&snap)
			if len(snap.PendingApprovals) == 1 {
				break
			}
		}
		require.Len(t, snap.PendingApprovals, 1, "destructive gate must be open")
		require.Equal(t, agentcontract.ApprovalKindDestructiveCmd, snap.PendingApprovals[0].Kind)
		env.SignalWorkflow(AgentSignalAbort, AbortSignalPayload{RequestedBy: "u", Reason: "stop"})
	}, 100*time.Millisecond)

	env.ExecuteWorkflow(InfrastructureAgentWorkflow, InfrastructureAgentInput{
		AgentRunID: "run-abort-destr", WorkspaceID: "ws-1", LLMProviderID: "p", InitialPrompt: "destroy",
	})

	require.True(t, env.IsWorkflowCompleted(), "abort at destructive gate must terminate the run")
	require.NoError(t, env.GetWorkflowError())

	shellMu.Lock()
	require.False(t, shellRan, "destructive command must not execute after abort")
	shellMu.Unlock()

	rec.mu.Lock()
	defer rec.mu.Unlock()
	require.GreaterOrEqual(t, len(rec.resolves), 1)
	require.Equal(t, "aborted", rec.resolves[len(rec.resolves)-1].in.Status)
}

// Reproduces the QA destructive-gate hang: OpenPendingApproval 500s and
// retries (Investigation B's agentRun CastError), so the main coroutine is
// blocked in openPendingApproval's .Get() — BEFORE it reaches awaitApproval —
// when the abort arrives. The abort must still preempt this pre-gate activity
// wait and terminate the run promptly, not hang ~25s for the retries.
func TestAbortAtGate_PreemptsDuringOpenPendingApproval(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)

	// OpenPendingApproval always errors (like the route's 500), forcing the
	// activity into its retry loop where the main coroutine blocks.
	var openAttempts int
	var openMu sync.Mutex
	env.RegisterActivityWithOptions(
		func(_ context.Context, _ agentactivity.OpenPendingApprovalInput) (agentactivity.OpenPendingApprovalResult, error) {
			openMu.Lock()
			openAttempts++
			openMu.Unlock()
			return agentactivity.OpenPendingApprovalResult{}, errors.New("pending-approvals open: HTTP 500: Cast to ObjectId failed")
		},
		activity.RegisterOptions{Name: agentcontract.ActivityOpenPendingApproval},
	)
	env.RegisterActivityWithOptions(
		func(_ context.Context, _ agentactivity.ResolvePendingApprovalInput) error { return nil },
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
		},
	}
	env.RegisterActivityWithOptions(llm.Run, activity.RegisterOptions{Name: ActivityLLMNextStep})

	// Abort shortly after the gate status flips (which happens BEFORE
	// openPendingApproval). The run must terminate promptly regardless of the
	// failing open retries.
	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow(AgentSignalAbort, AbortSignalPayload{RequestedBy: "u", Reason: "stop"})
	}, 200*time.Millisecond)

	env.ExecuteWorkflow(InfrastructureAgentWorkflow, InfrastructureAgentInput{
		AgentRunID: "run-abort-openfail", WorkspaceID: "ws-1", LLMProviderID: "p", InitialPrompt: "destroy",
	})

	require.True(t, env.IsWorkflowCompleted(), "abort must preempt a failing pre-gate openPendingApproval")
	require.NoError(t, env.GetWorkflowError())
}

// Abort while parked at a request_approval gate (the explicit gate the agent
// opens via the request_approval tool). Covers the fourth gate kind.
func TestAbortAtGate_RequestApproval(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)
	rec := &pendingApprovalsRecorder{}
	rec.Register(env, "row-req")

	llm := &scriptedLLM{
		steps: []agentactivity.LLMNextStepResult{
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-req", Name: ToolRequestApproval, Arguments: map[string]any{
						"title": "Confirm", "kind": "custom", "body_markdown": "?",
					}},
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
			_ = q.Get(&snap)
			if len(snap.PendingApprovals) == 1 {
				break
			}
		}
		require.Len(t, snap.PendingApprovals, 1)
		env.SignalWorkflow(AgentSignalAbort, AbortSignalPayload{RequestedBy: "u", Reason: "stop"})
	}, 100*time.Millisecond)

	env.ExecuteWorkflow(InfrastructureAgentWorkflow, InfrastructureAgentInput{
		AgentRunID: "run-abort-req", WorkspaceID: "ws-1", LLMProviderID: "p", InitialPrompt: "confirm something",
	})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	rec.mu.Lock()
	defer rec.mu.Unlock()
	require.GreaterOrEqual(t, len(rec.resolves), 1)
	require.Equal(t, "aborted", rec.resolves[len(rec.resolves)-1].in.Status)
}

// Abort while parked at a propose_pattern gate: same contract.
func TestAbortAtGate_ProposePattern(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)
	rec := &pendingApprovalsRecorder{}
	rec.Register(env, "row-pat")

	env.RegisterActivityWithOptions(
		func(_ context.Context, _ agentactivity.RegisterPendingPatternInput) (agentactivity.RegisterPendingPatternResult, error) {
			return agentactivity.RegisterPendingPatternResult{ID: "pat-1"}, nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivityRegisterPendingPattern},
	)
	var patResolved agentactivity.ResolvePatternInput
	var patMu sync.Mutex
	env.RegisterActivityWithOptions(
		func(_ context.Context, in agentactivity.ResolvePatternInput) (agentactivity.ResolvePatternResult, error) {
			patMu.Lock()
			patResolved = in
			patMu.Unlock()
			return agentactivity.ResolvePatternResult{ID: in.ID, Status: "rejected"}, nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivityResolvePattern},
	)

	llm := &scriptedLLM{
		steps: []agentactivity.LLMNextStepResult{
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-pat", Name: ToolProposePattern, Arguments: map[string]any{
						"name": "deploy_pattern", "display_name": "Deploy", "description": "d",
						"category": "deploy", "template_kind": "shell",
						"template_json":     `{"command":"echo hi"}`,
						"input_schema_json": `{"type":"object"}`,
					}},
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
			_ = q.Get(&snap)
			if len(snap.PendingApprovals) == 1 {
				break
			}
		}
		require.Len(t, snap.PendingApprovals, 1)
		env.SignalWorkflow(AgentSignalAbort, AbortSignalPayload{RequestedBy: "u", Reason: "stop"})
	}, 100*time.Millisecond)

	env.ExecuteWorkflow(InfrastructureAgentWorkflow, InfrastructureAgentInput{
		AgentRunID: "run-abort-pat", WorkspaceID: "ws-1", LLMProviderID: "p", InitialPrompt: "propose pattern",
	})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	patMu.Lock()
	require.False(t, patResolved.Approved, "aborted pattern gate must reject the pattern row")
	patMu.Unlock()

	rec.mu.Lock()
	defer rec.mu.Unlock()
	require.GreaterOrEqual(t, len(rec.resolves), 1)
	require.Equal(t, "aborted", rec.resolves[len(rec.resolves)-1].in.Status)
}
