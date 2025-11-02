package workflows

import (
	"context"
	"time"

	"github.com/drewpayment/orbit/temporal-workflows/internal/activities"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// Activity function stubs - these will be replaced with actual implementations when registering with worker
var (
	validateSchemaActivityStub = func(ctx context.Context, input activities.ValidateSchemaInput) error {
		panic("validateSchemaActivityStub not implemented - register actual activity implementation")
	}
	generateCodeActivityStub = func(ctx context.Context, input activities.GenerateCodeInput) (map[string]string, error) {
		panic("generateCodeActivityStub not implemented - register actual activity implementation")
	}
	packageArtifactsActivityStub = func(ctx context.Context, input activities.PackageArtifactsInput) (map[string][]byte, error) {
		panic("packageArtifactsActivityStub not implemented - register actual activity implementation")
	}
	uploadArtifactsActivityStub = func(ctx context.Context, input activities.UploadArtifactsInput) (map[string]string, error) {
		panic("uploadArtifactsActivityStub not implemented - register actual activity implementation")
	}
)

// CodeGenerationWorkflowInput defines the input parameters for the code generation workflow
type CodeGenerationWorkflowInput struct {
	WorkspaceID   string
	SchemaID      string
	SchemaType    string   // "protobuf", "openapi", "graphql"
	SchemaContent string
	Languages     []string // ["go", "typescript", "python", "java"]
}

// CodeGenerationWorkflowResult defines the output of the code generation workflow
type CodeGenerationWorkflowResult struct {
	SchemaID     string
	DownloadURLs map[string]string // language -> download URL
	Status       string
}

// CodeGenerationWorkflow orchestrates the generation of API client libraries from schemas
func CodeGenerationWorkflow(ctx workflow.Context, input CodeGenerationWorkflowInput) (CodeGenerationWorkflowResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting code generation workflow",
		"WorkspaceID", input.WorkspaceID,
		"SchemaID", input.SchemaID,
		"SchemaType", input.SchemaType,
		"Languages", input.Languages,
	)

	// Configure activity options with retry policy
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

	// Step 1: Validate schema syntax
	logger.Info("Step 1: Validating schema", "SchemaType", input.SchemaType)
	validateInput := activities.ValidateSchemaInput{
		SchemaType:    input.SchemaType,
		SchemaContent: input.SchemaContent,
	}
	err := workflow.ExecuteActivity(ctx, validateSchemaActivityStub, validateInput).Get(ctx, nil)
	if err != nil {
		logger.Error("Failed to validate schema", "Error", err)
		return CodeGenerationWorkflowResult{
			SchemaID: input.SchemaID,
			Status:   "failed",
		}, err
	}

	// Step 2: Generate code for target languages
	logger.Info("Step 2: Generating code", "Languages", input.Languages)
	generateInput := activities.GenerateCodeInput{
		SchemaType:    input.SchemaType,
		SchemaContent: input.SchemaContent,
		Languages:     input.Languages,
	}
	var generatedCode map[string]string
	err = workflow.ExecuteActivity(ctx, generateCodeActivityStub, generateInput).Get(ctx, &generatedCode)
	if err != nil {
		logger.Error("Failed to generate code", "Error", err)
		return CodeGenerationWorkflowResult{
			SchemaID: input.SchemaID,
			Status:   "failed",
		}, err
	}

	// Step 3: Package generated code into distributable artifacts
	logger.Info("Step 3: Packaging artifacts", "CodeCount", len(generatedCode))
	packageInput := activities.PackageArtifactsInput{
		Code: generatedCode,
	}
	var packages map[string][]byte
	err = workflow.ExecuteActivity(ctx, packageArtifactsActivityStub, packageInput).Get(ctx, &packages)
	if err != nil {
		logger.Error("Failed to package artifacts", "Error", err)
		return CodeGenerationWorkflowResult{
			SchemaID: input.SchemaID,
			Status:   "failed",
		}, err
	}

	// Step 4: Upload artifacts to storage
	logger.Info("Step 4: Uploading artifacts", "PackageCount", len(packages))
	uploadInput := activities.UploadArtifactsInput{
		Packages:    packages,
		WorkspaceID: input.WorkspaceID,
		SchemaID:    input.SchemaID,
	}
	var downloadURLs map[string]string
	err = workflow.ExecuteActivity(ctx, uploadArtifactsActivityStub, uploadInput).Get(ctx, &downloadURLs)
	if err != nil {
		logger.Error("Failed to upload artifacts", "Error", err)
		return CodeGenerationWorkflowResult{
			SchemaID: input.SchemaID,
			Status:   "failed",
		}, err
	}

	logger.Info("Code generation workflow completed successfully")
	return CodeGenerationWorkflowResult{
		SchemaID:     input.SchemaID,
		DownloadURLs: downloadURLs,
		Status:       "completed",
	}, nil
}
