package workflows

import (
	"fmt"
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

const (
	// ApplicationDecommissioningTaskQueue is the task queue for application decommissioning workflows
	ApplicationDecommissioningTaskQueue = "application-decommissioning"
)

// ApplicationDecommissioningInput contains the input for decommissioning an application
type ApplicationDecommissioningInput struct {
	ApplicationID     string    `json:"applicationId"`
	WorkspaceID       string    `json:"workspaceId"`
	GracePeriodEndsAt time.Time `json:"gracePeriodEndsAt"`
	ForceDelete       bool      `json:"forceDelete"`
	Reason            string    `json:"reason,omitempty"`
}

// ApplicationDecommissioningResult contains the result of decommissioning
type ApplicationDecommissioningResult struct {
	Success           bool   `json:"success"`
	CleanupWorkflowID string `json:"cleanupWorkflowId,omitempty"`
	Error             string `json:"error,omitempty"`
}

// SetVirtualClustersReadOnlyInput is the input for setting virtual clusters to read-only mode
type SetVirtualClustersReadOnlyInput struct {
	ApplicationID string `json:"applicationId"`
	WorkspaceID   string `json:"workspaceId"`
	Reason        string `json:"reason,omitempty"`
}

// SetVirtualClustersReadOnlyResult is the result of setting virtual clusters to read-only mode
type SetVirtualClustersReadOnlyResult struct {
	Success                  bool     `json:"success"`
	UpdatedVirtualClusterIDs []string `json:"updatedVirtualClusterIds"`
	Error                    string   `json:"error,omitempty"`
}

// ScheduleCleanupWorkflowInput is the input for scheduling a cleanup workflow
type ScheduleCleanupWorkflowInput struct {
	ApplicationID     string    `json:"applicationId"`
	WorkspaceID       string    `json:"workspaceId"`
	GracePeriodEndsAt time.Time `json:"gracePeriodEndsAt"`
	Reason            string    `json:"reason,omitempty"`
}

// ScheduleCleanupWorkflowResult is the result of scheduling a cleanup workflow
type ScheduleCleanupWorkflowResult struct {
	WorkflowID string `json:"workflowId"`
	Success    bool   `json:"success"`
	Error      string `json:"error,omitempty"`
}

// UpdateApplicationWorkflowIDInput is the input for updating an application's workflow ID
type UpdateApplicationWorkflowIDInput struct {
	ApplicationID          string `json:"applicationId"`
	DecommissionWorkflowID string `json:"decommissionWorkflowId"`
	CleanupWorkflowID      string `json:"cleanupWorkflowId,omitempty"`
}

// ExecuteCleanupInput is the input for executing immediate cleanup (force delete)
type ExecuteCleanupInput struct {
	ApplicationID string `json:"applicationId"`
	WorkspaceID   string `json:"workspaceId"`
	Reason        string `json:"reason,omitempty"`
}

// ExecuteCleanupResult is the result of executing immediate cleanup
type ExecuteCleanupResult struct {
	Success             bool     `json:"success"`
	DeletedResources    []string `json:"deletedResources"`
	DeletedTopics       []string `json:"deletedTopics"`
	DeletedCredentials  []string `json:"deletedCredentials"`
	DeletedVirtualClusters []string `json:"deletedVirtualClusters"`
	Error               string   `json:"error,omitempty"`
}

// MarkApplicationDeletedInput is the input for marking an application as deleted
type MarkApplicationDeletedInput struct {
	ApplicationID string    `json:"applicationId"`
	DeletedAt     time.Time `json:"deletedAt"`
	Reason        string    `json:"reason,omitempty"`
}

// ApplicationDecommissioningWorkflow orchestrates the decommissioning of a Kafka application.
// It sets all virtual clusters to read-only mode and either schedules cleanup for after the
// grace period (normal decommissioning) or executes immediate cleanup (force delete).
func ApplicationDecommissioningWorkflow(ctx workflow.Context, input ApplicationDecommissioningInput) (*ApplicationDecommissioningResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting ApplicationDecommissioningWorkflow",
		"applicationId", input.ApplicationID,
		"workspaceId", input.WorkspaceID,
		"forceDelete", input.ForceDelete,
		"gracePeriodEndsAt", input.GracePeriodEndsAt,
	)

	// Configure activity options with retry policy
	activityOptions := workflow.ActivityOptions{
		StartToCloseTimeout: 5 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    time.Minute,
			MaximumAttempts:    5,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, activityOptions)

	// Step 1: Set all virtual clusters to read-only mode
	logger.Info("Step 1: Setting virtual clusters to read-only mode")
	var readOnlyResult SetVirtualClustersReadOnlyResult
	err := workflow.ExecuteActivity(ctx, "SetVirtualClustersReadOnly", SetVirtualClustersReadOnlyInput{
		ApplicationID: input.ApplicationID,
		WorkspaceID:   input.WorkspaceID,
		Reason:        input.Reason,
	}).Get(ctx, &readOnlyResult)
	if err != nil {
		logger.Error("Failed to set virtual clusters to read-only", "error", err)
		return &ApplicationDecommissioningResult{
			Success: false,
			Error:   fmt.Sprintf("Failed to set virtual clusters to read-only: %v", err),
		}, nil
	}

	if !readOnlyResult.Success {
		logger.Error("SetVirtualClustersReadOnly returned failure", "error", readOnlyResult.Error)
		return &ApplicationDecommissioningResult{
			Success: false,
			Error:   readOnlyResult.Error,
		}, nil
	}

	logger.Info("Virtual clusters set to read-only",
		"updatedCount", len(readOnlyResult.UpdatedVirtualClusterIDs))

	// Branch based on force delete vs normal decommissioning
	if input.ForceDelete {
		// Force delete path: Execute immediate cleanup
		logger.Info("Step 2: Executing immediate cleanup (force delete)")
		var cleanupResult ExecuteCleanupResult
		err = workflow.ExecuteActivity(ctx, "ExecuteImmediateCleanup", ExecuteCleanupInput{
			ApplicationID: input.ApplicationID,
			WorkspaceID:   input.WorkspaceID,
			Reason:        input.Reason,
		}).Get(ctx, &cleanupResult)
		if err != nil {
			logger.Error("Failed to execute immediate cleanup", "error", err)
			return &ApplicationDecommissioningResult{
				Success: false,
				Error:   fmt.Sprintf("Failed to execute immediate cleanup: %v", err),
			}, nil
		}

		if !cleanupResult.Success {
			logger.Error("ExecuteImmediateCleanup returned failure", "error", cleanupResult.Error)
			return &ApplicationDecommissioningResult{
				Success: false,
				Error:   cleanupResult.Error,
			}, nil
		}

		logger.Info("Immediate cleanup completed",
			"deletedTopics", len(cleanupResult.DeletedTopics),
			"deletedCredentials", len(cleanupResult.DeletedCredentials),
			"deletedVirtualClusters", len(cleanupResult.DeletedVirtualClusters))

		// Step 3: Mark application as deleted
		logger.Info("Step 3: Marking application as deleted")
		err = workflow.ExecuteActivity(ctx, "MarkApplicationDeleted", MarkApplicationDeletedInput{
			ApplicationID: input.ApplicationID,
			DeletedAt:     workflow.Now(ctx),
			Reason:        input.Reason,
		}).Get(ctx, nil)
		if err != nil {
			logger.Error("Failed to mark application as deleted", "error", err)
			// Don't fail the workflow - cleanup was successful
		}

		logger.Info("ApplicationDecommissioningWorkflow completed (force delete)",
			"applicationId", input.ApplicationID)
		return &ApplicationDecommissioningResult{
			Success: true,
		}, nil
	}

	// Normal decommissioning path: Schedule cleanup workflow for grace period end
	logger.Info("Step 2: Scheduling cleanup workflow for grace period end",
		"gracePeriodEndsAt", input.GracePeriodEndsAt)
	var scheduleResult ScheduleCleanupWorkflowResult
	err = workflow.ExecuteActivity(ctx, "ScheduleCleanupWorkflow", ScheduleCleanupWorkflowInput{
		ApplicationID:     input.ApplicationID,
		WorkspaceID:       input.WorkspaceID,
		GracePeriodEndsAt: input.GracePeriodEndsAt,
		Reason:            input.Reason,
	}).Get(ctx, &scheduleResult)
	if err != nil {
		logger.Error("Failed to schedule cleanup workflow", "error", err)
		return &ApplicationDecommissioningResult{
			Success: false,
			Error:   fmt.Sprintf("Failed to schedule cleanup workflow: %v", err),
		}, nil
	}

	if !scheduleResult.Success {
		logger.Error("ScheduleCleanupWorkflow returned failure", "error", scheduleResult.Error)
		return &ApplicationDecommissioningResult{
			Success: false,
			Error:   scheduleResult.Error,
		}, nil
	}

	logger.Info("Cleanup workflow scheduled", "cleanupWorkflowId", scheduleResult.WorkflowID)

	// Step 3: Update application with cleanup workflow ID
	logger.Info("Step 3: Updating application with cleanup workflow ID")
	err = workflow.ExecuteActivity(ctx, "UpdateApplicationWorkflowID", UpdateApplicationWorkflowIDInput{
		ApplicationID:          input.ApplicationID,
		DecommissionWorkflowID: workflow.GetInfo(ctx).WorkflowExecution.ID,
		CleanupWorkflowID:      scheduleResult.WorkflowID,
	}).Get(ctx, nil)
	if err != nil {
		logger.Error("Failed to update application workflow ID", "error", err)
		// Don't fail the workflow - cleanup is scheduled, this is just metadata
	}

	logger.Info("ApplicationDecommissioningWorkflow completed (scheduled cleanup)",
		"applicationId", input.ApplicationID,
		"cleanupWorkflowId", scheduleResult.WorkflowID)
	return &ApplicationDecommissioningResult{
		Success:           true,
		CleanupWorkflowID: scheduleResult.WorkflowID,
	}, nil
}
