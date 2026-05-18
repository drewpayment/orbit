package workflows

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/testsuite"

	agentactivity "github.com/drewpayment/orbit/temporal-workflows/internal/activities/agent"
	"github.com/drewpayment/orbit/temporal-workflows/internal/agent/providers"
	"github.com/drewpayment/orbit/temporal-workflows/pkg/agentcontract"
)

// β — conversational review during an open approval gate. The reviewer
// can chat with the agent while a gate is pending; messages append as
// regular conversation turns and the agent responds via an LLM step
// with NO tools. The gate stays open; resolution still requires a real
// Approval signal. These tests pin those invariants.

func TestReviewerMessage_AppendsTurnsAndKeepsGateOpen(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)

	llm := &scriptedLLM{
		steps: []agentactivity.LLMNextStepResult{
			// Step 1: agent asks for approval.
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-req", Name: ToolRequestApproval, Arguments: map[string]any{
						"title":         "Confirm rollout",
						"kind":          "custom",
						"body_markdown": "Ready to deploy?",
					}},
				},
				StopReason: "tool_use",
			},
			// Step 2: reviewer-mode response (driven by the goroutine).
			{
				Text:       "Because the preview tier is cheaper for a smoke test.",
				StopReason: "end_turn",
			},
			// Step 3: agent calls done after the gate resolves.
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-done", Name: ToolDone, Arguments: map[string]any{"summary": "ok"}},
				},
				StopReason: "tool_use",
			},
		},
	}
	env.RegisterActivityWithOptions(llm.Run, activity.RegisterOptions{Name: ActivityLLMNextStep})

	// At T+100ms: chat with the agent without resolving the gate.
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
		require.Len(t, snap.PendingApprovals, 1, "request_approval gate should be open")
		env.SignalWorkflow(agentcontract.SignalReviewerMessage, agentcontract.ReviewerMessageSignalPayload{
			ApprovalID: snap.PendingApprovals[0].ApprovalID,
			UserID:     "alice",
			Message:    "Why this command instead of vercel link first?",
		})
	}, 100*time.Millisecond)

	// At T+300ms: the goroutine should have exchanged one round; gate must
	// still be pending. Then resolve.
	env.RegisterDelayedCallback(func() {
		var snap AgentSnapshot
		for i := 0; i < 20; i++ {
			q, err := env.QueryWorkflow(AgentQuerySnapshot)
			require.NoError(t, err)
			require.NoError(t, q.Get(&snap))
			if snap.ReviewerRounds >= 1 {
				break
			}
		}
		require.Equal(t, 1, snap.ReviewerRounds, "reviewer round must have been counted")
		require.Len(t, snap.PendingApprovals, 1, "gate must remain open during reviewer chat")

		env.SignalWorkflow(AgentSignalApproval, ApprovalSignalPayload{
			ApprovalID: snap.PendingApprovals[0].ApprovalID,
			Approved:   true,
			ResolvedBy: "admin",
		})
	}, 300*time.Millisecond)

	env.ExecuteWorkflow(InfrastructureAgentWorkflow, InfrastructureAgentInput{
		AgentRunID:    "run-rev",
		WorkspaceID:   "ws",
		LLMProviderID: "p",
		InitialPrompt: "deploy",
	})
	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	var finalSnap AgentSnapshot
	q, err := env.QueryWorkflow(AgentQuerySnapshot)
	require.NoError(t, err)
	require.NoError(t, q.Get(&finalSnap))

	// Reviewer's user turn and the agent's reply both present, consecutively.
	reviewerUserIdx, reviewerAsstIdx := -1, -1
	for i, turn := range finalSnap.Conversation {
		if turn.Role == "user" && strings.Contains(turn.Content, "Why this command") {
			reviewerUserIdx = i
		}
		if turn.Role == "assistant" && turn.Content == "Because the preview tier is cheaper for a smoke test." {
			reviewerAsstIdx = i
		}
	}
	require.NotEqual(t, -1, reviewerUserIdx, "reviewer user turn missing from transcript")
	require.NotEqual(t, -1, reviewerAsstIdx, "reviewer assistant turn missing from transcript")
	require.Equal(t, reviewerUserIdx+1, reviewerAsstIdx, "assistant reply must immediately follow reviewer turn")

	// Reviewer-mode LLM call must have been invoked with no tools — that's
	// how the no-action invariant is enforced.
	require.Len(t, llm.captured, 3, "expected 3 LLM calls: gate, reviewer round, done")
	require.Empty(t, llm.captured[1].Tools, "reviewer-mode LLM call must have no tools")
	require.Contains(t, llm.captured[1].System, "[REVIEW MODE]",
		"reviewer-mode LLM call must use the review-mode system prompt")

	require.Equal(t, 1, finalSnap.ReviewerRounds)
}

func TestReviewerMessage_DropsToolCallsFromReply(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)

	// shell_exec must NEVER be invoked during reviewer-mode response.
	// If a tool call from the reviewer-mode LLM leaks into the dispatcher
	// it would land here, failing the test loudly.
	env.RegisterActivityWithOptions(
		func(_ context.Context, _ agentactivity.SandboxedShellInput) (agentactivity.SandboxedShellResult, error) {
			t.Fatalf("shell_exec invoked from reviewer-mode response (must be dropped)")
			return agentactivity.SandboxedShellResult{}, nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivitySandboxedShell},
	)

	llm := &scriptedLLM{
		steps: []agentactivity.LLMNextStepResult{
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-req", Name: ToolRequestApproval, Arguments: map[string]any{
						"title":         "Confirm",
						"kind":          "custom",
						"body_markdown": "yes/no",
					}},
				},
				StopReason: "tool_use",
			},
			// Even though the workflow passes Tools=nil, simulate a model
			// that hallucinates tool calls anyway. The workflow must drop
			// them — text only.
			{
				Text: "Reasoning here.",
				ToolCalls: []providers.ToolCall{
					{ID: "tc-bad", Name: ToolShellExec, Arguments: map[string]any{"command": "echo HACKED"}},
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
		env.SignalWorkflow(agentcontract.SignalReviewerMessage, agentcontract.ReviewerMessageSignalPayload{
			ApprovalID: snap.PendingApprovals[0].ApprovalID,
			UserID:     "alice",
			Message:    "Why?",
		})
	}, 100*time.Millisecond)

	env.RegisterDelayedCallback(func() {
		var snap AgentSnapshot
		for i := 0; i < 20; i++ {
			q, err := env.QueryWorkflow(AgentQuerySnapshot)
			require.NoError(t, err)
			require.NoError(t, q.Get(&snap))
			if snap.ReviewerRounds >= 1 {
				break
			}
		}
		require.Len(t, snap.PendingApprovals, 1, "gate must still be open after reviewer round")
		env.SignalWorkflow(AgentSignalApproval, ApprovalSignalPayload{
			ApprovalID: snap.PendingApprovals[0].ApprovalID,
			Approved:   true,
		})
	}, 300*time.Millisecond)

	env.ExecuteWorkflow(InfrastructureAgentWorkflow, InfrastructureAgentInput{
		AgentRunID: "run-drop", WorkspaceID: "ws", LLMProviderID: "p", InitialPrompt: "x",
	})
	require.NoError(t, env.GetWorkflowError())

	var snap AgentSnapshot
	q, err := env.QueryWorkflow(AgentQuerySnapshot)
	require.NoError(t, err)
	require.NoError(t, q.Get(&snap))

	var found bool
	for _, turn := range snap.Conversation {
		if turn.Role == "assistant" && turn.Content == "Reasoning here." {
			require.Empty(t, turn.ToolCalls, "reviewer-mode assistant turn must drop tool calls")
			found = true
		}
	}
	require.True(t, found, "reviewer-mode assistant turn missing")
}

func TestReviewerMessage_EmptyMessageIgnored(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)

	llm := &scriptedLLM{
		steps: []agentactivity.LLMNextStepResult{
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-req", Name: ToolRequestApproval, Arguments: map[string]any{
						"title":         "ok?",
						"kind":          "custom",
						"body_markdown": "yes/no",
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
		// Empty message — must short-circuit before the LLM call.
		env.SignalWorkflow(agentcontract.SignalReviewerMessage, agentcontract.ReviewerMessageSignalPayload{
			ApprovalID: snap.PendingApprovals[0].ApprovalID,
			UserID:     "alice",
			Message:    "",
		})
		env.SignalWorkflow(AgentSignalApproval, ApprovalSignalPayload{
			ApprovalID: snap.PendingApprovals[0].ApprovalID,
			Approved:   true,
		})
	}, 100*time.Millisecond)

	env.ExecuteWorkflow(InfrastructureAgentWorkflow, InfrastructureAgentInput{
		AgentRunID: "run-empty", WorkspaceID: "ws", LLMProviderID: "p", InitialPrompt: "x",
	})
	require.NoError(t, env.GetWorkflowError())

	// Only the gate-step + done-step LLM calls — no reviewer-mode call.
	require.Len(t, llm.captured, 2, "empty reviewer message must NOT trigger an LLM call")

	var snap AgentSnapshot
	q, err := env.QueryWorkflow(AgentQuerySnapshot)
	require.NoError(t, err)
	require.NoError(t, q.Get(&snap))
	require.Equal(t, 0, snap.ReviewerRounds)
}

func TestReviewerMessage_IncrementsReviewerRoundsAcrossExchanges(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)

	llm := &scriptedLLM{
		steps: []agentactivity.LLMNextStepResult{
			// 0: gate
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-req", Name: ToolRequestApproval, Arguments: map[string]any{
						"title":         "ok?",
						"kind":          "custom",
						"body_markdown": "yes/no",
					}},
				},
				StopReason: "tool_use",
			},
			// 1, 2, 3: three reviewer-mode responses
			{Text: "ans1", StopReason: "end_turn"},
			{Text: "ans2", StopReason: "end_turn"},
			{Text: "ans3", StopReason: "end_turn"},
			// 4: done
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
		approvalID := snap.PendingApprovals[0].ApprovalID
		for i := 0; i < 3; i++ {
			env.SignalWorkflow(agentcontract.SignalReviewerMessage, agentcontract.ReviewerMessageSignalPayload{
				ApprovalID: approvalID,
				UserID:     "alice",
				Message:    fmt.Sprintf("question %d", i+1),
			})
		}
	}, 100*time.Millisecond)

	env.RegisterDelayedCallback(func() {
		var snap AgentSnapshot
		for i := 0; i < 30; i++ {
			q, err := env.QueryWorkflow(AgentQuerySnapshot)
			require.NoError(t, err)
			require.NoError(t, q.Get(&snap))
			if snap.ReviewerRounds >= 3 {
				break
			}
		}
		require.GreaterOrEqual(t, snap.ReviewerRounds, 3)
		env.SignalWorkflow(AgentSignalApproval, ApprovalSignalPayload{
			ApprovalID: snap.PendingApprovals[0].ApprovalID,
			Approved:   true,
		})
	}, 600*time.Millisecond)

	env.ExecuteWorkflow(InfrastructureAgentWorkflow, InfrastructureAgentInput{
		AgentRunID: "run-multi", WorkspaceID: "ws", LLMProviderID: "p", InitialPrompt: "x",
	})
	require.NoError(t, env.GetWorkflowError())

	var snap AgentSnapshot
	q, err := env.QueryWorkflow(AgentQuerySnapshot)
	require.NoError(t, err)
	require.NoError(t, q.Get(&snap))
	require.Equal(t, 3, snap.ReviewerRounds)
}
