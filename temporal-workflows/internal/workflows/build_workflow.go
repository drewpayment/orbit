package workflows

import (
	"time"

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
}

type BuildAndPushResult struct {
	Success     bool   `json:"success"`
	ImageURL    string `json:"imageUrl"`
	ImageDigest string `json:"imageDigest"`
	Error       string `json:"error,omitempty"`
}

type UpdateBuildStatusInput struct {
	AppID       string               `json:"appId"`
	Status      string               `json:"status"`
	ImageURL    string               `json:"imageUrl,omitempty"`
	ImageDigest string               `json:"imageDigest,omitempty"`
	Error       string               `json:"error,omitempty"`
	BuildConfig *DetectedBuildConfig `json:"buildConfig,omitempty"`
}

// BuildWorkflow orchestrates container image building
func BuildWorkflow(ctx workflow.Context, input BuildWorkflowInput) (*BuildWorkflowResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting build workflow",
		"requestID", input.RequestID,
		"appID", input.AppID,
		"repoURL", input.RepoURL)

	// Progress tracking
	progress := BuildProgress{
		CurrentStep:  "initializing",
		StepsTotal:   4,
		StepsCurrent: 0,
		Message:      "Starting build process",
	}

	// Set up query handler
	err := workflow.SetQueryHandler(ctx, "progress", func() (BuildProgress, error) {
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

	// Helper to update status on failure
	updateStatusOnFailure := func(errMsg string) {
		statusInput := UpdateBuildStatusInput{
			AppID:  input.AppID,
			Status: "failed",
			Error:  errMsg,
		}
		_ = workflow.ExecuteActivity(ctx, ActivityUpdateBuildStatus, statusInput).Get(ctx, nil)
	}

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
		InstallationToken: "", // TODO: Get from GitHub App installation
	}
	var analyzeResult AnalyzeRepositoryResult
	err = workflow.ExecuteActivity(ctx, ActivityAnalyzeRepository, analyzeInput).Get(ctx, &analyzeResult)
	if err != nil || !analyzeResult.Detected {
		errMsg := "repository analysis failed"
		if err != nil {
			errMsg = err.Error()
		} else if analyzeResult.Error != "" {
			errMsg = analyzeResult.Error
		}
		logger.Error("Analysis failed", "error", errMsg)
		updateStatusOnFailure(errMsg)
		return &BuildWorkflowResult{
			Status: "failed",
			Error:  errMsg,
		}, nil
	}

	// Step 3: Build and push image
	progress.CurrentStep = "building"
	progress.StepsCurrent = 3
	progress.Message = "Building container image"

	// Update status to building
	statusInput = UpdateBuildStatusInput{
		AppID:  input.AppID,
		Status: "building",
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
		InstallationToken: "", // TODO: Get from GitHub App installation
		LanguageVersion:   languageVersion,
		BuildCommand:      buildCommand,
		StartCommand:      startCommand,
		BuildEnv:          buildEnv,
		Registry:          input.Registry,
		ImageTag:          imageTag,
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
		updateStatusOnFailure(errMsg)
		return &BuildWorkflowResult{
			Status: "failed",
			Error:  errMsg,
		}, nil
	}

	// Step 4: Update status to success
	progress.CurrentStep = "completed"
	progress.StepsCurrent = 4
	progress.Message = "Build completed successfully"

	statusInput = UpdateBuildStatusInput{
		AppID:       input.AppID,
		Status:      "success",
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
		Status:      "success",
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
