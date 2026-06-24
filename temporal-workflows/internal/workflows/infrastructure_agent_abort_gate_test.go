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

// SMOKING GUN (run agent-37de985a): a composer UserMessage and an Abort are
// delivered together. The awaiting_user selector consumes the user message
// and runs the LLM step, which returns a destructive shell_exec; previously
// the workflow then opened a destructive_command gate and armed a 72h timer
// AFTER the abort was already in history, because state.terminated wasn't
// re-checked between the LLM step and tool dispatch. The run must instead
// terminate aborted with NO gate opened and NO 72h timer left armed.
func TestAbortAtGate_UserMessageTriggeredGateAfterAbort(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)

	var openCalled bool
	var openMu sync.Mutex
	env.RegisterActivityWithOptions(
		func(_ context.Context, _ agentactivity.OpenPendingApprovalInput) (agentactivity.OpenPendingApprovalResult, error) {
			openMu.Lock()
			openCalled = true
			openMu.Unlock()
			return agentactivity.OpenPendingApprovalResult{ID: "row-x"}, nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivityOpenPendingApproval},
	)
	env.RegisterActivityWithOptions(
		func(_ context.Context, _ agentactivity.ResolvePendingApprovalInput) error { return nil },
		activity.RegisterOptions{Name: agentcontract.ActivityResolvePendingApproval},
	)
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
			// Step 1: propose_to_user → parks the run in awaiting_user.
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-prop", Name: ToolProposeToUser, Arguments: map[string]any{
						"title": "Plan", "summary": "do x", "body_markdown": "## Plan",
					}},
				},
				StopReason: "tool_use",
			},
			// Step 2 (after the user reply): a destructive command that WOULD
			// open a gate — must never be dispatched because abort landed.
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

	// Once parked in awaiting_user, deliver the user message and the abort
	// together so both are pending in the same workflow task — the ordering
	// that let the gate open after the abort.
	env.RegisterDelayedCallback(func() {
		var snap AgentSnapshot
		for i := 0; i < 20; i++ {
			q, _ := env.QueryWorkflow(AgentQuerySnapshot)
			_ = q.Get(&snap)
			if snap.Status == "awaiting_user" {
				break
			}
		}
		require.Equal(t, "awaiting_user", snap.Status, "run should park after propose_to_user")
		env.SignalWorkflow(AgentSignalUserMessage, UserMessageSignalPayload{
			TurnID: "u-2", UserID: "u1", Message: "Run this exact shell command: terraform destroy -auto-approve",
		})
		env.SignalWorkflow(AgentSignalAbort, AbortSignalPayload{RequestedBy: "u1", Reason: "stop"})
	}, 100*time.Millisecond)

	env.ExecuteWorkflow(InfrastructureAgentWorkflow, InfrastructureAgentInput{
		AgentRunID: "run-abort-usergate", WorkspaceID: "ws-1", LLMProviderID: "p", InitialPrompt: "plan it",
	})

	require.True(t, env.IsWorkflowCompleted(), "run must terminate, not park on a post-abort gate")
	require.NoError(t, env.GetWorkflowError())

	// No destructive gate may have opened, and the command must not run.
	openMu.Lock()
	require.False(t, openCalled, "no approval gate may open after abort")
	openMu.Unlock()
	shellMu.Lock()
	require.False(t, shellRan, "destructive command must not execute after abort")
	shellMu.Unlock()

	// Final snapshot: aborted, no pending approvals left dangling.
	q, err := env.QueryWorkflow(AgentQuerySnapshot)
	require.NoError(t, err)
	var final AgentSnapshot
	require.NoError(t, q.Get(&final))
	require.Empty(t, final.PendingApprovals, "no gate should be left open after abort")
}

// BUG-A (live race, runs agent-f17cd47f / agent-e9b4f3c3 / agent-37de985a):
// a gate opened via the awaiting_user → user-message → LLM → tool path
// genuinely PARKS at awaiting_approval, and only THEN does the abort arrive
// (its own workflow task, AFTER the gate is open). The pre-gate inline drains
// (drainPendingAbort at loop-top / post-LLM) cannot help here because there
// was no buffered abort when they ran — the gate is already open and the run
// is sitting inside gateWaiter.await. The fix makes await select on the abort
// channel directly, so the gate terminates without depending on the abort
// goroutine winning a coroutine-scheduling turn to cancel loopCtx. The run
// must terminate aborted, the destructive command must not run, and no gate
// may be left open with a 72h timer armed.
func TestAbortAtGate_MessageTriggeredGateOpenThenAbort(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)

	var openCalled bool
	var openMu sync.Mutex
	env.RegisterActivityWithOptions(
		func(_ context.Context, _ agentactivity.OpenPendingApprovalInput) (agentactivity.OpenPendingApprovalResult, error) {
			openMu.Lock()
			openCalled = true
			openMu.Unlock()
			return agentactivity.OpenPendingApprovalResult{ID: "row-x"}, nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivityOpenPendingApproval},
	)
	env.RegisterActivityWithOptions(
		func(_ context.Context, _ agentactivity.ResolvePendingApprovalInput) error { return nil },
		activity.RegisterOptions{Name: agentcontract.ActivityResolvePendingApproval},
	)
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
			// Step 1: propose_to_user → parks the run in awaiting_user.
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-prop", Name: ToolProposeToUser, Arguments: map[string]any{
						"title": "Plan", "summary": "do x", "body_markdown": "## Plan",
					}},
				},
				StopReason: "tool_use",
			},
			// Step 2 (after the user reply): a destructive command that opens
			// the gate. The abort lands only AFTER the gate is open.
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

	// 1) Once parked in awaiting_user, deliver the user message alone. The LLM
	//    step runs and opens the destructive gate; the run parks in await.
	env.RegisterDelayedCallback(func() {
		var snap AgentSnapshot
		for i := 0; i < 20; i++ {
			q, _ := env.QueryWorkflow(AgentQuerySnapshot)
			_ = q.Get(&snap)
			if snap.Status == "awaiting_user" {
				break
			}
		}
		require.Equal(t, "awaiting_user", snap.Status, "run should park after propose_to_user")
		env.SignalWorkflow(AgentSignalUserMessage, UserMessageSignalPayload{
			TurnID: "u-2", UserID: "u1", Message: "Run this exact shell command: terraform destroy -auto-approve",
		})
	}, 100*time.Millisecond)

	// 2) After the gate is confirmed OPEN (status awaiting_approval, pending
	//    row present), deliver the abort as its own task. Only await's direct
	//    abort branch can terminate the run from here.
	env.RegisterDelayedCallback(func() {
		var snap AgentSnapshot
		for i := 0; i < 20; i++ {
			q, _ := env.QueryWorkflow(AgentQuerySnapshot)
			_ = q.Get(&snap)
			if snap.Status == "awaiting_approval" && len(snap.PendingApprovals) == 1 {
				break
			}
		}
		require.Equal(t, "awaiting_approval", snap.Status, "destructive gate must be open before abort")
		require.Len(t, snap.PendingApprovals, 1, "destructive gate must be open before abort")
		env.SignalWorkflow(AgentSignalAbort, AbortSignalPayload{RequestedBy: "u1", Reason: "stop"})
	}, 300*time.Millisecond)

	env.ExecuteWorkflow(InfrastructureAgentWorkflow, InfrastructureAgentInput{
		AgentRunID: "run-abort-msggate-open", WorkspaceID: "ws-1", LLMProviderID: "p", InitialPrompt: "plan it",
	})

	require.True(t, env.IsWorkflowCompleted(), "abort at an open message-triggered gate must terminate the run")
	require.NoError(t, env.GetWorkflowError())

	// The gate did open (this is the open-then-abort path), but the command
	// must never have executed, and no gate may be left dangling.
	openMu.Lock()
	require.True(t, openCalled, "gate should have opened in this scenario")
	openMu.Unlock()
	shellMu.Lock()
	require.False(t, shellRan, "destructive command must not execute after abort")
	shellMu.Unlock()

	q, err := env.QueryWorkflow(AgentQuerySnapshot)
	require.NoError(t, err)
	var final AgentSnapshot
	require.NoError(t, q.Get(&final))
	require.Equal(t, "aborted", final.Status, "run must end aborted")
	require.Empty(t, final.PendingApprovals, "no gate should be left open after abort")
}

// Abort delivered WHILE the step-2 LLM activity is running: cancelLoop fires
// during the activity, so by the time control returns to tool dispatch the
// loop is cancelled. The dispatch/gate guards must then prevent the
// destructive gate from opening (no approval_request, no 72h timer) and the
// run must terminate aborted. Uses a blocking LLM stub released only after
// the abort is signaled, making the ordering deterministic.
func TestAbortAtGate_AbortDuringLLMStepSkipsGate(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)

	var openCalled bool
	var openMu sync.Mutex
	env.RegisterActivityWithOptions(
		func(_ context.Context, _ agentactivity.OpenPendingApprovalInput) (agentactivity.OpenPendingApprovalResult, error) {
			openMu.Lock()
			openCalled = true
			openMu.Unlock()
			return agentactivity.OpenPendingApprovalResult{ID: "row-x"}, nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivityOpenPendingApproval},
	)
	env.RegisterActivityWithOptions(
		func(_ context.Context, _ agentactivity.ResolvePendingApprovalInput) error { return nil },
		activity.RegisterOptions{Name: agentcontract.ActivityResolvePendingApproval},
	)

	releaseLLM := make(chan struct{})
	var step int
	var stepMu sync.Mutex
	env.RegisterActivityWithOptions(
		func(ctx context.Context, _ agentactivity.LLMNextStepInput) (agentactivity.LLMNextStepResult, error) {
			stepMu.Lock()
			step++
			cur := step
			stepMu.Unlock()
			if cur == 1 {
				// First step: propose_to_user, parks awaiting_user.
				return agentactivity.LLMNextStepResult{
					ToolCalls: []providers.ToolCall{
						{ID: "tc-prop", Name: ToolProposeToUser, Arguments: map[string]any{
							"title": "Plan", "summary": "x", "body_markdown": "## Plan",
						}},
					},
					StopReason: "tool_use",
				}, nil
			}
			// Second step: block until the test releases (after abort is sent),
			// then return a destructive command the guard must refuse to gate.
			select {
			case <-releaseLLM:
			case <-ctx.Done():
				return agentactivity.LLMNextStepResult{}, ctx.Err()
			}
			return agentactivity.LLMNextStepResult{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-shell", Name: ToolShellExec, Arguments: map[string]any{
						"command": "terraform destroy -auto-approve",
					}},
				},
				StopReason: "tool_use",
			}, nil
		},
		activity.RegisterOptions{Name: ActivityLLMNextStep},
	)

	env.RegisterDelayedCallback(func() {
		var snap AgentSnapshot
		for i := 0; i < 20; i++ {
			q, _ := env.QueryWorkflow(AgentQuerySnapshot)
			_ = q.Get(&snap)
			if snap.Status == "awaiting_user" {
				break
			}
		}
		// Send the user reply (triggers step 2, which blocks), then abort while
		// step 2 is in-flight, then release the LLM so step 2 returns the
		// destructive command into a now-cancelled loop.
		env.SignalWorkflow(AgentSignalUserMessage, UserMessageSignalPayload{
			TurnID: "u-2", UserID: "u1", Message: "do it",
		})
	}, 100*time.Millisecond)
	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow(AgentSignalAbort, AbortSignalPayload{RequestedBy: "u1", Reason: "stop"})
		close(releaseLLM)
	}, 300*time.Millisecond)

	env.ExecuteWorkflow(InfrastructureAgentWorkflow, InfrastructureAgentInput{
		AgentRunID: "run-abort-midllm", WorkspaceID: "ws-1", LLMProviderID: "p", InitialPrompt: "plan",
	})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
	openMu.Lock()
	require.False(t, openCalled, "no gate may open after abort during the LLM step")
	openMu.Unlock()
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
