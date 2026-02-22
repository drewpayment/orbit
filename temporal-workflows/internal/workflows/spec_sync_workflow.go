package workflows

import (
	"fmt"
	"time"

	"go.temporal.io/sdk/log"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// SpecSyncInput contains all parameters needed for the spec sync workflow
type SpecSyncInput struct {
	AppID          string `json:"appId"`
	RepoFullName   string `json:"repoFullName"`
	InstallationID string `json:"installationId"`
	WorkspaceID    string `json:"workspaceId"`
}

// SpecSyncResult contains the workflow result
type SpecSyncResult struct {
	Status     string `json:"status"`
	SpecsFound int    `json:"specsFound"`
	Error      string `json:"error,omitempty"`
}

// SpecSyncProgress tracks workflow progress for query handler
type SpecSyncProgress struct {
	CurrentStep string `json:"currentStep"`
	Message     string `json:"message"`
	SpecsFound  int    `json:"specsFound"`
}

// WebhookPushSignal represents a webhook push event with changed file paths
type WebhookPushSignal struct {
	ChangedPaths []string `json:"changedPaths"`
	CommitSHA    string   `json:"commitSha"`
}

// SpecFileInfo describes a spec file discovered in a repository
type SpecFileInfo struct {
	Path     string `json:"path"`
	SpecType string `json:"specType"` // "openapi", "asyncapi", or "unknown"
}

// Activity input/output types

// ListSpecFilesInput is the input for the ListRepoSpecFiles activity
type ListSpecFilesInput struct {
	RepoFullName   string `json:"repoFullName"`
	InstallationID string `json:"installationId"`
}

// ListSpecFilesResult is the output of the ListRepoSpecFiles activity
type ListSpecFilesResult struct {
	Files []SpecFileInfo `json:"files"`
}

// FetchSpecContentInput is the input for the FetchSpecContent activity
type FetchSpecContentInput struct {
	RepoFullName   string `json:"repoFullName"`
	InstallationID string `json:"installationId"`
	FilePath       string `json:"filePath"`
	SpecType       string `json:"specType"`
}

// FetchSpecContentResult is the output of the FetchSpecContent activity
type FetchSpecContentResult struct {
	Content  string `json:"content"`
	FilePath string `json:"filePath"`
}

// UpsertSchemaInput contains the data needed to create or update an API schema
// in the catalog.
type UpsertSchemaInput struct {
	AppID          string `json:"appId"`
	WorkspaceID    string `json:"workspaceId"`
	FilePath       string `json:"filePath"`
	Content        string `json:"content"`
	SpecType       string `json:"specType"`
	RepoFullName   string `json:"repoFullName"`
	InstallationID string `json:"installationId"`
}

// UpsertSchemaResult contains the outcome of an upsert operation.
type UpsertSchemaResult struct {
	SchemaID string `json:"schemaId"`
	Created  bool   `json:"created"` // true if newly created, false if updated
}

// RemoveOrphanedSpecsInput is the input for the RemoveOrphanedSpecs activity
type RemoveOrphanedSpecsInput struct {
	AppID       string   `json:"appId"`
	WorkspaceID string   `json:"workspaceId"`
	ActivePaths []string `json:"activePaths"`
}

// Signal names
const (
	SignalScanForSpecs = "scan-for-specs"
	SignalWebhookPush  = "webhook-push"
	SignalForceResync  = "force-resync"
)

// Activity names - these must match the method names registered with the worker
const (
	ActivityListRepoSpecFiles   = "ListRepoSpecFiles"
	ActivityFetchSpecContent    = "FetchSpecContent"
	ActivityUpsertAPISchema     = "UpsertAPISchemaToCatalog"
	ActivityRemoveOrphanedSpecs = "RemoveOrphanedSpecs"
)

// RepositorySpecSyncWorkflow orchestrates the discovery and synchronization
// of API spec files from a repository into the API catalog. It performs an
// initial scan, then enters a long-running loop listening for signals to
// re-scan on webhook pushes or manual force-resync requests.
func RepositorySpecSyncWorkflow(ctx workflow.Context, input SpecSyncInput) (*SpecSyncResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting repository spec sync workflow",
		"appID", input.AppID,
		"repoFullName", input.RepoFullName)

	// Progress tracking
	progress := SpecSyncProgress{
		CurrentStep: "initializing",
		Message:     "Starting spec sync",
		SpecsFound:  0,
	}

	// Set up query handler for progress tracking
	err := workflow.SetQueryHandler(ctx, "progress", func() (SpecSyncProgress, error) {
		return progress, nil
	})
	if err != nil {
		logger.Error("Failed to set query handler", "error", err)
		return &SpecSyncResult{
			Status: "failed",
			Error:  "failed to set up progress tracking: " + err.Error(),
		}, err
	}

	// Activity options
	activityOptions := workflow.ActivityOptions{
		StartToCloseTimeout: 5 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts: 3,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, activityOptions)

	// Initial scan
	specsFound, scanErr := scanAndSync(ctx, input, &progress, logger)
	if scanErr != nil {
		return &SpecSyncResult{
			Status: "failed",
			Error:  "initial scan failed: " + scanErr.Error(),
		}, scanErr
	}

	// Set up signal channels
	scanCh := workflow.GetSignalChannel(ctx, SignalScanForSpecs)
	webhookCh := workflow.GetSignalChannel(ctx, SignalWebhookPush)
	resyncCh := workflow.GetSignalChannel(ctx, SignalForceResync)

	// Long-running signal loop
	for {
		selector := workflow.NewSelector(ctx)

		selector.AddReceive(scanCh, func(c workflow.ReceiveChannel, more bool) {
			var signal interface{}
			c.Receive(ctx, &signal)
			logger.Info("Received scan-for-specs signal")
			progress.CurrentStep = "scanning"
			progress.Message = "Re-scanning for spec files"
			found, err := scanAndSync(ctx, input, &progress, logger)
			if err != nil {
				logger.Error("Scan failed after signal", "error", err)
			} else {
				specsFound = found
			}
		})

		selector.AddReceive(webhookCh, func(c workflow.ReceiveChannel, more bool) {
			var signal WebhookPushSignal
			c.Receive(ctx, &signal)
			logger.Info("Received webhook-push signal",
				"commitSHA", signal.CommitSHA,
				"changedPaths", len(signal.ChangedPaths))
			progress.CurrentStep = "scanning"
			progress.Message = fmt.Sprintf("Processing webhook push %s", signal.CommitSHA)
			found, err := scanAndSync(ctx, input, &progress, logger)
			if err != nil {
				logger.Error("Scan failed after webhook push", "error", err)
			} else {
				specsFound = found
			}
		})

		selector.AddReceive(resyncCh, func(c workflow.ReceiveChannel, more bool) {
			var signal interface{}
			c.Receive(ctx, &signal)
			logger.Info("Received force-resync signal")
			progress.CurrentStep = "resyncing"
			progress.Message = "Force re-syncing all spec files"
			found, err := scanAndSync(ctx, input, &progress, logger)
			if err != nil {
				logger.Error("Force resync failed", "error", err)
			} else {
				specsFound = found
			}
		})

		selector.Select(ctx)

		// Update progress after processing
		progress.CurrentStep = "waiting"
		progress.Message = fmt.Sprintf("Idle, %d specs synced", specsFound)
	}
}

// scanAndSync discovers spec files in the repository, fetches their content,
// upserts them into the API catalog, and removes any orphaned specs.
func scanAndSync(
	ctx workflow.Context,
	input SpecSyncInput,
	progress *SpecSyncProgress,
	logger log.Logger,
) (int, error) {
	progress.CurrentStep = "listing"
	progress.Message = "Listing spec files in repository"

	// List spec files
	listInput := ListSpecFilesInput{
		RepoFullName:   input.RepoFullName,
		InstallationID: input.InstallationID,
	}
	var listResult ListSpecFilesResult
	err := workflow.ExecuteActivity(ctx, ActivityListRepoSpecFiles, listInput).Get(ctx, &listResult)
	if err != nil {
		logger.Error("Failed to list spec files", "error", err)
		return 0, err
	}

	logger.Info("Found spec files", "count", len(listResult.Files))
	progress.SpecsFound = len(listResult.Files)

	// Process each file
	activePaths := make([]string, 0, len(listResult.Files))
	specsProcessed := 0

	for _, file := range listResult.Files {
		progress.CurrentStep = "fetching"
		progress.Message = fmt.Sprintf("Fetching %s", file.Path)

		// Fetch content
		fetchInput := FetchSpecContentInput{
			RepoFullName:   input.RepoFullName,
			InstallationID: input.InstallationID,
			FilePath:       file.Path,
			SpecType:       file.SpecType,
		}
		var fetchResult FetchSpecContentResult
		err := workflow.ExecuteActivity(ctx, ActivityFetchSpecContent, fetchInput).Get(ctx, &fetchResult)
		if err != nil {
			logger.Error("Failed to fetch spec content, skipping", "path", file.Path, "error", err)
			continue
		}

		// Upsert to catalog
		progress.CurrentStep = "upserting"
		progress.Message = fmt.Sprintf("Upserting %s to catalog", file.Path)

		upsertInput := UpsertSchemaInput{
			AppID:          input.AppID,
			WorkspaceID:    input.WorkspaceID,
			FilePath:       file.Path,
			Content:        fetchResult.Content,
			SpecType:       file.SpecType,
			RepoFullName:   input.RepoFullName,
			InstallationID: input.InstallationID,
		}
		err = workflow.ExecuteActivity(ctx, ActivityUpsertAPISchema, upsertInput).Get(ctx, nil)
		if err != nil {
			logger.Error("Failed to upsert schema, skipping", "path", file.Path, "error", err)
			continue
		}

		activePaths = append(activePaths, file.Path)
		specsProcessed++
	}

	// Remove orphaned specs
	progress.CurrentStep = "cleaning"
	progress.Message = "Removing orphaned specs"

	removeInput := RemoveOrphanedSpecsInput{
		AppID:       input.AppID,
		WorkspaceID: input.WorkspaceID,
		ActivePaths: activePaths,
	}
	err = workflow.ExecuteActivity(ctx, ActivityRemoveOrphanedSpecs, removeInput).Get(ctx, nil)
	if err != nil {
		logger.Error("Failed to remove orphaned specs", "error", err)
		// Non-fatal: we still synced what we could
	}

	progress.CurrentStep = "completed"
	progress.Message = fmt.Sprintf("Synced %d spec files", specsProcessed)
	progress.SpecsFound = specsProcessed

	logger.Info("Spec sync completed", "specsProcessed", specsProcessed)
	return specsProcessed, nil
}
