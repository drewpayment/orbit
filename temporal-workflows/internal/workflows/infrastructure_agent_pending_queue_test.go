package workflows

import (
	"context"
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

// γ — aggregated pending-approvals queue. Every gate the workflow opens
// must mirror to a PendingApprovals row (via the activity), and every
// resolution must flip that row to status=resolved with the right
// audit fields. Tests pin those invariants for the request_approval
// path; the register_tool and destructive-command paths share the same
// helpers, so a single happy-path test plus a spot-check on resolution
// fields is enough.

type recordedOpen struct {
	in agentactivity.OpenPendingApprovalInput
}
type recordedResolve struct {
	in agentactivity.ResolvePendingApprovalInput
}

type pendingApprovalsRecorder struct {
	mu       sync.Mutex
	opens    []recordedOpen
	resolves []recordedResolve
}

func (r *pendingApprovalsRecorder) Register(env *testsuite.TestWorkflowEnvironment, openID string) {
	env.RegisterActivityWithOptions(
		func(_ context.Context, in agentactivity.OpenPendingApprovalInput) (agentactivity.OpenPendingApprovalResult, error) {
			r.mu.Lock()
			defer r.mu.Unlock()
			r.opens = append(r.opens, recordedOpen{in: in})
			return agentactivity.OpenPendingApprovalResult{ID: openID}, nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivityOpenPendingApproval},
	)
	env.RegisterActivityWithOptions(
		func(_ context.Context, in agentactivity.ResolvePendingApprovalInput) error {
			r.mu.Lock()
			defer r.mu.Unlock()
			r.resolves = append(r.resolves, recordedResolve{in: in})
			return nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivityResolvePendingApproval},
	)
}

func TestPendingApprovalsQueue_RequestApprovalMirrors(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)

	rec := &pendingApprovalsRecorder{}
	rec.Register(env, "row-001")

	llm := &scriptedLLM{
		steps: []agentactivity.LLMNextStepResult{
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-req", Name: ToolRequestApproval, Arguments: map[string]any{
						"title":         "Confirm rollout",
						"kind":          "custom",
						"body_markdown": "Ready?",
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

	env.RegisterDelayedCallback(func() {
		var snap AgentSnapshot
		for i := 0; i < 20; i++ {
			q, err := env.QueryWorkflow(AgentQuerySnapshot)
			require.NoError(t, err)
			require.NoError(t, q.Get(&snap))
			if len(snap.PendingApprovals) == 1 {
				break
			}
		}
		require.Len(t, snap.PendingApprovals, 1)
		env.SignalWorkflow(AgentSignalApproval, ApprovalSignalPayload{
			ApprovalID: snap.PendingApprovals[0].ApprovalID,
			Approved:   true,
			ResolvedBy: "alice",
			Notes:      "lgtm",
		})
	}, 100*time.Millisecond)

	env.ExecuteWorkflow(InfrastructureAgentWorkflow, InfrastructureAgentInput{
		AgentRunID:    "run-pq",
		WorkspaceID:   "ws-pq",
		LLMProviderID: "p",
		InitialPrompt: "deploy",
	})
	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	rec.mu.Lock()
	defer rec.mu.Unlock()
	require.Len(t, rec.opens, 1, "expected one OpenPendingApproval call for the gate")
	open := rec.opens[0].in
	require.Equal(t, "ws-pq", open.WorkspaceID)
	require.Equal(t, "run-pq", open.AgentRunID)
	require.Equal(t, agentcontract.ApprovalKindCustom, open.Kind)
	require.Equal(t, "Confirm rollout", open.Title)
	require.NotEmpty(t, open.WorkflowID)
	require.NotEmpty(t, open.ApprovalID)

	require.Len(t, rec.resolves, 1, "expected one ResolvePendingApproval call")
	resolve := rec.resolves[0].in
	require.Equal(t, "row-001", resolve.ID, "resolve must reference the row id from open")
	require.Equal(t, "resolved", resolve.Status)
	require.Equal(t, "approved", resolve.Resolution)
	require.Equal(t, "alice", resolve.ResolvedBy)
	require.Equal(t, "lgtm", resolve.Notes)
}

func TestPendingApprovalsQueue_AbortMarksAborted(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)

	rec := &pendingApprovalsRecorder{}
	rec.Register(env, "row-002")

	llm := &scriptedLLM{
		steps: []agentactivity.LLMNextStepResult{
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-req", Name: ToolRequestApproval, Arguments: map[string]any{
						"title":         "Confirm",
						"kind":          "custom",
						"body_markdown": "?",
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
			if len(snap.PendingApprovals) == 1 {
				break
			}
		}
		require.Len(t, snap.PendingApprovals, 1)
		env.SignalWorkflow(AgentSignalAbort, AbortSignalPayload{
			RequestedBy: "bob",
			Reason:      "user cancelled",
		})
	}, 100*time.Millisecond)

	env.ExecuteWorkflow(InfrastructureAgentWorkflow, InfrastructureAgentInput{
		AgentRunID:    "run-abort",
		WorkspaceID:   "ws-abort",
		LLMProviderID: "p",
		InitialPrompt: "x",
	})
	require.NoError(t, env.GetWorkflowError())

	rec.mu.Lock()
	defer rec.mu.Unlock()
	require.GreaterOrEqual(t, len(rec.opens), 1)
	require.GreaterOrEqual(t, len(rec.resolves), 1, "abort must still resolve the queue row so it doesn't linger as pending")
	last := rec.resolves[len(rec.resolves)-1].in
	require.Equal(t, "row-002", last.ID)
	require.Equal(t, "aborted", last.Status, "abort path must mark row aborted, not resolved")
}
