package workflows

import (
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// DeploymentWorkflowInput contains all parameters for deployment
type DeploymentWorkflowInput struct {
	DeploymentID  string                `json:"deploymentId"`
	AppID         string                `json:"appId"`
	WorkspaceID   string                `json:"workspaceId"`
	UserID        string                `json:"userId"`
	GeneratorType string                `json:"generatorType"`
	GeneratorSlug string                `json:"generatorSlug"`
	Config        []byte                `json:"config"`
	Target        DeploymentTargetInput `json:"target"`
}

// DeploymentTargetInput contains deployment target information
type DeploymentTargetInput struct {
	Type    string `json:"type"`
	Region  string `json:"region,omitempty"`
	Cluster string `json:"cluster,omitempty"`
	HostURL string `json:"hostUrl,omitempty"`
}

// DeploymentWorkflowResult contains the workflow result
type DeploymentWorkflowResult struct {
	Status        string `json:"status"` // completed, failed
	DeploymentURL string `json:"deploymentUrl,omitempty"`
	Error         string `json:"error,omitempty"`
}

// DeploymentProgress tracks workflow progress
type DeploymentProgress struct {
	CurrentStep  string `json:"currentStep"`
	StepsTotal   int    `json:"stepsTotal"`
	StepsCurrent int    `json:"stepsCurrent"`
	Message      string `json:"message"`
}

// ExecuteGeneratorResult contains generator execution result
type ExecuteGeneratorResult struct {
	Success       bool              `json:"success"`
	DeploymentURL string            `json:"deploymentUrl"`
	Outputs       map[string]string `json:"outputs"`
	Error         string            `json:"error,omitempty"`
}

// Activity names
const (
	ActivityValidateDeploymentConfig = "ValidateDeploymentConfig"
	ActivityPrepareGeneratorContext  = "PrepareGeneratorContext"
	ActivityExecuteGenerator         = "ExecuteGenerator"
	ActivityUpdateDeploymentStatus   = "UpdateDeploymentStatus"
	// ActivityCleanupWorkDir is already defined in template_instantiation_workflow.go
)

// DeploymentWorkflow orchestrates application deployment
func DeploymentWorkflow(ctx workflow.Context, input DeploymentWorkflowInput) (*DeploymentWorkflowResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting deployment workflow",
		"deploymentID", input.DeploymentID,
		"generatorType", input.GeneratorType)

	// Progress tracking
	progress := DeploymentProgress{
		CurrentStep:  "initializing",
		StepsTotal:   5,
		StepsCurrent: 0,
		Message:      "Starting deployment",
	}

	// Set up query handler
	err := workflow.SetQueryHandler(ctx, "progress", func() (DeploymentProgress, error) {
		return progress, nil
	})
	if err != nil {
		return &DeploymentWorkflowResult{
			Status: "failed",
			Error:  "failed to set up progress tracking: " + err.Error(),
		}, err
	}

	// Activity options
	activityOptions := workflow.ActivityOptions{
		StartToCloseTimeout: 15 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts: 3,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, activityOptions)

	// Helper to update status on failure
	updateStatusOnFailure := func(errMsg string) {
		statusInput := UpdateDeploymentStatusInput{
			DeploymentID: input.DeploymentID,
			Status:       "failed",
			ErrorMessage: errMsg,
		}
		_ = workflow.ExecuteActivity(ctx, ActivityUpdateDeploymentStatus, statusInput).Get(ctx, nil)
	}

	// Step 1: Update status to deploying
	progress.CurrentStep = "updating status"
	progress.StepsCurrent = 1
	progress.Message = "Initializing deployment"

	statusInput := UpdateDeploymentStatusInput{
		DeploymentID: input.DeploymentID,
		Status:       "deploying",
	}
	err = workflow.ExecuteActivity(ctx, ActivityUpdateDeploymentStatus, statusInput).Get(ctx, nil)
	if err != nil {
		logger.Error("Failed to update deployment status", "error", err)
		return &DeploymentWorkflowResult{
			Status: "failed",
			Error:  "failed to update status: " + err.Error(),
		}, err
	}

	// Step 2: Validate configuration
	progress.CurrentStep = "validating"
	progress.StepsCurrent = 2
	progress.Message = "Validating deployment configuration"

	validateInput := ValidateDeploymentConfigInput{
		GeneratorType: input.GeneratorType,
		Config:        input.Config,
	}
	err = workflow.ExecuteActivity(ctx, ActivityValidateDeploymentConfig, validateInput).Get(ctx, nil)
	if err != nil {
		logger.Error("Validation failed", "error", err)
		updateStatusOnFailure("validation failed: " + err.Error())
		return &DeploymentWorkflowResult{
			Status: "failed",
			Error:  "validation failed: " + err.Error(),
		}, nil
	}

	// Step 3: Prepare generator context
	progress.CurrentStep = "preparing"
	progress.StepsCurrent = 3
	progress.Message = "Preparing deployment files"

	prepareInput := PrepareGeneratorContextInput{
		DeploymentID:  input.DeploymentID,
		AppID:         input.AppID,
		GeneratorSlug: input.GeneratorSlug,
		Config:        input.Config,
	}
	var workDir string
	err = workflow.ExecuteActivity(ctx, ActivityPrepareGeneratorContext, prepareInput).Get(ctx, &workDir)
	if err != nil {
		logger.Error("Failed to prepare context", "error", err)
		updateStatusOnFailure("failed to prepare deployment: " + err.Error())
		return &DeploymentWorkflowResult{
			Status: "failed",
			Error:  "failed to prepare deployment: " + err.Error(),
		}, nil
	}

	// Step 4: Execute generator
	progress.CurrentStep = "deploying"
	progress.StepsCurrent = 4
	progress.Message = "Executing deployment"

	executeInput := ExecuteGeneratorInput{
		DeploymentID:  input.DeploymentID,
		GeneratorType: input.GeneratorType,
		WorkDir:       workDir,
		Target:        input.Target,
	}
	var executeResult ExecuteGeneratorResult
	err = workflow.ExecuteActivity(ctx, ActivityExecuteGenerator, executeInput).Get(ctx, &executeResult)

	// Cleanup work dir regardless of result
	_ = workflow.ExecuteActivity(ctx, ActivityCleanupWorkDir, workDir).Get(ctx, nil)

	if err != nil || !executeResult.Success {
		errMsg := "deployment execution failed"
		if err != nil {
			errMsg = err.Error()
		} else if executeResult.Error != "" {
			errMsg = executeResult.Error
		}
		logger.Error("Deployment failed", "error", errMsg)
		updateStatusOnFailure(errMsg)
		return &DeploymentWorkflowResult{
			Status: "failed",
			Error:  errMsg,
		}, nil
	}

	// Step 5: Update status to deployed
	progress.CurrentStep = "finalizing"
	progress.StepsCurrent = 5
	progress.Message = "Finalizing deployment"

	statusInput = UpdateDeploymentStatusInput{
		DeploymentID:  input.DeploymentID,
		Status:        "deployed",
		DeploymentURL: executeResult.DeploymentURL,
	}
	err = workflow.ExecuteActivity(ctx, ActivityUpdateDeploymentStatus, statusInput).Get(ctx, nil)
	if err != nil {
		logger.Error("Failed to update final status", "error", err)
	}

	progress.CurrentStep = "completed"
	progress.Message = "Deployment completed successfully"

	logger.Info("Deployment workflow completed",
		"deploymentID", input.DeploymentID,
		"url", executeResult.DeploymentURL)

	return &DeploymentWorkflowResult{
		Status:        "completed",
		DeploymentURL: executeResult.DeploymentURL,
	}, nil
}

// Activity input types
type ValidateDeploymentConfigInput struct {
	GeneratorType string `json:"generatorType"`
	Config        []byte `json:"config"`
}

type PrepareGeneratorContextInput struct {
	DeploymentID  string `json:"deploymentId"`
	AppID         string `json:"appId"`
	GeneratorSlug string `json:"generatorSlug"`
	Config        []byte `json:"config"`
}

type ExecuteGeneratorInput struct {
	DeploymentID  string                `json:"deploymentId"`
	GeneratorType string                `json:"generatorType"`
	WorkDir       string                `json:"workDir"`
	Target        DeploymentTargetInput `json:"target"`
}

type UpdateDeploymentStatusInput struct {
	DeploymentID  string `json:"deploymentId"`
	Status        string `json:"status"`
	DeploymentURL string `json:"deploymentUrl,omitempty"`
	ErrorMessage  string `json:"errorMessage,omitempty"`
}
