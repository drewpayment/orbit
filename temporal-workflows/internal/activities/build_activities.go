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
	UpdateAppBuildStatus(ctx context.Context, appID string, status string, imageURL string, imageDigest string, errorMsg string, buildConfig *DetectedBuildConfig) error
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

type DetectedBuildConfig struct {
	Language        string `json:"language"`
	LanguageVersion string `json:"languageVersion"`
	Framework       string `json:"framework"`
	BuildCommand    string `json:"buildCommand"`
	StartCommand    string `json:"startCommand"`
}

type UpdateBuildStatusInput struct {
	AppID       string               `json:"appId"`
	Status      string               `json:"status"`
	ImageURL    string               `json:"imageUrl,omitempty"`
	ImageDigest string               `json:"imageDigest,omitempty"`
	Error       string               `json:"error,omitempty"`
	BuildConfig *DetectedBuildConfig `json:"buildConfig,omitempty"`
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

	a.logger.Info("Repository analysis complete",
		"detected", result.Detected,
		"language", result.Language,
		"framework", result.Framework)

	return result, nil
}

// BuildAndPushImage calls build service gRPC to build and push image
func (a *BuildActivities) BuildAndPushImage(ctx context.Context, input BuildAndPushInput) (*BuildAndPushResult, error) {
	a.logger.Info("Building and pushing image",
		"requestID", input.RequestID,
		"appID", input.AppID,
		"repoURL", input.RepoURL,
		"ref", input.Ref,
		"imageTag", input.ImageTag)

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
	)
	if err != nil {
		return fmt.Errorf("failed to update build status: %w", err)
	}

	a.logger.Info("Build status updated successfully")
	return nil
}
