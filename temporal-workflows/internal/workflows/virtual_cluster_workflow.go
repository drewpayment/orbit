package workflows

import (
	"fmt"
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

const (
	// VirtualClusterProvisioningTaskQueue is the task queue for virtual cluster workflows
	VirtualClusterProvisioningTaskQueue = "virtual-cluster-provisioning"
)

// VirtualClusterProvisionInput contains the input for provisioning virtual clusters
type VirtualClusterProvisionInput struct {
	ApplicationID   string `json:"applicationId"`
	ApplicationSlug string `json:"applicationSlug"`
	WorkspaceID     string `json:"workspaceId"`
	WorkspaceSlug   string `json:"workspaceSlug"`
}

// VirtualClusterProvisionResult contains the result of provisioning
type VirtualClusterProvisionResult struct {
	Success         bool     `json:"success"`
	VirtualClusters []string `json:"virtualClusterIds"`
	Error           string   `json:"error,omitempty"`
}

// GetEnvironmentMappingInput is the input for getting environment mapping
type GetEnvironmentMappingInput struct {
	Environment string `json:"environment"`
}

// GetEnvironmentMappingResult is the result of getting environment mapping
type GetEnvironmentMappingResult struct {
	ClusterID        string `json:"clusterId"`
	BootstrapServers string `json:"bootstrapServers"`
}

// CreateVirtualClusterInput is the input for creating a virtual cluster
type CreateVirtualClusterInput struct {
	ApplicationID     string `json:"applicationId"`
	ApplicationSlug   string `json:"applicationSlug"`
	WorkspaceSlug     string `json:"workspaceSlug"`
	Environment       string `json:"environment"`
	PhysicalClusterID string `json:"physicalClusterId"`
	BootstrapServers  string `json:"bootstrapServers"`
}

// CreateVirtualClusterResult is the result of creating a virtual cluster
type CreateVirtualClusterResult struct {
	VirtualClusterID string `json:"virtualClusterId"`
	TopicPrefix      string `json:"topicPrefix"`
	GroupPrefix      string `json:"groupPrefix"`
	AdvertisedHost   string `json:"advertisedHost"`
}

// PushToBifrostInput is the input for pushing config to Bifrost
type PushToBifrostInput struct {
	VirtualClusterID string `json:"virtualClusterId"`
	ApplicationID    string `json:"applicationId"`
	ApplicationSlug  string `json:"applicationSlug"`
	WorkspaceSlug    string `json:"workspaceSlug"`
	Environment      string `json:"environment"`
	TopicPrefix      string `json:"topicPrefix"`
	GroupPrefix      string `json:"groupPrefix"`
	AdvertisedHost   string `json:"advertisedHost"`
	BootstrapServers string `json:"bootstrapServers"`
}

// PushToBifrostResult is the result of pushing config to Bifrost
type PushToBifrostResult struct {
	Success bool `json:"success"`
}

// UpdateVirtualClusterStatusInput is the input for updating virtual cluster status
type UpdateVirtualClusterStatusInput struct {
	VirtualClusterID string `json:"virtualClusterId"`
	Status           string `json:"status"`
}

// UpdateApplicationProvisioningStatusInput is the input for updating application provisioning status
type UpdateApplicationProvisioningStatusInput struct {
	ApplicationID       string                 `json:"applicationId"`
	Status              string                 `json:"status"` // pending, in_progress, completed, partial, failed
	ErrorMessage        string                 `json:"errorMessage,omitempty"`
	WorkflowID          string                 `json:"workflowId,omitempty"`
	SetCompletedAt      bool                   `json:"setCompletedAt,omitempty"`
	ProvisioningDetails map[string]interface{} `json:"provisioningDetails,omitempty"`
}

// EnvironmentResult tracks the provisioning result for a single environment
type EnvironmentResult struct {
	Status  string `json:"status"` // success, failed, skipped
	Error   string `json:"error,omitempty"`
	Message string `json:"message,omitempty"`
}

// VirtualClusterProvisionWorkflow provisions three virtual clusters (dev, stage, prod)
// for a newly created Kafka application
func VirtualClusterProvisionWorkflow(ctx workflow.Context, input VirtualClusterProvisionInput) (*VirtualClusterProvisionResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting VirtualClusterProvisionWorkflow", "applicationId", input.ApplicationID)

	activityOptions := workflow.ActivityOptions{
		StartToCloseTimeout: 5 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    time.Minute,
			MaximumAttempts:    3,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, activityOptions)

	// Get workflow info for workflow ID
	workflowInfo := workflow.GetInfo(ctx)

	// Track per-environment results
	envResults := make(map[string]interface{})

	// Helper to update application provisioning status with details
	updateAppStatusWithDetails := func(status, errorMsg string, setCompletedAt bool, details map[string]interface{}) {
		err := workflow.ExecuteActivity(ctx, "UpdateApplicationProvisioningStatus", UpdateApplicationProvisioningStatusInput{
			ApplicationID:       input.ApplicationID,
			Status:              status,
			ErrorMessage:        errorMsg,
			WorkflowID:          workflowInfo.WorkflowExecution.ID,
			SetCompletedAt:      setCompletedAt,
			ProvisioningDetails: details,
		}).Get(ctx, nil)
		if err != nil {
			logger.Error("Failed to update application provisioning status", "status", status, "error", err)
		}
	}

	// Mark application as in_progress at start
	updateAppStatusWithDetails("in_progress", "", false, nil)

	environments := []string{"dev", "stage", "prod"}
	var virtualClusterIds []string
	successCount := 0
	failedCount := 0

	for _, env := range environments {
		// Step 1: Get environment mapping to find physical cluster
		var mappingResult GetEnvironmentMappingResult
		err := workflow.ExecuteActivity(ctx, "GetEnvironmentMapping", GetEnvironmentMappingInput{
			Environment: env,
		}).Get(ctx, &mappingResult)
		if err != nil {
			logger.Error("Failed to get environment mapping", "env", env, "error", err)
			envResults[env] = EnvironmentResult{
				Status: "failed",
				Error:  fmt.Sprintf("No environment mapping: %v", err),
			}
			failedCount++
			continue // Continue to next environment instead of failing entirely
		}

		if mappingResult.ClusterID == "" {
			logger.Warn("No cluster mapped for environment, skipping", "env", env)
			envResults[env] = EnvironmentResult{
				Status:  "skipped",
				Message: "No cluster mapped for this environment",
			}
			continue
		}

		// Step 2: Create virtual cluster in Payload
		var createResult CreateVirtualClusterResult
		err = workflow.ExecuteActivity(ctx, "CreateVirtualCluster", CreateVirtualClusterInput{
			ApplicationID:     input.ApplicationID,
			ApplicationSlug:   input.ApplicationSlug,
			WorkspaceSlug:     input.WorkspaceSlug,
			Environment:       env,
			PhysicalClusterID: mappingResult.ClusterID,
			BootstrapServers:  mappingResult.BootstrapServers,
		}).Get(ctx, &createResult)
		if err != nil {
			logger.Error("Failed to create virtual cluster", "env", env, "error", err)
			envResults[env] = EnvironmentResult{
				Status: "failed",
				Error:  fmt.Sprintf("Failed to create virtual cluster: %v", err),
			}
			failedCount++
			continue // Continue to next environment
		}

		virtualClusterIds = append(virtualClusterIds, createResult.VirtualClusterID)

		// Step 3: Push config to Bifrost gateway
		var pushResult PushToBifrostResult
		err = workflow.ExecuteActivity(ctx, "PushToBifrost", PushToBifrostInput{
			VirtualClusterID: createResult.VirtualClusterID,
			ApplicationID:    input.ApplicationID,
			ApplicationSlug:  input.ApplicationSlug,
			WorkspaceSlug:    input.WorkspaceSlug,
			Environment:      env,
			TopicPrefix:      createResult.TopicPrefix,
			GroupPrefix:      createResult.GroupPrefix,
			AdvertisedHost:   createResult.AdvertisedHost,
			BootstrapServers: mappingResult.BootstrapServers,
		}).Get(ctx, &pushResult)
		if err != nil {
			logger.Error("Failed to push config to Bifrost", "env", env, "error", err)
			// Don't fail the workflow, just log the error
			// The virtual cluster is created, Bifrost sync can retry
		}

		// Step 4: Update virtual cluster status to active
		err = workflow.ExecuteActivity(ctx, "UpdateVirtualClusterStatus", UpdateVirtualClusterStatusInput{
			VirtualClusterID: createResult.VirtualClusterID,
			Status:           "active",
		}).Get(ctx, nil)
		if err != nil {
			logger.Error("Failed to update virtual cluster status", "env", env, "error", err)
		}

		envResults[env] = EnvironmentResult{
			Status:  "success",
			Message: fmt.Sprintf("Virtual cluster created: %s", createResult.VirtualClusterID),
		}
		successCount++

		logger.Info("Provisioned virtual cluster", "env", env, "id", createResult.VirtualClusterID)
	}

	// Determine final status based on results
	var finalStatus string
	var errorMsg string

	if successCount == 0 && failedCount > 0 {
		// All environments that we tried to provision failed
		finalStatus = "failed"
		errorMsg = "All environments failed to provision"
	} else if failedCount > 0 && successCount > 0 {
		// Some succeeded, some failed = partial success
		finalStatus = "partial"
		errorMsg = fmt.Sprintf("%d environment(s) failed to provision", failedCount)
	} else {
		// All succeeded (or were skipped)
		finalStatus = "completed"
	}

	updateAppStatusWithDetails(finalStatus, errorMsg, finalStatus == "completed", envResults)

	logger.Info("VirtualClusterProvisionWorkflow completed",
		"clusters", len(virtualClusterIds),
		"status", finalStatus,
		"succeeded", successCount,
		"failed", failedCount)

	return &VirtualClusterProvisionResult{
		Success:         finalStatus == "completed",
		VirtualClusters: virtualClusterIds,
		Error:           errorMsg,
	}, nil
}
