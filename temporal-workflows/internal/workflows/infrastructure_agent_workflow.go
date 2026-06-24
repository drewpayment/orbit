package workflows

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"

	"github.com/drewpayment/orbit/temporal-workflows/internal/activities"
	agentactivity "github.com/drewpayment/orbit/temporal-workflows/internal/activities/agent"
	"github.com/drewpayment/orbit/temporal-workflows/internal/agent/providers"
	"github.com/drewpayment/orbit/temporal-workflows/internal/agent/safety"
	"github.com/drewpayment/orbit/temporal-workflows/internal/agent/tooltemplate"
	"github.com/drewpayment/orbit/temporal-workflows/pkg/agentcontract"
)

// defaultHTTPAllowlist is used when input.HTTPAllowlist is empty. Conservative
// list of public hosts the agent often needs (read-only). Workspace admins can
// override via input.HTTPAllowlist.
var defaultHTTPAllowlist = []string{
	"api.github.com",
	"raw.githubusercontent.com",
	"*.githubusercontent.com",
	"registry.npmjs.org",
	"pypi.org",
	"pkg.go.dev",
	"crates.io",
}

// Signal/query/activity names re-exported from the contract package so the
// workflow file remains the canonical reference.
const (
	AgentSignalUserMessage  = agentcontract.SignalUserMessage
	AgentSignalApproval     = agentcontract.SignalApproval
	AgentSignalAbort        = agentcontract.SignalAbort
	AgentSignalTokenStream  = agentcontract.SignalTokenStream
	AgentSignalToolFinished = agentcontract.SignalToolFinished

	AgentQuerySnapshot    = agentcontract.QuerySnapshot
	AgentQueryEventsSince = agentcontract.QueryEventsSince
	AgentQueryHasFinished = agentcontract.QueryHasFinished

	ActivityLLMNextStep = agentcontract.ActivityLLMNextStep
)

// Type aliases for the contract types, kept here for source-code
// continuity with the rest of the workflow.
type (
	TokenStreamSignalPayload = agentcontract.TokenStreamSignalPayload
	UserMessageSignalPayload = agentcontract.UserMessageSignalPayload
	ApprovalSignalPayload    = agentcontract.ApprovalSignalPayload
	AbortSignalPayload       = agentcontract.AbortSignalPayload

	InfrastructureAgentInput = agentcontract.InfrastructureAgentInput
	ConversationTurn         = agentcontract.ConversationTurn
	ToolCallRecord           = agentcontract.ToolCallRecord
	Proposal                 = agentcontract.Proposal
	AgentEvent               = agentcontract.AgentEvent
	AgentSnapshot            = agentcontract.AgentSnapshot
	PendingApproval          = agentcontract.PendingApproval

	// AgentEventWire is the durable-event batch element the persistence
	// activity consumes.
	AgentEventWire = agentactivity.AgentEventWire
)

// Tool / event-kind names re-exported from the contract package.
const (
	ToolProposeToUser = agentcontract.ToolProposeToUser
	ToolDone          = agentcontract.ToolDone

	ToolShellExec       = agentcontract.ToolShellExec
	ToolHTTPRequest     = agentcontract.ToolHTTPRequest
	ToolReadFile        = agentcontract.ToolReadFile
	ToolWriteFile       = agentcontract.ToolWriteFile
	ToolListDir         = agentcontract.ToolListDir
	ToolRepoInspect     = agentcontract.ToolRepoInspect
	ToolRequestApproval  = agentcontract.ToolRequestApproval
	ToolRegisterTool       = agentcontract.ToolRegisterTool
	ToolStartHealthCheck   = agentcontract.ToolStartHealthCheck
	ToolProposePattern     = agentcontract.ToolProposePattern
	ToolListPatterns       = agentcontract.ToolListPatterns
	ToolInstantiatePattern = agentcontract.ToolInstantiatePattern

	ToolOrbitListApps          = agentcontract.ToolOrbitListApps
	ToolOrbitGetApp            = agentcontract.ToolOrbitGetApp
	ToolOrbitListCloudAccounts = agentcontract.ToolOrbitListCloudAccounts
	ToolOrbitCloudLogin        = agentcontract.ToolOrbitCloudLogin
	ToolOrbitRepoClone         = agentcontract.ToolOrbitRepoClone

	EventKindConversationTurn = agentcontract.EventKindConversationTurn
	EventKindTokenDelta       = agentcontract.EventKindTokenDelta
	EventKindProposalUpdate   = agentcontract.EventKindProposalUpdate
	EventKindApprovalRequest  = agentcontract.EventKindApprovalRequest
	EventKindApprovalResolved = agentcontract.EventKindApprovalResolved
	EventKindStatusUpdate        = agentcontract.EventKindStatusUpdate
	EventKindToolCallOutputChunk = agentcontract.EventKindToolCallOutputChunk
	EventKindToolCallOutput      = agentcontract.EventKindToolCallOutput
)

// Default behavioral knobs. Tunable via input.
const (
	defaultMaxIterations    = 80
	defaultMaxHistoryTurns  = 80
	defaultUserWaitTimeout  = 24 * time.Hour
)

// DefaultApprovalTimeout bounds how long an approval gate may stay pending
// before the workflow auto-rejects it. Process-wide default; the worker may
// override it once at startup from AGENT_APPROVAL_TIMEOUT (see
// SetDefaultApprovalTimeout). Per-run overrides come via
// InfrastructureAgentInput.ApprovalTimeout. 72h per the hardening plan.
var DefaultApprovalTimeout = 72 * time.Hour

// SetDefaultApprovalTimeout overrides the process-wide approval-gate timeout.
// Intended to be called exactly once by the worker before any workflow runs
// (so it's a fixed constant from every workflow's deterministic view). A
// non-positive value is ignored.
func SetDefaultApprovalTimeout(d time.Duration) {
	if d > 0 {
		DefaultApprovalTimeout = d
	}
}

// effectiveApprovalTimeout resolves the per-run override against the
// process-wide default.
func effectiveApprovalTimeout(input *InfrastructureAgentInput) time.Duration {
	if input != nil && input.ApprovalTimeout > 0 {
		return input.ApprovalTimeout
	}
	return DefaultApprovalTimeout
}

// agentState is the in-workflow mutable state.
type agentState struct {
	status               string
	// workspaceID is the run's workspace, copied from input once at
	// initState. Carried on state so helpers (event flush, pending-approval
	// resolve) can stamp it without threading input through every call.
	workspaceID          string
	// unflushedDurable buffers durable-kind events emitted since the last
	// successful PersistAgentEvents flush. Flushed in batches at every
	// barrier and before continue-as-new / return. A failed flush keeps the
	// buffer intact for the next attempt (sequence idempotency makes that
	// safe). Carried across continue-as-new is NOT needed — flushes run
	// before CAN — so this stays workflow-local.
	unflushedDurable     []AgentEventWire
	// toolOutputBuffers accumulates streamed tool output per callId so the
	// workflow can persist one aggregated tool_call_output event when the
	// call completes (the per-chunk events are ephemeral and not durable).
	// Capped at toolOutputCap bytes per call: oldest output is dropped (keep
	// tail) and the aggregate is marked truncated. Keyed by callId.
	toolOutputBuffers    map[string]*toolOutputBuffer
	history              []ConversationTurn
	events               []AgentEvent
	nextSeq              uint64
	streamingPartial     string
	streamingTurnID      string
	proposal             *Proposal
	pendingApprovals     map[string]PendingApproval
	// pendingApprovalRowIDs maps approval_id → PendingApprovals collection
	// row id so the workflow can call ResolvePendingApproval on the right
	// row when the gate closes (Spike 7 commit γ). Empty = the open call
	// failed; resolve falls back to a no-op so a flaky internal API
	// can't deadlock the gate.
	pendingApprovalRowIDs map[string]string
	registeredTools      map[string]agentactivity.ApprovedAgentTool
	// availablePatterns is the in-memory snapshot of the platform-wide
	// Patterns catalog (approved only), refreshed at the top of each LLM
	// iteration via refreshAvailablePatterns. Keyed by pattern name to
	// match registeredTools' shape; the LLM sees the catalog via the
	// list_patterns tool result. See plans/merry-strolling-bumblebee.md.
	availablePatterns    map[string]agentactivity.ApprovedPattern
	terminated           bool
	abortReason          string
	iterations           int
	reviewerRounds       int // reviewer↔agent exchanges during gates (β)
	backend              string
	model                string
	terminalAuditFlushed bool // set when ToolDone / abort / timeout writes the final audit row

	// awaitingLLMRecovery is set when an LLM step errors *after* at least one
	// tool has already executed. Instead of failing the run we park in
	// awaiting_user with the error surfaced to chat; the user decides
	// whether to /retry, /done, or type a follow-up. See GitHub issue #42.
	awaitingLLMRecovery bool
	lastLLMError        string

	// consecutiveEmptyLLM counts back-to-back LLM responses with neither
	// text nor tool calls. Such turns are not appended to history (the
	// provider layer would drop them from the payload anyway), so each
	// re-prompt is identical; the budget in maxConsecutiveEmptyLLMResponses
	// caps the re-prompts before parking in the recoverable-error wait.
	// Reset on any non-empty response. Not carried across continue-as-new:
	// a fresh run segment gets a fresh budget.
	consecutiveEmptyLLM int
}

// User-control sentinels that the workflow recognizes during an
// LLM-recovery wait. These are matched on the literal user-message
// content; anything else is treated as a normal user follow-up.
const (
	userControlRetry = "/retry"
	userControlDone  = "/done"
)

// Sentinel prefix used in status_update.message when the LLM step
// errored after prior tools had executed. The UI detects this prefix
// to render the retry / mark-done affordance and strips it for display.
// Encoded on the message field because the AgentStatusUpdate proto
// doesn't carry structured payload (yet).
const recoverableErrorPrefix = "[recoverable_llm_error] "

// maxConsecutiveEmptyLLMResponses bounds re-prompts when the model returns
// neither text nor tool calls. Empty turns are dropped from the wire payload
// (BUG-2 fix in openai_compat), so each re-prompt is byte-identical — a
// deterministic model will return the same empty response forever (runaway
// run agent-4d50c96e: 49 empty turns at ~0.4s intervals until abort). After
// this many consecutive empties the run parks in the recoverable-error wait.
const maxConsecutiveEmptyLLMResponses = 3

// hasExecutedAnyTools returns true if any tool result has been appended
// to the conversation history. Used to gate the LLM-recovery path —
// errors on the first LLM call (before any tool has run) still fail the
// run because there is no meaningful work to preserve.
// isNonRetryableActivityError reports whether an activity error wraps a
// non-retryable temporal.ApplicationError (e.g. the LLM activity's
// "LLMNonRetryable" / "InvalidInput" types). Used to surface hard LLM
// failures in chat (BUG-2b) rather than failing the run silently.
func isNonRetryableActivityError(err error) bool {
	var appErr *temporal.ApplicationError
	if errors.As(err, &appErr) {
		return appErr.NonRetryable()
	}
	return false
}

func hasExecutedAnyTools(state *agentState) bool {
	for _, t := range state.history {
		if t.Role == "tool" {
			return true
		}
	}
	return false
}

// InfrastructureAgentWorkflow drives the agentic deployment loop. It is the
// deterministic orchestration layer; every non-deterministic decision (LLM
// call, tool execution) goes through an activity.
//
// Spike 1 supports two tools: propose_to_user (sets the live proposal and
// awaits the next user reply) and done (terminates the loop). Subsequent
// spikes layer in shell_exec, http_request, request_approval, register_tool,
// and so on without changing the dispatch shape.
func InfrastructureAgentWorkflow(ctx workflow.Context, input InfrastructureAgentInput) error {
	logger := workflow.GetLogger(ctx)
	logger.Info("starting infrastructure agent workflow",
		"agentRunId", input.AgentRunID,
		"workspaceId", input.WorkspaceID,
		"repositoryId", input.RepositoryID,
	)

	state := initState(ctx, input)

	if err := registerQueries(ctx, &state); err != nil {
		return err
	}

	// Cancellable child context so the abort goroutine can wake up any
	// blocking Receive (notably awaitApproval) by calling cancel().
	loopCtx, cancelLoop := workflow.WithCancel(ctx)
	defer cancelLoop()

	// Activity options for the LLM step. Derived from loopCtx (NOT ctx) so an
	// abort — which calls cancelLoop() — preempts an LLM activity that is
	// mid-call or grinding through its retry backoff. Otherwise an abort
	// during a retry loop is ignored and the run wedges until retries exhaust
	// (QA-reported hang).
	llmCtx := workflow.WithActivityOptions(loopCtx, workflow.ActivityOptions{
		StartToCloseTimeout: 5 * time.Minute,
		HeartbeatTimeout:    30 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    2 * time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    30 * time.Second,
			MaximumAttempts:    3,
			NonRetryableErrorTypes: []string{"InvalidInput", "LLMNonRetryable"},
		},
	})

	// Activity options for sandbox tools. Long timeouts because terraform /
	// pulumi / kubectl can take a while; the activity heartbeats every 5s so
	// these timeouts gate true hangs only.
	sandboxCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 60 * time.Minute,
		HeartbeatTimeout:    30 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    2 * time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    30 * time.Second,
			MaximumAttempts:    2,
			NonRetryableErrorTypes: []string{"InvalidInput", "PathEscape", "HostNotAllowed"},
		},
	})

	// Activity options for the audit-trail update path. Short timeout +
	// minimal retries — we never want a flaky agent-runs API to slow the
	// workflow loop down.
	auditCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 5 * time.Second,
		RetryPolicy:         &temporal.RetryPolicy{MaximumAttempts: 2},
	})

	wfID := workflow.GetInfo(ctx).WorkflowExecution.ID

	// Provision the per-run sandbox up-front so the first tool call doesn't
	// pay creation cost on the critical path. CLI env defaults disable
	// pagers and prompts so commands like `az login --use-device-code`
	// and `gcloud auth login` don't hang on `less` or interactive
	// confirmations.
	if err := workflow.ExecuteActivity(sandboxCtx, agentcontract.ActivityEnsureSandbox, agentactivity.EnsureSandboxInput{
		WorkflowID:      wfID,
		WorkspaceID:     input.WorkspaceID,
		Image:           input.SandboxImage,
		Env:             mergeEnv(defaultSandboxEnv(), input.SandboxEnv),
		EgressAllowlist: input.HTTPAllowlist,
	}).Get(sandboxCtx, nil); err != nil {
		markRun(auditCtx, wfID, agentactivity.UpdateAgentRunInput{Status: "failed"})
		return fmt.Errorf("ensure sandbox: %w", err)
	}

	markRun(auditCtx, wfID, agentactivity.UpdateAgentRunInput{Status: "running"})

	// Tear down the sandbox on workflow exit, on a disconnected context so
	// it survives cancellation. Best-effort: errors logged but not returned.
	// Also flushes a final audit-trail update if the workflow exits without
	// reaching a terminal status (e.g. uncaught error path).
	defer func() {
		dctx, _ := workflow.NewDisconnectedContext(ctx)
		teardownCtx := workflow.WithActivityOptions(dctx, workflow.ActivityOptions{
			StartToCloseTimeout: 2 * time.Minute,
			RetryPolicy:         &temporal.RetryPolicy{MaximumAttempts: 2},
		})
		_ = workflow.ExecuteActivity(teardownCtx, agentcontract.ActivityTeardownSandbox, agentactivity.TeardownSandboxInput{
			WorkflowID: wfID,
		}).Get(teardownCtx, nil)

		dauditCtx := workflow.WithActivityOptions(dctx, workflow.ActivityOptions{
			StartToCloseTimeout: 5 * time.Second,
			RetryPolicy:         &temporal.RetryPolicy{MaximumAttempts: 2},
		})
		// terminalAuditFlushed is set by every place that writes a terminal
		// status (ToolDone, abort path, timeout path, max-iters); the defer
		// only fires the catch-all if none of those did.
		if !state.terminalAuditFlushed {
			markRun(dauditCtx, wfID, agentactivity.UpdateAgentRunInput{
				Status:  state.status,
				EndedAt: workflow.Now(ctx).UTC().Format(time.RFC3339),
			})
		}

		// Catch-all durable flush on EVERY return path (complete, fail,
		// abort, timeout, sandbox-init error, continue-as-new). Uses the
		// disconnected context so a cancelled loopCtx (abort) can't skip it.
		// No-op when the inline barriers already drained the buffer.
		flushDurableEvents(dctx, &state)
	}()

	userMsgCh := workflow.GetSignalChannel(loopCtx, AgentSignalUserMessage)
	approvalCh := workflow.GetSignalChannel(loopCtx, AgentSignalApproval)
	abortCh := workflow.GetSignalChannel(ctx, AgentSignalAbort) // outer ctx so the goroutine survives loop cancellation
	tokenCh := workflow.GetSignalChannel(loopCtx, AgentSignalTokenStream)
	toolOutputCh := workflow.GetSignalChannel(loopCtx, agentcontract.SignalToolOutput)
	reviewerMsgCh := workflow.GetSignalChannel(loopCtx, agentcontract.SignalReviewerMessage)

	// Launch a goroutine to drain token-stream signals into state.
	workflow.Go(loopCtx, func(gctx workflow.Context) {
		for !state.terminated {
			var payload TokenStreamSignalPayload
			more := tokenCh.Receive(gctx, &payload)
			if !more {
				return
			}
			if payload.TurnID != "" && payload.TurnID == state.streamingTurnID {
				state.streamingPartial += payload.Delta
			}
			emitEvent(gctx, &state, EventKindTokenDelta, map[string]any{
				"turn_id": payload.TurnID,
				"delta":   payload.Delta,
			})
		}
	})

	// Drain tool-output signals from the SandboxedShell activity. Each
	// signal becomes a tool_call_output_chunk event the gRPC streaming
	// proxy fans out as SSE so the chat UI renders shell output (e.g.
	// `az login --use-device-code` device codes) as it arrives.
	workflow.Go(loopCtx, func(gctx workflow.Context) {
		for !state.terminated {
			var payload agentcontract.ToolOutputSignalPayload
			more := toolOutputCh.Receive(gctx, &payload)
			if !more {
				return
			}
			emitEvent(gctx, &state, EventKindToolCallOutputChunk, map[string]any{
				"call_id": payload.CallID,
				"stream":  payload.Stream,
				"chunk":   payload.Chunk,
			})
			// Accumulate for the aggregated, durable tool_call_output event
			// emitted when the call completes (flushToolOutput).
			recordToolOutput(&state, payload.CallID, payload.Stream, payload.Chunk)
		}
	})

	// Drain reviewer-message signals (commit β — conversational review).
	// Each message arrives during an open approval gate and triggers a
	// dedicated LLM step with NO tools, so the agent can respond in text
	// but cannot take action while a gate is open. The gate stays open;
	// resolution still requires a real Approval / Reject signal.
	workflow.Go(loopCtx, func(gctx workflow.Context) {
		for !state.terminated {
			var payload agentcontract.ReviewerMessageSignalPayload
			more := reviewerMsgCh.Receive(gctx, &payload)
			if !more {
				return
			}
			handleReviewerMessage(gctx, &state, &input, payload)
		}
	})

	// applyAbort performs the terminal abort handling exactly once. It is
	// called from BOTH the abort-draining goroutine (which wakes a run parked
	// in a gate / awaiting_user select) AND inline from the main loop via
	// drainPendingAbort (which catches a buffered abort the goroutine hasn't
	// been scheduled to process yet, before the loop opens a fresh gate). The
	// state.terminated check makes it idempotent so whichever runs first wins.
	applyAbort := func(actx workflow.Context, payload AbortSignalPayload) {
		if state.terminated {
			return
		}
		state.terminated = true
		state.abortReason = payload.Reason
		state.status = "aborted"
		emitEvent(actx, &state, EventKindStatusUpdate, map[string]any{
			"status":  "aborted",
			"message": fmt.Sprintf("aborted by %s: %s", payload.RequestedBy, payload.Reason),
		})
		// Cancel the loop FIRST so a gate wait / awaiting-user select / LLM
		// activity is preempted immediately (BUG-3). The audit write happens
		// after; it must not gate termination.
		cancelLoop()
		// Mark the terminal audit as owned here BEFORE the (possibly slow)
		// write, so the main loop's deferred catch-all audit doesn't also fire.
		state.terminalAuditFlushed = true
		aAuditCtx := workflow.WithActivityOptions(actx, workflow.ActivityOptions{
			StartToCloseTimeout: 5 * time.Second,
			RetryPolicy:         &temporal.RetryPolicy{MaximumAttempts: 2},
		})
		markRun(aAuditCtx, wfID, agentactivity.UpdateAgentRunInput{
			Status:  "aborted",
			EndedAt: workflow.Now(actx).UTC().Format(time.RFC3339),
		})
	}

	// drainPendingAbort non-blockingly consumes a buffered abort signal and
	// applies it inline. The main loop calls this at decision points (top of
	// iteration, after the LLM step, before opening a gate) so a buffered
	// abort is honored even if the abort goroutine hasn't been scheduled yet
	// in this workflow task — closing the window where a UserMessage-driven
	// LLM step opened a gate AFTER an abort was already delivered (run
	// agent-37de985a). Uses a disconnected context so the terminal audit
	// write survives the cancelLoop it triggers.
	drainPendingAbort := func(_ workflow.Context, _ *agentState) {
		if state.terminated {
			return
		}
		var payload AbortSignalPayload
		if abortCh.ReceiveAsync(&payload) {
			dctx, _ := workflow.NewDisconnectedContext(ctx)
			applyAbort(dctx, payload)
		}
	}

	// Abort-draining goroutine: wakes a run parked in a gate / awaiting_user
	// select that the inline drain can't reach.
	workflow.Go(ctx, func(gctx workflow.Context) {
		var payload AbortSignalPayload
		more := abortCh.Receive(gctx, &payload)
		if !more {
			return
		}
		applyAbort(gctx, payload)
	})

	// gateWaiter bundles the channels an approval gate waits on so awaitApproval
	// can honor an abort INTRINSICALLY — by selecting on the abort channel
	// itself — instead of depending on a separate goroutine winning a
	// coroutine-scheduling turn to translate Abort → cancelLoop → loopCtx.Done()
	// (BUG-A live race, runs agent-f17cd47f / agent-e9b4f3c3 / agent-37de985a).
	// The abort branch applies the terminal abort via applyAbort (idempotent on
	// state.terminated), so whichever consumer of abortCh runs first wins and
	// the gate wait never wedges. abortCh is on the OUTER ctx; signal channels
	// are keyed by name, not by the context passed to Select, so awaitApproval
	// can drain it while running on loopCtx.
	gw := gateWaiter{
		approvalCh: approvalCh,
		abortCh:    abortCh,
		applyAbort: func(payload AbortSignalPayload) {
			// Disconnected context: the terminal audit write inside applyAbort
			// must survive the cancelLoop() it triggers (same reasoning as
			// drainPendingAbort).
			dctx, _ := workflow.NewDisconnectedContext(ctx)
			applyAbort(dctx, payload)
		},
	}

	// Seed the conversation with the initial user prompt if this is a fresh run.
	if len(state.history) == 0 && input.InitialPrompt != "" {
		appendTurn(ctx, &state, ConversationTurn{
			TurnID:    workflowUUID(ctx),
			Role:      "user",
			Content:   input.InitialPrompt,
			Timestamp: workflow.Now(ctx),
		})
	}

	maxIters := defaultMaxIterations
	for !state.terminated && state.iterations < maxIters {
		state.iterations++

		// Honor a buffered abort at the top of every iteration, before we
		// re-park in awaiting_user or drive another LLM step / gate.
		drainPendingAbort(loopCtx, &state)
		if state.terminated {
			break
		}

		// If the last turn is from the assistant and we're awaiting user input
		// (e.g. after propose_to_user), block until UserMessage or Abort.
		if awaitingUser(&state) {
			state.status = "awaiting_user"
			emitEvent(ctx, &state, EventKindStatusUpdate, map[string]any{"status": "awaiting_user"})
			markRun(auditCtx, wfID, agentactivity.UpdateAgentRunInput{Status: "awaiting_user"})

			selector := workflow.NewSelector(loopCtx)
			receivedUserMessage := false
			selector.AddReceive(userMsgCh, func(c workflow.ReceiveChannel, _ bool) {
				var msg UserMessageSignalPayload
				c.Receive(loopCtx, &msg)
				trimmed := strings.TrimSpace(msg.Message)
				// LLM-recovery control sentinels — only honored while we're
				// parked in awaitingLLMRecovery. /retry replays the same
				// history on the next LLM step (no turn appended); /done
				// finalizes the run as completed without another LLM call.
				if state.awaitingLLMRecovery {
					switch trimmed {
					case userControlRetry:
						state.awaitingLLMRecovery = false
						state.lastLLMError = ""
						receivedUserMessage = true
						return
					case userControlDone:
						state.awaitingLLMRecovery = false
						state.lastLLMError = ""
						state.terminated = true
						state.status = "completed"
						emitEvent(ctx, &state, EventKindStatusUpdate, map[string]any{
							"status":  "completed",
							"message": "completed by user after recoverable LLM error",
						})
						markRun(auditCtx, wfID, agentactivity.UpdateAgentRunInput{
							Status:  "completed",
							EndedAt: workflow.Now(ctx).UTC().Format(time.RFC3339),
						})
						state.terminalAuditFlushed = true
						receivedUserMessage = true
						return
					}
					// Any non-sentinel message clears the recovery flag and
					// falls through to the normal append-as-user path.
					state.awaitingLLMRecovery = false
					state.lastLLMError = ""
				}
				appendTurn(ctx, &state, ConversationTurn{
					TurnID:    msg.TurnID,
					Role:      "user",
					Content:   msg.Message,
					Timestamp: workflow.Now(ctx),
				})
				receivedUserMessage = true
			})
			selector.AddFuture(workflow.NewTimer(loopCtx, defaultUserWaitTimeout), func(workflow.Future) {
				if loopCtx.Err() != nil {
					return // abort cancelled the timer; no-op
				}
				state.terminated = true
				state.status = "timeout"
				emitEvent(ctx, &state, EventKindStatusUpdate, map[string]any{
					"status":  "timeout",
					"message": "no user response within 24 hours",
				})
				markRun(auditCtx, wfID, agentactivity.UpdateAgentRunInput{
					Status:  "timeout",
					EndedAt: workflow.Now(ctx).UTC().Format(time.RFC3339),
				})
				state.terminalAuditFlushed = true
			})
			selector.Select(loopCtx)
			if state.terminated || !receivedUserMessage {
				continue
			}
			markRun(auditCtx, wfID, agentactivity.UpdateAgentRunInput{Status: "running"})
		}

		// Drive one LLM step.
		state.status = "running"
		state.streamingTurnID = workflowUUID(ctx)
		state.streamingPartial = ""

		// Refresh the registered-tool catalog at the top of each iteration
		// so newly approved tools become available mid-run.
		refreshRegisteredTools(ctx, sandboxCtx, &state, input.WorkspaceID)
		// Same shape for the platform-wide Patterns catalog — picked up
		// by the agent via the list_patterns tool. See Phase 2 of
		// plans/merry-strolling-bumblebee.md.
		refreshAvailablePatterns(ctx, sandboxCtx, &state)

		llmInput := agentactivity.LLMNextStepInput{
			WorkflowID:  workflow.GetInfo(ctx).WorkflowExecution.ID,
			RunID:       workflow.GetInfo(ctx).WorkflowExecution.RunID,
			TurnID:      state.streamingTurnID,
			WorkspaceID: input.WorkspaceID,
			ProviderID:  input.LLMProviderID,
			System:      effectiveSystemPrompt(input),
			Messages:    historyToProviderMessages(state.history),
			Tools:       buildToolCatalog(&state),
			MaxTokens:   4096,
		}

		var result agentactivity.LLMNextStepResult
		if err := workflow.ExecuteActivity(llmCtx, ActivityLLMNextStep, llmInput).Get(llmCtx, &result); err != nil {
			// Abort cancels loopCtx, which cancels this activity. Don't treat
			// the resulting cancellation as an LLM failure — the abort
			// goroutine has already set the terminal aborted state and
			// flushed audit; just let the loop unwind so the run terminates
			// promptly (QA-reported abort-during-retry hang).
			if loopCtx.Err() != nil || temporal.IsCanceledError(err) {
				state.terminated = true
				continue
			}
			// Park-in-chat instead of silently failing the run when EITHER:
			//   - the run has already executed a tool (issue #42: the
			//     deployment work-product is real and shouldn't be discarded
			//     because the LLM 400'd on a wrap-up turn), OR
			//   - the error is non-retryable (BUG-2b: a hard provider error
			//     like the Ollama "invalid message content" 400 would
			//     otherwise leave the user staring at a stuck awaiting_user
			//     run with no banner; surface it so they can /done).
			// In both cases we emit the recoverable-error sentinel so the UI
			// renders the banner with /retry + /done. /retry may fail again
			// for a hard error, but /done lets the user close out.
			if hasExecutedAnyTools(&state) || isNonRetryableActivityError(err) {
				state.awaitingLLMRecovery = true
				state.lastLLMError = err.Error()
				state.status = "awaiting_user"
				emitEvent(ctx, &state, EventKindStatusUpdate, map[string]any{
					"status":  "awaiting_user",
					"message": recoverableErrorPrefix + err.Error(),
				})
				markRun(auditCtx, wfID, agentactivity.UpdateAgentRunInput{Status: "awaiting_user"})
				flushDurableEvents(ctx, &state)
				continue
			}
			state.status = "failed"
			emitEvent(ctx, &state, EventKindStatusUpdate, map[string]any{
				"status":  "failed",
				"message": err.Error(),
			})
			flushDurableEvents(ctx, &state)
			return fmt.Errorf("llm step failed: %w", err)
		}
		state.backend = result.Backend
		state.model = result.Model

		// An empty response — no text, no tool calls — can't advance the
		// conversation. Don't append it to history (it would persist as a
		// blank transcript bubble, and the provider layer strips it from the
		// wire payload anyway); re-prompt within a small budget, then park
		// in the recoverable-error wait so the user gets the /retry//done
		// banner instead of a runaway loop.
		if len(result.ToolCalls) == 0 && strings.TrimSpace(result.Text) == "" {
			state.streamingPartial = ""
			state.consecutiveEmptyLLM++
			if state.consecutiveEmptyLLM >= maxConsecutiveEmptyLLMResponses {
				state.consecutiveEmptyLLM = 0
				state.awaitingLLMRecovery = true
				state.lastLLMError = fmt.Sprintf("model returned %d consecutive empty responses", maxConsecutiveEmptyLLMResponses)
				state.status = "awaiting_user"
				emitEvent(ctx, &state, EventKindStatusUpdate, map[string]any{
					"status":  "awaiting_user",
					"message": recoverableErrorPrefix + state.lastLLMError,
				})
				markRun(auditCtx, wfID, agentactivity.UpdateAgentRunInput{Status: "awaiting_user"})
				flushDurableEvents(ctx, &state)
			}
			continue
		}
		state.consecutiveEmptyLLM = 0

		// Append assistant turn, including any tool calls.
		assistantTurn := ConversationTurn{
			TurnID:    state.streamingTurnID,
			Role:      "assistant",
			Content:   result.Text,
			Timestamp: workflow.Now(ctx),
		}
		for _, tc := range result.ToolCalls {
			assistantTurn.ToolCalls = append(assistantTurn.ToolCalls, ToolCallRecord{
				ID:        tc.ID,
				Name:      tc.Name,
				Arguments: tc.Arguments,
			})
		}
		appendTurn(ctx, &state, assistantTurn)
		state.streamingPartial = ""

		// Abort-after-LLM guard (smoking-gun fix): a UserMessage and an Abort
		// can be delivered in the same workflow task. If the awaiting_user
		// selector consumed the user message and we ran the LLM step before
		// the abort goroutine was scheduled to set state.terminated /
		// cancelLoop, we must NOT now dispatch tools — that would open a fresh
		// approval gate (and arm a 72h timer) AFTER the run was already
		// aborted. drainPendingAbort gives the abort handler a turn first;
		// then re-check here, before any gate can open, and unwind.
		drainPendingAbort(loopCtx, &state)
		if state.terminated || loopCtx.Err() != nil {
			state.terminated = true
			break
		}

		// Dispatch tool calls. Use loopCtx so awaitApproval inside dispatch
		// observes abort-induced cancellation.
		for _, tc := range result.ToolCalls {
			toolResult, terminated := dispatchTool(loopCtx, sandboxCtx, &state, &input, tc, gw)
			// The call has completed; emit one aggregated, durable
			// tool_call_output event for any streamed output before the
			// tool-result turn so the transcript order reads
			// output → result.
			flushToolOutput(ctx, &state, tc.ID)
			appendTurn(ctx, &state, ConversationTurn{
				TurnID:     workflowUUID(ctx),
				Role:       "tool",
				ToolCallID: tc.ID,
				ToolName:   tc.Name,
				Content:    toolResult,
				Timestamp:  workflow.Now(ctx),
			})
			if terminated {
				state.terminated = true
				break
			}
		}

		// A text-only response (no tool calls) ends the agent's turn: the
		// trailing assistant turn makes awaitingUser gate the next iteration,
		// parking the run until the user replies.

		// Flush the durable transcript at the end of every iteration so a
		// crash/retention-expiry mid-run leaves at most one iteration's
		// events unpersisted.
		flushDurableEvents(ctx, &state)

		// Continue-as-new threshold. Flush MUST happen before CAN so the
		// compacted in-memory history isn't the only copy of older turns.
		if shouldContinueAsNew(&state) {
			flushDurableEvents(ctx, &state)
			return continueAsNew(ctx, input, &state)
		}
	}

	if state.iterations >= maxIters {
		state.status = "max_iterations"
		emitEvent(ctx, &state, EventKindStatusUpdate, map[string]any{
			"status":  "max_iterations",
			"message": fmt.Sprintf("hit max iterations (%d)", maxIters),
		})
	}
	if state.status == "running" {
		state.status = "completed"
		emitEvent(ctx, &state, EventKindStatusUpdate, map[string]any{"status": "completed"})
	}

	if !state.terminalAuditFlushed {
		markRun(auditCtx, wfID, agentactivity.UpdateAgentRunInput{
			Status:  state.status,
			EndedAt: workflow.Now(ctx).UTC().Format(time.RFC3339),
		})
		state.terminalAuditFlushed = true
	}

	// Final durable flush on the normal completion / max-iterations path.
	// The defer below is the catch-all for all other return paths.
	flushDurableEvents(ctx, &state)

	return nil
}

// markRun is the workflow's audit-trail update helper. Errors are logged
// and swallowed — a flaky AgentRuns API must never block the workflow
// loop. Called on every meaningful status transition.
func markRun(ctx workflow.Context, workflowID string, in agentactivity.UpdateAgentRunInput) {
	in.WorkflowID = workflowID
	if err := workflow.ExecuteActivity(ctx, agentcontract.ActivityUpdateAgentRun, in).Get(ctx, nil); err != nil {
		workflow.GetLogger(ctx).Warn("agent run audit update failed (non-fatal)", "err", err, "workflowId", workflowID)
	}
}

// openPendingApproval mirrors a freshly-opened approval gate into the
// PendingApprovals collection so the /platform/approvals queue page can
// surface it (Spike 7 commit γ). Best-effort: on failure the gate still
// resolves correctly inside the chat thread, the queue page just won't
// show that one row.
func openPendingApproval(ctx workflow.Context, state *agentState, input *InfrastructureAgentInput, approvalID, kind, title, body string, payload map[string]any) {
	// Best-effort and abort-aware: if the loop was already cancelled (abort
	// in flight), skip the synchronous activity entirely so we don't sit in a
	// retry loop against a slow/erroring pending-approvals endpoint while the
	// user is trying to abort. The queue row is a convenience mirror; the gate
	// still resolves correctly without it.
	if ctx.Err() != nil {
		return
	}
	in := agentactivity.OpenPendingApprovalInput{
		WorkspaceID:  input.WorkspaceID,
		WorkflowID:   workflow.GetInfo(ctx).WorkflowExecution.ID,
		RunID:        workflow.GetInfo(ctx).WorkflowExecution.RunID,
		AgentRunID:   input.AgentRunID,
		ApprovalID:   approvalID,
		Kind:         kind,
		Title:        title,
		BodyMarkdown: body,
		Payload:      payload,
	}
	var res agentactivity.OpenPendingApprovalResult
	if err := workflow.ExecuteActivity(ctx, agentcontract.ActivityOpenPendingApproval, in).Get(ctx, &res); err != nil {
		workflow.GetLogger(ctx).Warn("open pending-approval row failed (non-fatal)", "err", err, "approvalId", approvalID)
		return
	}
	if res.ID != "" {
		state.pendingApprovalRowIDs[approvalID] = res.ID
	}
}

// resolvePendingApproval flips the queue row to resolved/aborted. Pulls
// the row id out of state, then forgets it. Best-effort like its
// counterpart — a missing row id (open call failed) is tolerated.
//
// Uses workflow.NewDisconnectedContext so abort paths (which cancel
// loopCtx) can still flip the row to status=aborted; otherwise an
// abort would leave the queue row stuck on pending forever.
func resolvePendingApproval(ctx workflow.Context, state *agentState, approvalID, status, resolution, resolvedBy, notes string) {
	rowID := state.pendingApprovalRowIDs[approvalID]
	delete(state.pendingApprovalRowIDs, approvalID)
	if rowID == "" {
		return
	}
	disconnected, _ := workflow.NewDisconnectedContext(ctx)
	actCtx := workflow.WithActivityOptions(disconnected, workflow.ActivityOptions{
		StartToCloseTimeout: 5 * time.Second,
		RetryPolicy:         &temporal.RetryPolicy{MaximumAttempts: 2},
	})
	in := agentactivity.ResolvePendingApprovalInput{
		ID:             rowID,
		Status:         status,
		Resolution:     resolution,
		ResolvedBy:     resolvedBy,
		Notes:          notes,
		WorkspaceID:    state.workspaceID,
		ReviewerRounds: state.reviewerRounds,
	}
	if err := workflow.ExecuteActivity(actCtx, agentcontract.ActivityResolvePendingApproval, in).Get(actCtx, nil); err != nil {
		workflow.GetLogger(ctx).Warn("resolve pending-approval row failed (non-fatal)", "err", err, "approvalId", approvalID)
	}
}

// dispatchTool routes a single tool call to its handler. Returns the textual
// result (fed back to the model as a tool-result message) and a flag telling
// the caller whether the loop should terminate.
func dispatchTool(ctx workflow.Context, sandboxCtx workflow.Context, state *agentState, input *InfrastructureAgentInput, tc providers.ToolCall, gw gateWaiter) (string, bool) {
	workflowID := workflow.GetInfo(ctx).WorkflowExecution.ID
	auditCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 5 * time.Second,
		RetryPolicy:         &temporal.RetryPolicy{MaximumAttempts: 2},
	})

	switch tc.Name {
	case ToolProposeToUser:
		title, _ := tc.Arguments["title"].(string)
		summary, _ := tc.Arguments["summary"].(string)
		body, _ := tc.Arguments["body_markdown"].(string)
		state.proposal = &Proposal{
			ProposalID:   workflowUUID(ctx),
			Title:        title,
			Summary:      summary,
			BodyMarkdown: body,
			UpdatedAt:    workflow.Now(ctx),
		}
		emitEvent(ctx, state, EventKindProposalUpdate, map[string]any{
			"proposal_id":   state.proposal.ProposalID,
			"title":         title,
			"summary":       summary,
			"body_markdown": body,
		})
		return "Proposal posted to user; awaiting their response.", false

	case ToolDone:
		summary, _ := tc.Arguments["summary"].(string)
		state.status = "completed"
		emitEvent(ctx, state, EventKindStatusUpdate, map[string]any{
			"status":  "completed",
			"message": summary,
		})
		markRun(auditCtx, workflowID, agentactivity.UpdateAgentRunInput{
			Status:  "completed",
			Summary: summary,
			EndedAt: workflow.Now(ctx).UTC().Format(time.RFC3339),
		})
		state.terminalAuditFlushed = true
		return "Marked done.", true

	case ToolShellExec:
		command, _ := tc.Arguments["command"].(string)
		workingDir, _ := tc.Arguments["working_dir"].(string)

		// Defense in depth: classify the command for destructive patterns
		// (rm -rf, terraform destroy, kubectl delete, …). When matched, we
		// gate the actual exec behind a synthesized destructive_command
		// approval prompt regardless of whether the agent remembered to
		// call request_approval first. The system prompt instructs the
		// agent to gate destructive actions itself; this catches the case
		// where the agent forgets or is talched into skipping by prompt
		// injection.
		if classification := safety.ClassifyShell(command); classification.Destructive {
			ok, reason := requireDestructiveApproval(ctx, auditCtx, state, input, gw, workflowID, command, classification)
			if !ok {
				return jsonResult(map[string]any{
					"approved":  false,
					"reason":    reason,
					"command":   command,
					"patterns":  classification.Patterns,
					"exit_code": -1,
				}), false
			}
		}

		var res agentactivity.SandboxedShellResult
		if err := workflow.ExecuteActivity(sandboxCtx, agentcontract.ActivitySandboxedShell, agentactivity.SandboxedShellInput{
			WorkflowID: workflowID,
			RunID:      workflow.GetInfo(ctx).WorkflowExecution.RunID,
			CallID:     tc.ID,
			Command:    command,
			WorkingDir: workingDir,
		}).Get(sandboxCtx, &res); err != nil {
			return jsonError("shell_exec", err), false
		}
		return jsonResult(map[string]any{
			"exit_code":   res.ExitCode,
			"stdout":      res.Stdout,
			"stderr":      res.Stderr,
			"duration_ms": res.DurationMs,
			"truncated":   res.Truncated,
		}), false

	case ToolHTTPRequest:
		method, _ := tc.Arguments["method"].(string)
		urlStr, _ := tc.Arguments["url"].(string)
		body, _ := tc.Arguments["body"].(string)
		headers := stringMap(tc.Arguments["headers"])
		allow := input.HTTPAllowlist
		if len(allow) == 0 {
			allow = defaultHTTPAllowlist
		}
		var res agentactivity.HTTPRequestResult
		if err := workflow.ExecuteActivity(sandboxCtx, agentcontract.ActivityHTTPRequest, agentactivity.HTTPRequestInput{
			WorkflowID: workflowID,
			Method:     method,
			URL:        urlStr,
			Headers:    headers,
			Body:       body,
			Allowlist:  allow,
		}).Get(sandboxCtx, &res); err != nil {
			return jsonError("http_request", err), false
		}
		return jsonResult(map[string]any{
			"status":      res.Status,
			"status_code": res.StatusCode,
			"headers":     res.Headers,
			"body":        res.Body,
			"truncated":   res.Truncated,
			"duration_ms": res.DurationMs,
		}), false

	case ToolReadFile:
		path, _ := tc.Arguments["path"].(string)
		var res agentactivity.SandboxReadFileResult
		if err := workflow.ExecuteActivity(sandboxCtx, agentcontract.ActivitySandboxReadFile, agentactivity.SandboxReadFileInput{
			WorkflowID: workflowID,
			Path:       path,
		}).Get(sandboxCtx, &res); err != nil {
			return jsonError("read_file", err), false
		}
		return jsonResult(map[string]any{
			"content":    res.Content,
			"size_bytes": res.SizeBytes,
			"truncated":  res.Truncated,
		}), false

	case ToolWriteFile:
		path, _ := tc.Arguments["path"].(string)
		content, _ := tc.Arguments["content"].(string)
		var res agentactivity.SandboxWriteFileResult
		if err := workflow.ExecuteActivity(sandboxCtx, agentcontract.ActivitySandboxWriteFile, agentactivity.SandboxWriteFileInput{
			WorkflowID: workflowID,
			Path:       path,
			Content:    content,
		}).Get(sandboxCtx, &res); err != nil {
			return jsonError("write_file", err), false
		}
		return jsonResult(map[string]any{"bytes_written": res.BytesWritten}), false

	case ToolListDir:
		path, _ := tc.Arguments["path"].(string)
		var res agentactivity.SandboxListDirResult
		if err := workflow.ExecuteActivity(sandboxCtx, agentcontract.ActivitySandboxListDir, agentactivity.SandboxListDirInput{
			WorkflowID: workflowID,
			Path:       path,
		}).Get(sandboxCtx, &res); err != nil {
			return jsonError("list_dir", err), false
		}
		return jsonResult(map[string]any{"entries": res.Entries}), false

	case ToolRepoInspect:
		repoURL, _ := tc.Arguments["repo_url"].(string)
		revision, _ := tc.Arguments["revision"].(string)
		var res agentactivity.RepoInspectResult
		if err := workflow.ExecuteActivity(sandboxCtx, agentcontract.ActivityRepoInspect, agentactivity.RepoInspectInput{
			WorkflowID:  workflowID,
			RepoURL:     repoURL,
			Revision:    revision,
			GitHubToken: input.GitHubToken,
		}).Get(sandboxCtx, &res); err != nil {
			return jsonError("repo_inspect", err), false
		}
		return jsonResult(map[string]any{
			"source":      res.Source,
			"revision":    res.Revision,
			"clone_ref":   res.CloneRef,
			"tree":        res.Tree,
			"files":       res.Files,
			"truncated_at": res.TruncatedAt,
		}), false

	case ToolRequestApproval:
		// Don't open a gate post-abort (see requireDestructiveApproval).
		if ctx.Err() != nil {
			return jsonResult(map[string]any{"approved": false, "reason": "agent run aborted"}), true
		}
		title, _ := tc.Arguments["title"].(string)
		kind, _ := tc.Arguments["kind"].(string)
		if kind == "" {
			kind = agentcontract.ApprovalKindCustom
		}
		body, _ := tc.Arguments["body_markdown"].(string)
		approvalID := workflowUUID(ctx)

		state.pendingApprovals[approvalID] = PendingApproval{
			ApprovalID:   approvalID,
			Kind:         kind,
			Title:        title,
			BodyMarkdown: body,
			CreatedAt:    workflow.Now(ctx),
		}
		prevStatus := state.status
		state.status = "awaiting_approval"
		emitEvent(ctx, state, EventKindApprovalRequest, map[string]any{
			"approval_id":   approvalID,
			"kind":          kind,
			"title":         title,
			"body_markdown": body,
		})
		emitEvent(ctx, state, EventKindStatusUpdate, map[string]any{
			"status":  "awaiting_approval",
			"message": title,
		})
		markRun(auditCtx, workflowID, agentactivity.UpdateAgentRunInput{Status: "awaiting_approval"})
		openPendingApproval(auditCtx, state, input, approvalID, kind, title, body, nil)

		// Block until a signal with this approval_id arrives. Other ids are
		// dropped (they'll be re-issued when their parent approval prompts
		// are reopened); abort short-circuits the wait; the timeout
		// auto-rejects (resolution carries "approval timed out" and flows
		// through the normal rejection path below).
		resolution, aborted, _ := gw.await(ctx, approvalID, effectiveApprovalTimeout(input))
		delete(state.pendingApprovals, approvalID)
		// Restore the pre-gate status ONLY when not aborted: on abort,
		// gw.await already ran applyAbort, which set status="aborted" — and
		// prevStatus is the pre-gate "running", so restoring it here would
		// clobber the terminal status back to running and the loop-exit
		// fallthrough would then mark the run "completed" (BUG-A tail).
		if !aborted {
			state.status = prevStatus
		}
		if aborted {
			state.terminated = true
			resolvePendingApproval(auditCtx, state, approvalID, "aborted", "", resolution.ResolvedBy, "agent run aborted")
			return jsonResult(map[string]any{
				"approved": false,
				"reason":   "agent run aborted",
			}), true
		}
		emitEvent(ctx, state, EventKindApprovalResolved, map[string]any{
			"approval_id": approvalID,
			"approved":    resolution.Approved,
			"resolved_by": resolution.ResolvedBy,
			"notes":       resolution.Notes,
		})
		resolvePendingApproval(auditCtx, state, approvalID, "resolved", resolutionLabel(resolution.Approved), resolution.ResolvedBy, resolution.Notes)
		// Audit append + status return.
		markRun(auditCtx, workflowID, agentactivity.UpdateAgentRunInput{
			Status:     prevStatus,
			ApprovalID: approvalID,
			Kind:       kind,
			Title:      title,
			Resolution: resolutionLabel(resolution.Approved),
			ResolvedBy: resolution.ResolvedBy,
			ResolvedAt: workflow.Now(ctx).UTC().Format(time.RFC3339),
			Notes:      resolution.Notes,
		})
		return jsonResult(map[string]any{
			"approved":    resolution.Approved,
			"resolved_by": resolution.ResolvedBy,
			"notes":       resolution.Notes,
		}), false

	case ToolStartHealthCheck:
		return dispatchStartHealthCheck(ctx, state, tc)

	case ToolRegisterTool:
		return dispatchRegisterTool(ctx, sandboxCtx, state, tc, gw, input)

	case ToolProposePattern:
		return dispatchProposePattern(ctx, sandboxCtx, state, tc, gw, input)

	case ToolListPatterns:
		return dispatchListPatterns(state, tc)

	case ToolInstantiatePattern:
		return dispatchInstantiatePattern(ctx, sandboxCtx, state, input, tc, gw)

	case ToolOrbitListApps:
		var res agentactivity.OrbitListAppsResult
		if err := workflow.ExecuteActivity(sandboxCtx, agentcontract.ActivityOrbitListApps, agentactivity.OrbitListAppsInput{
			WorkspaceID: input.WorkspaceID,
		}).Get(sandboxCtx, &res); err != nil {
			return jsonError("orbit_list_apps", err), false
		}
		return jsonResult(map[string]any{"apps": res.Apps}), false

	case ToolOrbitGetApp:
		appID, _ := tc.Arguments["app_id"].(string)
		var res agentactivity.OrbitGetAppResult
		if err := workflow.ExecuteActivity(sandboxCtx, agentcontract.ActivityOrbitGetApp, agentactivity.OrbitGetAppInput{
			WorkspaceID: input.WorkspaceID,
			AppID:       appID,
		}).Get(sandboxCtx, &res); err != nil {
			return jsonError("orbit_get_app", err), false
		}
		return jsonResult(map[string]any{"app": res.App}), false

	case ToolOrbitListCloudAccounts:
		var res agentactivity.OrbitListCloudAccountsResult
		if err := workflow.ExecuteActivity(sandboxCtx, agentcontract.ActivityOrbitListCloudAccounts, agentactivity.OrbitListCloudAccountsInput{
			WorkspaceID: input.WorkspaceID,
		}).Get(sandboxCtx, &res); err != nil {
			return jsonError("orbit_list_cloud_accounts", err), false
		}
		return jsonResult(map[string]any{"accounts": res.Accounts}), false

	case ToolOrbitCloudLogin:
		return dispatchOrbitCloudLogin(ctx, sandboxCtx, state, tc)

	case ToolOrbitRepoClone:
		appID, _ := tc.Arguments["app_id"].(string)
		repoURL, _ := tc.Arguments["repo_url"].(string)
		revision, _ := tc.Arguments["revision"].(string)
		var res agentactivity.OrbitRepoCloneResult
		if err := workflow.ExecuteActivity(sandboxCtx, agentcontract.ActivityOrbitRepoClone, agentactivity.OrbitRepoCloneInput{
			WorkflowID:  workflow.GetInfo(ctx).WorkflowExecution.ID,
			WorkspaceID: input.WorkspaceID,
			AppID:       appID,
			RepoURL:     repoURL,
			Revision:    revision,
		}).Get(sandboxCtx, &res); err != nil {
			return jsonError("orbit_repo_clone", err), false
		}
		return jsonResult(map[string]any{
			"clone_path":      res.ClonePath,
			"owner":           res.Owner,
			"repo":            res.Repo,
			"branch":          res.Branch,
			"head_sha":        res.HeadSHA,
			"installation_id": res.InstallationID,
			"duration_ms":     res.DurationMs,
		}), false

	default:
		// Registered tool? Expand its template and dispatch as primitive(s).
		if reg, ok := state.registeredTools[tc.Name]; ok {
			return dispatchRegisteredTool(ctx, sandboxCtx, state, input, tc, reg, gw)
		}
		return fmt.Sprintf("ERROR: unknown tool %q.", tc.Name), false
	}
}

// refreshRegisteredTools fetches the workspace's approved AgentTools and
// stores them in state.registeredTools. Failures fall through silently —
// the next iteration will retry, and the agent still has access to all
// built-ins in the meantime.
func refreshRegisteredTools(ctx workflow.Context, actCtx workflow.Context, state *agentState, workspaceID string) {
	logger := workflow.GetLogger(ctx)
	var res agentactivity.ListApprovedToolsResult
	err := workflow.ExecuteActivity(actCtx, agentcontract.ActivityListApprovedAgentTools, agentactivity.ListApprovedToolsInput{
		WorkspaceID: workspaceID,
	}).Get(actCtx, &res)
	if err != nil {
		logger.Warn("list approved agent tools failed; using last cached set", "err", err)
		return
	}
	out := make(map[string]agentactivity.ApprovedAgentTool, len(res.Tools))
	for _, t := range res.Tools {
		out[t.Name] = t
	}
	state.registeredTools = out
}

// refreshAvailablePatterns fetches the platform-wide approved Patterns
// catalog and stores them in state.availablePatterns. Like
// refreshRegisteredTools, failures fall through silently — the next
// iteration will retry, and the agent still has access to all built-ins
// + registered tools in the meantime. Called at the top of each LLM
// iteration so newly approved patterns become discoverable mid-run.
// See plans/merry-strolling-bumblebee.md (Phase 2).
func refreshAvailablePatterns(ctx workflow.Context, actCtx workflow.Context, state *agentState) {
	logger := workflow.GetLogger(ctx)
	var res agentactivity.ListApprovedPatternsResult
	err := workflow.ExecuteActivity(actCtx, agentcontract.ActivityListApprovedPatterns, agentactivity.ListApprovedPatternsInput{}).Get(actCtx, &res)
	if err != nil {
		logger.Warn("list approved patterns failed; using last cached set", "err", err)
		return
	}
	out := make(map[string]agentactivity.ApprovedPattern, len(res.Patterns))
	for _, p := range res.Patterns {
		out[p.Name] = p
	}
	state.availablePatterns = out
}

// buildToolCatalog returns the schemas the LLM sees: built-ins plus every
// approved registered tool (whose schema is its inputSchemaJson). Names
// are deterministically ordered for stable workflow histories.
func buildToolCatalog(state *agentState) []providers.ToolSchema {
	out := builtInToolSchemas()
	if len(state.registeredTools) == 0 {
		return out
	}
	names := make([]string, 0, len(state.registeredTools))
	for n := range state.registeredTools {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, n := range names {
		t := state.registeredTools[n]
		schema := map[string]any{"type": "object"}
		if t.InputSchemaJSON != "" {
			var parsed map[string]any
			if err := json.Unmarshal([]byte(t.InputSchemaJSON), &parsed); err == nil {
				schema = parsed
			}
		}
		out = append(out, providers.ToolSchema{
			Name:        t.Name,
			Description: t.Description,
			InputSchema: schema,
		})
	}
	return out
}

// dispatchRegisteredTool expands a registered tool's template into one or
// more primitive calls and runs each via the standard primitive dispatch.
// Composite templates aggregate results into a JSON array; single-call
// templates return their primitive's result directly.
func dispatchRegisteredTool(ctx workflow.Context, sandboxCtx workflow.Context, state *agentState, input *InfrastructureAgentInput, tc providers.ToolCall, reg agentactivity.ApprovedAgentTool, gw gateWaiter) (string, bool) {
	calls, err := tooltemplate.Expand(tooltemplate.Kind(reg.TemplateKind), reg.TemplateJSON, tc.Arguments)
	if err != nil {
		return jsonError(reg.Name, err), false
	}
	if len(calls) == 0 {
		return jsonError(reg.Name, fmt.Errorf("template expansion produced no calls")), false
	}
	results := make([]any, 0, len(calls))
	for i, call := range calls {
		// Synthesize a fresh tool call with the primitive's name and the
		// expanded args; reuse the parent's CallID as a prefix so audit
		// can stitch them back together.
		synthetic := providers.ToolCall{
			ID:        fmt.Sprintf("%s.step-%d", tc.ID, i),
			Name:      call.Tool,
			Arguments: call.Args,
		}
		out, terminated := dispatchTool(ctx, sandboxCtx, state, input, synthetic, gw)
		var parsed any
		if jerr := json.Unmarshal([]byte(out), &parsed); jerr == nil {
			results = append(results, parsed)
		} else {
			results = append(results, out)
		}
		if terminated {
			break
		}
	}
	if len(results) == 1 {
		b, _ := json.Marshal(results[0])
		return string(b), false
	}
	b, _ := json.Marshal(map[string]any{"steps": results})
	return string(b), false
}

// dispatchRegisterTool persists the LLM's proposed tool template as a
// pending row, surfaces a tool_registration approval prompt, and on
// approval flips the row to approved. The agent's next turn sees
// {approved, name, id, reason?} and can then invoke the tool by name.
func dispatchRegisterTool(ctx workflow.Context, sandboxCtx workflow.Context, state *agentState, tc providers.ToolCall, gw gateWaiter, input *InfrastructureAgentInput) (string, bool) {
	// Don't open a gate post-abort (see requireDestructiveApproval).
	if ctx.Err() != nil {
		return jsonResult(map[string]any{"approved": false, "reason": "agent run aborted"}), true
	}
	name, _ := tc.Arguments["name"].(string)
	description, _ := tc.Arguments["description"].(string)
	templateKind, _ := tc.Arguments["template_kind"].(string)
	templateJSON, _ := tc.Arguments["template_json"].(string)
	inputSchemaJSON, _ := tc.Arguments["input_schema_json"].(string)
	reasoning, _ := tc.Arguments["reasoning"].(string)

	// Reject names that shadow built-in tools. The catalog merge would
	// produce a duplicate entry the LLM sees, and the dispatch switch
	// always favors the built-in over registered tools — so a registered
	// shell_exec / done / request_approval would never actually run, just
	// confuse the model.
	if isBuiltInToolName(name) {
		return jsonError("register_tool", fmt.Errorf("tool name %q collides with a built-in tool", name)), false
	}

	// Validate the template is well-formed BEFORE we surface an approval to
	// the human reviewer. Saves them clicking through obviously-broken
	// rows and gives the agent immediate feedback to fix typos.
	if _, err := tooltemplate.Expand(tooltemplate.Kind(templateKind), templateJSON, exampleArgsFromSchema(inputSchemaJSON)); err != nil {
		return jsonError("register_tool", fmt.Errorf("template invalid: %w", err)), false
	}

	var registered agentactivity.RegisterPendingToolResult
	if err := workflow.ExecuteActivity(sandboxCtx, agentcontract.ActivityRegisterPendingAgentTool, agentactivity.RegisterPendingToolInput{
		WorkspaceID:     input.WorkspaceID,
		Name:            name,
		Description:     description,
		InputSchemaJSON: inputSchemaJSON,
		TemplateKind:    templateKind,
		TemplateJSON:    templateJSON,
		Reasoning:       reasoning,
		CreatedByRunID:  workflow.GetInfo(ctx).WorkflowExecution.ID,
	}).Get(sandboxCtx, &registered); err != nil {
		return jsonError("register_tool", err), false
	}

	approvalID := workflowUUID(ctx)
	approvalTitle := fmt.Sprintf("Register new agent tool: %s", name)
	approvalBody := fmt.Sprintf("**Description**\n\n%s\n\n**Reasoning**\n\n%s\n\n**Template (%s)**\n\n```json\n%s\n```\n\n**Input schema**\n\n```json\n%s\n```", description, reasoning, templateKind, templateJSON, inputSchemaJSON)
	state.pendingApprovals[approvalID] = PendingApproval{
		ApprovalID:   approvalID,
		Kind:         agentcontract.ApprovalKindToolRegistration,
		Title:        approvalTitle,
		BodyMarkdown: approvalBody,
		Payload: map[string]any{
			"agent_tool_id":     registered.ID,
			"name":              name,
			"template_kind":     templateKind,
			"template_json":     templateJSON,
			"input_schema_json": inputSchemaJSON,
			"reasoning":         reasoning,
		},
		CreatedAt: workflow.Now(ctx),
	}
	prevStatus := state.status
	state.status = "awaiting_approval"
	// Include the full template + schema in the event payload so the
	// chat UI can render the editable form without a separate fetch.
	// (The body_markdown already contains a human-readable rendering;
	// these structured fields are for the editor.)
	emitEvent(ctx, state, EventKindApprovalRequest, map[string]any{
		"approval_id":       approvalID,
		"kind":              agentcontract.ApprovalKindToolRegistration,
		"title":             approvalTitle,
		"body_markdown":     fmt.Sprintf("Tool: `%s`\nKind: `%s`\n\n%s", name, templateKind, description),
		"agent_tool_id":     registered.ID,
		"name":              name,
		"description":       description,
		"template_kind":     templateKind,
		"template_json":     templateJSON,
		"input_schema_json": inputSchemaJSON,
		"reasoning":         reasoning,
	})
	emitEvent(ctx, state, EventKindStatusUpdate, map[string]any{
		"status":  "awaiting_approval",
		"message": fmt.Sprintf("tool registration: %s", name),
	})

	// Local audit context for best-effort PendingApprovals queue updates
	// (Spike 7 commit γ). Mirrors the markRun pattern: short timeout, low
	// retry count — failures are logged and swallowed.
	auditCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 5 * time.Second,
		RetryPolicy:         &temporal.RetryPolicy{MaximumAttempts: 2},
	})
	openPendingApproval(auditCtx, state, input, approvalID, agentcontract.ApprovalKindToolRegistration, approvalTitle, approvalBody, map[string]any{
		"agent_tool_id":     registered.ID,
		"name":              name,
		"description":       description,
		"template_kind":     templateKind,
		"template_json":     templateJSON,
		"input_schema_json": inputSchemaJSON,
		"reasoning":         reasoning,
	})

	// Timeout auto-rejects: the synthesized resolution (Approved=false,
	// Notes="approval timed out") flows through the rejection path below —
	// the tool row is resolved rejected, the pending-approval row closed,
	// and an approval_resolution event emitted — so no special-casing here.
	resolution, aborted, _ := gw.await(ctx, approvalID, effectiveApprovalTimeout(input))
	delete(state.pendingApprovals, approvalID)
	// Restore pre-gate status only when not aborted (see request_approval
	// gate: on abort gw.await already set status="aborted").
	if !aborted {
		state.status = prevStatus
	}
	if aborted {
		state.terminated = true
		// Reject the pending row on abort so it doesn't linger as approvable.
		_ = workflow.ExecuteActivity(sandboxCtx, agentcontract.ActivityResolveAgentTool, agentactivity.ResolveAgentToolInput{
			ID: registered.ID, WorkspaceID: input.WorkspaceID, Approved: false, Reason: "agent run aborted",
		}).Get(sandboxCtx, nil)
		resolvePendingApproval(auditCtx, state, approvalID, "aborted", "", resolution.ResolvedBy, "agent run aborted")
		return jsonResult(map[string]any{"approved": false, "reason": "agent run aborted"}), true
	}

	// α — apply reviewer edits (if any). Effective values are what the
	// AgentTools row will be patched to; we validate those before signaling
	// the activity so a typo'd edit fails the gate cleanly rather than
	// poisoning the registry.
	finalName := name
	finalDescription := description
	finalTemplateKind := templateKind
	finalTemplateJSON := templateJSON
	finalSchemaJSON := inputSchemaJSON
	if resolution.Approved && resolution.Edited {
		if resolution.EditedName != "" {
			finalName = resolution.EditedName
		}
		if resolution.EditedDescription != "" {
			finalDescription = resolution.EditedDescription
		}
		if resolution.EditedTemplateKind != "" {
			finalTemplateKind = resolution.EditedTemplateKind
		}
		if resolution.EditedTemplateJSON != "" {
			finalTemplateJSON = resolution.EditedTemplateJSON
		}
		if resolution.EditedSchemaJSON != "" {
			finalSchemaJSON = resolution.EditedSchemaJSON
		}
		if isBuiltInToolName(finalName) {
			return jsonError("register_tool", fmt.Errorf("edit invalid: name %q collides with a built-in tool", finalName)), false
		}
		if _, err := tooltemplate.Expand(tooltemplate.Kind(finalTemplateKind), finalTemplateJSON, exampleArgsFromSchema(finalSchemaJSON)); err != nil {
			return jsonError("register_tool", fmt.Errorf("edit invalid: %w", err)), false
		}
	}

	var resolveResult agentactivity.ResolveAgentToolResult
	if err := workflow.ExecuteActivity(sandboxCtx, agentcontract.ActivityResolveAgentTool, agentactivity.ResolveAgentToolInput{
		ID:                 registered.ID,
		WorkspaceID:        input.WorkspaceID,
		Approved:           resolution.Approved,
		ResolvedBy:         resolution.ResolvedBy,
		Reason:             resolution.Notes,
		Edited:             resolution.Approved && resolution.Edited,
		EditedName:         resolution.EditedName,
		EditedDescription:  resolution.EditedDescription,
		EditedTemplateKind: resolution.EditedTemplateKind,
		EditedTemplateJSON: resolution.EditedTemplateJSON,
		EditedSchemaJSON:   resolution.EditedSchemaJSON,
	}).Get(sandboxCtx, &resolveResult); err != nil {
		return jsonError("register_tool", fmt.Errorf("resolve: %w", err)), false
	}

	emitEvent(ctx, state, EventKindApprovalResolved, map[string]any{
		"approval_id":            approvalID,
		"approved":               resolution.Approved,
		"resolved_by":            resolution.ResolvedBy,
		"notes":                  resolution.Notes,
		"edited":                 resolution.Approved && len(resolveResult.EditedFields) > 0,
		"edited_fields":          resolveResult.EditedFields,
		"agent_tool_version_id":  resolveResult.AgentToolVersionID,
	})
	resolvePendingApproval(auditCtx, state, approvalID, "resolved", resolutionLabel(resolution.Approved), resolution.ResolvedBy, resolution.Notes)

	if resolution.Approved {
		// Eagerly add to in-memory catalog so the next LLM call sees it
		// without waiting for the next refresh tick. Use the FINAL
		// (post-edit) values.
		if state.registeredTools == nil {
			state.registeredTools = map[string]agentactivity.ApprovedAgentTool{}
		}
		state.registeredTools[finalName] = agentactivity.ApprovedAgentTool{
			ID:              registered.ID,
			Name:            finalName,
			Description:     finalDescription,
			InputSchemaJSON: finalSchemaJSON,
			TemplateKind:    finalTemplateKind,
			TemplateJSON:    finalTemplateJSON,
		}
	}

	// Tool result the agent sees. Includes the diff between proposed and
	// final so the model can reason about the correction.
	result := map[string]any{
		"approved":      resolution.Approved,
		"name":          finalName,
		"agent_tool_id": registered.ID,
		"resolved_by":   resolution.ResolvedBy,
		"notes":         resolution.Notes,
		"edited":        resolution.Approved && len(resolveResult.EditedFields) > 0,
		"edited_fields": resolveResult.EditedFields,
	}
	if len(resolveResult.EditedFields) > 0 {
		result["agent_proposed"] = map[string]any{
			"name":              name,
			"description":       description,
			"template_kind":     templateKind,
			"template_json":     templateJSON,
			"input_schema_json": inputSchemaJSON,
		}
		result["final"] = map[string]any{
			"name":              finalName,
			"description":       finalDescription,
			"template_kind":     finalTemplateKind,
			"template_json":     finalTemplateJSON,
			"input_schema_json": finalSchemaJSON,
		}
	}
	return jsonResult(result), false
}

// dispatchProposePattern is the platform-catalog counterpart to
// dispatchRegisterTool: the agent proposes a reusable deployment recipe,
// the workflow persists it as a pending Patterns row, opens a
// pattern_registration approval gate, and on approval (with optional
// admin edits) flips the row to approved. The agent's next turn sees
// {approved, name, pattern_id, edited_fields?} — analogous to
// register_tool's result. The pattern lives platform-wide (no workspace
// scope), but the approval gate is still associated with this agent
// run's workspace so admins can see the source.
//
// See plans/merry-strolling-bumblebee.md (Patterns Catalog spike).
func dispatchProposePattern(ctx workflow.Context, sandboxCtx workflow.Context, state *agentState, tc providers.ToolCall, gw gateWaiter, input *InfrastructureAgentInput) (string, bool) {
	// Don't open a gate post-abort (see requireDestructiveApproval).
	if ctx.Err() != nil {
		return jsonResult(map[string]any{"approved": false, "reason": "agent run aborted"}), true
	}
	name, _ := tc.Arguments["name"].(string)
	displayName, _ := tc.Arguments["display_name"].(string)
	description, _ := tc.Arguments["description"].(string)
	category, _ := tc.Arguments["category"].(string)
	templateKind, _ := tc.Arguments["template_kind"].(string)
	templateJSON, _ := tc.Arguments["template_json"].(string)
	inputSchemaJSON, _ := tc.Arguments["input_schema_json"].(string)
	reasoning, _ := tc.Arguments["reasoning"].(string)

	// Reject names that shadow built-in tools — the LLM would see a
	// duplicate entry in its catalog and the dispatch switch always favors
	// the built-in over patterns, so the registered name would never
	// actually run.
	if isBuiltInToolName(name) {
		return jsonError("propose_pattern", fmt.Errorf("pattern name %q collides with a built-in tool", name)), false
	}

	// Pre-flight template validation — saves the admin reviewer clicking
	// through obviously-broken proposals and gives the agent immediate
	// feedback to fix typos. Same machinery register_tool uses.
	if _, err := tooltemplate.Expand(tooltemplate.Kind(templateKind), templateJSON, exampleArgsFromSchema(inputSchemaJSON)); err != nil {
		return jsonError("propose_pattern", fmt.Errorf("template invalid: %w", err)), false
	}

	var registered agentactivity.RegisterPendingPatternResult
	if err := workflow.ExecuteActivity(sandboxCtx, agentcontract.ActivityRegisterPendingPattern, agentactivity.RegisterPendingPatternInput{
		Name:            name,
		DisplayName:     displayName,
		Description:     description,
		Category:        category,
		TemplateKind:    templateKind,
		TemplateJSON:    templateJSON,
		InputSchemaJSON: inputSchemaJSON,
		Reasoning:       reasoning,
		CreatedByRunID:  workflow.GetInfo(ctx).WorkflowExecution.ID,
		CreatedByUser:   input.UserID,
	}).Get(sandboxCtx, &registered); err != nil {
		return jsonError("propose_pattern", err), false
	}

	approvalID := workflowUUID(ctx)
	approvalTitle := fmt.Sprintf("Register new pattern: %s", displayName)
	approvalBody := fmt.Sprintf(
		"**Pattern**: `%s`\n**Category**: %s\n\n**Description**\n\n%s\n\n**Reasoning**\n\n%s\n\n**Template (%s)**\n\n```json\n%s\n```\n\n**Input schema**\n\n```json\n%s\n```",
		name, category, description, reasoning, templateKind, templateJSON, inputSchemaJSON,
	)
	state.pendingApprovals[approvalID] = PendingApproval{
		ApprovalID:   approvalID,
		Kind:         agentcontract.ApprovalKindPatternRegistration,
		Title:        approvalTitle,
		BodyMarkdown: approvalBody,
		Payload: map[string]any{
			"pattern_id":        registered.ID,
			"name":              name,
			"display_name":      displayName,
			"description":       description,
			"category":          category,
			"template_kind":     templateKind,
			"template_json":     templateJSON,
			"input_schema_json": inputSchemaJSON,
			"reasoning":         reasoning,
		},
		CreatedAt: workflow.Now(ctx),
	}
	prevStatus := state.status
	state.status = "awaiting_approval"
	emitEvent(ctx, state, EventKindApprovalRequest, map[string]any{
		"approval_id":       approvalID,
		"kind":              agentcontract.ApprovalKindPatternRegistration,
		"title":             approvalTitle,
		"body_markdown":     fmt.Sprintf("Pattern: `%s`\nCategory: `%s`\nKind: `%s`\n\n%s", name, category, templateKind, description),
		"pattern_id":        registered.ID,
		"name":              name,
		"display_name":      displayName,
		"description":       description,
		"category":          category,
		"template_kind":     templateKind,
		"template_json":     templateJSON,
		"input_schema_json": inputSchemaJSON,
		"reasoning":         reasoning,
	})
	emitEvent(ctx, state, EventKindStatusUpdate, map[string]any{
		"status":  "awaiting_approval",
		"message": fmt.Sprintf("pattern registration: %s", name),
	})

	auditCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 5 * time.Second,
		RetryPolicy:         &temporal.RetryPolicy{MaximumAttempts: 2},
	})
	openPendingApproval(auditCtx, state, input, approvalID, agentcontract.ApprovalKindPatternRegistration, approvalTitle, approvalBody, map[string]any{
		"pattern_id":        registered.ID,
		"name":              name,
		"display_name":      displayName,
		"description":       description,
		"category":          category,
		"template_kind":     templateKind,
		"template_json":     templateJSON,
		"input_schema_json": inputSchemaJSON,
		"reasoning":         reasoning,
	})

	// Timeout auto-rejects via the rejection path below (resolve pattern row
	// rejected, close pending row, emit approval_resolution).
	resolution, aborted, _ := gw.await(ctx, approvalID, effectiveApprovalTimeout(input))
	delete(state.pendingApprovals, approvalID)
	// Restore pre-gate status only when not aborted (see request_approval
	// gate: on abort gw.await already set status="aborted").
	if !aborted {
		state.status = prevStatus
	}
	if aborted {
		state.terminated = true
		// Reject on abort so the row doesn't linger as approvable.
		_ = workflow.ExecuteActivity(sandboxCtx, agentcontract.ActivityResolvePattern, agentactivity.ResolvePatternInput{
			ID: registered.ID, Approved: false, Reason: "agent run aborted",
		}).Get(sandboxCtx, nil)
		resolvePendingApproval(auditCtx, state, approvalID, "aborted", "", resolution.ResolvedBy, "agent run aborted")
		return jsonResult(map[string]any{"approved": false, "reason": "agent run aborted"}), true
	}

	// Apply admin edits if any. Validate the post-edit template before
	// signaling the activity so a typo'd edit fails the gate cleanly.
	finalName := name
	finalDisplayName := displayName
	finalDescription := description
	finalCategory := category
	finalTemplateKind := templateKind
	finalTemplateJSON := templateJSON
	finalSchemaJSON := inputSchemaJSON
	if resolution.Approved && resolution.Edited {
		if resolution.EditedName != "" {
			finalName = resolution.EditedName
		}
		if resolution.EditedDisplayName != "" {
			finalDisplayName = resolution.EditedDisplayName
		}
		if resolution.EditedDescription != "" {
			finalDescription = resolution.EditedDescription
		}
		if resolution.EditedCategory != "" {
			finalCategory = resolution.EditedCategory
		}
		if resolution.EditedTemplateKind != "" {
			finalTemplateKind = resolution.EditedTemplateKind
		}
		if resolution.EditedTemplateJSON != "" {
			finalTemplateJSON = resolution.EditedTemplateJSON
		}
		if resolution.EditedSchemaJSON != "" {
			finalSchemaJSON = resolution.EditedSchemaJSON
		}
		if isBuiltInToolName(finalName) {
			return jsonError("propose_pattern", fmt.Errorf("edit invalid: name %q collides with a built-in tool", finalName)), false
		}
		if _, err := tooltemplate.Expand(tooltemplate.Kind(finalTemplateKind), finalTemplateJSON, exampleArgsFromSchema(finalSchemaJSON)); err != nil {
			return jsonError("propose_pattern", fmt.Errorf("edit invalid: %w", err)), false
		}
	}

	var resolveResult agentactivity.ResolvePatternResult
	if err := workflow.ExecuteActivity(sandboxCtx, agentcontract.ActivityResolvePattern, agentactivity.ResolvePatternInput{
		ID:                 registered.ID,
		Approved:           resolution.Approved,
		ResolvedBy:         resolution.ResolvedBy,
		Reason:             resolution.Notes,
		Edited:             resolution.Approved && resolution.Edited,
		EditedName:         resolution.EditedName,
		EditedDisplayName:  resolution.EditedDisplayName,
		EditedDescription:  resolution.EditedDescription,
		EditedCategory:     resolution.EditedCategory,
		EditedTemplateKind: resolution.EditedTemplateKind,
		EditedTemplateJSON: resolution.EditedTemplateJSON,
		EditedSchemaJSON:   resolution.EditedSchemaJSON,
	}).Get(sandboxCtx, &resolveResult); err != nil {
		return jsonError("propose_pattern", fmt.Errorf("resolve: %w", err)), false
	}

	emitEvent(ctx, state, EventKindApprovalResolved, map[string]any{
		"approval_id":         approvalID,
		"approved":            resolution.Approved,
		"resolved_by":         resolution.ResolvedBy,
		"notes":               resolution.Notes,
		"edited":              resolution.Approved && len(resolveResult.EditedFields) > 0,
		"edited_fields":       resolveResult.EditedFields,
		"pattern_version_id":  resolveResult.PatternVersionID,
	})
	resolvePendingApproval(auditCtx, state, approvalID, "resolved", resolutionLabel(resolution.Approved), resolution.ResolvedBy, resolution.Notes)

	result := map[string]any{
		"approved":      resolution.Approved,
		"name":          finalName,
		"display_name":  finalDisplayName,
		"pattern_id":    registered.ID,
		"resolved_by":   resolution.ResolvedBy,
		"notes":         resolution.Notes,
		"edited":        resolution.Approved && len(resolveResult.EditedFields) > 0,
		"edited_fields": resolveResult.EditedFields,
	}
	if len(resolveResult.EditedFields) > 0 {
		result["agent_proposed"] = map[string]any{
			"name":              name,
			"display_name":      displayName,
			"description":       description,
			"category":          category,
			"template_kind":     templateKind,
			"template_json":     templateJSON,
			"input_schema_json": inputSchemaJSON,
		}
		result["final"] = map[string]any{
			"name":              finalName,
			"display_name":      finalDisplayName,
			"description":       finalDescription,
			"category":          finalCategory,
			"template_kind":     finalTemplateKind,
			"template_json":     finalTemplateJSON,
			"input_schema_json": finalSchemaJSON,
		}
	}
	return jsonResult(result), false
}

// dispatchListPatterns returns the in-memory snapshot of the
// platform-wide Patterns catalog (approved only, refreshed at the top of
// each LLM iteration). Optional `category` filter narrows the result so
// the agent can browse e.g. "data" or "cache" without flooding its
// context. Returns lightweight metadata only — no template_json (which
// can be large); the agent reads it via instantiate_pattern's
// pattern_id selection at execute time. See Phase 2 of
// plans/merry-strolling-bumblebee.md.
func dispatchListPatterns(state *agentState, tc providers.ToolCall) (string, bool) {
	categoryFilter, _ := tc.Arguments["category"].(string)

	names := make([]string, 0, len(state.availablePatterns))
	for n := range state.availablePatterns {
		names = append(names, n)
	}
	sort.Strings(names)

	type listed struct {
		ID              string `json:"id"`
		Name            string `json:"name"`
		DisplayName     string `json:"display_name"`
		Description     string `json:"description"`
		Category        string `json:"category"`
		CurrentVersion  int    `json:"current_version"`
		InputSchemaJSON string `json:"input_schema_json"`
	}
	out := make([]listed, 0, len(names))
	for _, n := range names {
		p := state.availablePatterns[n]
		if categoryFilter != "" && p.Category != categoryFilter {
			continue
		}
		out = append(out, listed{
			ID:              p.ID,
			Name:            p.Name,
			DisplayName:     p.DisplayName,
			Description:     p.Description,
			Category:        p.Category,
			CurrentVersion:  p.CurrentVersion,
			InputSchemaJSON: p.InputSchemaJSON,
		})
	}
	return jsonResult(map[string]any{
		"patterns": out,
		"count":    len(out),
	}), false
}

// dispatchInstantiatePattern provisions an approved Pattern into the
// current workspace. Lifecycle:
//   1. GetPatternByID — load templateJson + inputSchemaJson + version.
//   2. Validate user-supplied parameters against the schema's required[].
//   3. CreatePatternInstance — row at status=pending; bind to workspace,
//      app (optional), name (unique per workspace), patternVersion snap.
//   4. UpdateStatus(validating), then UpdateStatus(provisioning).
//   5. tooltemplate.Expand against the user-supplied parameters and
//      dispatch each expanded primitive via dispatchTool — same path
//      registered tools use, so all the existing safety / approval /
//      sandbox plumbing applies. Failures along the way short-circuit
//      to UpdateStatus(failed, errorMessage=...).
//   6. On success: UpdateStatus(active, outputs={...}). Outputs are the
//      JSON-decoded results of each primitive call, in step order.
//
// See plans/merry-strolling-bumblebee.md (Phase 3). For v1, instance
// execution lives inside the agent run. A future iteration moves
// long-running instances into a dedicated PatternInstantiationWorkflow
// without changing this schema.
func dispatchInstantiatePattern(ctx workflow.Context, sandboxCtx workflow.Context, state *agentState, input *InfrastructureAgentInput, tc providers.ToolCall, gw gateWaiter) (string, bool) {
	patternID, _ := tc.Arguments["pattern_id"].(string)
	workspaceID, _ := tc.Arguments["workspace_id"].(string)
	if workspaceID == "" {
		workspaceID = input.WorkspaceID
	}
	name, _ := tc.Arguments["name"].(string)
	appID, _ := tc.Arguments["app_id"].(string)
	rawParams, _ := tc.Arguments["parameters"].(map[string]any)
	if rawParams == nil {
		rawParams = map[string]any{}
	}

	if patternID == "" || workspaceID == "" || name == "" {
		return jsonError("instantiate_pattern", fmt.Errorf("pattern_id, workspace_id, and name are required")), false
	}

	// Step 1: load the pattern's full content. PatternNotFound errors
	// surface as a non-retryable application error from the activity.
	var patternRes agentactivity.GetPatternByIDResult
	if err := workflow.ExecuteActivity(sandboxCtx, agentcontract.ActivityGetPatternByID,
		agentactivity.GetPatternByIDInput{ID: patternID}).Get(sandboxCtx, &patternRes); err != nil {
		return jsonError("instantiate_pattern", fmt.Errorf("get pattern: %w", err)), false
	}
	pattern := patternRes.Pattern
	if pattern.Status != "approved" {
		return jsonError("instantiate_pattern",
			fmt.Errorf("pattern %q is %q; only approved patterns can be instantiated", pattern.Name, pattern.Status)), false
	}

	// Step 2: parameter validation against the snapshot schema. For v1
	// we honor only "required" — full JSON Schema validation is a
	// follow-up. Missing required keys short-circuit before we create
	// a row, so the agent gets immediate feedback.
	if missing := missingRequiredKeys(pattern.InputSchemaJSON, rawParams); len(missing) > 0 {
		return jsonError("instantiate_pattern",
			fmt.Errorf("missing required parameter(s): %s", strings.Join(missing, ", "))), false
	}

	// Step 3: create the row. CreatePatternInstance maps name-collision
	// errors to a non-retryable application error so the agent can pick
	// a different name without a retry loop.
	var created agentactivity.CreatePatternInstanceResult
	if err := workflow.ExecuteActivity(sandboxCtx, agentcontract.ActivityCreatePatternInstance,
		agentactivity.CreatePatternInstanceInput{
			WorkspaceID:    workspaceID,
			PatternID:      pattern.ID,
			PatternVersion: pattern.CurrentVersion,
			Name:           name,
			AppID:          appID,
			Parameters:     rawParams,
			CreatedByUser:  input.UserID,
			CreatedByRunID: workflow.GetInfo(ctx).WorkflowExecution.ID,
			WorkflowID:     workflow.GetInfo(ctx).WorkflowExecution.ID,
		}).Get(sandboxCtx, &created); err != nil {
		return jsonError("instantiate_pattern", fmt.Errorf("create instance: %w", err)), false
	}
	instanceID := created.ID

	// failInstance is a helper that writes status=failed + an
	// errorMessage to the row, then returns the jsonError result so
	// callers can `return failInstance(...)` in one line.
	failInstance := func(stage, msg string) (string, bool) {
		_ = workflow.ExecuteActivity(sandboxCtx, agentcontract.ActivityUpdatePatternInstanceStatus,
			agentactivity.UpdatePatternInstanceStatusInput{
				ID:           instanceID,
				Status:       "failed",
				ErrorMessage: fmt.Sprintf("%s: %s", stage, msg),
			}).Get(sandboxCtx, nil)
		return jsonError("instantiate_pattern", fmt.Errorf("%s: %s", stage, msg)), false
	}

	// Step 4a: validating.
	_ = workflow.ExecuteActivity(sandboxCtx, agentcontract.ActivityUpdatePatternInstanceStatus,
		agentactivity.UpdatePatternInstanceStatusInput{ID: instanceID, Status: "validating"}).Get(sandboxCtx, nil)

	// Step 5a: pre-flight expand on the user-supplied parameters so a
	// template that references {{var}} placeholders missing from the
	// schema fails cleanly here, before any side-effects.
	calls, err := tooltemplate.Expand(tooltemplate.Kind(pattern.TemplateKind), pattern.TemplateJSON, rawParams)
	if err != nil {
		return failInstance("template invalid", err.Error())
	}
	if len(calls) == 0 {
		return failInstance("template invalid", "expansion produced no primitive calls")
	}

	// Step 4b: provisioning.
	_ = workflow.ExecuteActivity(sandboxCtx, agentcontract.ActivityUpdatePatternInstanceStatus,
		agentactivity.UpdatePatternInstanceStatusInput{ID: instanceID, Status: "provisioning"}).Get(sandboxCtx, nil)

	// Step 5b: dispatch each expanded primitive via the standard tool
	// path (sandbox, approval gates, safety classifier all apply).
	// Capture each step's result; on any error short-circuit to failed.
	results := make([]any, 0, len(calls))
	for i, call := range calls {
		synthetic := providers.ToolCall{
			ID:        fmt.Sprintf("%s.step-%d", tc.ID, i),
			Name:      call.Tool,
			Arguments: call.Args,
		}
		out, terminated := dispatchTool(ctx, sandboxCtx, state, input, synthetic, gw)
		var parsed any
		if jerr := json.Unmarshal([]byte(out), &parsed); jerr == nil {
			results = append(results, parsed)
			if errMap, ok := parsed.(map[string]any); ok {
				if errVal, hasErr := errMap["error"]; hasErr {
					return failInstance("step "+fmt.Sprintf("%d", i+1), fmt.Sprintf("%v", errVal))
				}
			}
		} else {
			results = append(results, out)
		}
		if terminated {
			// Abort: don't mark failed (the agent run is exiting); the
			// row stays at "provisioning" so an admin can see where it
			// stopped. Future iteration: write status=aborted.
			return jsonResult(map[string]any{
				"instance_id":   instanceID,
				"pattern_id":    pattern.ID,
				"pattern_name":  pattern.Name,
				"status":        "aborted",
				"partial_steps": len(results),
			}), true
		}
	}

	// Step 6: active + outputs.
	outputs := map[string]any{"steps": results}
	_ = workflow.ExecuteActivity(sandboxCtx, agentcontract.ActivityUpdatePatternInstanceStatus,
		agentactivity.UpdatePatternInstanceStatusInput{
			ID:      instanceID,
			Status:  "active",
			Outputs: outputs,
		}).Get(sandboxCtx, nil)

	return jsonResult(map[string]any{
		"instance_id":     instanceID,
		"pattern_id":      pattern.ID,
		"pattern_name":    pattern.Name,
		"pattern_version": pattern.CurrentVersion,
		"name":            name,
		"workspace_id":    workspaceID,
		"status":          "active",
		"outputs":         outputs,
	}), false
}

// missingRequiredKeys returns the names of required JSON-Schema
// properties that are absent from args. Schema must be JSON-encoded; an
// unparseable schema returns no missing keys (the agent's pre-flight
// validation already runs on propose_pattern, so we don't block here on
// schema syntax — that's the platform admin's problem at proposal time).
func missingRequiredKeys(schemaJSON string, args map[string]any) []string {
	if strings.TrimSpace(schemaJSON) == "" {
		return nil
	}
	var schema map[string]any
	if err := json.Unmarshal([]byte(schemaJSON), &schema); err != nil {
		return nil
	}
	rawRequired, ok := schema["required"].([]any)
	if !ok {
		return nil
	}
	missing := make([]string, 0, len(rawRequired))
	for _, r := range rawRequired {
		key, ok := r.(string)
		if !ok {
			continue
		}
		if _, present := args[key]; !present {
			missing = append(missing, key)
		}
	}
	return missing
}

// isBuiltInToolName reports whether name collides with the workflow's
// built-in tools. Used by dispatchRegisterTool to reject shadow names.
func isBuiltInToolName(name string) bool {
	switch name {
	case ToolProposeToUser, ToolDone,
		ToolShellExec, ToolHTTPRequest,
		ToolReadFile, ToolWriteFile, ToolListDir,
		ToolRepoInspect, ToolRequestApproval,
		ToolRegisterTool, ToolStartHealthCheck,
		ToolProposePattern, ToolListPatterns, ToolInstantiatePattern,
		ToolOrbitListApps, ToolOrbitGetApp, ToolOrbitListCloudAccounts:
		return true
	}
	return false
}

// exampleArgsFromSchema returns a map filled with placeholder values for
// every required property in the schema. Used by dispatchRegisterTool for
// the template's pre-flight validation: every {{var}} placeholder must
// resolve to *some* value, which means at minimum every placeholder must
// appear as a property in the schema.
func exampleArgsFromSchema(schemaJSON string) map[string]any {
	var schema map[string]any
	if err := json.Unmarshal([]byte(schemaJSON), &schema); err != nil {
		return map[string]any{}
	}
	props, _ := schema["properties"].(map[string]any)
	out := map[string]any{}
	for k := range props {
		out[k] = "x"
	}
	return out
}

// requireDestructiveApproval surfaces a destructive_command approval gate
// keyed to the command and waits for human resolution. Returns (true, "")
// on approve and (false, reason) on reject or abort. The audit row gets
// the resolution appended either way so the run-history page records the
// gate even when the action was rejected.
func requireDestructiveApproval(ctx workflow.Context, auditCtx workflow.Context, state *agentState, input *InfrastructureAgentInput, gw gateWaiter, workflowID, command string, classification safety.Classification) (bool, string) {
	// Don't open a gate if the run was already aborted (ctx/loopCtx cancelled).
	// Opening here would emit an approval_request, mirror a pending-approvals
	// row, and arm a 72h approval timer AFTER termination. Bail as rejected.
	if ctx.Err() != nil {
		return false, "agent run aborted"
	}
	approvalID := workflowUUID(ctx)
	title := "Destructive shell command — approval required"
	body := fmt.Sprintf("The agent wants to run a command that matched the workflow's destructive-command policy.\n\n**Patterns:** %s\n\n**Command:**\n\n```\n%s\n```\n\nApprove only if you have verified this is the intended action.",
		strings.Join(classification.Patterns, ", "), command)

	state.pendingApprovals[approvalID] = PendingApproval{
		ApprovalID:   approvalID,
		Kind:         agentcontract.ApprovalKindDestructiveCmd,
		Title:        title,
		BodyMarkdown: body,
		Payload: map[string]any{
			"command":  command,
			"patterns": classification.Patterns,
		},
		CreatedAt: workflow.Now(ctx),
	}
	prevStatus := state.status
	state.status = "awaiting_approval"
	emitEvent(ctx, state, EventKindApprovalRequest, map[string]any{
		"approval_id":   approvalID,
		"kind":          agentcontract.ApprovalKindDestructiveCmd,
		"title":         title,
		"body_markdown": body,
		"command":       command,
		"patterns":      classification.Patterns,
	})
	emitEvent(ctx, state, EventKindStatusUpdate, map[string]any{
		"status":  "awaiting_approval",
		"message": title,
	})
	markRun(auditCtx, workflowID, agentactivity.UpdateAgentRunInput{Status: "awaiting_approval"})
	openPendingApproval(auditCtx, state, input, approvalID, agentcontract.ApprovalKindDestructiveCmd, title, body, map[string]any{
		"command":  command,
		"patterns": classification.Patterns,
	})

	// Timeout auto-rejects: the synthesized resolution carries
	// "approval timed out" and runs the rejection path below (emit
	// approval_resolution, close pending row, deny the command).
	resolution, aborted, _ := gw.await(ctx, approvalID, effectiveApprovalTimeout(input))
	delete(state.pendingApprovals, approvalID)
	// Restore pre-gate status only when not aborted (see request_approval
	// gate: on abort gw.await already set status="aborted").
	if !aborted {
		state.status = prevStatus
	}
	if aborted {
		state.terminated = true
		resolvePendingApproval(auditCtx, state, approvalID, "aborted", "", resolution.ResolvedBy, "agent run aborted")
		return false, "agent run aborted"
	}
	emitEvent(ctx, state, EventKindApprovalResolved, map[string]any{
		"approval_id": approvalID,
		"approved":    resolution.Approved,
		"resolved_by": resolution.ResolvedBy,
		"notes":       resolution.Notes,
	})
	resolvePendingApproval(auditCtx, state, approvalID, "resolved", resolutionLabel(resolution.Approved), resolution.ResolvedBy, resolution.Notes)
	markRun(auditCtx, workflowID, agentactivity.UpdateAgentRunInput{
		Status:     prevStatus,
		ApprovalID: approvalID,
		Kind:       agentcontract.ApprovalKindDestructiveCmd,
		Title:      title,
		Resolution: resolutionLabel(resolution.Approved),
		ResolvedBy: resolution.ResolvedBy,
		ResolvedAt: workflow.Now(ctx).UTC().Format(time.RFC3339),
		Notes:      resolution.Notes,
	})
	if !resolution.Approved {
		reason := resolution.Notes
		if reason == "" {
			reason = "destructive command rejected"
		}
		return false, reason
	}
	return true, ""
}

// dispatchOrbitCloudLogin runs the appropriate per-cloud CLI device-code
// login command via SandboxedShell, with streaming output enabled so the
// user sees the device code in the chat as the CLI prints it. The user
// authenticates as themselves; tokens land in the sandbox pod and die
// with TeardownSandbox — no credentials are stored in Orbit's data plane.
//
// The agent calls this when orbit_list_cloud_accounts is empty (or the
// user wants to authenticate to a different account than the configured
// one). It does NOT replace the cloud-accounts collection — that
// collection is now an optional convenience for named bookmarks.
func dispatchOrbitCloudLogin(ctx workflow.Context, sandboxCtx workflow.Context, state *agentState, tc providers.ToolCall) (string, bool) {
	provider, _ := tc.Arguments["provider"].(string)
	tenant, _ := tc.Arguments["tenant"].(string)

	command, label, err := buildCloudLoginCommand(provider, tenant)
	if err != nil {
		return jsonError("orbit_cloud_login", err), false
	}

	emitEvent(ctx, state, EventKindStatusUpdate, map[string]any{
		"status":  state.status,
		"message": fmt.Sprintf("awaiting %s login — watch for the device code below", label),
	})

	workflowID := workflow.GetInfo(ctx).WorkflowExecution.ID
	runID := workflow.GetInfo(ctx).WorkflowExecution.RunID
	var res agentactivity.SandboxedShellResult
	if err := workflow.ExecuteActivity(sandboxCtx, agentcontract.ActivitySandboxedShell, agentactivity.SandboxedShellInput{
		WorkflowID: workflowID,
		RunID:      runID,
		CallID:     tc.ID,
		Command:    command,
		// Device-code flows give the user up to ~15 min to enter the code;
		// budget 20 min so a slow user doesn't trip a sandbox timeout.
		TimeoutSeconds: 1200,
	}).Get(sandboxCtx, &res); err != nil {
		return jsonError("orbit_cloud_login", err), false
	}

	authenticated := res.ExitCode == 0
	return jsonResult(map[string]any{
		"authenticated": authenticated,
		"provider":      provider,
		"exit_code":     res.ExitCode,
		"stdout":        res.Stdout,
		"stderr":        res.Stderr,
		"duration_ms":   res.DurationMs,
	}), false
}

// buildCloudLoginCommand returns (bash command, human label) for a given
// provider. Each command is the canonical no-browser flow for that CLI.
// Unknown / empty providers are rejected so the agent gets a clear error.
func buildCloudLoginCommand(provider, tenant string) (string, string, error) {
	switch provider {
	case "azure":
		cmd := "az login --use-device-code"
		if tenant != "" {
			cmd += " --tenant " + bashQuote(tenant)
		}
		// JSON output makes the post-login state easier for the agent to
		// parse if it wants account info. The actual device code still
		// streams to stdout.
		cmd += " --output json"
		return cmd, "Azure", nil
	case "gcp":
		return "gcloud auth login --no-launch-browser", "Google Cloud", nil
	case "aws":
		// `aws sso login` expects the user to have run `aws configure sso`
		// previously. We let the failure message bubble up to the agent
		// rather than guess at a setup wizard here.
		return "aws sso login", "AWS", nil
	default:
		return "", "", fmt.Errorf("unknown provider %q (expected azure | gcp | aws)", provider)
	}
}

// bashQuote single-quotes s for safe inclusion in a bash command line. The
// classic '\'' trick escapes embedded single quotes.
func bashQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

// defaultSandboxEnv returns the env vars every sandbox starts with —
// pager/prompt disabling so CLIs (az / gcloud / aws) run cleanly under
// `bash -lc` without TTY trickery. Workspace-specific env (input.SandboxEnv)
// overlays on top via mergeEnv so callers can still pin a different value.
func defaultSandboxEnv() map[string]string {
	return map[string]string{
		"AZURE_CORE_NO_PAGER":          "1",
		"AZURE_CORE_OUTPUT":            "json",
		"AZURE_CORE_ONLY_SHOW_ERRORS":  "false",
		"AWS_PAGER":                    "",
		"CLOUDSDK_CORE_DISABLE_PROMPTS": "1",
		"CLOUDSDK_PYTHON_SITEPACKAGES":  "1",
		"GIT_TERMINAL_PROMPT":          "0",
		"PYTHONUNBUFFERED":             "1",
		"DEBIAN_FRONTEND":              "noninteractive",
	}
}

// mergeEnv overlays b on top of a; b's values win. nil maps are treated
// as empty.
func mergeEnv(a, b map[string]string) map[string]string {
	out := make(map[string]string, len(a)+len(b))
	for k, v := range a {
		out[k] = v
	}
	for k, v := range b {
		out[k] = v
	}
	return out
}

// dispatchStartHealthCheck writes the requested health-check spec to the
// App's healthConfig via the internal API. The Apps.afterChange hook then
// calls manageSchedule, which starts (or restarts under TERMINATE_IF_RUNNING)
// the canonical HealthCheckWorkflow under the stable id
// `health-check-{appId}`. This replaces the previous "spawn an ABANDONed
// child workflow" approach so app.status and app.healthConfig stay in
// sync and only one HealthCheckWorkflow ever runs per app. See GitHub
// issue #44.
func dispatchStartHealthCheck(ctx workflow.Context, state *agentState, tc providers.ToolCall) (string, bool) {
	appID, _ := tc.Arguments["app_id"].(string)
	url, _ := tc.Arguments["url"].(string)
	method, _ := tc.Arguments["method"].(string)
	if method == "" {
		method = "GET"
	}
	expectedStatus := intArg(tc.Arguments, "expected_status", 200)
	interval := intArg(tc.Arguments, "interval", 60)
	timeout := intArg(tc.Arguments, "timeout", 10)

	if appID == "" || url == "" {
		return jsonError("start_child_health_check", fmt.Errorf("app_id and url are required")), false
	}

	// Reuse the LLM-step activity options' style for an internal-API call
	// — short timeout, modest retries; the hook does the heavy lifting.
	cfgCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    2 * time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    30 * time.Second,
			MaximumAttempts:    3,
		},
	})

	input := activities.ConfigureAppHealthCheckInput{
		AppID: appID,
		Spec: activities.HealthConfigSpec{
			URL:            url,
			Method:         method,
			ExpectedStatus: expectedStatus,
			Interval:       interval,
			Timeout:        timeout,
		},
	}
	if err := workflow.ExecuteActivity(cfgCtx, agentcontract.ActivityConfigureAppHealthCheck, input).Get(cfgCtx, nil); err != nil {
		return jsonError("start_child_health_check", fmt.Errorf("configure health check: %w", err)), false
	}

	// The canonical workflow id Orbit uses for app health checks — useful
	// to surface back to the LLM for any follow-up "is the check running?"
	// reasoning, but the agent doesn't manage its lifecycle.
	workflowID := fmt.Sprintf("health-check-%s", appID)
	return jsonResult(map[string]any{
		"workflow_id":      workflowID,
		"app_id":           appID,
		"url":              url,
		"interval_seconds": interval,
		"managed_by":       "orbit-apps-hook",
	}), false
}

// resolutionLabel maps the approval bool to the audit row's enum.
func resolutionLabel(approved bool) string {
	if approved {
		return "approved"
	}
	return "rejected"
}

// intArg pulls a numeric argument from the LLM-supplied args map. The JSON
// decoder produces float64 for numbers; callers want int.
func intArg(args map[string]any, key string, fallback int) int {
	if v, ok := args[key]; ok {
		switch x := v.(type) {
		case float64:
			return int(x)
		case int:
			return x
		case int64:
			return int(x)
		}
	}
	return fallback
}

// handleReviewerMessage drives one reviewer↔agent exchange during an
// open approval gate (commit β). The reviewer's text becomes a regular
// user conversation turn (annotated so audit + the agent's own context
// know it arrived under a gate), an LLM step runs with NO tools so the
// agent can only respond with text, and the agent's reply becomes a
// regular assistant conversation turn. The gate stays open.
//
// We deliberately drop any tool calls the LLM emits in this mode — the
// agent talks but cannot act while waiting for human approval. Surfacing
// them would create a path around the gate.
//
// Failure modes are tolerant: if the gate has already resolved by the
// time the signal arrives we still process the message (it just becomes
// a normal late conversation turn); if the LLM call fails we log and
// drop, the next reviewer message can retry.
func handleReviewerMessage(ctx workflow.Context, state *agentState, input *InfrastructureAgentInput, payload agentcontract.ReviewerMessageSignalPayload) {
	logger := workflow.GetLogger(ctx)
	if payload.Message == "" {
		return
	}

	// Append the reviewer's message to history. The annotation prefix
	// gives the model context that this turn is a side-conversation
	// during an approval gate so it answers as a reviewer collaborator
	// rather than continuing the deployment plan.
	annotated := payload.Message
	if payload.ApprovalID != "" {
		annotated = fmt.Sprintf("[Reviewer asks during approval gate %s]: %s", payload.ApprovalID, payload.Message)
	}
	turnID := workflowUUID(ctx)
	appendTurn(ctx, state, ConversationTurn{
		TurnID:    turnID,
		Role:      "user",
		Content:   annotated,
		Timestamp: workflow.Now(ctx),
	})
	state.reviewerRounds++

	// LLM step. Empty Tools array means the model can only respond with
	// text — clean way to enforce the no-action invariant without
	// post-hoc filtering.
	llmCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 5 * time.Minute,
		HeartbeatTimeout:    30 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:        2 * time.Second,
			BackoffCoefficient:     2.0,
			MaximumInterval:        30 * time.Second,
			MaximumAttempts:        3,
			NonRetryableErrorTypes: []string{"InvalidInput", "LLMNonRetryable"},
		},
	})
	respTurnID := workflowUUID(ctx)
	llmInput := agentactivity.LLMNextStepInput{
		WorkflowID:  workflow.GetInfo(ctx).WorkflowExecution.ID,
		RunID:       workflow.GetInfo(ctx).WorkflowExecution.RunID,
		TurnID:      respTurnID,
		WorkspaceID: input.WorkspaceID,
		ProviderID:  input.LLMProviderID,
		System:      reviewerModeSystemPrompt(input),
		Messages:    historyToProviderMessages(state.history),
		Tools:       nil,
		MaxTokens:   2048,
	}
	var result agentactivity.LLMNextStepResult
	if err := workflow.ExecuteActivity(llmCtx, ActivityLLMNextStep, llmInput).Get(llmCtx, &result); err != nil {
		logger.Warn("reviewer-message LLM step failed (non-fatal)", "err", err, "approvalId", payload.ApprovalID)
		return
	}

	// Agent's text response becomes a regular assistant turn. Tool calls
	// (if any leaked through despite Tools=nil) are intentionally NOT
	// recorded as ToolCallRecords on the turn — the workflow doesn't
	// dispatch them. We log and drop.
	if len(result.ToolCalls) > 0 {
		logger.Warn("reviewer-mode LLM emitted tool calls; dropping",
			"approvalId", payload.ApprovalID, "toolCount", len(result.ToolCalls))
	}
	appendTurn(ctx, state, ConversationTurn{
		TurnID:    respTurnID,
		Role:      "assistant",
		Content:   result.Text,
		Timestamp: workflow.Now(ctx),
	})
}

// reviewerModeSystemPrompt overrides the workflow's default system prompt
// when the agent is responding to reviewer questions during a gate.
// Concise, instructive, makes the no-action invariant explicit so the
// model doesn't hallucinate tool calls we'd then drop.
func reviewerModeSystemPrompt(input *InfrastructureAgentInput) string {
	base := effectiveSystemPrompt(*input)
	return base + "\n\n[REVIEW MODE] You are currently parked on an approval gate. The user reviewing your last action has asked a question. Respond with text only — DO NOT emit any tool calls. The gate stays open until the human explicitly approves or rejects via the chat UI. Use this turn to explain your reasoning, suggest alternatives, or answer questions; do not propose new actions until the gate resolves."
}

// approvalTimedOutReason is the canonical reason/notes string recorded when
// an approval gate expires. The UI and audit trail key on this exact value.
const approvalTimedOutReason = "approval timed out"

// gateWaiter carries everything an approval gate needs to wait robustly: the
// approval channel it resolves on, the abort channel it must honor, and the
// idempotent terminal-abort handler to run if an abort arrives mid-wait. It
// replaces the bare approvalCh that used to be threaded through dispatchTool
// and the four gate dispatchers.
type gateWaiter struct {
	approvalCh workflow.ReceiveChannel
	abortCh    workflow.ReceiveChannel
	// applyAbort performs the terminal abort (cancelLoop, terminal audit,
	// state.terminated) exactly once. await invokes it when it consumes the
	// abort signal itself, so the gate never depends on a separate goroutine
	// winning a scheduling turn to translate Abort → cancelLoop.
	applyAbort func(AbortSignalPayload)
}

// await blocks until an ApprovalSignal with matching approvalID arrives, an
// Abort signal arrives (or already cancelled the loop), or the timeout
// elapses. Mismatched approval signals are dropped — callers re-emit the
// approval prompt when their gate reopens.
//
// Returns (resolution, aborted, timedOut). On timeout it synthesizes a
// rejected resolution carrying approvalTimedOutReason so callers can flow it
// through their normal rejection path (resolve rows, emit
// approval_resolution) without special-casing every site.
//
// BUG-A robustness: await selects on the abort channel DIRECTLY (not just on
// ctx.Done()). Previously the gate wait only woke on loopCtx.Done(), which
// depends on the abort GOROUTINE — or the inline drainPendingAbort — having
// already consumed the Abort and called cancelLoop(). When a UserMessage and
// an Abort land in the same workflow task and the gate opens via the
// awaiting_user path, that translation can lose a coroutine-scheduling race
// in the live worker (the deterministic test scheduler masked it), leaving
// the run parked at awaiting_approval until force-terminated. By draining
// abortCh here and applying the abort inline, await terminates the gate wait
// regardless of interleaving: whichever consumer of abortCh runs first wins,
// and applyAbort is idempotent on state.terminated. The destructive/gated
// command still never executes — await returns aborted=true and the caller's
// rejection path resolves the row.
//
// We use a Selector that watches the approval channel, the abort channel,
// ctx.Done(), and a timer rather than relying on Receive returning
// more=false on cancellation, because that contract isn't reliable across SDK
// versions.
func (gw gateWaiter) await(ctx workflow.Context, approvalID string, timeout time.Duration) (ApprovalSignalPayload, bool, bool) {
	// Fast-path: if abort already cancelled the loop before we got here (e.g.
	// it fired while the gate's pre-wait audit / openPendingApproval activity
	// was still running), report aborted immediately instead of arming a
	// timer and entering the select.
	if ctx.Err() != nil {
		return ApprovalSignalPayload{}, true, false
	}
	// Also drain a buffered abort synchronously before entering the select:
	// it may already be sitting in the channel from the same task that opened
	// this gate, in which case we want to terminate without arming a timer.
	var early AbortSignalPayload
	if gw.abortCh.ReceiveAsync(&early) {
		gw.applyAbort(early)
		return ApprovalSignalPayload{}, true, false
	}
	deadline := workflow.NewTimer(ctx, timeout)
	for {
		var resolved ApprovalSignalPayload
		var abortPayload AbortSignalPayload
		var matched, aborted, abortReceived, timedOut bool

		sel := workflow.NewSelector(ctx)
		sel.AddReceive(gw.approvalCh, func(c workflow.ReceiveChannel, _ bool) {
			var p ApprovalSignalPayload
			c.Receive(ctx, &p)
			if p.ApprovalID == approvalID {
				resolved = p
				matched = true
			}
			// Else: mismatched id; drop and the outer loop reselects.
		})
		sel.AddReceive(gw.abortCh, func(c workflow.ReceiveChannel, _ bool) {
			// Consume the abort here so the gate wait honors it intrinsically,
			// independent of the abort goroutine's scheduling.
			c.Receive(ctx, &abortPayload)
			abortReceived = true
		})
		sel.AddReceive(ctx.Done(), func(c workflow.ReceiveChannel, _ bool) {
			// The abort goroutine (or inline drain) cancelled loopCtx first.
			aborted = true
		})
		sel.AddFuture(deadline, func(workflow.Future) {
			// ctx cancellation also fires the timer; the ctx.Done() branch
			// takes precedence (aborted), so only treat this as a timeout
			// when the context is still live.
			if ctx.Err() == nil {
				timedOut = true
			}
		})
		sel.Select(ctx)

		if abortReceived {
			// We won the race to the abort signal; run the terminal handler so
			// the loop is cancelled and the run terminates aborted.
			gw.applyAbort(abortPayload)
			return ApprovalSignalPayload{}, true, false
		}
		if aborted {
			return ApprovalSignalPayload{}, true, false
		}
		if timedOut {
			return ApprovalSignalPayload{
				ApprovalID: approvalID,
				Approved:   false,
				ResolvedBy: "system",
				Notes:      approvalTimedOutReason,
			}, false, true
		}
		if matched {
			return resolved, false, false
		}
	}
}

// jsonResult marshals a tool result for the model. Always returns valid JSON
// even on marshal failure so the LLM can reliably parse.
func jsonResult(v map[string]any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return fmt.Sprintf(`{"error":"marshal: %s"}`, err.Error())
	}
	return string(b)
}

// jsonError formats an activity error as a tool result so the model can see
// what went wrong and adapt.
func jsonError(tool string, err error) string {
	return fmt.Sprintf(`{"error":%q,"tool":%q}`, err.Error(), tool)
}

// stringMap coerces a map[string]any (as decoded from LLM JSON) into the
// map[string]string the activity expects. Non-string values are stringified.
func stringMap(v any) map[string]string {
	in, ok := v.(map[string]any)
	if !ok {
		return nil
	}
	out := make(map[string]string, len(in))
	for k, val := range in {
		switch s := val.(type) {
		case string:
			out[k] = s
		default:
			out[k] = fmt.Sprintf("%v", val)
		}
	}
	return out
}

func awaitingUser(state *agentState) bool {
	// Recovery wait after an LLM-step error — gated independently of
	// the tool-history shape because the LLM failed before producing
	// any new turn to inspect.
	if state.awaitingLLMRecovery {
		return true
	}
	if len(state.history) == 0 {
		return false
	}
	last := state.history[len(state.history)-1]
	// A text-only assistant reply (no tool calls) ends the agent's turn:
	// there is nothing to execute, and re-prompting with unchanged history
	// cannot advance the run — the model is waiting for the user (runaway
	// regression, run agent-4d50c96e).
	if last.Role == "assistant" && len(last.ToolCalls) == 0 {
		return true
	}
	if last.Role != "tool" {
		return false
	}
	// Walk back to find the assistant turn this tool result belongs to.
	for i := len(state.history) - 2; i >= 0; i-- {
		if state.history[i].Role == "assistant" {
			for _, tc := range state.history[i].ToolCalls {
				if tc.ID == last.ToolCallID && tc.Name == ToolProposeToUser {
					return true
				}
			}
			return false
		}
	}
	return false
}

func builtInToolSchemas() []providers.ToolSchema {
	return []providers.ToolSchema{
		{
			Name:        ToolProposeToUser,
			Description: "Show the user a structured deployment proposal and wait for their reply. Use when you have a concrete plan to share or a question that needs the user's input.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"title":         map[string]any{"type": "string", "description": "Short headline for the proposal"},
					"summary":       map[string]any{"type": "string", "description": "One-paragraph summary"},
					"body_markdown": map[string]any{"type": "string", "description": "Full proposal body in markdown"},
				},
				"required": []string{"title", "summary", "body_markdown"},
			},
		},
		{
			Name:        ToolDone,
			Description: "Mark the agent run finished. Use only after the user's goal is achieved (or unrecoverably impossible). Provides a final summary message.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"summary": map[string]any{"type": "string", "description": "Final summary for the user"},
				},
				"required": []string{"summary"},
			},
		},
		{
			Name: ToolShellExec,
			Description: "Run a bash command inside the run's sandbox. Use this for `az`, `gcloud`, `kubectl`, `helm`, `terraform`, `pulumi`, `git`, `npm`, etc. Output is captured and returned. Long commands heartbeat automatically. Returns {exit_code, stdout, stderr, duration_ms, truncated}.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"command":     map[string]any{"type": "string", "description": "The shell command to run via `bash -lc`."},
					"working_dir": map[string]any{"type": "string", "description": "Optional. Defaults to the sandbox root."},
				},
				"required": []string{"command"},
			},
		},
		{
			Name: ToolHTTPRequest,
			Description: "Make an outbound HTTP request, gated by the workspace's host allowlist. Use for cloud-provider REST APIs the agent doesn't have a CLI for. Returns {status, status_code, headers, body, truncated}.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"method":  map[string]any{"type": "string", "description": "GET / POST / PUT / DELETE / PATCH"},
					"url":     map[string]any{"type": "string"},
					"headers": map[string]any{"type": "object", "description": "Header name → value"},
					"body":    map[string]any{"type": "string", "description": "Optional request body."},
				},
				"required": []string{"url"},
			},
		},
		{
			Name: ToolReadFile,
			Description: "Read a file inside the sandbox. Path is relative to the sandbox root and rejected if it escapes.",
			InputSchema: map[string]any{
				"type":       "object",
				"properties": map[string]any{"path": map[string]any{"type": "string"}},
				"required":   []string{"path"},
			},
		},
		{
			Name: ToolWriteFile,
			Description: "Write a file inside the sandbox (parent directories are created). Use to author terraform / helm / pulumi files before applying.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"path":    map[string]any{"type": "string"},
					"content": map[string]any{"type": "string"},
				},
				"required": []string{"path", "content"},
			},
		},
		{
			Name: ToolListDir,
			Description: "List the contents of a directory inside the sandbox.",
			InputSchema: map[string]any{
				"type":       "object",
				"properties": map[string]any{"path": map[string]any{"type": "string", "description": "Defaults to '.'"}},
			},
		},
		{
			Name: ToolRepoInspect,
			Description: "Survey a git repository (tree + key manifest files like README, package.json, go.mod, Dockerfile). Tries the GitHub API first; falls back to a shallow clone of the main branch into the sandbox at repo/<slug>/. Use this to learn what kind of app the user wants to deploy before proposing a plan.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"repo_url":  map[string]any{"type": "string", "description": "https://github.com/owner/repo or git URL"},
					"revision":  map[string]any{"type": "string", "description": "Defaults to 'main'."},
					"max_files": map[string]any{"type": "integer", "description": "Tree entry cap (default 200)."},
				},
				"required": []string{"repo_url"},
			},
		},
		{
			Name: ToolRequestApproval,
			Description: "Request explicit human approval before proceeding. The workflow blocks on this; the chat UI surfaces an inline Approve/Reject card. Use BEFORE any destructive command (terraform destroy, kubectl delete, az ... delete) and any time the user has not yet given consent for a billable / observable action. Returns {approved, resolved_by, notes}.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"title":         map[string]any{"type": "string", "description": "Short headline shown on the approval card."},
					"kind":          map[string]any{"type": "string", "enum": []string{"destructive_command", "tool_registration", "proposal", "custom"}, "description": "Defaults to 'custom'."},
					"body_markdown": map[string]any{"type": "string", "description": "Full detail rendered as markdown. Embed the exact command/diff being approved."},
				},
				"required": []string{"title", "body_markdown"},
			},
		},
		{
			Name: ToolRegisterTool,
			Description: `Register a new named tool for this workspace. The tool becomes a parameterized template over primitives (shell or http); after a workspace admin approves it the agent can invoke it by name in subsequent turns and the template expands to vetted primitive calls. You never write executable code — the template references {{var}} placeholders that bind to your supplied args at call time. Use this to capture a useful procedure once instead of re-deriving it every run (e.g. deploy_azure_appservice → shell_exec("az appservice create ...")). Returns {approved, name, agent_tool_id, resolved_by, notes}.`,
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"name":              map[string]any{"type": "string", "description": "Slug-style tool name (snake_case). Must not collide with built-ins."},
					"description":       map[string]any{"type": "string", "description": "What the tool does, in one paragraph."},
					"template_kind":     map[string]any{"type": "string", "enum": []string{"shell", "http", "composite"}},
					"template_json":     map[string]any{"type": "string", "description": "JSON-encoded template body. Shell: {\"command\":\"...{{var}}...\"}. HTTP: {\"method\":\"GET\",\"url\":\"...\"}. Composite: {\"steps\":[{...}]}."},
					"input_schema_json": map[string]any{"type": "string", "description": "JSON Schema for the tool's args. Every {{var}} placeholder in template_json must appear as a property here."},
					"reasoning":         map[string]any{"type": "string", "description": "Why this tool is worth registering. Shown to the human reviewer."},
				},
				"required": []string{"name", "description", "template_kind", "template_json"},
			},
		},
		{
			Name: ToolInstantiatePattern,
			Description: `Provision an approved Pattern into a workspace. Pass pattern_id (from list_patterns), workspace_id (defaults to the current run's workspace), a unique name for the instance, and the parameters object (must satisfy the pattern's input_schema_json). The platform validates parameters, expands the template through the same engine that runs registered tools (shell / http / composite primitives), runs each primitive with the agent's existing safety + approval plumbing, and writes the result back as a PatternInstance row. Returns {instance_id, pattern_id, status, outputs}. Prefer this over shell when a matching pattern exists — patterns are audited, deterministic, and cheap to re-run.`,
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"pattern_id":   map[string]any{"type": "string", "description": "id of an approved Pattern (from list_patterns)."},
					"workspace_id": map[string]any{"type": "string", "description": "Workspace to provision into. Defaults to the current run's workspace if omitted."},
					"name":         map[string]any{"type": "string", "description": "Human name for the instance, unique within the target workspace."},
					"parameters":   map[string]any{"type": "object", "description": "Args matching the pattern's input_schema_json."},
					"app_id":       map[string]any{"type": "string", "description": "Optional: bind this instance to an existing App (e.g. \"Postgres for myapp\")."},
				},
				"required": []string{"pattern_id", "name", "parameters"},
			},
		},
		{
			Name: ToolListPatterns,
			Description: `List the platform-wide Patterns catalog (admin-approved deployment recipes available to every workspace). Call this EARLY in a run — before reaching for shell — to see whether an existing pattern already solves the user's request. Each entry includes the pattern's id, name, display_name, description, category, and input_schema_json (the parameters it accepts). When a pattern matches, prefer it: invoke it via instantiate_pattern instead of re-deriving from shell. Returns {patterns: [...], count}.`,
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"category": map[string]any{
						"type":        "string",
						"enum":        []string{"compute", "data", "cache", "queue", "observability", "edge", "static-site", "other"},
						"description": "Optional filter; omit to list the whole catalog.",
					},
				},
			},
		},
		{
			Name: ToolProposePattern,
			Description: `Propose a new platform-wide deployment Pattern. Patterns are the durable, curated counterpart to register_tool — once a platform admin approves the proposal, the pattern lives in the global catalog and any workspace can instantiate it (via instantiate_pattern, later via a browse UI). Use this AFTER you've successfully completed a deployment via shell so the next person doesn't have to re-derive the steps. The pattern's template_json compiles via the same engine as register_tool (shell / http / composite). Returns {approved, name, pattern_id, resolved_by, notes, edited_fields}.`,
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"name":              map[string]any{"type": "string", "description": "Slug-style pattern name (snake_case). Globally unique across all workspaces."},
					"display_name":      map[string]any{"type": "string", "description": "Human-readable name shown in the catalog UI."},
					"description":       map[string]any{"type": "string", "description": "What the pattern provisions, in one paragraph."},
					"category":          map[string]any{"type": "string", "enum": []string{"compute", "data", "cache", "queue", "observability", "edge", "static-site", "other"}, "description": "Catalog category. Browsers filter by this."},
					"template_kind":     map[string]any{"type": "string", "enum": []string{"shell", "http", "composite"}},
					"template_json":     map[string]any{"type": "string", "description": "JSON-encoded template body. Same shape as register_tool's template_json."},
					"input_schema_json": map[string]any{"type": "string", "description": "JSON Schema for the parameters a PatternInstance must supply. Every {{var}} in template_json must appear as a property here."},
					"reasoning":         map[string]any{"type": "string", "description": "Why this pattern is worth productizing. Shown to the platform admin reviewer."},
				},
				"required": []string{"name", "display_name", "description", "category", "template_kind", "template_json", "input_schema_json"},
			},
		},
		{
			Name: ToolStartHealthCheck,
			Description: "Set up a periodic HTTP health check against a deployed URL. Writes the spec onto the App's healthConfig; Orbit's platform then runs exactly one HealthCheckWorkflow per app (durable, survives this agent run, survives worker restarts) and the App detail page shows live status. Idempotent — calling again with new params restarts the same canonical workflow. Use this once you've successfully deployed something the user wants monitored.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"app_id":          map[string]any{"type": "string", "description": "Orbit App id the health check belongs to."},
					"url":             map[string]any{"type": "string", "description": "URL to probe."},
					"method":          map[string]any{"type": "string", "description": "HTTP method, default GET."},
					"expected_status": map[string]any{"type": "integer", "description": "Expected HTTP status code, default 200."},
					"interval":        map[string]any{"type": "integer", "description": "Seconds between checks. Default 60. Server-side minimum is 30."},
					"timeout":         map[string]any{"type": "integer", "description": "Per-request timeout seconds. Default 10."},
				},
				"required": []string{"app_id", "url"},
			},
		},
		{
			Name:        ToolOrbitListApps,
			Description: "List every app in the current workspace. Use this when the user references an app by name and you need its id, when you're deciding which apps to deploy, or when the workspace-context block is stale. Workspace is implicit — you cannot reach across workspaces. Returns {apps: [{id, name, description, status, repository}]}.",
			InputSchema: map[string]any{"type": "object", "properties": map[string]any{}},
		},
		{
			Name:        ToolOrbitGetApp,
			Description: "Fetch full details for one app in the current workspace: repository, health config, build config. Use this when the workspace-context summary doesn't have enough detail. Returns {app: {id, name, ..., health_config, build_config}}; returns AppNotFound when the id isn't in this workspace.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"app_id": map[string]any{"type": "string", "description": "The Orbit app id. Get from orbit_list_apps if you don't already know it."},
				},
				"required": []string{"app_id"},
			},
		},
		{
			Name:        ToolOrbitListCloudAccounts,
			Description: "List every cloud account connected to the current workspace. Use this to pick the target account before proposing a deployment, or to confirm the user has the provider you need. Credentials are NEVER returned — they reach the sandbox only via orbit_cloud_login. Returns {accounts: [{id, name, provider, region, status, last_validated_at}]}.",
			InputSchema: map[string]any{"type": "object", "properties": map[string]any{}},
		},
		{
			Name:        ToolOrbitCloudLogin,
			Description: "Authenticate to a cloud provider as the USER, using the CLI's device-code flow (az login --use-device-code, aws sso login, gcloud auth login --no-launch-browser). The CLI prints a URL + code that surfaces in the chat in real time; the user opens the URL in their browser, enters the code, and the CLI completes. Tokens live in the sandbox pod and are destroyed when the run ends — Orbit never stores cloud credentials. Use this when orbit_list_cloud_accounts is empty, or when the user wants to authenticate to a different account than the configured one. Returns {authenticated, provider, exit_code, stdout, stderr, duration_ms}.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"provider": map[string]any{
						"type":        "string",
						"enum":        []string{"azure", "gcp", "aws"},
						"description": "Cloud provider to authenticate against.",
					},
					"tenant": map[string]any{
						"type":        "string",
						"description": "Optional. Azure tenant id or domain. For other providers it's ignored.",
					},
				},
				"required": []string{"provider"},
			},
		},
		{
			Name:        ToolOrbitRepoClone,
			Description: "Clone a (private) GitHub repository connected to this workspace into the sandbox so you can read its files. Orbit mints a fresh short-lived GitHub App installation token from the workspace's connected installation — the token is never exposed to you or written to the cloned .git/config. You MUST supply EXACTLY ONE of app_id (preferred — Orbit resolves the repo URL from the Apps collection) OR repo_url (a full https://github.com/<owner>/<repo> URL when the repo isn't registered as an Orbit App). Optional revision selects a branch or tag (defaults to the repo's default branch). Returns {clone_path, owner, repo, branch, head_sha, installation_id, duration_ms}. The clone lives at clone_path relative to the sandbox's working dir and you can shell_exec into it (e.g. `cd <clone_path> && cat package.json`).",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"app_id": map[string]any{
						"type":        "string",
						"description": "Orbit app id (from orbit_list_apps). Preferred — Orbit resolves the repo URL from the Apps collection. Supply this OR repo_url, not both.",
					},
					"repo_url": map[string]any{
						"type":        "string",
						"description": "Fallback: a full https://github.com/<owner>/<repo> URL when the repo isn't registered as an Orbit App. Must be on github.com. Supply this OR app_id, not both.",
					},
					"revision": map[string]any{
						"type":        "string",
						"description": "Optional branch or tag to clone. Defaults to the repository's default branch.",
					},
				},
			},
		},
	}
}

// historyToProviderMessages converts the workflow's transcript into the
// provider-agnostic message list. It elides system turns (lifted to System)
// and translates tool turns into RoleTool messages.
func historyToProviderMessages(history []ConversationTurn) []providers.Message {
	out := make([]providers.Message, 0, len(history))
	for _, t := range history {
		switch t.Role {
		case "user":
			out = append(out, providers.Message{Role: providers.RoleUser, Content: t.Content})
		case "assistant":
			m := providers.Message{Role: providers.RoleAssistant, Content: t.Content}
			for _, tc := range t.ToolCalls {
				m.ToolCalls = append(m.ToolCalls, providers.ToolCall{
					ID: tc.ID, Name: tc.Name, Arguments: tc.Arguments,
				})
			}
			out = append(out, m)
		case "tool":
			out = append(out, providers.Message{
				Role:       providers.RoleTool,
				Content:    t.Content,
				ToolCallID: t.ToolCallID,
				Name:       t.ToolName,
			})
		}
	}
	return out
}

func effectiveSystemPrompt(input InfrastructureAgentInput) string {
	if strings.TrimSpace(input.SystemPrompt) != "" {
		return input.SystemPrompt
	}
	return defaultSystemPrompt
}

const defaultSystemPrompt = `You are Orbit's infrastructure agent. You help the user deploy applications to their cloud accounts.

You operate inside a deterministic Temporal workflow that exposes a small set of tools. You never execute commands directly; you emit tool-use requests and the workflow runs them inside a sandboxed environment with optional human approval. Tool results flow back into your next turn.

The user's first message begins with a [Workspace context] block listing the apps and cloud accounts available in this run's workspace. Trust that block as the authoritative starting state — don't ask the user for information it already contains.

Tools (Orbit context — workspace is fixed for this run):
- orbit_list_apps(): list every app in the workspace (id, name, description, status, repository)
- orbit_get_app(app_id): full details for one app (repository, health_config, build_config)
- orbit_list_cloud_accounts(): every cloud account connected to the workspace (no credentials returned)
- orbit_cloud_login(provider, tenant?): device-code login as the USER for azure | gcp | aws. The CLI prints a URL + code that streams into the chat; the user authenticates in their browser; tokens live in the sandbox pod and die with the run. Orbit never stores cloud credentials.

Tools (conversation + control):
- propose_to_user(title, summary, body_markdown): post a structured plan to the user and wait for their reply
- request_approval(title, kind, body_markdown): block on an explicit human approve/reject decision (use BEFORE every destructive command)
- register_tool(name, description, template_kind, template_json, input_schema_json?, reasoning?): teach the system a new named tool that compiles to vetted primitives; admin approval required once, then callable by name
- done(summary): end the run

Tools (sandbox execution):
- shell_exec(command, working_dir?): run a bash command in the sandbox (az / gcloud / kubectl / helm / terraform / pulumi / git etc.)
- http_request(method, url, headers?, body?): outbound HTTP gated by the workspace allowlist
- read_file(path) / write_file(path, content) / list_dir(path?): file IO inside the sandbox
- repo_inspect(repo_url, revision?, max_files?): survey a repo (tree + manifests) without a full clone when possible
- start_child_health_check(app_id, url, ...): configure the App's healthConfig so Orbit runs one durable HealthCheckWorkflow per app (visible on the App detail page)

Tools (platform-wide catalog — PREFER OVER SHELL when applicable):
- list_patterns(category?): list admin-approved deployment Patterns curated by the platform team. Patterns are durable recipes that anyone in any workspace can rely on. Browse this catalog EARLY in the run so you can pick a vetted approach instead of re-deriving from shell.
- instantiate_pattern(pattern_id, name, parameters, workspace_id?, app_id?): provision an approved Pattern into a workspace. The platform validates parameters against the pattern's schema, expands the template through the same engine as registered tools, runs each primitive with the agent's existing safety + approval plumbing, and writes the result as a PatternInstance row.
- propose_pattern(name, display_name, description, category, template_kind, template_json, input_schema_json, reasoning?): codify a successful deployment so the next person doesn't have to figure it out. Use this AFTER a shell-driven deployment succeeds. The platform admin reviews; once approved the pattern joins the catalog above.

Workflow:
1. Read the [Workspace context] block in the user's prompt; if the app the user is asking about is already listed, use orbit_get_app to pull the repository / health / build details rather than asking the user.
2. **First: call list_patterns to see whether the platform already has a vetted recipe for what the user wants.** If a pattern matches, propose_to_user with the pattern picked out, then on approval invoke it via instantiate_pattern — deterministic, audited, and faster than re-deriving from shell.
3. If no pattern matches, fall back to the long-tail path: use repo_inspect on the repository to learn what the app is, use shell_exec for further investigation, then propose_to_user with the plan embedded in body_markdown.
4. After the user approves, run the plan via shell_exec calls.
5. **After a successful novel deployment, call propose_pattern to productize it.** Every successful agent run should leave a draft pattern behind so the next person doesn't pay the same reasoning cost.
6. Call done with a final summary.

Cloud authentication — IMPORTANT:
- Orbit does NOT store cloud credentials. The sandbox starts with no AZURE_*, AWS_*, or GOOGLE_* env vars.
- Before any deployment command that needs cloud access, call orbit_cloud_login(provider) — the user authenticates as themselves via device code in their browser.
- Once authenticated, subsequent shell_exec calls to az / gcloud / aws use the user's tokens, which live in the sandbox pod (~/.azure, ~/.config/gcloud, ~/.aws) and disappear when the run ends.
- If the user asks about a cloud they haven't logged into yet, run orbit_cloud_login FIRST. Do not ask them for credentials directly. Do not invent service-principal flows.
- If orbit_list_cloud_accounts shows a row already configured for that provider, that row is informational (it's a saved bookmark, not a credential store) — you still need orbit_cloud_login to actually authenticate.

Style: be concise. Prefer structured proposals over wall-of-text. When the user's goal is unclear, ask. Tool results are JSON; treat them programmatically. After orbit_cloud_login succeeds, verify with a quick shell_exec (e.g. ` + "`" + `az account show` + "`" + `) before proceeding to anything destructive or billable.`

// --- state helpers ---

func initState(ctx workflow.Context, input InfrastructureAgentInput) agentState {
	state := agentState{
		status:           "starting",
		workspaceID:      input.WorkspaceID,
		history:          append([]ConversationTurn(nil), input.History...),
		events:           append([]AgentEvent(nil), input.Events...),
		nextSeq:          input.NextSequence,
		pendingApprovals:      map[string]PendingApproval{},
		pendingApprovalRowIDs: map[string]string{},
		toolOutputBuffers:     map[string]*toolOutputBuffer{},
		iterations:            input.IterationsSoFar,
	}
	if state.nextSeq == 0 {
		state.nextSeq = 1
	}
	emitEvent(ctx, &state, EventKindStatusUpdate, map[string]any{"status": "starting"})
	return state
}

func emitEvent(ctx workflow.Context, state *agentState, kind string, payload map[string]any) {
	now := workflow.Now(ctx)
	ev := AgentEvent{
		Sequence:  state.nextSeq,
		EmittedAt: now,
		Kind:      kind,
		Payload:   payload,
	}
	state.events = append(state.events, ev)
	// Buffer durable-kind events for the next persistence flush. Ephemeral
	// streaming kinds (token_delta, tool_call_output_chunk) are never
	// persisted — they're reconstructed live and would balloon Mongo.
	//
	// The persisted payload is the camelCase per-kind DTO the read path's
	// mapper consumes (the SAME mapper as the live SSE stream), NOT the
	// workflow's internal snake_case event payload. toDurableDTO does the
	// transform.
	if isDurableKind(kind) {
		state.unflushedDurable = append(state.unflushedDurable, AgentEventWire{
			Sequence:  ev.Sequence,
			Kind:      ev.Kind,
			Payload:   toDurableDTO(ev.Kind, ev.Payload),
			EmittedAt: now.UTC().Format(time.RFC3339Nano),
		})
	}
	state.nextSeq++
}

// toDurableDTO converts a workflow event's internal snake_case payload into
// the camelCase per-kind DTO the orbit-www read path maps (same shape the SSE
// DTO mapper emits). Only DTO-relevant keys are carried; internal-only fields
// (e.g. tool_calls, edited_fields) are dropped. Optional string fields are
// omitted when empty so they stay genuinely optional on the wire.
func toDurableDTO(kind string, p map[string]any) map[string]any {
	out := map[string]any{}
	put := func(dst, src string) {
		if v, ok := p[src]; ok {
			out[dst] = v
		}
	}
	// putNonEmpty only sets dst when the source is a non-empty string (used
	// for optional fields the route treats as absent when blank).
	putNonEmpty := func(dst, src string) {
		if v, ok := p[src].(string); ok && v != "" {
			out[dst] = v
		}
	}
	switch kind {
	case EventKindConversationTurn:
		put("turnId", "turn_id")
		put("role", "role")
		put("content", "content")
		putNonEmpty("toolName", "tool_name")
		putNonEmpty("toolCallId", "tool_call_id")
	case EventKindProposalUpdate:
		put("proposalId", "proposal_id")
		put("title", "title")
		put("summary", "summary")
		put("bodyMarkdown", "body_markdown")
	case EventKindApprovalRequest:
		put("approvalId", "approval_id")
		put("kind", "kind")
		put("title", "title")
		put("bodyMarkdown", "body_markdown")
		putNonEmpty("name", "name")
		putNonEmpty("displayName", "display_name")
		putNonEmpty("description", "description")
		putNonEmpty("category", "category")
		putNonEmpty("templateKind", "template_kind")
		putNonEmpty("templateJson", "template_json")
		putNonEmpty("inputSchemaJson", "input_schema_json")
		putNonEmpty("reasoning", "reasoning")
		putNonEmpty("agentToolId", "agent_tool_id")
		putNonEmpty("patternId", "pattern_id")
	case EventKindApprovalResolved:
		put("approvalId", "approval_id")
		put("approved", "approved")
		put("resolvedBy", "resolved_by")
		put("notes", "notes")
	case EventKindStatusUpdate:
		put("status", "status")
		put("message", "message")
	case EventKindToolCallOutput:
		put("callId", "call_id")
		put("stream", "stream")
		// Internal aggregate uses "output"; the DTO key is "text".
		put("text", "output")
	default:
		// Unknown durable kind: pass through unchanged rather than silently
		// dropping. isDurableKind gates this, so it shouldn't happen.
		return p
	}
	return out
}

// toolOutputCap bounds the aggregated tool_call_output payload at 64KB. On
// overflow we keep the tail (most-recent output, usually the relevant end of
// a command) and mark the aggregate truncated.
const toolOutputCap = 64 * 1024

// toolOutputBuffer accumulates one tool call's streamed output, capping at
// toolOutputCap bytes by dropping the oldest bytes (keep tail). stream
// records the last stream label seen ("stdout"/"stderr") for the DTO; most
// commands are stdout-dominant and the chat renders them in one pane.
type toolOutputBuffer struct {
	data      []byte
	stream    string
	truncated bool
}

func (b *toolOutputBuffer) append(chunk string) {
	b.data = append(b.data, chunk...)
	if len(b.data) > toolOutputCap {
		over := len(b.data) - toolOutputCap
		b.data = b.data[over:]
		b.truncated = true
	}
}

// recordToolOutput appends a streamed chunk to the per-call buffer. Called
// from the drain goroutine for every tool_call_output_chunk signal.
func recordToolOutput(state *agentState, callID, stream, chunk string) {
	if callID == "" || chunk == "" {
		return
	}
	buf := state.toolOutputBuffers[callID]
	if buf == nil {
		buf = &toolOutputBuffer{stream: "stdout"}
		state.toolOutputBuffers[callID] = buf
	}
	if stream != "" {
		buf.stream = stream
	}
	buf.append(chunk)
}

// flushToolOutput emits one aggregated, durable tool_call_output event for a
// completed tool call (if any output was streamed) and drops the buffer. The
// payload carries the (possibly truncated) combined output plus a truncated
// flag the UI/persistence layer can surface.
func flushToolOutput(ctx workflow.Context, state *agentState, callID string) {
	buf := state.toolOutputBuffers[callID]
	if buf == nil {
		return
	}
	delete(state.toolOutputBuffers, callID)
	if len(buf.data) == 0 {
		return
	}
	output := string(buf.data)
	if buf.truncated {
		// Signal truncation inline (the DTO carries no separate flag); the
		// kept tail is the most-recent, usually-relevant output.
		output = "…[output truncated — showing tail]\n" + output
	}
	emitEvent(ctx, state, EventKindToolCallOutput, map[string]any{
		"call_id": callID,
		"stream":  buf.stream,
		"output":  output,
	})
}

// isDurableKind reports whether an event kind is part of the persistent
// transcript (system-of-record replica in Mongo). Mirrors the plan's
// "Durable kinds only" list.
func isDurableKind(kind string) bool {
	switch kind {
	case EventKindConversationTurn,
		EventKindProposalUpdate,
		EventKindApprovalRequest,
		EventKindApprovalResolved,
		EventKindStatusUpdate,
		EventKindToolCallOutput:
		return true
	default:
		return false
	}
}

// flushDurableEvents persists the buffered durable events via the
// PersistAgentEvents activity. On success the buffer is cleared; on failure
// it is retained for the next flush attempt (idempotent upsert on
// (workflowId, sequence) makes retries safe). Activity failures never fail
// the run — they're logged and swallowed. Pass a disconnected ctx on
// terminal/abort paths so a cancelled loopCtx can't skip the final flush.
func flushDurableEvents(ctx workflow.Context, state *agentState) {
	if len(state.unflushedDurable) == 0 {
		return
	}
	// Snapshot the batch so concurrently-appended events (from drain
	// goroutines) aren't lost if this flush fails: we only clear exactly
	// what we attempted to send.
	batch := append([]AgentEventWire(nil), state.unflushedDurable...)
	flushCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 10 * time.Second,
		// One attempt per barrier: a failure keeps the buffer for the next
		// barrier rather than burning retry budget inline. The terminal
		// flush in the defer is the backstop.
		RetryPolicy: &temporal.RetryPolicy{MaximumAttempts: 1},
	})
	err := workflow.ExecuteActivity(flushCtx, agentcontract.ActivityPersistAgentEvents, agentactivity.PersistAgentEventsInput{
		WorkflowID:  workflow.GetInfo(ctx).WorkflowExecution.ID,
		WorkspaceID: state.workspaceID,
		Events:      batch,
	}).Get(flushCtx, nil)
	if err != nil {
		workflow.GetLogger(ctx).Warn("persist agent events failed (non-fatal); keeping buffer for next flush",
			"err", err, "buffered", len(state.unflushedDurable))
		return
	}
	// Drop exactly the flushed prefix; anything appended during the flush
	// survives for the next barrier.
	state.unflushedDurable = state.unflushedDurable[len(batch):]
}

func appendTurn(ctx workflow.Context, state *agentState, turn ConversationTurn) {
	state.history = append(state.history, turn)
	emitEvent(ctx, state, EventKindConversationTurn, map[string]any{
		"turn_id":      turn.TurnID,
		"role":         turn.Role,
		"content":      turn.Content,
		"tool_calls":   turn.ToolCalls,
		"tool_call_id": turn.ToolCallID,
		"tool_name":    turn.ToolName,
	})
}

func registerQueries(ctx workflow.Context, state *agentState) error {
	if err := workflow.SetQueryHandler(ctx, AgentQuerySnapshot, func() (AgentSnapshot, error) {
		return AgentSnapshot{
			Status:           state.status,
			Conversation:     append([]ConversationTurn(nil), state.history...),
			StreamingPartial: state.streamingPartial,
			StreamingTurnID:  state.streamingTurnID,
			Proposal:         cloneProposal(state.proposal),
			PendingApprovals: pendingList(state.pendingApprovals),
			LatestSequence:   lastSeq(state),
			Backend:          state.backend,
			Model:            state.model,
			ReviewerRounds:   state.reviewerRounds,
		}, nil
	}); err != nil {
		return err
	}
	if err := workflow.SetQueryHandler(ctx, AgentQueryEventsSince, func(since uint64) ([]AgentEvent, error) {
		out := make([]AgentEvent, 0)
		for _, e := range state.events {
			if e.Sequence > since {
				out = append(out, e)
			}
		}
		return out, nil
	}); err != nil {
		return err
	}
	if err := workflow.SetQueryHandler(ctx, AgentQueryHasFinished, func() (bool, error) {
		return state.terminated, nil
	}); err != nil {
		return err
	}
	return nil
}

func cloneProposal(p *Proposal) *Proposal {
	if p == nil {
		return nil
	}
	cp := *p
	return &cp
}

// pendingList returns the pending approvals sorted by ApprovalID for
// deterministic iteration. Map iteration would be non-deterministic and
// violate workflow rules.
func pendingList(m map[string]PendingApproval) []PendingApproval {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	out := make([]PendingApproval, 0, len(keys))
	for _, k := range keys {
		out = append(out, m[k])
	}
	return out
}

func lastSeq(state *agentState) uint64 {
	if len(state.events) == 0 {
		return 0
	}
	return state.events[len(state.events)-1].Sequence
}

func shouldContinueAsNew(state *agentState) bool {
	return len(state.history) > defaultMaxHistoryTurns
}

func continueAsNew(ctx workflow.Context, input InfrastructureAgentInput, state *agentState) error {
	// Compact: keep the last N turns and a summary of older context. For Spike
	// 1 we just keep the last 30 turns; later spikes may add a summarization
	// activity.
	keep := state.history
	if len(keep) > 30 {
		keep = keep[len(keep)-30:]
	}
	carry := InfrastructureAgentInput{
		AgentRunID:      input.AgentRunID,
		WorkspaceID:     input.WorkspaceID,
		RepositoryID:    input.RepositoryID,
		UserID:          input.UserID,
		LLMProviderID:   input.LLMProviderID,
		SystemPrompt:    input.SystemPrompt,
		History:         keep,
		Events:          nil,
		NextSequence:    state.nextSeq,
		IterationsSoFar: 0,
	}
	return workflow.NewContinueAsNewError(ctx, InfrastructureAgentWorkflow, carry)
}

// workflowUUID returns a deterministic UUID-shaped identifier from a SideEffect.
// (Crypto-grade randomness isn't needed here; we just want unique-per-event.)
func workflowUUID(ctx workflow.Context) string {
	var id string
	enc := workflow.SideEffect(ctx, func(workflow.Context) any {
		// SideEffect bypasses determinism enforcement, allowing time/random.
		// Use UnixNano + a counter-ish suffix.
		return fmt.Sprintf("%d-%d", time.Now().UnixNano(), nextSideEffectCounter())
	})
	if err := enc.Get(&id); err != nil {
		// SideEffect should never fail in practice; fall back to a stable id.
		return "fallback"
	}
	return id
}

// nextSideEffectCounter is monotonic per process. Workflow determinism is
// preserved because the value is captured inside SideEffect.
var sideEffectCounter int64

func nextSideEffectCounter() int64 {
	sideEffectCounter++
	return sideEffectCounter
}

// errInternal is returned by the workflow on logic errors that shouldn't be
// surfaced as activity failures.
var errInternal = errors.New("infrastructure agent: internal error")
