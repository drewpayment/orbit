package workflows

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"go.temporal.io/sdk/log"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"

	"github.com/drewpayment/orbit/temporal-workflows/internal/activities"
	"github.com/drewpayment/orbit/temporal-workflows/internal/scaffolder"
)

// Terminal run statuses. These are the strings the `action-runs` collection
// stores and the repository service's parseWorkflowStatus maps onto the
// WorkflowStatus enum.
const (
	ScaffolderStatusSucceeded = "succeeded"
	ScaffolderStatusFailed    = "failed"
	ScaffolderStatusCancelled = "cancelled"
	ScaffolderStatusRunning   = "running"
)

// Per-step progress statuses.
const (
	stepStatusPending   = "pending"
	stepStatusRunning   = "running"
	stepStatusSucceeded = "succeeded"
	stepStatusFailed    = "failed"
	stepStatusSkipped   = "skipped"
)

// ScaffolderProgressQuery is the query name GetRunProgress uses.
const ScaffolderProgressQuery = "progress"

// defaultStepTimeout applies to a step that declares no `timeout`.
const defaultStepTimeout = 10 * time.Minute

// stepHeartbeatTimeout bounds how long a long-running action may go without a
// heartbeat before the attempt is considered lost. Actions call
// rc.Heartbeat during clones, renders and pushes.
const stepHeartbeatTimeout = 2 * time.Minute

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
	Definition          scaffolder.Definition `json:"definition"`
	Parameters          map[string]any        `json:"parameters"`
	WorkspaceID         string                `json:"workspaceId"`
	UserID              string                `json:"userId"`
	DryRun              bool                  `json:"dryRun"`
}

// ScaffolderWorkflowResult is the run outcome.
type ScaffolderWorkflowResult struct {
	Status  string                     `json:"status"` // succeeded | failed | cancelled
	Outputs map[string]any             `json:"outputs,omitempty"`
	Plan    []scaffolder.PlannedChange `json:"plan,omitempty"`
	Error   string                     `json:"error,omitempty"`
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

	run := newScaffolderRun(ctx, input, logger)

	if err := workflow.SetQueryHandler(ctx, ScaffolderProgressQuery, func() (ScaffolderProgress, error) {
		return run.progress(), nil
	}); err != nil {
		logger.Error("Failed to register the scaffolder progress query", "error", err)
		return &ScaffolderWorkflowResult{
			Status: ScaffolderStatusFailed,
			Error:  "failed to set up progress tracking: " + err.Error(),
		}, nil
	}

	actCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: defaultStepTimeout,
		HeartbeatTimeout:    stepHeartbeatTimeout,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts:        maxStepAttempts,
			NonRetryableErrorTypes: []string{activities.ErrTypeScaffolderInvalid},
		},
	})

	// The first writeback claims the run: it records the workflow id so the UI
	// can cancel, and flips the run to running with every step pending.
	run.writeProgress(actCtx, ScaffolderStatusRunning, info.WorkflowExecution.ID, nil)

	// Static validation runs in an activity (see ValidateDefinition's doc for
	// why) and its findings fail the run without a retry.
	var validation *activities.ValidateDefinitionResult
	err := workflow.ExecuteActivity(actCtx, activities.ActivityScaffolderValidateDefinition,
		activities.ValidateDefinitionInput{Definition: input.Definition}).Get(actCtx, &validation)
	switch {
	case err != nil && temporal.IsCanceledError(err):
		return run.finishCancelled(ctx)
	case err != nil:
		return run.finish(ctx, actCtx, ScaffolderStatusFailed, "definition validation failed: "+err.Error())
	case validation != nil && len(validation.Errors) > 0:
		return run.finish(ctx, actCtx, ScaffolderStatusFailed,
			"definition is not executable: "+strings.Join(validation.Errors, "; "))
	}

	for i := range input.Definition.Spec.Steps {
		step := input.Definition.Spec.Steps[i]

		proceed, cancelled, failure := run.runStep(ctx, actCtx, step)
		switch {
		case cancelled:
			return run.finishCancelled(ctx)
		case failure != "":
			return run.finish(ctx, actCtx, ScaffolderStatusFailed, failure)
		case !proceed:
			// continueOnError swallowed a step failure; keep going.
		}
		run.writeProgress(actCtx, ScaffolderStatusRunning, "", nil)
	}

	outputs, err := resolveDefinitionOutput(run.exprCtx, input.Definition.Spec.Output)
	if err != nil {
		return run.finish(ctx, actCtx, ScaffolderStatusFailed, "failed to resolve output: "+err.Error())
	}
	run.outputs = outputs

	return run.finish(ctx, actCtx, ScaffolderStatusSucceeded, "")
}

// newScaffolderRun seeds the expression context and the per-step progress
// slice. Every namespace is a plain map, so an expression can never reach into
// Go state (see scaffolder.Ctx).
func newScaffolderRun(ctx workflow.Context, input ScaffolderWorkflowInput, logger log.Logger) *scaffolderRun {
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
			User:       map[string]any{"id": input.UserID},
			Workspace:  map[string]any{"id": input.WorkspaceID},
			Template: map[string]any{
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
	_ = ctx
	return run
}

// runStep evaluates a step's condition, resolves its input and dispatches it.
//
// It returns (proceed, cancelled, failure): proceed is false when the step
// failed but continueOnError let the run carry on; cancelled is true when the
// workflow was cancelled; failure is a non-empty message when the run must
// stop.
func (r *scaffolderRun) runStep(ctx workflow.Context, actCtx workflow.Context, step scaffolder.Step) (bool, bool, string) {
	idx, ok := r.stepIndex[step.ID]
	if !ok {
		return false, false, fmt.Sprintf("step %q: no progress slot", step.ID)
	}

	if step.If != "" {
		want, err := scaffolder.EvalBool(r.exprCtx, step.If)
		if err != nil {
			r.failStep(idx, err.Error())
			return false, false, fmt.Sprintf("step %q: %v", step.ID, err)
		}
		if !want {
			r.steps[idx].Status = stepStatusSkipped
			r.steps[idx].FinishedAt = workflowNow(ctx)
			r.logger.Info("Scaffolder step skipped", "stepId", step.ID, "if", step.If)
			return true, false, ""
		}
	}

	timeout, err := parseStepTimeout(step.Timeout, defaultStepTimeout)
	if err != nil {
		r.failStep(idx, err.Error())
		return false, false, fmt.Sprintf("step %q: %v", step.ID, err)
	}

	resolvedInput, err := scaffolder.ResolveJSON(r.exprCtx, step.Input)
	if err != nil {
		r.failStep(idx, err.Error())
		return false, false, fmt.Sprintf("step %q: %v", step.ID, err)
	}

	r.steps[idx].Status = stepStatusRunning
	r.steps[idx].StartedAt = workflowNow(ctx)

	stepCtx := workflow.WithStartToCloseTimeout(actCtx, timeout)
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
		r.failStep(idx, "cancelled")
		return false, true, ""
	}
	if activityErr != nil {
		if temporal.IsCanceledError(activityErr) {
			r.failStep(idx, "cancelled")
			return false, true, ""
		}
		r.failStep(idx, activityErr.Error())
		if step.ContinueOnError {
			r.logger.Warn("Scaffolder step failed but continueOnError is set",
				"stepId", step.ID, "action", step.Action, "error", activityErr)
			return false, false, ""
		}
		return false, false, fmt.Sprintf("step %q (%s) failed: %v", step.ID, step.Action, activityErr)
	}

	r.steps[idx].Status = stepStatusSucceeded
	r.steps[idx].FinishedAt = workflowNow(ctx)

	if r.input.DryRun {
		if planResult.Unsupported {
			r.plan = append(r.plan, scaffolder.PlannedChange{
				Kind:        "unsupported",
				Name:        step.ID,
				Description: fmt.Sprintf("%s cannot be previewed", step.Action),
			})
		}
		r.plan = append(r.plan, planResult.Changes...)
		// A planned step produces no output, so nothing enters the expression
		// context: a dry run must not let a later step read a value that will
		// not exist in the real run.
		return true, false, ""
	}

	out := execResult.Output
	if out == nil {
		out = map[string]any{}
	}
	r.steps[idx].Output = out
	r.exprCtx.Steps[step.ID] = scaffolder.StepOutput{Output: out}
	return true, false, ""
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

	return &ScaffolderWorkflowResult{
		Status:  status,
		Outputs: r.outputs,
		Plan:    r.plan,
		Error:   errMsg,
	}, nil
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
	}, nil
}

// writeProgress pushes the current snapshot to the run record. A failed
// writeback never fails the run: the workflow result and the progress query
// remain authoritative, and losing a status write is not worth discarding
// completed work.
//
// Writes are strictly sequential (each awaits the previous), so a terminal
// status can never be overtaken by a later per-step write.
func (r *scaffolderRun) writeProgress(ctx workflow.Context, status, workflowID string, logs []activities.ScaffolderLogEntry) {
	in := activities.WriteRunProgressInput{
		RunID:      r.input.RunID,
		Status:     status,
		WorkflowID: workflowID,
		Steps:      append([]activities.ScaffolderStepProgress(nil), r.steps...),
		AppendLogs: logs,
	}
	if isTerminalScaffolderStatus(status) {
		in.Error = r.errorMsg
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
