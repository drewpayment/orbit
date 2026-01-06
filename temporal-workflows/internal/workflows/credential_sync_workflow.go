// temporal-workflows/internal/workflows/credential_sync_workflow.go
package workflows

import (
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"

	"github.com/drewpayment/orbit/temporal-workflows/internal/activities"
)

// CredentialUpsertWorkflowInput contains input for upserting a credential
type CredentialUpsertWorkflowInput struct {
	CredentialID     string `json:"credentialId"`
	VirtualClusterID string `json:"virtualClusterId"`
	Username         string `json:"username"`
	PasswordHash     string `json:"passwordHash"`
	Template         string `json:"template"`
}

// CredentialUpsertWorkflowResult contains the result of the workflow
type CredentialUpsertWorkflowResult struct {
	Success bool   `json:"success"`
	Error   string `json:"error,omitempty"`
}

// CredentialUpsertWorkflow syncs a credential to Bifrost gateway
func CredentialUpsertWorkflow(ctx workflow.Context, input CredentialUpsertWorkflowInput) (*CredentialUpsertWorkflowResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting CredentialUpsertWorkflow", "credentialId", input.CredentialID)

	activityOptions := workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    30 * time.Second,
			MaximumAttempts:    5,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, activityOptions)

	var result activities.CredentialSyncResult
	err := workflow.ExecuteActivity(ctx, "SyncCredentialToBifrost", activities.CredentialSyncInput{
		CredentialID:     input.CredentialID,
		VirtualClusterID: input.VirtualClusterID,
		Username:         input.Username,
		PasswordHash:     input.PasswordHash,
		Template:         input.Template,
	}).Get(ctx, &result)

	if err != nil {
		logger.Error("Failed to sync credential to Bifrost", "error", err)
		return &CredentialUpsertWorkflowResult{
			Success: false,
			Error:   err.Error(),
		}, nil
	}

	logger.Info("CredentialUpsertWorkflow completed successfully")
	return &CredentialUpsertWorkflowResult{Success: true}, nil
}

// CredentialRevokeWorkflowInput contains input for revoking a credential
type CredentialRevokeWorkflowInput struct {
	CredentialID string `json:"credentialId"`
}

// CredentialRevokeWorkflowResult contains the result of the workflow
type CredentialRevokeWorkflowResult struct {
	Success bool   `json:"success"`
	Error   string `json:"error,omitempty"`
}

// CredentialRevokeWorkflow removes a credential from Bifrost gateway
func CredentialRevokeWorkflow(ctx workflow.Context, input CredentialRevokeWorkflowInput) (*CredentialRevokeWorkflowResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting CredentialRevokeWorkflow", "credentialId", input.CredentialID)

	// Use shorter timeout for revocation - we want this to be fast
	activityOptions := workflow.ActivityOptions{
		StartToCloseTimeout: 10 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    500 * time.Millisecond,
			BackoffCoefficient: 2.0,
			MaximumInterval:    5 * time.Second,
			MaximumAttempts:    10, // More retries for revocation
		},
	}
	ctx = workflow.WithActivityOptions(ctx, activityOptions)

	var result activities.CredentialRevokeResult
	err := workflow.ExecuteActivity(ctx, "RevokeCredentialFromBifrost", activities.CredentialRevokeInput{
		CredentialID: input.CredentialID,
	}).Get(ctx, &result)

	if err != nil {
		logger.Error("Failed to revoke credential from Bifrost", "error", err)
		return &CredentialRevokeWorkflowResult{
			Success: false,
			Error:   err.Error(),
		}, nil
	}

	logger.Info("CredentialRevokeWorkflow completed successfully")
	return &CredentialRevokeWorkflowResult{Success: true}, nil
}
