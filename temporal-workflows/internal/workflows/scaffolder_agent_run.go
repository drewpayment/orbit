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

// agentRunAction is the special-cased step action. ScaffolderWorkflow's step
// loop branches on this name before generic dispatch: the registered
// actions.AgentRun action exists only for its schema/descriptor (see its
// doc comment) and is never Execute'd or Plan'd.
const agentRunAction = "agent:run"

// agentRunTitleMaxLen bounds the title derived from a prompt when the step
// input omits one, matching the chat UI's own convention
// (src/app/actions/infra-agent.ts: `initialPrompt.slice(0, 80)`).
const agentRunTitleMaxLen = 80

// agentRunInput is `agent:run`'s resolved step input.
type agentRunInput struct {
	Prompt string `json:"prompt"`
	Title  string `json:"title"`
}

func parseAgentRunInput(resolved json.RawMessage) (agentRunInput, error) {
	var in agentRunInput
	if len(strings.TrimSpace(string(resolved))) > 0 {
		if err := json.Unmarshal(resolved, &in); err != nil {
			return in, fmt.Errorf("agent:run: decode input: %w", err)
		}
	}
	if strings.TrimSpace(in.Prompt) == "" {
		return in, fmt.Errorf("agent:run: `prompt` is required")
	}
	if strings.TrimSpace(in.Title) == "" {
		title := in.Prompt
		if len(title) > agentRunTitleMaxLen {
			title = title[:agentRunTitleMaxLen]
		}
		in.Title = title
	}
	return in, nil
}

// agentRunChildWorkflowID is deterministic (RunID + StepID), matching
// approvalStepID's convention: a workflow may not call anything
// non-deterministic outside workflow.SideEffect, and this also doubles as
// the AgentRuns row's `workflowId` key, so the run page
// (/workspaces/[slug]/infra-agent/[runId]) can find it directly.
func agentRunChildWorkflowID(runID, stepID string) string {
	return runID + "-" + stepID
}

// planAgentRunStep is the dry-run branch for `agent:run` (plan §4.2). A dry
// run must never start the infra agent: it records the step as unsupported,
// the same shape approval:request's dry run produces.
func (r *scaffolderRun) planAgentRunStep(ctx workflow.Context, idx int, step scaffolder.Step) {
	r.steps[idx].Status = stepStatusSucceeded
	r.steps[idx].FinishedAt = workflowNow(ctx)
	r.plan = append(r.plan, scaffolder.PlannedChange{
		Kind:        "unsupported",
		Name:        step.ID,
		Description: "requires running the infra agent — not evaluated in a dry run",
	})
	r.appendLog(ctx, "info", fmt.Sprintf("step %s (%s) requires the infra agent; not evaluated in a dry run", step.ID, step.Action))
}

// runAgentRunStep is the workflow-level special case for `agent:run` (plan
// §4). It resolves the step's input, creates the backing AgentRuns row
// (which also resolves the workspace's default LLM provider), starts
// InfrastructureAgentWorkflow as a child with ParentClosePolicy: TERMINATE,
// and waits on the child's future or the workflow's own cancellation —
// mirroring runApprovalStep's selector/cancellation idiom exactly (plan
// §10, Task D depends on Task C's proven shape).
//
// Returns (cancelled, failure) with the same contract as runStep.
func (r *scaffolderRun) runAgentRunStep(ctx workflow.Context, bookkeepingCtx workflow.Context, step scaffolder.Step) (bool, string) {
	idx, ok := r.stepIndex[step.ID]
	if !ok {
		return false, fmt.Sprintf("step %q: no progress slot", step.ID)
	}

	// step.If is evaluated identically to the generic runStep path (and to
	// approval:request's own fix, see runApprovalStep): agent:run is not
	// exempt from conditional skipping just because it is special-cased. A
	// malformed condition is handled the same way too: dry-run-skippable (an
	// unresolved step reference) records the step as unplannable and moves
	// on, anything else fails the run.
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
			r.logger.Info("Scaffolder agent:run step skipped", "stepId", step.ID, "if", step.If)
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

	if r.input.DryRun {
		r.planAgentRunStep(ctx, idx, step)
		return false, ""
	}

	resolvedInput, err := scaffolder.ResolveJSON(r.exprCtx, step.Input)
	if err != nil {
		r.failStep(idx, err.Error())
		return false, fmt.Sprintf("step %q: %v", step.ID, err)
	}
	in, err := parseAgentRunInput(resolvedInput)
	if err != nil {
		r.failStep(idx, err.Error())
		return false, fmt.Sprintf("step %q: %v", step.ID, err)
	}

	if strings.TrimSpace(r.input.UserID) == "" {
		// InfrastructureAgentInput.UserID and AgentRuns.startedBy both need a
		// real user: an automation-triggered run (no triggering user) cannot
		// use agent:run. Fail fast, before the create-run activity, rather
		// than surfacing this as an opaque Payload validation error.
		return r.failAgentRunStep(ctx, idx, step, "agent:run requires an authenticated user")
	}

	childWorkflowID := agentRunChildWorkflowID(r.input.RunID, step.ID)

	r.steps[idx].Status = stepStatusRunning
	r.steps[idx].StartedAt = workflowNow(ctx)
	r.appendLog(ctx, "info", fmt.Sprintf("step %s (%s) starting infra agent run", step.ID, step.Action))
	r.writeProgress(bookkeepingCtx, ScaffolderStatusRunning, "", nil)

	var createResult activities.ScaffolderCreateAgentRunResult
	createErr := workflow.ExecuteActivity(bookkeepingCtx, activities.ActivityScaffolderCreateAgentRun, activities.ScaffolderCreateAgentRunInput{
		WorkspaceID: r.input.WorkspaceID,
		UserID:      r.input.UserID,
		WorkflowID:  childWorkflowID,
		Title:       in.Title,
		Prompt:      in.Prompt,
	}).Get(bookkeepingCtx, &createResult)
	if createErr != nil {
		if temporal.IsCanceledError(createErr) {
			r.failStep(idx, "cancelled")
			r.appendLog(ctx, "warn", fmt.Sprintf("step %s (%s) cancelled", step.ID, step.Action))
			return true, ""
		}
		return r.failAgentRunStep(ctx, idx, step, "failed to start infra agent run: "+createErr.Error())
	}

	agentInput := InfrastructureAgentInput{
		AgentRunID:    createResult.AgentRunID,
		WorkspaceID:   r.input.WorkspaceID,
		UserID:        r.input.UserID,
		LLMProviderID: createResult.LLMProviderID,
		InitialPrompt: in.Prompt,
	}

	childCtx := workflow.WithChildOptions(ctx, workflow.ChildWorkflowOptions{
		WorkflowID: childWorkflowID,
		// TERMINATE so cancelling the template run tears down the agent run
		// rather than abandoning it (ABANDON would leave an orphaned agent
		// burning tokens after the template run itself is gone).
		ParentClosePolicy:   enumspb.PARENT_CLOSE_POLICY_TERMINATE,
		WaitForCancellation: true,
	})
	future := workflow.ExecuteChildWorkflow(childCtx, InfrastructureAgentWorkflow, agentInput)

	var (
		childErr  error
		cancelled bool
	)
	sel := workflow.NewSelector(ctx)
	sel.AddFuture(future, func(f workflow.Future) { childErr = f.Get(childCtx, nil) })
	sel.AddReceive(ctx.Done(), func(workflow.ReceiveChannel, bool) { cancelled = true })
	sel.Select(ctx)

	if cancelled {
		// ctx.Done() only means the cancel was *requested*; the child (which
		// inherited the same cancellable ctx) is also being cancelled, but
		// its ParentClosePolicy is only a backstop for parent-close, not
		// explicit cancel — wait for it to actually stop on a disconnected
		// context before returning, mirroring runStep's own cancel handling.
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
		return r.failAgentRunStep(ctx, idx, step, "infra agent run failed: "+childErr.Error())
	}

	out := map[string]any{
		"agentRunId": createResult.AgentRunID,
		"status":     "completed",
	}
	if r.input.WorkspaceSlug != "" {
		out["url"] = fmt.Sprintf("/workspaces/%s/infra-agent/%s", r.input.WorkspaceSlug, childWorkflowID)
	}

	r.steps[idx].Status = stepStatusSucceeded
	r.steps[idx].FinishedAt = workflowNow(ctx)
	r.steps[idx].Output = out
	r.exprCtx.Steps[step.ID] = scaffolder.StepOutput{Output: out}
	r.appendLog(ctx, "info", fmt.Sprintf("step %s (%s) infra agent run completed", step.ID, step.Action))
	return false, ""
}

// failAgentRunStep records the step failure and decides the run's fate,
// honouring continueOnError exactly as the generic step path does.
func (r *scaffolderRun) failAgentRunStep(ctx workflow.Context, idx int, step scaffolder.Step, msg string) (bool, string) {
	r.failStep(idx, msg)
	if step.ContinueOnError {
		r.logger.Warn("Scaffolder agent:run step failed but continueOnError is set",
			"stepId", step.ID, "action", step.Action, "error", msg)
		r.appendLog(ctx, "warn", fmt.Sprintf("step %s (%s) failed, continuing: %s", step.ID, step.Action, msg))
		return false, ""
	}
	r.appendLog(ctx, "error", fmt.Sprintf("step %s (%s) failed: %s", step.ID, step.Action, msg))
	return false, fmt.Sprintf("step %q (%s) failed: %s", step.ID, step.Action, msg)
}
