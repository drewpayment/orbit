package workflows

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"go.temporal.io/sdk/log"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"

	"github.com/drewpayment/orbit/temporal-workflows/internal/activities"
	"github.com/drewpayment/orbit/temporal-workflows/internal/scaffolder"
)

// scaffolderSweepTrigger is the ScaffolderWorkflowInput.Trigger value
// TemplateDryRunSweepWorkflow's TriggerTemplateDryRun activity sets (Phase 4
// Task G). finish() only records lastDryRunStatus/lastDryRunPlanHash when
// DryRun is true AND Trigger equals this exact value — a person's "Preview"
// click leaves Trigger empty and must never touch those fields.
const scaffolderSweepTrigger = "scheduled-sweep"

// Run statuses, re-exported from the engine package so this file reads
// naturally. scaffolder owns them because the dispatch activities are checked
// against the same list, and they cannot import this package.
const (
	ScaffolderStatusSucceeded        = scaffolder.RunStatusSucceeded
	ScaffolderStatusFailed           = scaffolder.RunStatusFailed
	ScaffolderStatusCancelled        = scaffolder.RunStatusCancelled
	ScaffolderStatusRunning          = scaffolder.RunStatusRunning
	ScaffolderStatusAwaitingApproval = scaffolder.RunStatusAwaitingApproval
)

// Per-step progress statuses.
const (
	stepStatusPending          = scaffolder.StepStatusPending
	stepStatusRunning          = scaffolder.StepStatusRunning
	stepStatusSucceeded        = scaffolder.StepStatusSucceeded
	stepStatusFailed           = scaffolder.StepStatusFailed
	stepStatusSkipped          = scaffolder.StepStatusSkipped
	stepStatusAwaitingApproval = scaffolder.StepStatusAwaitingApproval
)

// ScaffolderProgressQuery is the query name GetRunProgress uses.
const ScaffolderProgressQuery = "progress"

// defaultStepTimeout applies to a step that declares no `timeout`.
const defaultStepTimeout = 10 * time.Minute

// stepHeartbeatTimeout bounds how long a long-running action may go without a
// heartbeat before the attempt is considered lost. Actions call
// rc.Heartbeat during clones, renders and pushes.
const stepHeartbeatTimeout = 2 * time.Minute

// bookkeepingTimeout bounds the activities that are not template steps:
// validation, the run-status writeback and work dir cleanup. None of them
// heartbeat, so they deliberately run without a heartbeat timeout.
const bookkeepingTimeout = 5 * time.Minute

// cancelNoticeTimeout bounds the "cancel requested" writeback. It is one
// attempt on a short budget: the run is being torn down, and cleanup must not
// wait on a status write nobody is depending on.
const cancelNoticeTimeout = 30 * time.Second

// maxStepAttempts bounds retries for a step whose action failed for a reason
// that might be transient. Definition and expression errors never reach a
// retry: they are raised as non-retryable application errors, or handled in
// workflow code before an activity is scheduled.
const maxStepAttempts = 3

// ScaffolderWorkflowInput is everything the v2 engine needs to run one
// template. The Definition is resolved by the caller (the repository service
// reads the stored version) so workflow code never makes a Payload call and
// the exact document that ran is recorded in workflow history.
type ScaffolderWorkflowInput struct {
	RunID               string                `json:"runId"`
	DefinitionVersionID string                `json:"definitionVersionId"`
	DefinitionID        string                `json:"definitionId"`
	Definition          scaffolder.Definition `json:"definition"`
	Parameters          map[string]any        `json:"parameters"`
	WorkspaceID         string                `json:"workspaceId"`
	// WorkspaceSlug, WorkspaceName, UserEmail and UserName come from the run
	// record rather than the request, and populate the `${{ workspace.* }}`
	// and `${{ user.* }}` namespaces the engine's validator advertises.
	WorkspaceSlug string `json:"workspaceSlug,omitempty"`
	WorkspaceName string `json:"workspaceName,omitempty"`
	UserID        string `json:"userId"`
	UserEmail     string `json:"userEmail,omitempty"`
	UserName      string `json:"userName,omitempty"`
	DryRun        bool   `json:"dryRun"`
	// TemplateStack is the list of definitionVersionIds already in progress
	// via `fetch:template` composition, outer-first. Empty for a top-level
	// run. A nested run's input carries its parent's stack plus the
	// version id it is about to run, which is how ScaffolderWorkflow
	// detects a composition cycle (Phase 4 Task D, plan §6) before
	// starting a child that would recurse forever.
	TemplateStack []string `json:"templateStack,omitempty"`
	// Trigger distinguishes what started this run: empty/"manual" for a
	// person's "Preview"/"Run" click, "scheduled-sweep" for
	// TemplateDryRunSweepWorkflow's automated re-dry-run (Phase 4 Task G).
	// finish() only records the sweep's drift fields when DryRun &&
	// Trigger == scaffolderSweepTrigger — see recordSweepResult.
	Trigger string `json:"trigger,omitempty"`
	// RootRunID/RootDefinitionID identify the OUTERMOST run and template
	// definition of a (possibly `fetch:template`-nested) execution — the
	// only run that has a Payload action-runs document and a
	// /self-service/templates/<id>/run/<runId> page. Empty for a top-level
	// run: scaffolderRun.rootRunID/rootDefinitionID treat empty as "this
	// input already IS the root" and fall back to RunID/DefinitionID, so
	// existing callers (StartScaffolderRun, tests) that never set these two
	// fields are unaffected. runFetchTemplateStep copies its own resolved
	// root forward into every nested child's input unchanged, so an
	// arbitrarily deep composition chain still points back at the same
	// top-level run no matter how many `fetch:template` levels an
	// `approval:request` step ends up nested at.
	RootRunID        string `json:"rootRunId,omitempty"`
	RootDefinitionID string `json:"rootDefinitionId,omitempty"`
}

// ScaffolderWorkflowResult is the run outcome.
type ScaffolderWorkflowResult struct {
	Status  string                     `json:"status"` // succeeded | failed | cancelled
	Outputs map[string]any             `json:"outputs,omitempty"`
	Plan    []scaffolder.PlannedChange `json:"plan,omitempty"`
	Error   string                     `json:"error,omitempty"`
	// Steps is the run's final per-step progress. It exists so a parent
	// ScaffolderWorkflow composing this run via `fetch:template` (Phase 4
	// Task D, plan §6) can flatten these into its own steps[] as
	// `<outerStepId>.<nestedStepId>` once the nested run completes — see
	// scaffolder_fetch_template.go. A top-level run's own live progress
	// comes from the "progress" query and the persisted run record, not
	// this field.
	Steps []activities.ScaffolderStepProgress `json:"steps,omitempty"`
}

// ScaffolderProgress is the "progress" query payload.
//
// The plan calls for the query to return []StepProgress; it returns this
// wrapper instead because GetRunProgress also has to report the run's status,
// resolved outputs and error, and a second query handler for those would be
// able to disagree with this one.
type ScaffolderProgress struct {
	Status  string                              `json:"status"`
	Steps   []activities.ScaffolderStepProgress `json:"steps"`
	Outputs map[string]any                      `json:"outputs,omitempty"`
	Plan    []scaffolder.PlannedChange          `json:"plan,omitempty"`
	Error   string                              `json:"errorMessage,omitempty"`
}

// scaffolderRun is the workflow's mutable state.
type scaffolderRun struct {
	input    ScaffolderWorkflowInput
	logger   log.Logger
	exprCtx  scaffolder.Ctx
	steps    []activities.ScaffolderStepProgress
	plan     []scaffolder.PlannedChange
	outputs  map[string]any
	status   string
	errorMsg string
	// stepIndex maps a step id to its slot in steps.
	stepIndex map[string]int
	// pendingLogs accumulates lifecycle lines between progress writebacks.
	pendingLogs []activities.ScaffolderLogEntry
}

// ScaffolderWorkflow runs a v2 template definition: one activity per step,
// expressions resolved between steps, per-step progress written back to the
// run record, and the whole thing cancellable.
//
// It returns a nil error for every terminal state, including failure and
// cancellation. The run's outcome lives in the result and in the run record;
// completing normally keeps the "progress" query serving the terminal snapshot
// to GetRunProgress instead of only an error.
func ScaffolderWorkflow(ctx workflow.Context, input ScaffolderWorkflowInput) (*ScaffolderWorkflowResult, error) {
	logger := workflow.GetLogger(ctx)
	info := workflow.GetInfo(ctx)

	run := newScaffolderRun(input, logger)

	// Bookkeeping activities (validate, progress writeback, cleanup) do not
	// heartbeat, so they get their own options: a heartbeat timeout here would
	// fail them for not doing something they never do.
	bookkeepingCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: bookkeepingTimeout,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts:        maxStepAttempts,
			NonRetryableErrorTypes: []string{activities.ErrTypeScaffolderInvalid},
		},
	})

	// Register the query handler first: it is pure workflow-local setup, and
	// doing it before the first activity means a progress query issued while
	// the claiming write is still in flight is answered instead of rejected.
	if err := workflow.SetQueryHandler(ctx, ScaffolderProgressQuery, func() (ScaffolderProgress, error) {
		return run.progress(), nil
	}); err != nil {
		logger.Error("Failed to register the scaffolder progress query", "error", err)
		return run.finish(ctx, bookkeepingCtx, ScaffolderStatusFailed,
			"failed to set up progress tracking: "+err.Error())
	}

	// Claim the run before any work happens: this records the workflow id so
	// the UI can cancel, and flips the run to running with every step pending.
	// It stays ahead of validation so a rejected definition still leaves a run
	// that can be found and explained.
	run.writeProgress(bookkeepingCtx, ScaffolderStatusRunning, info.WorkflowExecution.ID, nil)

	// Step activities heartbeat (clone, render, push), so they carry a
	// heartbeat timeout. WaitForCancellation makes a cancelled step's future
	// settle only once the action has actually stopped, which is what lets
	// cleanup safely delete the work dir it was writing into.
	stepBaseCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: defaultStepTimeout,
		HeartbeatTimeout:    stepHeartbeatTimeout,
		WaitForCancellation: true,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts:        maxStepAttempts,
			NonRetryableErrorTypes: []string{activities.ErrTypeScaffolderInvalid},
		},
	})

	// Static validation runs in an activity (see ValidateDefinition's doc for
	// why) and its findings fail the run without a retry.
	var validation *activities.ValidateDefinitionResult
	err := workflow.ExecuteActivity(bookkeepingCtx, activities.ActivityScaffolderValidateDefinition,
		activities.ValidateDefinitionInput{Definition: input.Definition}).Get(bookkeepingCtx, &validation)
	switch {
	case err != nil && temporal.IsCanceledError(err):
		return run.finishCancelled(ctx)
	case err != nil:
		return run.finish(ctx, bookkeepingCtx, ScaffolderStatusFailed, "definition validation failed: "+err.Error())
	case validation != nil && len(validation.Errors) > 0:
		return run.finish(ctx, bookkeepingCtx, ScaffolderStatusFailed,
			"definition is not executable: "+strings.Join(validation.Errors, "; "))
	}

	for i := range input.Definition.Spec.Steps {
		step := input.Definition.Spec.Steps[i]

		var cancelled bool
		var failure string
		switch step.Action {
		case approvalRequestAction:
			// approval:request pauses the WORKFLOW on a human signal, which
			// requires workflow-context APIs (GetSignalChannel, NewSelector)
			// a Temporal activity cannot call — so it is intercepted here,
			// before the generic runStep dispatch path. See
			// scaffolder_approval.go.
			cancelled, failure = run.runApprovalStep(ctx, bookkeepingCtx, step)
		case agentRunAction:
			// agent:run starts and awaits a child workflow, which requires
			// ExecuteChildWorkflow — workflow-context-only, like the
			// approval gate above. See scaffolder_agent_run.go.
			cancelled, failure = run.runAgentRunStep(ctx, bookkeepingCtx, step)
		case fetchTemplateAction:
			// fetch:template recursively runs another ScaffolderWorkflow as
			// a child. Same workflow-context requirement as agent:run. See
			// scaffolder_fetch_template.go.
			cancelled, failure = run.runFetchTemplateStep(ctx, bookkeepingCtx, step)
		default:
			cancelled, failure = run.runStep(ctx, stepBaseCtx, step)
		}
		switch {
		case cancelled:
			return run.finishCancelled(ctx)
		case failure != "":
			return run.finish(ctx, bookkeepingCtx, ScaffolderStatusFailed, failure)
		}
		run.writeProgress(bookkeepingCtx, ScaffolderStatusRunning, "", nil)
	}

	outputs, err := resolveDefinitionOutput(run.exprCtx, input.Definition.Spec.Output)
	outputSkippable, outputErr := run.dryRunSkippable(err, func(c scaffolder.Ctx) error {
		_, e := resolveDefinitionOutput(c, input.Definition.Spec.Output)
		return e
	})
	switch {
	case outputSkippable:
		// spec.output almost always reads a step's output, and a dry run
		// produces none. Report it the same way an unpreviewable step is
		// reported rather than failing an otherwise complete preview.
		run.plan = append(run.plan, scaffolder.PlannedChange{
			Kind:        "unsupported",
			Name:        "output",
			Description: "the run output cannot be previewed: it depends on a step's output",
		})
		run.appendLog(ctx, "warn", "run output cannot be previewed: it depends on a step's output")
		run.logger.Info("Scaffolder run output not previewable in a dry run", "reason", err)
		// Non-nil but empty, so the writeback clears any outputs a previous
		// run of this record left behind instead of leaving them to look
		// like this run's result.
		run.outputs = map[string]any{}
	case outputErr != nil:
		return run.finish(ctx, bookkeepingCtx, ScaffolderStatusFailed, "failed to resolve output: "+outputErr.Error())
	default:
		run.outputs = outputs
	}

	return run.finish(ctx, bookkeepingCtx, ScaffolderStatusSucceeded, "")
}

// newScaffolderRun seeds the expression context and the per-step progress
// slice. Every namespace is a plain map, so an expression can never reach into
// Go state (see scaffolder.Ctx).
func newScaffolderRun(input ScaffolderWorkflowInput, logger log.Logger) *scaffolderRun {
	params := input.Parameters
	if params == nil {
		params = map[string]any{}
	}

	run := &scaffolderRun{
		input:  input,
		logger: logger,
		status: ScaffolderStatusRunning,
		exprCtx: scaffolder.Ctx{
			Parameters: params,
			Steps:      map[string]scaffolder.StepOutput{},
			// The keys the engine's validator advertises for these
			// namespaces, seeded from the run record via the dispatcher.
			//
			// A field the record could not supply is OMITTED, not seeded as an
			// empty string. A template that reads it then fails with an
			// unresolved-path error instead of silently rendering nothing into
			// a real repository — an empty owner or contact address is the
			// kind of defect nobody notices until it matters. Authors who want
			// it optional write `${{ user.email | default("") }}`.
			User:      optionalKeys("id", input.UserID, "email", input.UserEmail, "name", input.UserName),
			Workspace: optionalKeys("id", input.WorkspaceID, "slug", input.WorkspaceSlug, "name", input.WorkspaceName),
			Template: map[string]any{
				"id":          input.DefinitionID,
				"name":        input.Definition.Metadata.Name,
				"title":       input.Definition.Metadata.Title,
				"owner":       input.Definition.Metadata.Owner,
				"targetKind":  input.Definition.Metadata.TargetKind,
				"versionId":   input.DefinitionVersionID,
				"workspaceId": input.WorkspaceID,
			},
			RunID: input.RunID,
		},
		stepIndex: map[string]int{},
	}

	for i, step := range input.Definition.Spec.Steps {
		run.steps = append(run.steps, activities.ScaffolderStepProgress{
			ID:     step.ID,
			Name:   step.Name,
			Status: stepStatusPending,
		})
		run.stepIndex[step.ID] = i
	}
	return run
}

// rootRunID returns the id of the Payload action-runs document this
// execution ultimately belongs to: its own RunID for a top-level run, or the
// ancestor chain's already-resolved RootRunID for a `fetch:template`-nested
// run, which has no action-runs document of its own (see
// runFetchTemplateStep's doc comment) — its synthetic RunID exists only for
// its work directory and expression context, never for anything a human
// links to.
func (r *scaffolderRun) rootRunID() string {
	if r.input.RootRunID != "" {
		return r.input.RootRunID
	}
	return r.input.RunID
}

// rootDefinitionID is rootRunID's template-definition counterpart — the
// definition whose /self-service/templates/<id>/run/<runId> page actually
// renders this run, as opposed to whatever nested definition a
// `fetch:template` step is currently composing in.
func (r *scaffolderRun) rootDefinitionID() string {
	if r.input.RootDefinitionID != "" {
		return r.input.RootDefinitionID
	}
	return r.input.DefinitionID
}

// runStep evaluates a step's condition, resolves its input and dispatches it.
//
// It returns (cancelled, failure): cancelled is true when the workflow was
// cancelled; failure is a non-empty message when the run must stop. A step that
// failed under continueOnError returns ("", false) so the run carries on.
func (r *scaffolderRun) runStep(ctx workflow.Context, stepBaseCtx workflow.Context, step scaffolder.Step) (bool, string) {
	idx, ok := r.stepIndex[step.ID]
	if !ok {
		return false, fmt.Sprintf("step %q: no progress slot", step.ID)
	}

	if step.If != "" {
		want, err := scaffolder.EvalBool(r.exprCtx, step.If)
		if err != nil {
			// Recheck the condition AND the input together. Skipping here
			// returns before the input is ever resolved, so checking only the
			// condition would let a genuine bad reference in the input reach
			// a "succeeded" dry run through the `if` door.
			skippable, realErr := r.dryRunSkippable(err, func(c scaffolder.Ctx) error {
				if _, e := scaffolder.EvalBool(c, step.If); e != nil {
					return e
				}
				_, e := scaffolder.ResolveJSON(c, step.Input)
				return e
			})
			if skippable {
				r.markUnplannable(ctx, idx, step, err)
				return false, ""
			}
			r.failStep(idx, realErr.Error())
			return false, fmt.Sprintf("step %q: %v", step.ID, realErr)
		}
		if !want {
			r.steps[idx].Status = stepStatusSkipped
			r.steps[idx].FinishedAt = workflowNow(ctx)
			r.logger.Info("Scaffolder step skipped", "stepId", step.ID, "if", step.If)
			r.appendLog(ctx, "info", fmt.Sprintf("step %s (%s) skipped: condition is false", step.ID, step.Action))
			if r.input.DryRun {
				// Record it, so a reader can see the plan accounts for every
				// step. Silently omitting it makes the preview look complete
				// when a step was simply not represented.
				r.plan = append(r.plan, scaffolder.PlannedChange{
					Kind:        "skipped",
					Name:        step.ID,
					Description: fmt.Sprintf("%s will not run: its condition is false", step.Action),
				})
			}
			return false, ""
		}
	}

	timeout, err := parseStepTimeout(step.Timeout, defaultStepTimeout)
	if err != nil {
		r.failStep(idx, err.Error())
		return false, fmt.Sprintf("step %q: %v", step.ID, err)
	}

	resolvedInput, err := scaffolder.ResolveJSON(r.exprCtx, step.Input)
	if err != nil {
		// During a dry run no step produces output, so a reference to a prior
		// step's output cannot resolve. That is a limit of previewing, not a
		// broken definition: record the step as unplannable and keep going,
		// the same way an action that cannot Plan is recorded.
		skippable, realErr := r.dryRunSkippable(err, func(c scaffolder.Ctx) error {
			_, e := scaffolder.ResolveJSON(c, step.Input)
			return e
		})
		if skippable {
			r.markUnplannable(ctx, idx, step, err)
			return false, ""
		}
		r.failStep(idx, realErr.Error())
		return false, fmt.Sprintf("step %q: %v", step.ID, realErr)
	}

	r.steps[idx].Status = stepStatusRunning
	r.steps[idx].StartedAt = workflowNow(ctx)
	r.appendLog(ctx, "info", fmt.Sprintf("step %s (%s) started", step.ID, step.Action))

	stepCtx := workflow.WithStartToCloseTimeout(stepBaseCtx, timeout)
	activityName := activities.ActivityScaffolderExecuteStep
	if r.input.DryRun {
		activityName = activities.ActivityScaffolderPlanStep
	}

	future := workflow.ExecuteActivity(stepCtx, activityName, activities.ScaffolderStepInput{
		RunID:             r.input.RunID,
		WorkspaceID:       r.input.WorkspaceID,
		TemplateVersionID: r.input.DefinitionVersionID,
		UserID:            r.input.UserID,
		DryRun:            r.input.DryRun,
		StepID:            step.ID,
		StepName:          step.Name,
		Action:            step.Action,
		Input:             resolvedInput,
	})

	// Select over the activity and the workflow's own cancellation, so a
	// cancel is observed as soon as it arrives rather than only once the
	// activity acknowledges it.
	var (
		execResult  activities.ScaffolderStepResult
		planResult  activities.ScaffolderPlanResult
		activityErr error
		cancelled   bool
	)
	sel := workflow.NewSelector(ctx)
	sel.AddFuture(future, func(f workflow.Future) {
		if r.input.DryRun {
			activityErr = f.Get(stepCtx, &planResult)
			return
		}
		activityErr = f.Get(stepCtx, &execResult)
	})
	sel.AddReceive(ctx.Done(), func(workflow.ReceiveChannel, bool) { cancelled = true })
	sel.Select(ctx)

	if cancelled {
		// The activity is still running: ctx.Done() only means the cancel was
		// *requested*. Wait for the step to actually stop before returning,
		// or cleanup would delete the work dir out from under a live clone or
		// render, leaving a half-written tree nothing ever removes. The wait
		// uses a disconnected context (the workflow's own is cancelled, so a
		// Get on it would return immediately) and is bounded by the step's own
		// start-to-close timeout. WaitForCancellation on the activity options
		// is what makes the future settle only once the action has returned.
		// Tell the run record a cancel is in flight before the wait, so the UI
		// does not sit on a stale "running" for however long the step takes to
		// stop. `action-runs.status` has no `cancelling` member, so this is a
		// log line on the still-running status rather than a new state.
		waitCtx, cancelWait := workflow.NewDisconnectedContext(ctx)
		defer cancelWait()

		// This notice is a UI nicety, not a durability requirement, and it
		// runs BEFORE the wait — so it gets a deliberately tight budget. On
		// the bookkeeping budget (5m x 3 attempts) an unreachable orbit-www
		// would postpone the work dir cleanup by a quarter of an hour.
		notifyCtx := workflow.WithActivityOptions(waitCtx, workflow.ActivityOptions{
			StartToCloseTimeout: cancelNoticeTimeout,
			RetryPolicy:         &temporal.RetryPolicy{MaximumAttempts: 1},
		})
		r.appendLog(ctx, "warn", fmt.Sprintf("cancel requested; waiting for step %s (%s) to stop", step.ID, step.Action))
		r.writeProgress(notifyCtx, ScaffolderStatusRunning, "", nil)

		_ = future.Get(waitCtx, nil)

		r.failStep(idx, "cancelled")
		r.appendLog(ctx, "warn", fmt.Sprintf("step %s (%s) cancelled", step.ID, step.Action))
		return true, ""
	}
	if activityErr != nil {
		if temporal.IsCanceledError(activityErr) {
			r.failStep(idx, "cancelled")
			r.appendLog(ctx, "warn", fmt.Sprintf("step %s (%s) cancelled", step.ID, step.Action))
			return true, ""
		}
		r.failStep(idx, activityErr.Error())
		if step.ContinueOnError {
			r.logger.Warn("Scaffolder step failed but continueOnError is set",
				"stepId", step.ID, "action", step.Action, "error", activityErr)
			r.appendLog(ctx, "warn", fmt.Sprintf("step %s (%s) failed, continuing: %v", step.ID, step.Action, activityErr))
			if r.input.DryRun {
				// The step could not be planned and the run carried on, so
				// the plan is incomplete. Say so rather than leaving a gap
				// that reads as "this step changes nothing".
				r.plan = append(r.plan, scaffolder.PlannedChange{
					Kind: "unsupported",
					Name: step.ID,
					// The activity error can quote the input the action
					// choked on — a clone URL carrying an installation
					// token, say — and this description reaches the plan,
					// the progress query and workflow history. Scrub it
					// here, not only on the persistence path.
					Description: scaffolder.RedactText(
						fmt.Sprintf("%s could not be previewed: %v", step.Action, activityErr)),
				})
			}
			return false, ""
		}
		r.appendLog(ctx, "error", fmt.Sprintf("step %s (%s) failed: %v", step.ID, step.Action, activityErr))
		return false, fmt.Sprintf("step %q (%s) failed: %v", step.ID, step.Action, activityErr)
	}

	r.steps[idx].Status = stepStatusSucceeded
	r.steps[idx].FinishedAt = workflowNow(ctx)
	r.appendLog(ctx, "info", fmt.Sprintf("step %s (%s) succeeded", step.ID, step.Action))

	if r.input.DryRun {
		if planResult.Unsupported {
			r.plan = append(r.plan, scaffolder.PlannedChange{
				Kind:        "unsupported",
				Name:        step.ID,
				Description: fmt.Sprintf("%s cannot be previewed", step.Action),
			})
		}
		// Action-provided entries are scrubbed on the way in, not only on the
		// way out to the run record: r.plan is also what the progress query
		// serves and what the workflow result carries.
		for _, change := range planResult.Changes {
			change.Name = scaffolder.RedactText(change.Name)
			change.Description = scaffolder.RedactText(change.Description)
			r.plan = append(r.plan, change)
		}
		// A planned step produces no output, so nothing enters the expression
		// context: a dry run must not let a later step read a value that will
		// not exist in the real run.
		return false, ""
	}

	out := execResult.Output
	if out == nil {
		out = map[string]any{}
	}
	r.steps[idx].Output = out
	r.exprCtx.Steps[step.ID] = scaffolder.StepOutput{Output: out}
	return false, ""
}

// dryRunSkippable decides whether a resolution failure is only a consequence
// of dry-running, and returns the error the run should fail with otherwise.
//
// A dry run produces no step output, so `${{ steps.x.output.y }}` never
// resolves. That alone is not enough to skip: resolution stops at the FIRST
// bad reference, so an expression reading both a prior step's output and a
// misspelled parameter would look step-dependent while actually being broken.
// So when the failing reference is in the `steps` namespace, the expression is
// re-resolved with step outputs assumed present; only if THAT succeeds is the
// step genuinely unpreviewable.
//
// A structural error (unknown namespace, malformed steps reference) is not an
// UnresolvedPathError and always fails the run, dry or not.
func (r *scaffolderRun) dryRunSkippable(err error, recheck func(scaffolder.Ctx) error) (bool, error) {
	if !r.input.DryRun || err == nil {
		return false, err
	}
	var unresolved *scaffolder.UnresolvedPathError
	if !errors.As(err, &unresolved) || unresolved.Namespace() != "steps" {
		return false, err
	}

	assumed := r.exprCtx
	assumed.AssumeStepOutputs = true
	if realErr := recheck(assumed); realErr != nil {
		// Something other than the step reference is broken. Report that,
		// not the step reference that happened to fail first.
		return false, realErr
	}
	return true, nil
}

// markUnplannable records a step the dry run could not preview.
func (r *scaffolderRun) markUnplannable(ctx workflow.Context, idx int, step scaffolder.Step, cause error) {
	r.steps[idx].Status = stepStatusSkipped
	r.steps[idx].FinishedAt = workflowNow(ctx)
	r.steps[idx].Error = cause.Error()
	r.plan = append(r.plan, scaffolder.PlannedChange{
		Kind:        "unsupported",
		Name:        step.ID,
		Description: fmt.Sprintf("%s cannot be previewed: it depends on an earlier step's output", step.Action),
	})
	r.appendLog(ctx, "warn", fmt.Sprintf("step %s (%s) cannot be previewed: it depends on an earlier step's output", step.ID, step.Action))
	r.logger.Info("Scaffolder step not previewable in a dry run",
		"stepId", step.ID, "action", step.Action, "reason", cause)
}

// appendLog queues one line for the next progress writeback. Only step
// lifecycle transitions are logged — never a resolved step input, which can
// carry an installation token or another credential.
func (r *scaffolderRun) appendLog(ctx workflow.Context, level, message string) {
	r.pendingLogs = append(r.pendingLogs, activities.ScaffolderLogEntry{
		// The deterministic workflow clock, never time.Now: the activity would
		// otherwise stamp a replay-unstable timestamp on every line.
		TS:      workflowNow(ctx),
		Level:   level,
		Message: message,
	})
}

// failStep records a step failure without deciding the run's fate.
func (r *scaffolderRun) failStep(idx int, msg string) {
	r.steps[idx].Status = stepStatusFailed
	r.steps[idx].Error = msg
}

// finish cleans up the run's work dir, writes the terminal status and returns
// the result. Every non-cancellation exit goes through here so the work dir is
// never left behind.
func (r *scaffolderRun) finish(ctx workflow.Context, actCtx workflow.Context, status, errMsg string) (*ScaffolderWorkflowResult, error) {
	r.status = status
	r.errorMsg = errMsg

	if err := workflow.ExecuteActivity(actCtx, activities.ActivityScaffolderCleanupRun,
		activities.CleanupScaffolderRunInput{RunID: r.input.RunID}).Get(actCtx, nil); err != nil {
		if temporal.IsCanceledError(err) {
			// A cancel landed during cleanup: redo it on a context that can
			// still schedule work, then report cancelled.
			return r.finishCancelled(ctx)
		}
		r.logger.Warn("Best-effort scaffolder work dir cleanup failed", "runId", r.input.RunID, "error", err)
	}

	r.writeProgress(actCtx, status, "", nil)

	// Phase 4 Task G: only a sweep-triggered DRY run records drift status. A
	// human "Preview" (Trigger unset) and a REAL run (DryRun false, even one
	// the sweep triggered — the sweep only ever triggers dry runs today, but
	// the guard is explicit rather than assumed) never reach this.
	if r.input.DryRun && r.input.Trigger == scaffolderSweepTrigger {
		r.recordSweepResult(actCtx, status)
	}

	return &ScaffolderWorkflowResult{
		Status:  status,
		Outputs: r.outputs,
		Plan:    r.plan,
		Error:   errMsg,
		Steps:   append([]activities.ScaffolderStepProgress(nil), r.steps...),
	}, nil
}

// recordSweepResult writes this dry run's drift outcome back to its
// template-definitions doc. Best-effort like writeProgress: a failed write
// never fails the run, since the run itself already completed.
func (r *scaffolderRun) recordSweepResult(ctx workflow.Context, status string) {
	in := activities.RecordSweepResultInput{
		DefinitionID: r.input.DefinitionID,
		Failed:       status == ScaffolderStatusFailed,
		PlanHash:     computePlanHash(r.plan),
	}
	if err := workflow.ExecuteActivity(ctx, activities.ActivityScaffolderRecordSweepResult, in).Get(ctx, nil); err != nil {
		r.logger.Warn("Failed to record scheduled-sweep dry run result",
			"runId", r.input.RunID, "definitionId", r.input.DefinitionID, "error", err)
	}
}

// computePlanHash returns a stable content hash of a dry run's planned
// changes, used to detect drift between two sweep runs of the same
// definition. Sorted first so entry REORDERING (which carries no semantic
// meaning — a plan is a set of effects, not a sequence with significance
// beyond step order, which stays fixed per-definition anyway) never reads as
// drift; a coarse hash of kind+name+description, not a full diff — a
// template whose plan changes for a reason other than its listed
// PlannedChange[] content (e.g. a Kafka topic name embedded only in a
// non-file action's side effect) will not be flagged by this first cut (see
// the phase plan §7/§11's noted limitation).
func computePlanHash(plan []scaffolder.PlannedChange) string {
	entries := make([]string, len(plan))
	for i, c := range plan {
		entries[i] = c.Kind + "\x00" + c.Name + "\x00" + c.Description
	}
	sort.Strings(entries)

	h := sha256.New()
	for _, e := range entries {
		h.Write([]byte(e))
		h.Write([]byte{'\n'})
	}
	return hex.EncodeToString(h.Sum(nil))
}

// finishCancelled cleans up and reports the terminal status on a disconnected
// context: the workflow's own context is already cancelled, so activities
// scheduled on it would never run.
func (r *scaffolderRun) finishCancelled(ctx workflow.Context) (*ScaffolderWorkflowResult, error) {
	r.status = ScaffolderStatusCancelled
	r.errorMsg = "scaffolder run cancelled"

	cleanupCtx, cancel := workflow.NewDisconnectedContext(ctx)
	defer cancel()
	cleanupCtx = workflow.WithActivityOptions(cleanupCtx, workflow.ActivityOptions{
		StartToCloseTimeout: 2 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts:        maxStepAttempts,
			NonRetryableErrorTypes: []string{activities.ErrTypeScaffolderInvalid},
		},
	})

	if err := workflow.ExecuteActivity(cleanupCtx, activities.ActivityScaffolderCleanupRun,
		activities.CleanupScaffolderRunInput{RunID: r.input.RunID}).Get(cleanupCtx, nil); err != nil {
		r.logger.Warn("Best-effort scaffolder work dir cleanup failed after cancellation",
			"runId", r.input.RunID, "error", err)
	}

	r.writeProgress(cleanupCtx, ScaffolderStatusCancelled, "", nil)

	return &ScaffolderWorkflowResult{
		Status:  ScaffolderStatusCancelled,
		Outputs: r.outputs,
		Plan:    r.plan,
		Error:   r.errorMsg,
		Steps:   append([]activities.ScaffolderStepProgress(nil), r.steps...),
	}, nil
}

// writeProgress pushes the current snapshot to the run record. A failed
// writeback never fails the run: the workflow result and the progress query
// remain authoritative, and losing a status write is not worth discarding
// completed work.
//
// Writes are strictly sequential (each awaits the previous), so a terminal
// status can never be overtaken by a later per-step write.
func (r *scaffolderRun) writeProgress(ctx workflow.Context, status, workflowID string, extraLogs []activities.ScaffolderLogEntry) {
	logs := append(r.pendingLogs, extraLogs...)
	// Drain before the call: a failed writeback must not replay the same lines
	// on the next one, since the route appends rather than replaces.
	r.pendingLogs = nil

	in := activities.WriteRunProgressInput{
		RunID:      r.input.RunID,
		Status:     status,
		WorkflowID: workflowID,
		Steps:      append([]activities.ScaffolderStepProgress(nil), r.steps...),
		AppendLogs: logs,
	}
	if isTerminalScaffolderStatus(status) {
		in.Error = r.errorMsg
		// Always claim the outputs on a terminal write, even when there are
		// none, so a previous run of this record cannot leave values behind
		// that read as this run's result.
		in.HasOutputs = true
		in.Outputs = r.outputs
		if r.input.DryRun {
			// Always send the plan on a dry run's terminal write, even when
			// empty, so a stale plan from a previous run cannot survive.
			in.HasPlan = true
			in.Plan = r.plan
		}
	}

	if err := workflow.ExecuteActivity(ctx, activities.ActivityScaffolderWriteRunProgress, in).Get(ctx, nil); err != nil {
		r.logger.Warn("Failed to write scaffolder run progress",
			"runId", r.input.RunID, "status", status, "error", err)
	}
}

// progress builds the query payload.
func (r *scaffolderRun) progress() ScaffolderProgress {
	return ScaffolderProgress{
		Status:  r.status,
		Steps:   append([]activities.ScaffolderStepProgress(nil), r.steps...),
		Outputs: r.outputs,
		Plan:    r.plan,
		Error:   r.errorMsg,
	}
}

func isTerminalScaffolderStatus(status string) bool {
	switch status {
	case ScaffolderStatusSucceeded, ScaffolderStatusFailed, ScaffolderStatusCancelled:
		return true
	default:
		return false
	}
}

// optionalKeys builds a namespace map from key/value pairs, dropping any pair
// whose value is empty. Dropping rather than seeding "" is what makes an
// unpopulated field fail loudly when a template reads it.
func optionalKeys(pairs ...string) map[string]any {
	out := make(map[string]any, len(pairs)/2)
	for i := 0; i+1 < len(pairs); i += 2 {
		if pairs[i+1] == "" {
			continue
		}
		out[pairs[i]] = pairs[i+1]
	}
	return out
}

// workflowNow formats the deterministic workflow clock. Never time.Now().
func workflowNow(ctx workflow.Context) string {
	return workflow.Now(ctx).UTC().Format(time.RFC3339)
}

// parseStepTimeout turns a step's `timeout` into a duration. An empty value
// takes the default; anything unparsable or non-positive is a definition error.
func parseStepTimeout(raw string, def time.Duration) (time.Duration, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return def, nil
	}
	d, err := time.ParseDuration(trimmed)
	if err != nil {
		return 0, fmt.Errorf("invalid timeout %q: %w", raw, err)
	}
	if d <= 0 {
		return 0, fmt.Errorf("invalid timeout %q: must be positive", raw)
	}
	if d > scaffolder.MaxStepTimeout {
		return 0, fmt.Errorf("invalid timeout %q: must not exceed %s", raw, scaffolder.MaxStepTimeout)
	}
	return d, nil
}

// resolveDefinitionOutput resolves spec.output against the final expression
// context and returns it as a plain map for the run record and the gRPC
// response. A definition without an output block yields nil.
func resolveDefinitionOutput(exprCtx scaffolder.Ctx, out *scaffolder.Output) (map[string]any, error) {
	if out == nil {
		return nil, nil
	}
	raw, err := json.Marshal(out)
	if err != nil {
		return nil, err
	}
	var decoded any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return nil, err
	}
	resolved, err := scaffolder.Resolve(exprCtx, decoded)
	if err != nil {
		return nil, err
	}
	asMap, ok := resolved.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("resolved output is not an object")
	}
	return asMap, nil
}
