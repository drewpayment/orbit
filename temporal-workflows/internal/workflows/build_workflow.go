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
	LanguageVersion   string            `json:"languageVersion,omitempty"`
	BuildCommand      string            `json:"buildCommand,omitempty"`
	StartCommand      string            `json:"startCommand,omitempty"`
	BuildEnv          map[string]string `json:"buildEnv,omitempty"`
	ImageTag          string            `json:"imageTag,omitempty"`
	InstallationToken string            `json:"installationToken,omitempty"` // GitHub App token for repo cloning
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
	ActivityAnalyzeRepository    = "AnalyzeRepository"
	ActivityBuildAndPushImage    = "BuildAndPushImage"
	ActivityUpdateBuildStatus    = "UpdateBuildStatus"
	ActivityCheckQuotaAndCleanup = "CheckQuotaAndCleanup"
	ActivityTrackImage           = "TrackImage"
)

// Activity input types
type AnalyzeRepositoryInput struct {
	RepoURL           string `json:"repoUrl"`
	Ref               string `json:"ref"`
	InstallationToken string `json:"installationToken"`
}

type AnalyzeRepositoryResult struct {
	Detected        bool                     `json:"detected"`
	Language        string                   `json:"language"`
	LanguageVersion string                   `json:"languageVersion"`
	Framework       string                   `json:"framework"`
	BuildCommand    string                   `json:"buildCommand"`
	StartCommand    string                   `json:"startCommand"`
	Error           string                   `json:"error,omitempty"`
	PackageManager  *types.PackageManagerInfo `json:"packageManager,omitempty"`
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

// QuotaCheckInput is input for CheckQuotaAndCleanup activity
type QuotaCheckInput struct {
	WorkspaceID string `json:"workspaceId"`
}

// QuotaCheckResult is result from CheckQuotaAndCleanup activity
type QuotaCheckResult struct {
	CleanupPerformed  bool           `json:"cleanupPerformed"`
	CurrentUsageBytes int64          `json:"currentUsageBytes"`
	QuotaBytes        int64          `json:"quotaBytes"`
	CleanedImages     []CleanedImage `json:"cleanedImages"`
	Error             string         `json:"error,omitempty"`
}

// CleanedImage represents an image that was cleaned up
type CleanedImage struct {
	AppName   string `json:"appName"`
	Tag       string `json:"tag"`
	SizeBytes int64  `json:"sizeBytes"`
}

// TrackImageInput is input for TrackImage activity
type TrackImageInput struct {
	WorkspaceID  string `json:"workspaceId"`
	AppID        string `json:"appId"`
	Tag          string `json:"tag"`
	Digest       string `json:"digest"`
	RegistryURL  string `json:"registryUrl"`
	Repository   string `json:"repository"`
	RegistryType string `json:"registryType"` // "orbit", "ghcr", or "acr"
}

// TrackImageResult is result from TrackImage activity
type TrackImageResult struct {
	SizeBytes     int64  `json:"sizeBytes"`
	NewTotalUsage int64  `json:"newTotalUsage"`
	Error         string `json:"error,omitempty"`
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

	// Activity options - builds can take a while (cold cache builds may exceed 30 min)
	activityOptions := workflow.ActivityOptions{
		StartToCloseTimeout: 60 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts: 3,
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

	// Use InstallationToken if provided (new flow), otherwise fallback to Registry.Token (legacy)
	installToken := input.InstallationToken
	if installToken == "" {
		installToken = input.Registry.Token
	}

	analyzeInput := AnalyzeRepositoryInput{
		RepoURL:           input.RepoURL,
		Ref:               input.Ref,
		InstallationToken: installToken,
	}
	var analyzeResult types.AnalyzeRepositoryResult
	err = workflow.ExecuteActivity(ctx, ActivityAnalyzeRepository, analyzeInput).Get(ctx, &analyzeResult)

	// Debug logging for package manager
	if analyzeResult.PackageManager != nil {
		logger.Info("Workflow received package manager info",
			"pm_detected", analyzeResult.PackageManager.Detected,
			"pm_name", analyzeResult.PackageManager.Name,
			"pm_source", analyzeResult.PackageManager.Source)
	} else {
		logger.Info("Workflow received nil package manager")
	}

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
	hasLockfile := false
	if analyzeResult.PackageManager != nil {
		packageManager = analyzeResult.PackageManager.Name
		hasLockfile = analyzeResult.PackageManager.Lockfile != ""

		// Log detailed package manager info
		logger.Info("Package manager detection result",
			"detected", analyzeResult.PackageManager.Detected,
			"name", analyzeResult.PackageManager.Name,
			"source", analyzeResult.PackageManager.Source,
			"lockfile", analyzeResult.PackageManager.Lockfile,
			"hasLockfile", hasLockfile)
	}

	// If package manager was detected from packageManager field but no lockfile exists,
	// Railpack will still need a lockfile. Log a warning.
	if analyzeResult.PackageManager != nil &&
		analyzeResult.PackageManager.Detected &&
		analyzeResult.PackageManager.Source == "packageManager" &&
		!hasLockfile {
		logger.Warn("Package manager detected from packageManager field but no lockfile found. Build may fail.")
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

	// Pre-build quota check (only for Orbit registry)
	if input.Registry.Type == "orbit" {
		logger.Info("Checking quota before build", "workspaceID", input.WorkspaceID)

		quotaOptions := workflow.ActivityOptions{
			StartToCloseTimeout: 2 * time.Minute,
			RetryPolicy: &temporal.RetryPolicy{
				MaximumAttempts: 3,
			},
		}
		quotaCtx := workflow.WithActivityOptions(ctx, quotaOptions)

		var quotaResult QuotaCheckResult
		err = workflow.ExecuteActivity(quotaCtx, ActivityCheckQuotaAndCleanup, QuotaCheckInput{
			WorkspaceID: input.WorkspaceID,
		}).Get(quotaCtx, &quotaResult)

		if err != nil {
			logger.Warn("Quota check failed, proceeding with build", "error", err)
		} else if quotaResult.Error != "" {
			logger.Warn("Quota check returned error, proceeding with build", "error", quotaResult.Error)
		} else if quotaResult.CleanupPerformed {
			var freedBytes int64
			for _, img := range quotaResult.CleanedImages {
				freedBytes += img.SizeBytes
			}
			logger.Info("Cleaned up old images before build",
				"imageCount", len(quotaResult.CleanedImages),
				"freedBytes", freedBytes,
				"currentUsage", quotaResult.CurrentUsageBytes,
				"quota", quotaResult.QuotaBytes)
		}
	}

	buildInput := BuildAndPushInput{
		RequestID:         input.RequestID,
		AppID:             input.AppID,
		RepoURL:           input.RepoURL,
		Ref:               input.Ref,
		InstallationToken: installToken, // GitHub App token for repo cloning
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

	// Post-push image tracking (for all registry types)
	if buildResult.Success {
		logger.Info("Tracking image after build",
			"workspaceID", input.WorkspaceID,
			"appID", input.AppID,
			"tag", imageTag,
			"registryType", input.Registry.Type)

		trackOptions := workflow.ActivityOptions{
			StartToCloseTimeout: 1 * time.Minute,
			RetryPolicy: &temporal.RetryPolicy{
				MaximumAttempts: 3,
			},
		}
		trackCtx := workflow.WithActivityOptions(ctx, trackOptions)

		var trackResult TrackImageResult
		err = workflow.ExecuteActivity(trackCtx, ActivityTrackImage, TrackImageInput{
			WorkspaceID:  input.WorkspaceID,
			AppID:        input.AppID,
			Tag:          imageTag,
			Digest:       buildResult.ImageDigest,
			RegistryURL:  input.Registry.URL,
			Repository:   input.Registry.Repository,
			RegistryType: input.Registry.Type,
		}).Get(trackCtx, &trackResult)

		if err != nil {
			logger.Warn("Failed to track image", "error", err)
		} else if trackResult.Error != "" {
			logger.Warn("Track image returned error", "error", trackResult.Error)
		} else {
			logger.Info("Image tracked successfully",
				"sizeBytes", trackResult.SizeBytes,
				"totalUsage", trackResult.NewTotalUsage)
		}
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
