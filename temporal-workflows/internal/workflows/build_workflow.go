package workflows

import (
	"fmt"
	"time"

	"github.com/drewpayment/orbit/temporal-workflows/pkg/types"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// BuildWorkflowInput contains all parameters for image building
type BuildWorkflowInput struct {
	RequestID   string              `json:"requestId"`
	AppID       string              `json:"appId"`
	WorkspaceID string              `json:"workspaceId"`
	UserID      string              `json:"userId"`
	RepoURL     string              `json:"repoUrl"`
	Ref         string              `json:"ref"`
	Registry    BuildRegistryConfig `json:"registry"`
	// Optional overrides
	LanguageVersion string            `json:"languageVersion,omitempty"`
	BuildCommand    string            `json:"buildCommand,omitempty"`
	StartCommand    string            `json:"startCommand,omitempty"`
	BuildEnv        map[string]string `json:"buildEnv,omitempty"`
	ImageTag        string            `json:"imageTag,omitempty"`
}

type BuildRegistryConfig struct {
	Type       string `json:"type"` // "ghcr" or "acr"
	URL        string `json:"url"`
	Repository string `json:"repository"`
	Token      string `json:"token"`
	Username   string `json:"username,omitempty"` // For ACR
}

type BuildWorkflowResult struct {
	Status         string               `json:"status"` // analyzing, building, success, failed
	ImageURL       string               `json:"imageUrl,omitempty"`
	ImageDigest    string               `json:"imageDigest,omitempty"`
	Error          string               `json:"error,omitempty"`
	DetectedConfig *DetectedBuildConfig `json:"detectedConfig,omitempty"`
}

type DetectedBuildConfig struct {
	Language        string `json:"language"`
	LanguageVersion string `json:"languageVersion"`
	Framework       string `json:"framework"`
	BuildCommand    string `json:"buildCommand"`
	StartCommand    string `json:"startCommand"`
}

type BuildProgress struct {
	CurrentStep  string `json:"currentStep"`
	StepsTotal   int    `json:"stepsTotal"`
	StepsCurrent int    `json:"stepsCurrent"`
	Message      string `json:"message"`
}

// Activity names
const (
	ActivityAnalyzeRepository = "AnalyzeRepository"
	ActivityBuildAndPushImage = "BuildAndPushImage"
	ActivityUpdateBuildStatus = "UpdateBuildStatus"
)

// Activity input types
type AnalyzeRepositoryInput struct {
	RepoURL           string `json:"repoUrl"`
	Ref               string `json:"ref"`
	InstallationToken string `json:"installationToken"`
}

type AnalyzeRepositoryResult struct {
	Detected        bool   `json:"detected"`
	Language        string `json:"language"`
	LanguageVersion string `json:"languageVersion"`
	Framework       string `json:"framework"`
	BuildCommand    string `json:"buildCommand"`
	StartCommand    string `json:"startCommand"`
	Error           string `json:"error,omitempty"`
}

type BuildAndPushInput struct {
	RequestID         string              `json:"requestId"`
	AppID             string              `json:"appId"`
	RepoURL           string              `json:"repoUrl"`
	Ref               string              `json:"ref"`
	InstallationToken string              `json:"installationToken"`
	LanguageVersion   string              `json:"languageVersion"`
	BuildCommand      string              `json:"buildCommand"`
	StartCommand      string              `json:"startCommand"`
	BuildEnv          map[string]string   `json:"buildEnv"`
	Registry          BuildRegistryConfig `json:"registry"`
	ImageTag          string              `json:"imageTag"`
	PackageManager    string              `json:"packageManager,omitempty"` // "npm", "yarn", "pnpm", "bun", or "" for auto
}

type BuildAndPushResult struct {
	Success     bool   `json:"success"`
	ImageURL    string `json:"imageUrl"`
	ImageDigest string `json:"imageDigest"`
	Error       string `json:"error,omitempty"`
}

type UpdateBuildStatusInput struct {
	AppID            string               `json:"appId"`
	Status           string               `json:"status"`
	ImageURL         string               `json:"imageUrl,omitempty"`
	ImageDigest      string               `json:"imageDigest,omitempty"`
	Error            string               `json:"error,omitempty"`
	BuildConfig      *DetectedBuildConfig `json:"buildConfig,omitempty"`
	AvailableChoices []string             `json:"availableChoices,omitempty"` // For awaiting_input status
}

// BuildWorkflow orchestrates container image building
func BuildWorkflow(ctx workflow.Context, input BuildWorkflowInput) (*BuildWorkflowResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting build workflow",
		"requestID", input.RequestID,
		"appID", input.AppID,
		"repoURL", input.RepoURL)

	// Initialize workflow state
	state := &types.BuildState{
		Status: types.BuildStatusAnalyzing,
	}

	// Register query handler for build state
	err := workflow.SetQueryHandler(ctx, types.QueryBuildState, func() (*types.BuildState, error) {
		return state, nil
	})
	if err != nil {
		return &BuildWorkflowResult{
			Status: types.BuildStatusFailed,
			Error:  fmt.Sprintf("failed to register query handler: %v", err),
		}, err
	}

	// Progress tracking
	progress := BuildProgress{
		CurrentStep:  "initializing",
		StepsTotal:   4,
		StepsCurrent: 0,
		Message:      "Starting build process",
	}

	// Set up query handler for legacy progress tracking
	err = workflow.SetQueryHandler(ctx, "progress", func() (BuildProgress, error) {
		return progress, nil
	})
	if err != nil {
		return &BuildWorkflowResult{
			Status: "failed",
			Error:  "failed to set up progress tracking: " + err.Error(),
		}, err
	}

	// Activity options - builds can take a while
	activityOptions := workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts: 2,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, activityOptions)

	// Step 1: Update status to analyzing
	progress.CurrentStep = "analyzing"
	progress.StepsCurrent = 1
	progress.Message = "Analyzing repository"

	statusInput := UpdateBuildStatusInput{
		AppID:  input.AppID,
		Status: "analyzing",
	}
	err = workflow.ExecuteActivity(ctx, ActivityUpdateBuildStatus, statusInput).Get(ctx, nil)
	if err != nil {
		logger.Error("Failed to update build status", "error", err)
		return &BuildWorkflowResult{
			Status: "failed",
			Error:  "failed to update status: " + err.Error(),
		}, err
	}

	// Step 2: Analyze repository
	progress.CurrentStep = "analyzing"
	progress.StepsCurrent = 2
	progress.Message = "Detecting language and framework"

	analyzeInput := AnalyzeRepositoryInput{
		RepoURL:           input.RepoURL,
		Ref:               input.Ref,
		InstallationToken: input.Registry.Token, // Use registry token (GitHub token for GHCR)
	}
	var analyzeResult types.AnalyzeRepositoryResult
	err = workflow.ExecuteActivity(ctx, ActivityAnalyzeRepository, analyzeInput).Get(ctx, &analyzeResult)
	if err != nil || !analyzeResult.Detected {
		errMsg := "repository analysis failed"
		if err != nil {
			errMsg = err.Error()
		} else if analyzeResult.Error != "" {
			errMsg = analyzeResult.Error
		}
		logger.Error("Analysis failed", "error", errMsg)
		return failWorkflow(ctx, input.AppID, state, errMsg)
	}

	// Step 3: Check package manager version support
	if analyzeResult.PackageManager != nil && !analyzeResult.PackageManager.VersionSupported {
		errMsg := fmt.Sprintf(
			"Package manager version not supported: %s@%s requested, but only %s %s is supported. Please update your package.json packageManager field.",
			analyzeResult.PackageManager.Name,
			analyzeResult.PackageManager.RequestedVersion,
			analyzeResult.PackageManager.Name,
			analyzeResult.PackageManager.SupportedRange,
		)
		logger.Error("Unsupported package manager version", "error", errMsg)
		return failWorkflow(ctx, input.AppID, state, errMsg)
	}

	// Step 4: Check if we need user input for package manager
	packageManager := ""
	if analyzeResult.PackageManager != nil {
		packageManager = analyzeResult.PackageManager.Name
	}

	if analyzeResult.PackageManager == nil || !analyzeResult.PackageManager.Detected {
		// No package manager detected - wait for user selection
		state.Status = types.BuildStatusAwaitingInput
		state.NeedsPackageManager = true
		state.AvailableChoices = []string{"npm", "yarn", "pnpm", "bun"}

		logger.Info("Package manager not detected, awaiting user selection")

		// Update frontend status
		err = workflow.ExecuteActivity(ctx, ActivityUpdateBuildStatus, UpdateBuildStatusInput{
			AppID:            input.AppID,
			Status:           types.BuildStatusAwaitingInput,
			AvailableChoices: state.AvailableChoices,
		}).Get(ctx, nil)
		if err != nil {
			logger.Error("Failed to update awaiting_input status", "error", err)
		}

		// Wait for signal with user's package manager choice
		signalChan := workflow.GetSignalChannel(ctx, types.SignalPackageManagerSelected)
		var selectedPM string
		signalChan.Receive(ctx, &selectedPM)

		// Validate that the selected package manager is one of the available choices
		isValid := false
		for _, choice := range state.AvailableChoices {
			if selectedPM == choice {
				isValid = true
				break
			}
		}
		if !isValid {
			errMsg := fmt.Sprintf("Invalid package manager selected: %s. Must be one of: %v", selectedPM, state.AvailableChoices)
			logger.Error("Invalid package manager selection", "selectedPM", selectedPM, "availableChoices", state.AvailableChoices)
			return failWorkflow(ctx, input.AppID, state, errMsg)
		}

		logger.Info("Received package manager selection", "pm", selectedPM)
		state.SelectedPM = selectedPM
		packageManager = selectedPM
	}

	// Step 5: Update status to building
	progress.CurrentStep = "building"
	progress.StepsCurrent = 3
	progress.Message = "Building container image"

	state.Status = types.BuildStatusBuilding
	statusInput = UpdateBuildStatusInput{
		AppID:  input.AppID,
		Status: types.BuildStatusBuilding,
		BuildConfig: &DetectedBuildConfig{
			Language:        analyzeResult.Language,
			LanguageVersion: analyzeResult.LanguageVersion,
			Framework:       analyzeResult.Framework,
			BuildCommand:    analyzeResult.BuildCommand,
			StartCommand:    analyzeResult.StartCommand,
		},
	}
	err = workflow.ExecuteActivity(ctx, ActivityUpdateBuildStatus, statusInput).Get(ctx, nil)
	if err != nil {
		logger.Error("Failed to update build status", "error", err)
	}

	// Apply overrides from input
	languageVersion := analyzeResult.LanguageVersion
	if input.LanguageVersion != "" {
		languageVersion = input.LanguageVersion
	}

	buildCommand := analyzeResult.BuildCommand
	if input.BuildCommand != "" {
		buildCommand = input.BuildCommand
	}

	startCommand := analyzeResult.StartCommand
	if input.StartCommand != "" {
		startCommand = input.StartCommand
	}

	buildEnv := input.BuildEnv
	if buildEnv == nil {
		buildEnv = make(map[string]string)
	}

	imageTag := input.ImageTag
	if imageTag == "" {
		imageTag = "latest"
	}

	buildInput := BuildAndPushInput{
		RequestID:         input.RequestID,
		AppID:             input.AppID,
		RepoURL:           input.RepoURL,
		Ref:               input.Ref,
		InstallationToken: input.Registry.Token, // Use registry token (GitHub token for GHCR)
		LanguageVersion:   languageVersion,
		BuildCommand:      buildCommand,
		StartCommand:      startCommand,
		BuildEnv:          buildEnv,
		Registry:          input.Registry,
		ImageTag:          imageTag,
		PackageManager:    packageManager, // Pass selected/detected package manager
	}

	var buildResult BuildAndPushResult
	err = workflow.ExecuteActivity(ctx, ActivityBuildAndPushImage, buildInput).Get(ctx, &buildResult)
	if err != nil || !buildResult.Success {
		errMsg := "build failed"
		if err != nil {
			errMsg = err.Error()
		} else if buildResult.Error != "" {
			errMsg = buildResult.Error
		}
		logger.Error("Build failed", "error", errMsg)
		return failWorkflow(ctx, input.AppID, state, errMsg)
	}

	// Step 6: Update status to success
	progress.CurrentStep = "completed"
	progress.StepsCurrent = 4
	progress.Message = "Build completed successfully"

	state.Status = types.BuildStatusSuccess
	statusInput = UpdateBuildStatusInput{
		AppID:       input.AppID,
		Status:      types.BuildStatusSuccess,
		ImageURL:    buildResult.ImageURL,
		ImageDigest: buildResult.ImageDigest,
		BuildConfig: &DetectedBuildConfig{
			Language:        analyzeResult.Language,
			LanguageVersion: languageVersion,
			Framework:       analyzeResult.Framework,
			BuildCommand:    buildCommand,
			StartCommand:    startCommand,
		},
	}
	err = workflow.ExecuteActivity(ctx, ActivityUpdateBuildStatus, statusInput).Get(ctx, nil)
	if err != nil {
		logger.Error("Failed to update final status", "error", err)
	}

	logger.Info("Build workflow completed",
		"requestID", input.RequestID,
		"imageURL", buildResult.ImageURL,
		"imageDigest", buildResult.ImageDigest)

	return &BuildWorkflowResult{
		Status:      types.BuildStatusSuccess,
		ImageURL:    buildResult.ImageURL,
		ImageDigest: buildResult.ImageDigest,
		DetectedConfig: &DetectedBuildConfig{
			Language:        analyzeResult.Language,
			LanguageVersion: languageVersion,
			Framework:       analyzeResult.Framework,
			BuildCommand:    buildCommand,
			StartCommand:    startCommand,
		},
	}, nil
}

// failWorkflow is a helper function that updates status to failed and returns error
func failWorkflow(ctx workflow.Context, appID string, state *types.BuildState, errMsg string) (*BuildWorkflowResult, error) {
	state.Status = types.BuildStatusFailed
	state.Error = errMsg

	_ = workflow.ExecuteActivity(ctx, ActivityUpdateBuildStatus, UpdateBuildStatusInput{
		AppID:  appID,
		Status: types.BuildStatusFailed,
		Error:  errMsg,
	}).Get(ctx, nil)

	return &BuildWorkflowResult{
		Status: types.BuildStatusFailed,
		Error:  errMsg,
	}, nil
}
