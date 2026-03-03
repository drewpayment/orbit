package workflows

import (
	"fmt"
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"

	"github.com/drewpayment/orbit/temporal-workflows/pkg/types"
)

// Signal names for LaunchWorkflow
const (
	ApprovalSignal = "ApprovalSignal"
	DeorbitSignal  = "DeorbitSignal"
	AbortSignal    = "AbortSignal"
)

// Query name
const (
	GetLaunchProgress = "GetLaunchProgress"
)

// Activity names
const (
	ActivityValidateLaunchInputs = "ValidateLaunchInputs"
	ActivityUpdateLaunchStatus   = "UpdateLaunchStatus"
	ActivityStoreLaunchOutputs   = "StoreLaunchOutputs"
	ActivityProvisionInfra       = "provisionInfra"
	ActivityDestroyInfra         = "destroyInfra"
)

// taskQueueForProvider returns the task queue name for a given cloud provider.
func taskQueueForProvider(provider string) string {
	return fmt.Sprintf("launches_%s", provider)
}

// LaunchWorkflow orchestrates infrastructure provisioning, lifecycle management,
// and teardown for a Launch. It follows the Entity Workflow pattern: the workflow
// stays open while infrastructure is active, listening for lifecycle signals.
func LaunchWorkflow(ctx workflow.Context, input types.LaunchWorkflowInput) error {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting launch workflow",
		"launchId", input.LaunchID,
		"template", input.TemplateSlug,
		"provider", input.Provider,
	)

	// Progress tracking
	progress := types.LaunchProgress{
		Status:      "initializing",
		CurrentStep: 0,
		TotalSteps:  5,
		Message:     "Starting launch workflow",
		Percentage:  0,
		Logs:        []string{"Workflow started"},
	}

	// Set up query handler
	err := workflow.SetQueryHandler(ctx, GetLaunchProgress, func() (types.LaunchProgress, error) {
		return progress, nil
	})
	if err != nil {
		return fmt.Errorf("failed to set up progress query handler: %w", err)
	}

	// --- Activity options ---

	// Local activity options: short timeout for validation
	localActivityOptions := workflow.LocalActivityOptions{
		StartToCloseTimeout: 30 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts: 3,
		},
	}
	localCtx := workflow.WithLocalActivityOptions(ctx, localActivityOptions)

	// Update activity options: for Payload CMS status updates
	updateActivityOptions := workflow.ActivityOptions{
		StartToCloseTimeout: 15 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts: 5,
		},
	}
	updateCtx := workflow.WithActivityOptions(ctx, updateActivityOptions)

	// Provision activity options: long timeout for Pulumi operations on provider task queue
	provisionActivityOptions := workflow.ActivityOptions{
		StartToCloseTimeout: 60 * time.Minute,
		HeartbeatTimeout:    30 * time.Second,
		TaskQueue:           taskQueueForProvider(input.Provider),
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts: 2,
		},
	}
	provisionCtx := workflow.WithActivityOptions(ctx, provisionActivityOptions)

	// Helper to update status on failure
	updateStatusOnFailure := func(errMsg string) {
		statusInput := types.UpdateLaunchStatusInput{
			LaunchID: input.LaunchID,
			Status:   "failed",
			Error:    errMsg,
		}
		_ = workflow.ExecuteActivity(updateCtx, ActivityUpdateLaunchStatus, statusInput).Get(updateCtx, nil)
	}

	// Cleanup on cancellation: destroy infra and set status to aborted
	defer func() {
		if ctx.Err() != nil {
			// Context was cancelled — use a disconnected context for cleanup
			disconnectedCtx, _ := workflow.NewDisconnectedContext(ctx)
			cleanupProvisionCtx := workflow.WithActivityOptions(disconnectedCtx, provisionActivityOptions)
			cleanupUpdateCtx := workflow.WithActivityOptions(disconnectedCtx, updateActivityOptions)

			stackName := fmt.Sprintf("orbit-%s-%s", input.WorkspaceID, input.LaunchID)
			destroyInput := types.DestroyInfraInput{
				LaunchID:       input.LaunchID,
				StackName:      stackName,
				TemplatePath:   input.PulumiProjectPath,
				CloudAccountID: input.CloudAccountID,
				Provider:       input.Provider,
				Region:         input.Region,
			}

			logger.Info("Cancellation detected, destroying infrastructure", "launchId", input.LaunchID)
			_ = workflow.ExecuteActivity(cleanupProvisionCtx, ActivityDestroyInfra, destroyInput).Get(cleanupProvisionCtx, nil)

			abortStatus := types.UpdateLaunchStatusInput{
				LaunchID: input.LaunchID,
				Status:   "aborted",
			}
			_ = workflow.ExecuteActivity(cleanupUpdateCtx, ActivityUpdateLaunchStatus, abortStatus).Get(cleanupUpdateCtx, nil)
		}
	}()

	// ==========================================
	// Step 1: Validate Inputs (local activity)
	// ==========================================
	progress.CurrentStep = 1
	progress.Status = "validating"
	progress.Message = "Validating launch inputs"
	progress.Percentage = 10
	progress.Logs = append(progress.Logs, "Validating inputs")

	err = workflow.ExecuteLocalActivity(localCtx, ActivityValidateLaunchInputs, input).Get(localCtx, nil)
	if err != nil {
		logger.Error("Validation failed", "error", err)
		updateStatusOnFailure("validation failed: " + err.Error())
		return fmt.Errorf("validation failed: %w", err)
	}
	progress.Logs = append(progress.Logs, "Inputs validated successfully")

	// ==========================================
	// Step 2: Approval Gate (conditional)
	// ==========================================
	if input.ApprovalRequired {
		progress.CurrentStep = 2
		progress.Status = "awaiting_approval"
		progress.Message = "Waiting for approval"
		progress.Percentage = 20
		progress.Logs = append(progress.Logs, "Approval required — waiting for signal")

		// Update status to awaiting_approval
		statusInput := types.UpdateLaunchStatusInput{
			LaunchID: input.LaunchID,
			Status:   "awaiting_approval",
		}
		err = workflow.ExecuteActivity(updateCtx, ActivityUpdateLaunchStatus, statusInput).Get(updateCtx, nil)
		if err != nil {
			logger.Error("Failed to update status to awaiting_approval", "error", err)
			return fmt.Errorf("failed to update status: %w", err)
		}

		// Wait for approval signal or timeout
		approvalCh := workflow.GetSignalChannel(ctx, ApprovalSignal)
		timerFuture := workflow.NewTimer(ctx, 24*time.Hour)

		selector := workflow.NewSelector(ctx)
		var approvalInput types.ApprovalSignalInput
		approved := false
		timedOut := false

		selector.AddReceive(approvalCh, func(c workflow.ReceiveChannel, more bool) {
			c.Receive(ctx, &approvalInput)
			approved = approvalInput.Approved
		})

		selector.AddFuture(timerFuture, func(f workflow.Future) {
			timedOut = true
		})

		selector.Select(ctx)

		if timedOut || !approved {
			reason := "approval rejected"
			if timedOut {
				reason = "approval timed out after 24 hours"
			}
			progress.Status = "aborted"
			progress.Message = reason
			progress.Logs = append(progress.Logs, reason)

			abortStatus := types.UpdateLaunchStatusInput{
				LaunchID: input.LaunchID,
				Status:   "aborted",
				Error:    reason,
			}
			_ = workflow.ExecuteActivity(updateCtx, ActivityUpdateLaunchStatus, abortStatus).Get(updateCtx, nil)

			logger.Info("Launch aborted at approval gate", "reason", reason, "launchId", input.LaunchID)
			return nil
		}

		logger.Info("Launch approved", "approvedBy", approvalInput.ApprovedBy, "launchId", input.LaunchID)
		progress.Logs = append(progress.Logs, fmt.Sprintf("Approved by %s", approvalInput.ApprovedBy))
	}

	// ==========================================
	// Step 3: Provision Infrastructure
	// ==========================================
	progress.CurrentStep = 3
	progress.Status = "launching"
	progress.Message = "Provisioning infrastructure"
	progress.Percentage = 40
	progress.Logs = append(progress.Logs, "Starting infrastructure provisioning")

	// Update status to launching
	launchingStatus := types.UpdateLaunchStatusInput{
		LaunchID: input.LaunchID,
		Status:   "launching",
	}
	err = workflow.ExecuteActivity(updateCtx, ActivityUpdateLaunchStatus, launchingStatus).Get(updateCtx, nil)
	if err != nil {
		logger.Error("Failed to update status to launching", "error", err)
		return fmt.Errorf("failed to update status: %w", err)
	}

	stackName := fmt.Sprintf("orbit-%s-%s", input.WorkspaceID, input.LaunchID)
	provisionInput := types.ProvisionInfraInput{
		LaunchID:       input.LaunchID,
		StackName:      stackName,
		TemplatePath:   input.PulumiProjectPath,
		CloudAccountID: input.CloudAccountID,
		Provider:       input.Provider,
		Region:         input.Region,
		Parameters:     input.Parameters,
	}

	var provisionResult types.ProvisionInfraResult
	err = workflow.ExecuteActivity(provisionCtx, ActivityProvisionInfra, provisionInput).Get(provisionCtx, &provisionResult)
	if err != nil {
		logger.Error("Infrastructure provisioning failed", "error", err)
		updateStatusOnFailure("provisioning failed: " + err.Error())
		return fmt.Errorf("provisioning failed: %w", err)
	}
	progress.Logs = append(progress.Logs, "Infrastructure provisioned successfully")

	// ==========================================
	// Step 4: Store Outputs + Update Status
	// ==========================================
	progress.CurrentStep = 4
	progress.Status = "active"
	progress.Message = "Storing outputs and activating"
	progress.Percentage = 80
	progress.Logs = append(progress.Logs, "Storing infrastructure outputs")

	// Store outputs
	storeInput := types.StoreLaunchOutputsInput{
		LaunchID: input.LaunchID,
		Outputs:  provisionResult.Outputs,
	}
	err = workflow.ExecuteActivity(updateCtx, ActivityStoreLaunchOutputs, storeInput).Get(updateCtx, nil)
	if err != nil {
		logger.Error("Failed to store launch outputs", "error", err)
		updateStatusOnFailure("failed to store outputs: " + err.Error())
		return fmt.Errorf("failed to store outputs: %w", err)
	}

	// Update status to active
	activeStatus := types.UpdateLaunchStatusInput{
		LaunchID: input.LaunchID,
		Status:   "active",
	}
	err = workflow.ExecuteActivity(updateCtx, ActivityUpdateLaunchStatus, activeStatus).Get(updateCtx, nil)
	if err != nil {
		logger.Error("Failed to update status to active", "error", err)
		return fmt.Errorf("failed to update status: %w", err)
	}

	progress.CurrentStep = 5
	progress.Percentage = 100
	progress.Message = "Infrastructure active — waiting for lifecycle signals"
	progress.Logs = append(progress.Logs, "Launch is active")

	// ==========================================
	// Entity Phase: Wait for Lifecycle Signals
	// ==========================================
	logger.Info("Launch active, waiting for lifecycle signals", "launchId", input.LaunchID)

	deorbitCh := workflow.GetSignalChannel(ctx, DeorbitSignal)
	abortCh := workflow.GetSignalChannel(ctx, AbortSignal)

	selector := workflow.NewSelector(ctx)

	var deorbitInput types.DeorbitSignalInput
	var abortInput types.AbortSignalInput

	selector.AddReceive(deorbitCh, func(c workflow.ReceiveChannel, more bool) {
		c.Receive(ctx, &deorbitInput)
		logger.Info("Deorbit signal received", "requestedBy", deorbitInput.RequestedBy, "reason", deorbitInput.Reason)
		progress.Logs = append(progress.Logs, fmt.Sprintf("Deorbit requested by %s: %s", deorbitInput.RequestedBy, deorbitInput.Reason))
	})

	selector.AddReceive(abortCh, func(c workflow.ReceiveChannel, more bool) {
		c.Receive(ctx, &abortInput)
		logger.Info("Abort signal received", "requestedBy", abortInput.RequestedBy)
		progress.Logs = append(progress.Logs, fmt.Sprintf("Abort requested by %s", abortInput.RequestedBy))
	})

	// Block until either signal is received
	selector.Select(ctx)

	// ==========================================
	// Deorbit Flow
	// ==========================================
	progress.Status = "deorbiting"
	progress.Message = "Tearing down infrastructure"
	progress.Logs = append(progress.Logs, "Starting infrastructure teardown")

	deorbitingStatus := types.UpdateLaunchStatusInput{
		LaunchID: input.LaunchID,
		Status:   "deorbiting",
	}
	err = workflow.ExecuteActivity(updateCtx, ActivityUpdateLaunchStatus, deorbitingStatus).Get(updateCtx, nil)
	if err != nil {
		logger.Error("Failed to update status to deorbiting", "error", err)
	}

	destroyInput := types.DestroyInfraInput{
		LaunchID:       input.LaunchID,
		StackName:      stackName,
		TemplatePath:   input.PulumiProjectPath,
		CloudAccountID: input.CloudAccountID,
		Provider:       input.Provider,
		Region:         input.Region,
	}
	err = workflow.ExecuteActivity(provisionCtx, ActivityDestroyInfra, destroyInput).Get(provisionCtx, nil)
	if err != nil {
		logger.Error("Infrastructure destruction failed", "error", err)
		updateStatusOnFailure("deorbit failed: " + err.Error())
		return fmt.Errorf("deorbit failed: %w", err)
	}

	// Update status to deorbited
	deorbitedStatus := types.UpdateLaunchStatusInput{
		LaunchID: input.LaunchID,
		Status:   "deorbited",
	}
	err = workflow.ExecuteActivity(updateCtx, ActivityUpdateLaunchStatus, deorbitedStatus).Get(updateCtx, nil)
	if err != nil {
		logger.Error("Failed to update status to deorbited", "error", err)
	}

	progress.Status = "deorbited"
	progress.Message = "Infrastructure successfully torn down"
	progress.Logs = append(progress.Logs, "Deorbit complete")

	logger.Info("Launch workflow completed — infrastructure deorbited", "launchId", input.LaunchID)
	return nil
}
