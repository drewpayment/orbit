package workflows

import (
	"encoding/json"
	"fmt"
	"strings"

	enumspb "go.temporal.io/api/enums/v1"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"

	"github.com/drewpayment/orbit/temporal-workflows/internal/activities"
	"github.com/drewpayment/orbit/temporal-workflows/internal/scaffolder"
)

// fetchTemplateAction is the special-cased step action. ScaffolderWorkflow's
// step loop branches on this name before generic dispatch: the registered
// actions.FetchTemplate action exists only for its schema/descriptor (see
// its doc comment) and is never Execute'd or Plan'd.
const fetchTemplateAction = "fetch:template"

// maxTemplateStackDepth caps total `fetch:template` nesting, independent of
// cycle detection: two independent cycles of different lengths both need
// catching by the stack check, but an accidental very-deep (non-cyclic)
// composition chain needs its own guard. Tunable; cheap insurance at this
// size.
const maxTemplateStackDepth = 5

// fetchTemplateInput is `fetch:template`'s resolved step input.
type fetchTemplateInput struct {
	TemplateDefinitionID string         `json:"templateDefinitionId"`
	Version              string         `json:"version"`
	Parameters           map[string]any `json:"parameters"`
}

func parseFetchTemplateInput(resolved json.RawMessage) (fetchTemplateInput, error) {
	var in fetchTemplateInput
	if len(strings.TrimSpace(string(resolved))) > 0 {
		if err := json.Unmarshal(resolved, &in); err != nil {
			return in, fmt.Errorf("fetch:template: decode input: %w", err)
		}
	}
	if strings.TrimSpace(in.TemplateDefinitionID) == "" {
		return in, fmt.Errorf("fetch:template: `templateDefinitionId` is required")
	}
	return in, nil
}

// fetchTemplateChildWorkflowID is deterministic (RunID + StepID), the same
// convention agent:run and approval:request use.
func fetchTemplateChildWorkflowID(runID, stepID string) string {
	return runID + "-" + stepID
}

// fetchTemplateNestedRunID namespaces the nested run's own RunID (used for
// its work directory and expression context, NOT for a Payload action-runs
// row: no such row exists for a nested run, see the doc comment on
// runFetchTemplateStep for why that is safe). Distinct from the Temporal
// child workflow id.
func fetchTemplateNestedRunID(runID, stepID string) string {
	return runID + ":" + stepID
}

// runFetchTemplateStep is the workflow-level special case for
// `fetch:template` (plan §6). It resolves the target template version via an
// activity (cycle- and depth-checking against TemplateStack), then runs the
// nested definition as a child ScaffolderWorkflow with DryRun inherited —
// so a dry run of the outer plans the nested run too, never executing it —
// and flattens the nested run's final steps into this run's own steps[] as
// `<outerStepId>.<nestedStepId>` (plan §13 decision 1).
//
// The nested run intentionally has NO backing action-runs Payload document:
// its own progress writebacks 404 and are dropped (WriteRunProgress already
// treats a failed writeback as non-fatal — "a failed writeback never fails
// the run"), and its work directory is keyed by its own synthetic RunID, so
// it never collides with the outer run's. This run's own steps[] is what
// the run page reads; the nested run's live step-by-step progress is not
// relayed while it is in flight — only its FINAL step list, once the child
// completes, is flattened in. This is the simpler of the two composition
// shapes the plan allows (plan §6.4): the alternative (a separate
// action-runs row per nested run, linked back via a new `parentRun` field)
// is cleaner for auditability but adds a data-model field and a nested-run
// page this phase does not need; it remains a named follow-up.
//
// Returns (cancelled, failure) with the same contract as runStep.
func (r *scaffolderRun) runFetchTemplateStep(ctx workflow.Context, bookkeepingCtx workflow.Context, step scaffolder.Step) (bool, string) {
	idx, ok := r.stepIndex[step.ID]
	if !ok {
		return false, fmt.Sprintf("step %q: no progress slot", step.ID)
	}

	// step.If is evaluated identically to the generic runStep path (and to
	// approval:request's own fix, see runApprovalStep): fetch:template is
	// not exempt from conditional skipping just because it is
	// special-cased. A malformed condition is handled the same way too:
	// dry-run-skippable (an unresolved step reference) records the step as
	// unplannable and moves on, anything else fails the run.
	if step.If != "" {
		want, err := scaffolder.EvalBool(r.exprCtx, step.If)
		if err != nil {
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
			r.logger.Info("Scaffolder fetch:template step skipped", "stepId", step.ID, "if", step.If)
			r.appendLog(ctx, "info", fmt.Sprintf("step %s (%s) skipped: condition is false", step.ID, step.Action))
			if r.input.DryRun {
				// Recorded, so a reader can see the plan accounts for every
				// step — matches the generic runStep path's dry-run "skipped"
				// entry exactly.
				r.plan = append(r.plan, scaffolder.PlannedChange{
					Kind:        "skipped",
					Name:        step.ID,
					Description: fmt.Sprintf("%s will not run: its condition is false", step.Action),
				})
			}
			return false, ""
		}
	}

	resolvedInput, err := scaffolder.ResolveJSON(r.exprCtx, step.Input)
	if err != nil {
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
	in, err := parseFetchTemplateInput(resolvedInput)
	if err != nil {
		r.failStep(idx, err.Error())
		return false, fmt.Sprintf("step %q: %v", step.ID, err)
	}

	if len(r.input.TemplateStack) >= maxTemplateStackDepth {
		msg := fmt.Sprintf("template composition depth exceeded (max %d): %s",
			maxTemplateStackDepth, strings.Join(r.input.TemplateStack, " → "))
		return r.failFetchTemplateStep(ctx, idx, step, msg)
	}

	r.steps[idx].Status = stepStatusRunning
	r.steps[idx].StartedAt = workflowNow(ctx)
	r.appendLog(ctx, "info", fmt.Sprintf("step %s (%s) resolving template %s", step.ID, step.Action, in.TemplateDefinitionID))
	r.writeProgress(bookkeepingCtx, ScaffolderStatusRunning, "", nil)

	var resolveResult activities.ScaffolderResolveTemplateVersionResult
	resolveErr := workflow.ExecuteActivity(bookkeepingCtx, activities.ActivityScaffolderResolveTemplateVersion, activities.ScaffolderResolveTemplateVersionInput{
		WorkspaceID:          r.input.WorkspaceID,
		TemplateDefinitionID: in.TemplateDefinitionID,
		Version:              in.Version,
	}).Get(bookkeepingCtx, &resolveResult)
	if resolveErr != nil {
		if temporal.IsCanceledError(resolveErr) {
			r.failStep(idx, "cancelled")
			r.appendLog(ctx, "warn", fmt.Sprintf("step %s (%s) cancelled", step.ID, step.Action))
			return true, ""
		}
		return r.failFetchTemplateStep(ctx, idx, step, "failed to resolve template version: "+resolveErr.Error())
	}

	for _, seen := range r.input.TemplateStack {
		if seen == resolveResult.DefinitionVersionID {
			path := append(append([]string{}, r.input.TemplateStack...), resolveResult.DefinitionVersionID)
			msg := fmt.Sprintf("template composition cycle detected: %s", strings.Join(path, " → "))
			return r.failFetchTemplateStep(ctx, idx, step, msg)
		}
	}

	childWorkflowID := fetchTemplateChildWorkflowID(r.input.RunID, step.ID)
	nestedInput := ScaffolderWorkflowInput{
		RunID:               fetchTemplateNestedRunID(r.input.RunID, step.ID),
		DefinitionVersionID: resolveResult.DefinitionVersionID,
		DefinitionID:        resolveResult.DefinitionID,
		Definition:          resolveResult.Definition,
		Parameters:          in.Parameters,
		WorkspaceID:         r.input.WorkspaceID,
		WorkspaceSlug:       r.input.WorkspaceSlug,
		WorkspaceName:       r.input.WorkspaceName,
		UserID:              r.input.UserID,
		UserEmail:           r.input.UserEmail,
		UserName:            r.input.UserName,
		DryRun:              r.input.DryRun,
		TemplateStack:       append(append([]string{}, r.input.TemplateStack...), resolveResult.DefinitionVersionID),
	}

	childCtx := workflow.WithChildOptions(ctx, workflow.ChildWorkflowOptions{
		WorkflowID:          childWorkflowID,
		ParentClosePolicy:   enumspb.PARENT_CLOSE_POLICY_TERMINATE,
		WaitForCancellation: true,
	})
	future := workflow.ExecuteChildWorkflow(childCtx, ScaffolderWorkflow, nestedInput)

	var (
		childResult *ScaffolderWorkflowResult
		childErr    error
		cancelled   bool
	)
	sel := workflow.NewSelector(ctx)
	sel.AddFuture(future, func(f workflow.Future) { childErr = f.Get(childCtx, &childResult) })
	sel.AddReceive(ctx.Done(), func(workflow.ReceiveChannel, bool) { cancelled = true })
	sel.Select(ctx)

	if cancelled {
		waitCtx, cancelWait := workflow.NewDisconnectedContext(ctx)
		defer cancelWait()
		_ = future.Get(waitCtx, nil)

		r.failStep(idx, "cancelled")
		r.appendLog(ctx, "warn", fmt.Sprintf("step %s (%s) cancelled", step.ID, step.Action))
		return true, ""
	}

	if childErr != nil {
		if temporal.IsCanceledError(childErr) {
			r.failStep(idx, "cancelled")
			r.appendLog(ctx, "warn", fmt.Sprintf("step %s (%s) cancelled", step.ID, step.Action))
			return true, ""
		}
		return r.failFetchTemplateStep(ctx, idx, step, "nested template run failed: "+childErr.Error())
	}
	if childResult == nil {
		return r.failFetchTemplateStep(ctx, idx, step, "nested template run returned no result")
	}

	// Flatten the nested run's final step list into this run's own, prefixed
	// so a reader can tell which fetch:template step they came from. No
	// entry is added to stepIndex: nested ids are only ever looked up by
	// prefix from the run record/UI, never re-dispatched through this run's
	// own step loop.
	for _, nested := range childResult.Steps {
		flat := nested
		flat.ID = step.ID + "." + nested.ID
		r.steps = append(r.steps, flat)
	}

	switch childResult.Status {
	case ScaffolderStatusCancelled:
		r.failStep(idx, "cancelled")
		r.appendLog(ctx, "warn", fmt.Sprintf("step %s (%s) cancelled", step.ID, step.Action))
		return true, ""
	case ScaffolderStatusFailed:
		msg := childResult.Error
		if msg == "" {
			msg = "nested template run failed"
		}
		return r.failFetchTemplateStep(ctx, idx, step, msg)
	}

	r.steps[idx].Status = stepStatusSucceeded
	r.steps[idx].FinishedAt = workflowNow(ctx)

	if r.input.DryRun {
		// A dry run never produces real step output (the same invariant
		// runStep's own dry-run branch preserves), so this step's output is
		// deliberately left unset in the expression context — a later step
		// referencing it gets the same "cannot be previewed" downgrade any
		// other unpreviewable step reference gets. Only the nested plan is
		// surfaced, prefixed the same way the flattened steps are.
		for _, change := range childResult.Plan {
			r.plan = append(r.plan, scaffolder.PlannedChange{
				Kind:        change.Kind,
				Name:        step.ID + "." + change.Name,
				Description: change.Description,
			})
		}
		r.appendLog(ctx, "info", fmt.Sprintf("step %s (%s) planned nested template run", step.ID, step.Action))
		return false, ""
	}

	out := childResult.Outputs
	if out == nil {
		out = map[string]any{}
	}
	r.steps[idx].Output = out
	r.exprCtx.Steps[step.ID] = scaffolder.StepOutput{Output: out}
	r.appendLog(ctx, "info", fmt.Sprintf("step %s (%s) nested template run completed", step.ID, step.Action))
	return false, ""
}

// failFetchTemplateStep records the step failure and decides the run's
// fate, honouring continueOnError exactly as the generic step path does.
func (r *scaffolderRun) failFetchTemplateStep(ctx workflow.Context, idx int, step scaffolder.Step, msg string) (bool, string) {
	r.failStep(idx, msg)
	if step.ContinueOnError {
		r.logger.Warn("Scaffolder fetch:template step failed but continueOnError is set",
			"stepId", step.ID, "action", step.Action, "error", msg)
		r.appendLog(ctx, "warn", fmt.Sprintf("step %s (%s) failed, continuing: %s", step.ID, step.Action, msg))
		if r.input.DryRun {
			r.plan = append(r.plan, scaffolder.PlannedChange{
				Kind:        "unsupported",
				Name:        step.ID,
				Description: scaffolder.RedactText(fmt.Sprintf("%s could not be previewed: %s", step.Action, msg)),
			})
		}
		return false, ""
	}
	r.appendLog(ctx, "error", fmt.Sprintf("step %s (%s) failed: %s", step.ID, step.Action, msg))
	return false, fmt.Sprintf("step %q (%s) failed: %s", step.ID, step.Action, msg)
}
