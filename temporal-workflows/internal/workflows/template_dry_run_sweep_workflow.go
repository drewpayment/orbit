package workflows

import (
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"

	"github.com/drewpayment/orbit/temporal-workflows/internal/activities"
)

// sweepActivityTimeout bounds each of the sweep's own activities. These are
// small HTTP round-trips (list candidates, create+dispatch one run) — none
// of them heartbeat, and none should ever legitimately take long.
const sweepActivityTimeout = 2 * time.Minute

// sweepMaxAttempts matches the scaffolder engine's own maxStepAttempts: one
// broken definition's fixture retries a bounded number of times, then is
// counted as failed rather than retrying forever and blocking every other
// definition's re-check behind it.
const sweepMaxAttempts = 3

// TemplateDryRunSweepWorkflowInput is TemplateDryRunSweepWorkflow's input.
// Empty today (the sweep always covers every published, fixtured
// definition) — a struct rather than no input so a future filtered sweep
// (e.g. one workspace) can add fields without a breaking schema change.
type TemplateDryRunSweepWorkflowInput struct{}

// TemplateDryRunSweepWorkflowResult summarizes one sweep run, for the
// Temporal UI/history and for tests. The sweep itself does not track
// individual ScaffolderWorkflow outcomes — TriggerTemplateDryRun starts each
// dry run and returns immediately; drift/failure per definition shows up in
// template-definitions.lastDryRunStatus, written independently by
// ScaffolderWorkflow.finish() -> RecordSweepResult once each triggered run
// completes.
type TemplateDryRunSweepWorkflowResult struct {
	// TriggeredCount is how many fixtures were successfully handed to
	// TriggerTemplateDryRun (a dry run was created and dispatched).
	TriggeredCount int `json:"triggeredCount"`
	// FailedCount is how many fixtures' TriggerTemplateDryRun call itself
	// failed (the run/dispatch could not even be created) — distinct from a
	// dispatched dry run later failing, which is NOT tracked here (see the
	// type docblock).
	FailedCount int `json:"failedCount"`
	// SkippedNoFixturesCount is how many published, versioned definitions had
	// zero fixtures and so were logged, not dry-run.
	SkippedNoFixturesCount int      `json:"skippedNoFixturesCount"`
	SkippedDefinitionIDs   []string `json:"skippedDefinitionIds,omitempty"`
}

// TemplateDryRunSweepWorkflow is the Phase 4 Task G scheduled re-dry-run
// sweep: list every published template-definition with a resolved current
// version, and for each of its fixtures, trigger a dry run. A definition
// with zero fixtures is logged (workflow.GetLogger, plus counted in the
// result) rather than silently never re-checked — "broken paved paths must
// fail loudly" extends to "silently never re-checked" being its own failure
// mode (phase plan §7).
//
// Each fixture's trigger is independent: TriggerTemplateDryRun creates the
// run and starts ScaffolderWorkflow WITHOUT this workflow awaiting that
// child run's completion (ParentClosePolicy/child-workflow semantics do not
// even apply here — TriggerTemplateDryRun starts an entirely separate,
// independently-scheduled workflow execution, not a child of this one). A
// failure triggering one fixture is caught and counted, not fatal to the
// sweep — one broken definition must not stop every other definition's
// re-check.
func TemplateDryRunSweepWorkflow(ctx workflow.Context, _ TemplateDryRunSweepWorkflowInput) (*TemplateDryRunSweepWorkflowResult, error) {
	logger := workflow.GetLogger(ctx)

	actCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: sweepActivityTimeout,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts: sweepMaxAttempts,
		},
	})

	var listResult *activities.ListPublishedTemplatesWithFixturesResult
	if err := workflow.ExecuteActivity(actCtx, activities.ActivityListPublishedTemplatesWithFixtures).Get(actCtx, &listResult); err != nil {
		return nil, err
	}

	result := &TemplateDryRunSweepWorkflowResult{}
	if listResult == nil {
		return result, nil
	}

	for _, tpl := range listResult.Templates {
		if len(tpl.Fixtures) == 0 {
			logger.Warn("Scheduled sweep: published template has no fixtures, not re-checked",
				"definitionId", tpl.DefinitionID, "name", tpl.Name)
			result.SkippedNoFixturesCount++
			result.SkippedDefinitionIDs = append(result.SkippedDefinitionIDs, tpl.DefinitionID)
			continue
		}

		for _, fixture := range tpl.Fixtures {
			in := activities.TriggerTemplateDryRunInput{
				DefinitionID:     tpl.DefinitionID,
				DefinitionName:   tpl.Name,
				CurrentVersionID: tpl.CurrentVersionID,
				WorkspaceID:      tpl.WorkspaceID,
				FixtureID:        fixture.ID,
				FixtureName:      fixture.Name,
				Parameters:       fixture.Values,
			}

			var triggered *activities.TriggerTemplateDryRunResult
			err := workflow.ExecuteActivity(actCtx, activities.ActivityTriggerTemplateDryRun, in).Get(actCtx, &triggered)
			if err != nil {
				logger.Warn("Scheduled sweep: failed to trigger a fixture's dry run",
					"definitionId", tpl.DefinitionID, "fixtureId", fixture.ID, "error", err)
				result.FailedCount++
				continue
			}
			result.TriggeredCount++
		}
	}

	return result, nil
}
