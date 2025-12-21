package activities

import (
	"context"
	"fmt"
	"log/slog"

	buildv1 "github.com/drewpayment/orbit/proto/gen/go/idp/build/v1"
	"github.com/drewpayment/orbit/temporal-workflows/pkg/types"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

// BuildServiceClient interface for build service operations
type BuildServiceClient interface {
	AnalyzeRepository(ctx context.Context, req *buildv1.AnalyzeRepositoryRequest) (*buildv1.AnalyzeRepositoryResponse, error)
	BuildImage(ctx context.Context, req *buildv1.BuildImageRequest) (*buildv1.BuildImageResponse, error)
}

// PayloadBuildClient interface for Payload CMS operations
type PayloadBuildClient interface {
	UpdateAppBuildStatus(ctx context.Context, appID string, status string, imageURL string, imageDigest string, errorMsg string, buildConfig *types.DetectedBuildConfig, availableChoices []string) error
	GetGitHubInstallationToken(ctx context.Context, workspaceID string) (string, error)
	GetRegistryConfig(ctx context.Context, registryID string) (*RegistryConfigData, error)
}

// RegistryConfigData represents registry configuration from Payload
type RegistryConfigData struct {
	Type           string `json:"type"`
	GHCROwner      string `json:"ghcrOwner"`
	ACRLoginServer string `json:"acrLoginServer"`
	ACRUsername    string `json:"acrUsername"`
	ACRToken       string `json:"acrToken"`
}

// BuildActivities holds dependencies for build activities
type BuildActivities struct {
	payloadClient    PayloadBuildClient
	buildServiceAddr string
	logger           *slog.Logger
}

// NewBuildActivities creates a new instance
func NewBuildActivities(payloadClient PayloadBuildClient, logger *slog.Logger) *BuildActivities {
	return NewBuildActivitiesWithAddr(payloadClient, logger, "")
}

// NewBuildActivitiesWithAddr creates a new instance with custom address
func NewBuildActivitiesWithAddr(payloadClient PayloadBuildClient, logger *slog.Logger, buildServiceAddr string) *BuildActivities {
	if logger == nil {
		logger = slog.Default()
	}
	if buildServiceAddr == "" {
		buildServiceAddr = "build-service:50054" // Docker service name and port
	}
	return &BuildActivities{
		payloadClient:    payloadClient,
		buildServiceAddr: buildServiceAddr,
		logger:           logger,
	}
}

// Activity input types (duplicated from workflows package to avoid circular dependency)
type AnalyzeRepositoryInput struct {
	RepoURL           string `json:"repoUrl"`
	Ref               string `json:"ref"`
	InstallationToken string `json:"installationToken"`
}

// AnalyzeRepositoryResult is now imported from types package

type BuildRegistryConfig struct {
	Type       string `json:"type"` // "ghcr" or "acr"
	URL        string `json:"url"`
	Repository string `json:"repository"`
	Token      string `json:"token"`
	Username   string `json:"username,omitempty"` // For ACR
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
	AppID            string                     `json:"appId"`
	Status           string                     `json:"status"`
	ImageURL         string                     `json:"imageUrl,omitempty"`
	ImageDigest      string                     `json:"imageDigest,omitempty"`
	Error            string                     `json:"error,omitempty"`
	BuildConfig      *types.DetectedBuildConfig `json:"buildConfig,omitempty"`
	AvailableChoices []string                   `json:"availableChoices,omitempty"`
}

// AnalyzeRepository calls build service gRPC to analyze repository
func (a *BuildActivities) AnalyzeRepository(ctx context.Context, input AnalyzeRepositoryInput) (*types.AnalyzeRepositoryResult, error) {
	a.logger.Info("Analyzing repository",
		"repoURL", input.RepoURL,
		"ref", input.Ref)

	// Validate input
	if input.RepoURL == "" {
		return nil, fmt.Errorf("repo_url is required")
	}
	if input.Ref == "" {
		return nil, fmt.Errorf("ref is required")
	}

	// Connect to build service
	conn, err := grpc.DialContext(ctx, a.buildServiceAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("failed to connect to build service: %w", err)
	}
	defer conn.Close()

	client := buildv1.NewBuildServiceClient(conn)

	// Call AnalyzeRepository
	req := &buildv1.AnalyzeRepositoryRequest{
		RepoUrl:           input.RepoURL,
		Ref:               input.Ref,
		InstallationToken: input.InstallationToken,
	}

	resp, err := client.AnalyzeRepository(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("build service analyze failed: %w", err)
	}

	// Convert proto response to workflow result
	result := &types.AnalyzeRepositoryResult{
		Detected: resp.Detected,
		Error:    resp.Error,
	}

	if resp.Config != nil {
		result.Language = resp.Config.Language
		result.LanguageVersion = resp.Config.LanguageVersion
		result.Framework = resp.Config.Framework
		result.BuildCommand = resp.Config.BuildCommand
		result.StartCommand = resp.Config.StartCommand

		// Map package manager info
		if resp.Config.PackageManager != nil {
			result.PackageManager = &types.PackageManagerInfo{
				Detected:         resp.Config.PackageManager.Detected,
				Name:             resp.Config.PackageManager.Name,
				Source:           resp.Config.PackageManager.Source,
				Lockfile:         resp.Config.PackageManager.Lockfile,
				RequestedVersion: resp.Config.PackageManager.RequestedVersion,
				VersionSupported: resp.Config.PackageManager.VersionSupported,
				SupportedRange:   resp.Config.PackageManager.SupportedRange,
			}
		}
	}

	// Log package manager info for debugging
	if result.PackageManager != nil {
		a.logger.Info("Repository analysis complete",
			"detected", result.Detected,
			"language", result.Language,
			"framework", result.Framework,
			"pm_detected", result.PackageManager.Detected,
			"pm_name", result.PackageManager.Name,
			"pm_source", result.PackageManager.Source)
	} else {
		a.logger.Info("Repository analysis complete",
			"detected", result.Detected,
			"language", result.Language,
			"framework", result.Framework,
			"pm_detected", "nil")
	}

	return result, nil
}

// BuildAndPushImage calls build service gRPC to build and push image
func (a *BuildActivities) BuildAndPushImage(ctx context.Context, input BuildAndPushInput) (*BuildAndPushResult, error) {
	// Log token info for debugging GHCR auth issues
	registryTokenPrefix := ""
	if len(input.Registry.Token) >= 10 {
		registryTokenPrefix = input.Registry.Token[:10] + "..."
	} else if len(input.Registry.Token) > 0 {
		registryTokenPrefix = input.Registry.Token + "..."
	}

	a.logger.Info("Building and pushing image",
		"requestID", input.RequestID,
		"appID", input.AppID,
		"repoURL", input.RepoURL,
		"ref", input.Ref,
		"imageTag", input.ImageTag,
		"registryType", input.Registry.Type,
		"registryURL", input.Registry.URL,
		"registryTokenLength", len(input.Registry.Token),
		"registryTokenPrefix", registryTokenPrefix)

	// Validate input
	if input.RequestID == "" {
		return nil, fmt.Errorf("request_id is required")
	}
	if input.AppID == "" {
		return nil, fmt.Errorf("app_id is required")
	}
	if input.RepoURL == "" {
		return nil, fmt.Errorf("repo_url is required")
	}
	if input.Ref == "" {
		return nil, fmt.Errorf("ref is required")
	}
	if input.Registry.URL == "" {
		return nil, fmt.Errorf("registry URL is required")
	}
	if input.Registry.Repository == "" {
		return nil, fmt.Errorf("registry repository is required")
	}

	// Connect to build service
	conn, err := grpc.DialContext(ctx, a.buildServiceAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("failed to connect to build service: %w", err)
	}
	defer conn.Close()

	client := buildv1.NewBuildServiceClient(conn)

	// Convert registry type
	var registryType buildv1.RegistryType
	switch input.Registry.Type {
	case "ghcr":
		registryType = buildv1.RegistryType_REGISTRY_TYPE_GHCR
	case "acr":
		registryType = buildv1.RegistryType_REGISTRY_TYPE_ACR
	case "orbit":
		registryType = buildv1.RegistryType_REGISTRY_TYPE_ORBIT
	default:
		return nil, fmt.Errorf("unsupported registry type: %s", input.Registry.Type)
	}

	// Build request
	req := &buildv1.BuildImageRequest{
		RequestId:         input.RequestID,
		AppId:             input.AppID,
		RepoUrl:           input.RepoURL,
		Ref:               input.Ref,
		InstallationToken: input.InstallationToken,
		BuildEnv:          input.BuildEnv,
		Registry: &buildv1.RegistryConfig{
			Type:       registryType,
			Url:        input.Registry.URL,
			Repository: input.Registry.Repository,
			Token:      input.Registry.Token,
			Username:   &input.Registry.Username,
		},
		ImageTag:       input.ImageTag,
		PackageManager: input.PackageManager,
	}

	// Set optional overrides
	if input.LanguageVersion != "" {
		req.LanguageVersion = &input.LanguageVersion
	}
	if input.BuildCommand != "" {
		req.BuildCommand = &input.BuildCommand
	}
	if input.StartCommand != "" {
		req.StartCommand = &input.StartCommand
	}

	// Call BuildImage
	resp, err := client.BuildImage(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("build service build failed: %w", err)
	}

	// Convert proto response to workflow result
	result := &BuildAndPushResult{
		Success:     resp.Success,
		ImageURL:    resp.ImageUrl,
		ImageDigest: resp.ImageDigest,
		Error:       resp.Error,
	}

	a.logger.Info("Build and push complete",
		"success", result.Success,
		"imageURL", result.ImageURL,
		"imageDigest", result.ImageDigest)

	return result, nil
}

// UpdateBuildStatus calls Payload to update app build status
func (a *BuildActivities) UpdateBuildStatus(ctx context.Context, input UpdateBuildStatusInput) error {
	a.logger.Info("Updating build status",
		"appID", input.AppID,
		"status", input.Status)

	// Validate input
	if input.AppID == "" {
		return fmt.Errorf("app_id is required")
	}
	if input.Status == "" {
		return fmt.Errorf("status is required")
	}

	// Skip if no client configured (for testing)
	if a.payloadClient == nil {
		a.logger.Warn("No Payload client configured, skipping status update")
		return nil
	}

	// Call Payload client
	err := a.payloadClient.UpdateAppBuildStatus(
		ctx,
		input.AppID,
		input.Status,
		input.ImageURL,
		input.ImageDigest,
		input.Error,
		input.BuildConfig,
		input.AvailableChoices,
	)
	if err != nil {
		return fmt.Errorf("failed to update build status: %w", err)
	}

	a.logger.Info("Build status updated successfully")
	return nil
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
	WorkspaceID string `json:"workspaceId"`
	AppID       string `json:"appId"`
	Tag         string `json:"tag"`
	Digest      string `json:"digest"`
	RegistryURL string `json:"registryUrl"`
	Repository  string `json:"repository"`
}

// TrackImageResult is result from TrackImage activity
type TrackImageResult struct {
	SizeBytes     int64  `json:"sizeBytes"`
	NewTotalUsage int64  `json:"newTotalUsage"`
	Error         string `json:"error,omitempty"`
}

// CheckQuotaAndCleanup checks workspace quota and cleans up old images if needed
func (a *BuildActivities) CheckQuotaAndCleanup(ctx context.Context, input QuotaCheckInput) (*QuotaCheckResult, error) {
	a.logger.Info("Checking quota and cleanup",
		"workspaceID", input.WorkspaceID)

	if input.WorkspaceID == "" {
		return nil, fmt.Errorf("workspace_id is required")
	}

	// Connect to build service
	conn, err := grpc.DialContext(ctx, a.buildServiceAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("failed to connect to build service: %w", err)
	}
	defer conn.Close()

	client := buildv1.NewBuildServiceClient(conn)

	resp, err := client.CheckQuotaAndCleanup(ctx, &buildv1.CheckQuotaRequest{
		WorkspaceId: input.WorkspaceID,
	})
	if err != nil {
		return nil, fmt.Errorf("quota check failed: %w", err)
	}

	// Check for error in response
	if resp.Error != "" {
		a.logger.Warn("Quota check returned error",
			"workspaceID", input.WorkspaceID,
			"error", resp.Error)
		return &QuotaCheckResult{
			Error: resp.Error,
		}, nil
	}

	// Convert cleaned images
	cleanedImages := make([]CleanedImage, len(resp.CleanedImages))
	for i, img := range resp.CleanedImages {
		cleanedImages[i] = CleanedImage{
			AppName:   img.AppName,
			Tag:       img.Tag,
			SizeBytes: img.SizeBytes,
		}
	}

	if resp.CleanupPerformed {
		var totalFreed int64
		for _, img := range cleanedImages {
			totalFreed += img.SizeBytes
		}
		a.logger.Info("Quota cleanup completed",
			"workspaceID", input.WorkspaceID,
			"imagesDeleted", len(cleanedImages),
			"bytesFreed", totalFreed,
			"currentUsage", resp.CurrentUsageBytes,
			"quota", resp.QuotaBytes)
	} else {
		a.logger.Info("Quota check complete, no cleanup needed",
			"workspaceID", input.WorkspaceID,
			"currentUsage", resp.CurrentUsageBytes,
			"quota", resp.QuotaBytes)
	}

	return &QuotaCheckResult{
		CleanupPerformed:  resp.CleanupPerformed,
		CurrentUsageBytes: resp.CurrentUsageBytes,
		QuotaBytes:        resp.QuotaBytes,
		CleanedImages:     cleanedImages,
	}, nil
}

// TrackImage records a pushed image in the registry tracking system
func (a *BuildActivities) TrackImage(ctx context.Context, input TrackImageInput) (*TrackImageResult, error) {
	a.logger.Info("Tracking image",
		"workspaceID", input.WorkspaceID,
		"appID", input.AppID,
		"tag", input.Tag,
		"repository", input.Repository)

	if input.WorkspaceID == "" || input.AppID == "" || input.Tag == "" {
		return nil, fmt.Errorf("workspace_id, app_id, and tag are required")
	}

	if input.Repository == "" {
		return nil, fmt.Errorf("repository is required")
	}

	// Connect to build service
	conn, err := grpc.DialContext(ctx, a.buildServiceAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("failed to connect to build service: %w", err)
	}
	defer conn.Close()

	client := buildv1.NewBuildServiceClient(conn)

	resp, err := client.TrackImage(ctx, &buildv1.TrackImageRequest{
		WorkspaceId: input.WorkspaceID,
		AppId:       input.AppID,
		Tag:         input.Tag,
		Digest:      input.Digest,
		RegistryUrl: input.RegistryURL,
		Repository:  input.Repository,
	})
	if err != nil {
		return nil, fmt.Errorf("track image failed: %w", err)
	}

	// Check for error in response
	if resp.Error != "" {
		a.logger.Warn("Track image returned error",
			"workspaceID", input.WorkspaceID,
			"appID", input.AppID,
			"tag", input.Tag,
			"error", resp.Error)
		return &TrackImageResult{
			Error: resp.Error,
		}, nil
	}

	a.logger.Info("Image tracked successfully",
		"workspaceID", input.WorkspaceID,
		"appID", input.AppID,
		"tag", input.Tag,
		"sizeBytes", resp.SizeBytes,
		"newTotalUsage", resp.NewTotalUsage)

	return &TrackImageResult{
		SizeBytes:     resp.SizeBytes,
		NewTotalUsage: resp.NewTotalUsage,
	}, nil
}
