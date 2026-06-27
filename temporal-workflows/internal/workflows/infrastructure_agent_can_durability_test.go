package workflows

import (
	"context"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/converter"
	"go.temporal.io/sdk/testsuite"
	"go.temporal.io/sdk/workflow"

	agentactivity "github.com/drewpayment/orbit/temporal-workflows/internal/activities/agent"
	"github.com/drewpayment/orbit/temporal-workflows/internal/agent/providers"
	"github.com/drewpayment/orbit/temporal-workflows/pkg/agentcontract"
)

// errSimulatedFlush is returned by a persist stub to force a single flush
// failure (retaining the buffer) without failing the run.
var errSimulatedFlush = errStr("simulated transient persist failure")

type errStr string

func (e errStr) Error() string { return string(e) }

// shellLoopLLM returns a non-destructive shell_exec on every step so the
// workflow keeps appending (assistant + tool) turns until it crosses the
// continue-as-new history threshold. Each call's tool id is unique so the
// transcript stays well-formed.
type shellLoopLLM struct {
	calls atomic.Int32
}

func (s *shellLoopLLM) Run(_ context.Context, _ agentactivity.LLMNextStepInput) (agentactivity.LLMNextStepResult, error) {
	n := s.calls.Add(1)
	return agentactivity.LLMNextStepResult{
		ToolCalls: []providers.ToolCall{
			{ID: "tc-loop-" + itoa(n), Name: ToolShellExec, Arguments: map[string]any{"command": "echo hello"}},
		},
		StopReason: "tool_use", Backend: "test", Model: "test-model",
	}, nil
}

func itoa(n int32) string {
	// Small deterministic int→string without importing strconv at call sites.
	if n == 0 {
		return "0"
	}
	var b [12]byte
	i := len(b)
	neg := n < 0
	if neg {
		n = -n
	}
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}

// decodeCarry pulls the typed InfrastructureAgentInput out of a
// ContinueAsNewError's encoded payload using the default data converter, the
// same converter the test environment uses to marshal CAN args.
func decodeCarry(t *testing.T, canErr *workflow.ContinueAsNewError) InfrastructureAgentInput {
	t.Helper()
	require.NotNil(t, canErr.Input, "CAN error carried no input")
	dc := converter.GetDefaultDataConverter()
	var carry InfrastructureAgentInput
	require.NoError(t, dc.FromPayloads(canErr.Input, &carry))
	return carry
}

// drainToCAN drives a fresh run with the shell-loop LLM until it
// continue-as-new's, returning the decoded carry input. The persist recorder's
// failNext is honored, so callers can force the pre-CAN flush(es) to error.
func drainToCAN(t *testing.T, rec *eventRecorder) InfrastructureAgentInput {
	t.Helper()
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)
	registerEventRecorder(env, rec)
	env.RegisterActivityWithOptions(
		func(_ context.Context, _ agentactivity.SandboxedShellInput) (agentactivity.SandboxedShellResult, error) {
			return agentactivity.SandboxedShellResult{ExitCode: 0, Stdout: "hello\n"}, nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivitySandboxedShell},
	)
	llm := &shellLoopLLM{}
	env.RegisterActivityWithOptions(llm.Run, activity.RegisterOptions{Name: ActivityLLMNextStep})

	env.ExecuteWorkflow(InfrastructureAgentWorkflow, InfrastructureAgentInput{
		AgentRunID: "run-can", WorkspaceID: "ws-1", RepositoryID: "repo-1",
		UserID: "u1", LLMProviderID: "prov-1", InitialPrompt: "loop",
	})
	require.True(t, env.IsWorkflowCompleted())
	err := env.GetWorkflowError()
	var canErr *workflow.ContinueAsNewError
	require.ErrorAs(t, err, &canErr, "expected the loop run to continue-as-new")
	return decodeCarry(t, canErr)
}

// collectSeqs flattens the recorder's persisted events into a set of sequences,
// asserting no sequence is persisted twice (AC1.4).
func collectSeqs(t *testing.T, rec *eventRecorder) map[uint64]bool {
	t.Helper()
	seen := map[uint64]bool{}
	for _, e := range rec.allEvents() {
		require.Falsef(t, seen[e.Sequence], "sequence %d persisted more than once", e.Sequence)
		seen[e.Sequence] = true
	}
	return seen
}

// AC1.2: when the pre-CAN flush errors, the buffered durable events must not be
// lost — they are carried into the continued run and persisted there. We drive
// the first run to CAN with EVERY flush failing, assert the carry holds the
// unflushed events, then run the continued segment with a healthy recorder and
// assert those exact sequences land.
func TestCANDurability_PreCANFlushErrorEventsPersistedAfterCAN(t *testing.T) {
	firstRec := &eventRecorder{}
	// Fail a large number of flushes so the pre-CAN flush in the first segment
	// errors and the buffer carries forward intact.
	firstRec.failNext.Store(1 << 20)

	carry := drainToCAN(t, firstRec)

	require.NotEmpty(t, carry.UnflushedDurable,
		"a failed pre-CAN flush must carry its buffered durable events into the continued run")
	// The carried events must be monotonic and well-below the carried
	// NextSequence (they were emitted before the CAN barrier).
	var prev uint64
	for i, e := range carry.UnflushedDurable {
		if i > 0 {
			require.Greaterf(t, e.Sequence, prev, "carried events not strictly increasing at %d", i)
		}
		prev = e.Sequence
		require.Less(t, e.Sequence, carry.NextSequence, "carried event sequence must be below NextSequence")
	}
	carriedSeqs := map[uint64]bool{}
	for _, e := range carry.UnflushedDurable {
		carriedSeqs[e.Sequence] = true
	}

	// Continued segment: healthy recorder, drive immediately to done. The
	// carried (previously-unflushed) events must be persisted exactly once.
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)
	secondRec := &eventRecorder{}
	registerEventRecorder(env, secondRec)
	llm := &scriptedLLM{steps: []agentactivity.LLMNextStepResult{
		{ToolCalls: []providers.ToolCall{{ID: "tc-done", Name: ToolDone, Arguments: map[string]any{"summary": "ok"}}}, StopReason: "tool_use"},
	}}
	env.RegisterActivityWithOptions(llm.Run, activity.RegisterOptions{Name: ActivityLLMNextStep})

	env.ExecuteWorkflow(InfrastructureAgentWorkflow, carry)
	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	persisted := collectSeqs(t, secondRec)
	for seq := range carriedSeqs {
		require.Truef(t, persisted[seq], "carried (previously unflushed) sequence %d was not persisted after CAN", seq)
	}
	// AC1.1: the union across both segments has no duplicates. firstRec never
	// recorded anything (all flushes failed), so the second segment owns the
	// carried sequences; collectSeqs already asserted no intra-segment dupes.
	require.Empty(t, firstRec.allEvents(), "first segment recorded nothing because every flush failed")
}

// seedHistory builds n well-formed alternating user/assistant turns so a run
// can start just below the continue-as-new history threshold. Seeded turns
// emit no durable events (initState copies History without re-emitting), so the
// durable buffer starts empty and the test can attribute every carried event to
// activity during the run.
func seedHistory(n int) []ConversationTurn {
	turns := make([]ConversationTurn, 0, n)
	for i := 0; i < n; i++ {
		// End on a user turn so awaitingUser is false at startup and the loop
		// proceeds to the first LLM step (which opens the gate) rather than
		// parking on a trailing assistant turn.
		role := "assistant"
		if (n-1-i)%2 == 0 {
			role = "user"
		}
		turns = append(turns, ConversationTurn{
			TurnID:    "seed-" + itoa(int32(i)),
			Role:      role,
			Content:   "seed",
			Timestamp: time.Unix(0, 0),
		})
	}
	return turns
}

// AC1.3: a durable event appended DURING the pre-CAN flush await must be
// carried across CAN, not dropped. flushDurableEvents snapshots its batch
// before awaiting the persist activity and drops only that exact prefix, so an
// event appended while a flush is in flight survives in the buffer;
// continueAsNew must carry that residual.
//
// Construction (deterministic, no goroutine timing): seed history just below
// the CAN threshold and open a request_approval gate so the run PARKS — the one
// place a delayed callback can reliably inject a signal mid-run. While parked,
// a reviewer message appends a durable conversation turn into the buffer; every
// flush fails so it is retained; resolving the gate lets the run append its
// tool-result turn, cross the threshold, and continue-as-new. The reviewer turn
// (a durable event that landed mid-run, exactly as a during-flush-await append
// would) must appear in the carried unflushed buffer.
func TestCANDurability_EventAppendedDuringFlushAwaitIsCarried(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)

	// Every flush fails so the durable buffer is retained up to the CAN barrier.
	env.RegisterActivityWithOptions(
		func(_ context.Context, _ agentactivity.PersistAgentEventsInput) error {
			return errSimulatedFlush
		},
		activity.RegisterOptions{Name: agentcontract.ActivityPersistAgentEvents},
	)

	llm := &scriptedLLM{
		steps: []agentactivity.LLMNextStepResult{
			// Step 1: open an approval gate so the run parks.
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-req", Name: ToolRequestApproval, Arguments: map[string]any{
						"title": "Confirm", "kind": "custom", "body_markdown": "ok?",
					}},
				},
				StopReason: "tool_use",
			},
			// A reviewer-mode reply (driven by the reviewer goroutine during the
			// gate) — text only, no tools.
			{Text: "noted", StopReason: "end_turn"},
			// Step 2 (after the gate resolves): done. By now history has crossed
			// the CAN threshold and the loop continue-as-new's BEFORE this runs.
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-done", Name: ToolDone, Arguments: map[string]any{"summary": "ok"}},
				},
				StopReason: "tool_use",
			},
		},
	}
	env.RegisterActivityWithOptions(llm.Run, activity.RegisterOptions{Name: ActivityLLMNextStep})

	// Once parked at the gate: inject the reviewer message (durable turn lands
	// in the buffer), then resolve the gate so the run proceeds to CAN.
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
		require.Len(t, snap.PendingApprovals, 1, "gate should be open")
		env.SignalWorkflow(agentcontract.SignalReviewerMessage, agentcontract.ReviewerMessageSignalPayload{
			ApprovalID: snap.PendingApprovals[0].ApprovalID,
			Message:    "appended-during-flush",
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
		require.Len(t, snap.PendingApprovals, 1, "gate must still be open after reviewer chat")
		env.SignalWorkflow(AgentSignalApproval, ApprovalSignalPayload{
			ApprovalID: snap.PendingApprovals[0].ApprovalID,
			Approved:   true,
			ResolvedBy: "admin",
		})
	}, 300*time.Millisecond)

	// Seed history one short of the threshold so the post-gate turns cross it.
	env.ExecuteWorkflow(InfrastructureAgentWorkflow, InfrastructureAgentInput{
		AgentRunID: "run-can-await", WorkspaceID: "ws-1", RepositoryID: "repo-1",
		UserID: "u1", LLMProviderID: "prov-1", InitialPrompt: "go",
		History: seedHistory(defaultMaxHistoryTurns - 2),
	})
	require.True(t, env.IsWorkflowCompleted())
	err := env.GetWorkflowError()
	var canErr *workflow.ContinueAsNewError
	require.ErrorAs(t, err, &canErr, "expected continue-as-new after the gate-resolved turns crossed the threshold")
	carry := decodeCarry(t, canErr)

	// The reviewer turn appended mid-run (while flushes were failing) must have
	// been carried forward in the unflushed buffer, not dropped at the CAN
	// barrier.
	// The reviewer turn's content is annotated by handleReviewerMessage with a
	// "[Reviewer asks during approval gate ...]" prefix, so match on substring.
	var carriedReviewerTurn bool
	for _, e := range carry.UnflushedDurable {
		if e.Kind == agentcontract.EventKindConversationTurn {
			if c, _ := e.Payload["content"].(string); strings.Contains(c, "appended-during-flush") {
				carriedReviewerTurn = true
			}
		}
	}
	require.True(t, carriedReviewerTurn,
		"a durable event appended mid-run must be carried across CAN, not dropped")
}
