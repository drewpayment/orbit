package workflows

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"

	"github.com/drewpayment/orbit/temporal-workflows/internal/activities"
	"github.com/drewpayment/orbit/temporal-workflows/internal/scaffolder"
)

// approvalRequestAction is the special-cased step action. ScaffolderWorkflow's
// step loop branches on this name before generic dispatch: the registered
// actions.ApprovalRequest action exists only for its schema/descriptor (see
// its doc comment) and is never Execute'd or Plan'd.
const approvalRequestAction = "approval:request"

// ScaffolderApprovalSignal is the single channel every approval:request step
// in a run waits on, filtered by ApprovalID — one channel per workflow, not
// per step, mirroring how agentcontract.SignalApproval is one channel name
// reused across the agent's many possible gates (simpler than a dynamically
// named channel per step).
const ScaffolderApprovalSignal = "ScaffolderApprovalSignal"

// defaultApprovalTimeoutHours is used when a step's `timeoutHours` is absent
// or non-positive.
const defaultApprovalTimeoutHours = 24.0

// ScaffolderApprovalSignalInput is the payload ResolveScaffolderApproval
// sends. Field-compatible with the repository service's mirror
// (types.ScaffolderApprovalSignalInput) — Temporal's JSON data converter
// matches by field name, not by Go type identity.
type ScaffolderApprovalSignalInput struct {
	ApprovalID string `json:"approvalId"`
	Approved   bool   `json:"approved"`
	ApproverID string `json:"approverId"`
	Comment    string `json:"comment"`
}

// approvalRequestInput is `approval:request`'s resolved step input.
type approvalRequestInput struct {
	Message      string   `json:"message"`
	Approvers    []string `json:"approvers"`
	TimeoutHours float64  `json:"timeoutHours"`
}

func parseApprovalRequestInput(resolved json.RawMessage) (approvalRequestInput, error) {
	var in approvalRequestInput
	if len(strings.TrimSpace(string(resolved))) > 0 {
		if err := json.Unmarshal(resolved, &in); err != nil {
			return in, fmt.Errorf("approval:request: decode input: %w", err)
		}
	}
	if strings.TrimSpace(in.Message) == "" {
		return in, fmt.Errorf("approval:request: `message` is required")
	}
	if in.TimeoutHours <= 0 {
		in.TimeoutHours = defaultApprovalTimeoutHours
	}
	return in, nil
}

// approvalID is deterministic (RunID + StepID), not randomly generated: a
// workflow may not call anything non-deterministic outside
// workflow.SideEffect, and a plain deterministic id also lets
// ResolveScaffolderApproval's caller (which only ever sees the step id from
// the run record) address the exact step without a round trip through
// workflow state.
func approvalStepID(runID, stepID string) string {
	return runID + ":" + stepID
}

// planApprovalStep is the dry-run branch for `approval:request` (plan §3.4).
// A dry run must never block on a human: it records the step as unsupported
// (the same shape markUnplannable/the generic dry-run "unsupported" path
// produces) and returns without opening a pending-approvals row or touching
// the signal selector.
func (r *scaffolderRun) planApprovalStep(ctx workflow.Context, idx int, step scaffolder.Step) {
	r.steps[idx].Status = stepStatusSucceeded
	r.steps[idx].FinishedAt = workflowNow(ctx)
	r.plan = append(r.plan, scaffolder.PlannedChange{
		Kind:        "unsupported",
		Name:        step.ID,
		Description: "requires human approval — not evaluated in a dry run",
	})
	r.appendLog(ctx, "info", fmt.Sprintf("step %s (%s) requires human approval; not evaluated in a dry run", step.ID, step.Action))
}

// runApprovalStep is the workflow-level special case for `approval:request`
// (plan §3). It resolves the step's input, opens a pending-approvals row,
// then waits on ScaffolderApprovalSignal (filtered by approval id), the
// workflow's own cancellation, or a timer — whichever comes first — and
// resolves the row on every exit path.
//
// Returns (cancelled, failure) with the same contract as runStep: cancelled
// means the workflow was cancelled (the caller must call finishCancelled and
// must NOT also treat failure as a separate outcome); failure is a non-empty
// message when the run must stop; a rejected/timed-out step under
// continueOnError returns (false, "") so the run carries on.
func (r *scaffolderRun) runApprovalStep(ctx workflow.Context, bookkeepingCtx workflow.Context, step scaffolder.Step) (bool, string) {
	idx, ok := r.stepIndex[step.ID]
	if !ok {
		return false, fmt.Sprintf("step %q: no progress slot", step.ID)
	}

	if r.input.DryRun {
		r.planApprovalStep(ctx, idx, step)
		return false, ""
	}

	resolvedInput, err := scaffolder.ResolveJSON(r.exprCtx, step.Input)
	if err != nil {
		r.failStep(idx, err.Error())
		return false, fmt.Sprintf("step %q: %v", step.ID, err)
	}
	in, err := parseApprovalRequestInput(resolvedInput)
	if err != nil {
		r.failStep(idx, err.Error())
		return false, fmt.Sprintf("step %q: %v", step.ID, err)
	}

	approvalID := approvalStepID(r.input.RunID, step.ID)

	r.steps[idx].Status = stepStatusAwaitingApproval
	r.steps[idx].StartedAt = workflowNow(ctx)
	r.appendLog(ctx, "info", fmt.Sprintf("step %s (%s) awaiting approval: %s", step.ID, step.Action, in.Message))
	r.writeProgress(bookkeepingCtx, ScaffolderStatusAwaitingApproval, "", nil)

	var openResult activities.ScaffolderOpenApprovalResult
	openErr := workflow.ExecuteActivity(bookkeepingCtx, activities.ActivityScaffolderOpenApproval, activities.ScaffolderOpenApprovalInput{
		WorkspaceID: r.input.WorkspaceID,
		WorkflowID:  workflow.GetInfo(ctx).WorkflowExecution.ID,
		RunID:       r.input.RunID,
		ApprovalID:  approvalID,
		StepID:      step.ID,
		Message:     in.Message,
		Approvers:   in.Approvers,
	}).Get(bookkeepingCtx, &openResult)
	if openErr != nil {
		if temporal.IsCanceledError(openErr) {
			r.failStep(idx, "cancelled")
			r.appendLog(ctx, "warn", fmt.Sprintf("step %s (%s) cancelled", step.ID, step.Action))
			return true, ""
		}
		return r.failApprovalStep(ctx, idx, step, "failed to open approval gate: "+openErr.Error())
	}

	timeout := time.Duration(in.TimeoutHours * float64(time.Hour))
	approvalCh := workflow.GetSignalChannel(ctx, ScaffolderApprovalSignal)
	timerFuture := workflow.NewTimer(ctx, timeout)

	var (
		signal    ScaffolderApprovalSignalInput
		resolved  bool
		timedOut  bool
		cancelled bool
	)
	sel := workflow.NewSelector(ctx)
	sel.AddReceive(approvalCh, func(c workflow.ReceiveChannel, _ bool) {
		var candidate ScaffolderApprovalSignalInput
		c.Receive(ctx, &candidate)
		if candidate.ApprovalID != approvalID {
			// A signal for a different (already-resolved or not-yet-reached)
			// approval:request step in this run. Ignore it and keep waiting —
			// the loop below calls Select again.
			return
		}
		signal = candidate
		resolved = true
	})
	sel.AddReceive(ctx.Done(), func(workflow.ReceiveChannel, bool) { cancelled = true })
	sel.AddFuture(timerFuture, func(workflow.Future) { timedOut = true })

	for !resolved && !timedOut && !cancelled {
		sel.Select(ctx)
	}

	if cancelled {
		r.resolveApprovalRowDisconnected(ctx, openResult.ID, "rejected", "workflow cancelled")
		r.failStep(idx, "cancelled")
		r.appendLog(ctx, "warn", fmt.Sprintf("step %s (%s) cancelled while awaiting approval", step.ID, step.Action))
		return true, ""
	}

	if timedOut {
		r.resolveApproval(bookkeepingCtx, openResult.ID, "rejected", "", fmt.Sprintf("timed out after %.0fh", in.TimeoutHours))
		msg := fmt.Sprintf("approval timed out after %.0fh", in.TimeoutHours)
		return r.failApprovalStep(ctx, idx, step, msg)
	}

	if !signal.Approved {
		note := signal.Comment
		r.resolveApproval(bookkeepingCtx, openResult.ID, "rejected", signal.ApproverID, note)
		msg := "rejected by " + signal.ApproverID
		if note != "" {
			msg += ": " + note
		}
		return r.failApprovalStep(ctx, idx, step, msg)
	}

	r.resolveApproval(bookkeepingCtx, openResult.ID, "approved", signal.ApproverID, signal.Comment)

	out := map[string]any{
		"approved":   true,
		"approverId": signal.ApproverID,
		"comment":    signal.Comment,
	}
	r.steps[idx].Status = stepStatusSucceeded
	r.steps[idx].FinishedAt = workflowNow(ctx)
	r.steps[idx].Output = out
	r.exprCtx.Steps[step.ID] = scaffolder.StepOutput{Output: out}
	r.appendLog(ctx, "info", fmt.Sprintf("step %s (%s) approved by %s", step.ID, step.Action, signal.ApproverID))
	return false, ""
}

// failApprovalStep records the step failure and decides the run's fate,
// honouring continueOnError exactly as the generic step path does.
func (r *scaffolderRun) failApprovalStep(ctx workflow.Context, idx int, step scaffolder.Step, msg string) (bool, string) {
	r.failStep(idx, msg)
	if step.ContinueOnError {
		r.logger.Warn("Scaffolder approval step failed but continueOnError is set",
			"stepId", step.ID, "action", step.Action, "error", msg)
		r.appendLog(ctx, "warn", fmt.Sprintf("step %s (%s) failed, continuing: %s", step.ID, step.Action, msg))
		return false, ""
	}
	r.appendLog(ctx, "error", fmt.Sprintf("step %s (%s) failed: %s", step.ID, step.Action, msg))
	return false, fmt.Sprintf("step %q (%s) failed: %s", step.ID, step.Action, msg)
}

// resolveApproval flips the pending-approvals row on ctx (still live: called
// from the non-cancellation exit paths).
func (r *scaffolderRun) resolveApproval(ctx workflow.Context, rowID, resolution, resolvedBy, notes string) {
	if err := workflow.ExecuteActivity(ctx, activities.ActivityScaffolderResolveApproval, activities.ScaffolderResolveApprovalInput{
		ID:          rowID,
		WorkspaceID: r.input.WorkspaceID,
		Resolution:  resolution,
		ResolvedBy:  resolvedBy,
		Notes:       notes,
	}).Get(ctx, nil); err != nil {
		r.logger.Warn("Failed to resolve scaffolder approval row", "rowId", rowID, "error", err)
	}
}

// resolveApprovalRowDisconnected flips the row on cancellation, when the
// workflow's own context is already cancelled and a call scheduled on it
// would never run.
func (r *scaffolderRun) resolveApprovalRowDisconnected(ctx workflow.Context, rowID, resolution, notes string) {
	resolveCtx, cancel := workflow.NewDisconnectedContext(ctx)
	defer cancel()
	resolveCtx = workflow.WithActivityOptions(resolveCtx, workflow.ActivityOptions{
		StartToCloseTimeout: cancelNoticeTimeout,
		RetryPolicy:         &temporal.RetryPolicy{MaximumAttempts: 1},
	})
	r.resolveApproval(resolveCtx, rowID, resolution, "", notes)
}
