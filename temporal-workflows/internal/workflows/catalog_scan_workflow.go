// temporal-workflows/internal/workflows/catalog_scan_workflow.go
package workflows

import (
	"time"

	"github.com/drewpayment/orbit/temporal-workflows/internal/activities"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

const (
	// catalogScanCANThreshold is the number of repos processed per workflow
	// run before continue-as-new keeps the event history bounded.
	catalogScanCANThreshold = 200
	// catalogScanParallelism bounds how many ScanRepoActivity run concurrently.
	catalogScanParallelism = 5
	// CatalogScanProgressQuery is the query name exposing running totals.
	CatalogScanProgressQuery = "scanProgress"
)

// CatalogScanWorkflowInput drives CatalogScanWorkflow. On the first invocation
// only InstallationID + WorkspaceID are set; the continue-as-new carry-over
// fields (RemainingRepos, ScanRunID, Totals) are populated on subsequent runs.
type CatalogScanWorkflowInput struct {
	InstallationID string `json:"installationId"`
	WorkspaceID    string `json:"workspaceId"`

	// RemainingRepos carries the not-yet-scanned repos across continue-as-new.
	// nil on the first invocation (the workflow enumerates repos itself).
	RemainingRepos []activities.RepoRef `json:"remainingRepos,omitempty"`
	// ScanRunID is the stable identifier for this whole scan, preserved across
	// continue-as-new so every repo's proposals share one scanRunId.
	ScanRunID string `json:"scanRunId,omitempty"`
	// Totals accumulates results across continue-as-new boundaries.
	Totals CatalogScanTotals `json:"totals,omitempty"`
}

// CatalogScanTotals accumulates scan results.
type CatalogScanTotals struct {
	ReposScanned int `json:"reposScanned"`
	ReposFailed  int `json:"reposFailed"`
	Proposed     int `json:"proposed"`
	Imported     int `json:"imported"`
}

// CatalogScanWorkflowResult is the terminal result (also queryable mid-run via
// CatalogScanProgressQuery).
type CatalogScanWorkflowResult struct {
	ReposScanned int    `json:"reposScanned"`
	ReposFailed  int    `json:"reposFailed"`
	Proposed     int    `json:"proposed"`
	Imported     int    `json:"imported"`
	ScanRunID    string `json:"scanRunId"`
}

// scanOutcome is the per-repo result collected by the fan-out coroutines.
type scanOutcome struct {
	res    activities.ScanRepoResult
	failed bool
}

// CatalogScanWorkflow enumerates a GitHub installation's repositories and scans
// each one for catalog-discovery evidence, fanning out ScanRepoActivity with
// bounded parallelism. It is partial-failure tolerant: a repo whose activity
// exhausts its retries is recorded as failed and skipped, never failing the
// whole scan. Past catalogScanCANThreshold repos it continues-as-new, carrying
// the remaining repo list and running totals so history stays bounded.
func CatalogScanWorkflow(ctx workflow.Context, input CatalogScanWorkflowInput) (CatalogScanWorkflowResult, error) {
	logger := workflow.GetLogger(ctx)

	// Stable scan run id: seed from the first run's RunID, then carry it across
	// every continue-as-new so all proposals belong to one logical scan.
	scanRunID := input.ScanRunID
	if scanRunID == "" {
		scanRunID = workflow.GetInfo(ctx).WorkflowExecution.RunID
	}

	totals := input.Totals

	// Expose running totals for the discovery UI's status banner.
	if err := workflow.SetQueryHandler(ctx, CatalogScanProgressQuery, func() (CatalogScanTotals, error) {
		return totals, nil
	}); err != nil {
		return CatalogScanWorkflowResult{}, err
	}

	scanOpts := workflow.ActivityOptions{
		StartToCloseTimeout: 5 * time.Minute,
		HeartbeatTimeout:    time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    2 * time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    30 * time.Second,
			MaximumAttempts:    4,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, scanOpts)

	// Nil pointer used only to reference the activity methods by name.
	var a *activities.CatalogScanActivities

	// 1. Enumerate repos on the first invocation only.
	repos := input.RemainingRepos
	if repos == nil {
		listOpts := workflow.ActivityOptions{
			StartToCloseTimeout: 10 * time.Minute,
			HeartbeatTimeout:    time.Minute,
			RetryPolicy: &temporal.RetryPolicy{
				InitialInterval:    2 * time.Second,
				BackoffCoefficient: 2.0,
				MaximumInterval:    time.Minute,
				MaximumAttempts:    5,
			},
		}
		listCtx := workflow.WithActivityOptions(ctx, listOpts)
		if err := workflow.ExecuteActivity(listCtx, a.ListInstallationReposActivity, activities.ListInstallationReposInput{
			InstallationID: input.InstallationID,
			WorkspaceID:    input.WorkspaceID,
		}).Get(listCtx, &repos); err != nil {
			logger.Error("list installation repos failed", "Error", err)
			return CatalogScanWorkflowResult{}, err
		}
		logger.Info("enumerated installation repos", "Count", len(repos), "ScanRunID", scanRunID)
	}

	// 2. Slice this run's batch; the rest rolls into continue-as-new.
	batch := repos
	var remaining []activities.RepoRef
	if len(batch) > catalogScanCANThreshold {
		remaining = append(remaining, batch[catalogScanCANThreshold:]...)
		batch = batch[:catalogScanCANThreshold]
	}

	// 3. Fan out ScanRepoActivity with bounded parallelism. The buffered
	//    channel acts as a semaphore: the dispatch loop acquires a slot before
	//    spawning each coroutine (blocking once catalogScanParallelism are in
	//    flight); each coroutine releases its slot on completion.
	sem := workflow.NewBufferedChannel(ctx, catalogScanParallelism)
	wg := workflow.NewWaitGroup(ctx)
	results := make([]scanOutcome, len(batch))

	for i := range batch {
		i := i
		repo := batch[i]
		sem.Send(ctx, struct{}{}) // acquire (blocks when parallelism is saturated)
		wg.Add(1)
		workflow.Go(ctx, func(gctx workflow.Context) {
			defer wg.Done()
			defer sem.Receive(gctx, nil) // release
			var res activities.ScanRepoResult
			err := workflow.ExecuteActivity(gctx, a.ScanRepoActivity, activities.ScanRepoInput{
				InstallationID: input.InstallationID,
				WorkspaceID:    input.WorkspaceID,
				Repo:           repo,
				ScanRunID:      scanRunID,
			}).Get(gctx, &res)
			if err != nil {
				workflow.GetLogger(gctx).Warn("repo scan failed; skipping",
					"Owner", repo.Owner, "Repo", repo.Name, "Error", err)
				results[i] = scanOutcome{failed: true}
				return
			}
			results[i] = scanOutcome{res: res}
		})
	}
	wg.Wait(ctx)

	// 4. Aggregate this batch into the running totals.
	for _, o := range results {
		if o.failed {
			totals.ReposFailed++
			continue
		}
		totals.ReposScanned++
		totals.Proposed += o.res.Proposed
		totals.Imported += o.res.Imported
	}

	// 5. Continue-as-new if repos remain; otherwise finish.
	if len(remaining) > 0 {
		logger.Info("continue-as-new with remaining repos",
			"Remaining", len(remaining), "ScannedSoFar", totals.ReposScanned)
		return CatalogScanWorkflowResult{}, workflow.NewContinueAsNewError(ctx, CatalogScanWorkflow, CatalogScanWorkflowInput{
			InstallationID: input.InstallationID,
			WorkspaceID:    input.WorkspaceID,
			RemainingRepos: remaining,
			ScanRunID:      scanRunID,
			Totals:         totals,
		})
	}

	result := CatalogScanWorkflowResult{
		ReposScanned: totals.ReposScanned,
		ReposFailed:  totals.ReposFailed,
		Proposed:     totals.Proposed,
		Imported:     totals.Imported,
		ScanRunID:    scanRunID,
	}
	logger.Info("catalog scan complete",
		"Scanned", result.ReposScanned,
		"Failed", result.ReposFailed,
		"Proposed", result.Proposed,
		"Imported", result.Imported,
	)
	return result, nil
}
