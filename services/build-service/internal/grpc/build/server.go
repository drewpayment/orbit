package build

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/drewpayment/orbit/services/build-service/internal/builder"
	"github.com/drewpayment/orbit/services/build-service/internal/payload"
	"github.com/drewpayment/orbit/services/build-service/internal/railpack"
	"github.com/drewpayment/orbit/services/build-service/internal/registry"
	"github.com/google/uuid"

	buildv1 "github.com/drewpayment/orbit/proto/gen/go/idp/build/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// BuildServer implements the BuildService gRPC server
type BuildServer struct {
	buildv1.UnimplementedBuildServiceServer
	logger         *slog.Logger
	workDir        string
	analyzer       *railpack.Analyzer
	builder        *builder.Builder
	registryClient *registry.Client
	payloadClient  *payload.RegistryClient
	cleaner        *registry.Cleaner
}

// NewBuildServer creates a new BuildServer instance
func NewBuildServer(logger *slog.Logger) *BuildServer {
	workDir := os.Getenv("BUILD_WORK_DIR")
	if workDir == "" {
		workDir = "/tmp/orbit-builds"
	}
	return NewBuildServerWithWorkDir(logger, workDir)
}

// NewBuildServerWithWorkDir creates a new BuildServer with specified working directory
func NewBuildServerWithWorkDir(logger *slog.Logger, workDir string) *BuildServer {
	if logger == nil {
		logger = slog.Default()
	}

	// Initialize registry client for Docker Registry v2 API
	registryURL := os.Getenv("ORBIT_REGISTRY_URL")
	if registryURL == "" {
		registryURL = "http://orbit-registry:5050"
	}
	registryUsername := os.Getenv("ORBIT_REGISTRY_USERNAME")
	registryPassword := os.Getenv("ORBIT_REGISTRY_PASSWORD")

	var registryClient *registry.Client
	if registryUsername != "" {
		registryClient = registry.NewClientWithAuth(registryURL, registryUsername, registryPassword, logger)
	} else {
		registryClient = registry.NewClient(registryURL, logger)
	}

	// Initialize Payload client for registry metadata operations
	payloadURL := os.Getenv("ORBIT_API_URL")
	if payloadURL == "" {
		payloadURL = "http://orbit-www:3000"
	}
	payloadAPIKey := os.Getenv("ORBIT_INTERNAL_API_KEY")
	payloadClient := payload.NewRegistryClient(payloadURL, payloadAPIKey, logger)

	// Initialize cleaner with both clients
	cleaner := registry.NewCleaner(registryClient, payloadClient, logger)

	return &BuildServer{
		logger:         logger,
		workDir:        workDir,
		analyzer:       railpack.NewAnalyzer(logger),
		builder:        builder.NewBuilder(logger, workDir),
		registryClient: registryClient,
		payloadClient:  payloadClient,
		cleaner:        cleaner,
	}
}

// AnalyzeRepository analyzes a repository to detect build configuration
func (s *BuildServer) AnalyzeRepository(ctx context.Context, req *buildv1.AnalyzeRepositoryRequest) (*buildv1.AnalyzeRepositoryResponse, error) {
	s.logger.Info("AnalyzeRepository called",
		"repo_url", req.RepoUrl,
		"ref", req.Ref,
	)

	// Generate request ID for temp directory
	requestID := generateRequestID()
	cloneDir := filepath.Join(s.workDir, requestID)
	defer os.RemoveAll(cloneDir)

	// Clone repository for analysis
	if err := cloneForAnalysis(ctx, s.logger, req, cloneDir, requestID); err != nil {
		s.logger.Error("Failed to clone repository", "error", err)
		return &buildv1.AnalyzeRepositoryResponse{
			Detected: false,
			Error:    fmt.Sprintf("failed to clone repository: %v", err),
		}, nil
	}

	// Run analyzer on cloned directory
	result, err := s.analyzer.Analyze(ctx, cloneDir)
	if err != nil {
		s.logger.Error("Failed to analyze repository", "error", err)
		return &buildv1.AnalyzeRepositoryResponse{
			Detected: false,
			Error:    fmt.Sprintf("analysis failed: %v", err),
		}, nil
	}

	// Debug logging for package manager detection
	if result.PackageManager != nil {
		s.logger.Info("Analyzer returned package manager info",
			"pm_detected", result.PackageManager.Detected,
			"pm_name", result.PackageManager.Name,
			"pm_source", result.PackageManager.Source,
			"pm_lockfile", result.PackageManager.Lockfile,
		)
	} else {
		s.logger.Info("Analyzer returned nil package manager")
	}

	// Convert analyzer result to proto response
	response := &buildv1.AnalyzeRepositoryResponse{
		Detected:      result.Detected,
		DetectedFiles: result.DetectedFiles,
		Error:         result.Error,
	}

	if result.Detected {
		response.Config = &buildv1.DetectedBuildConfig{
			Language:        result.Language,
			LanguageVersion: result.LanguageVersion,
			Framework:       result.Framework,
			BuildCommand:    result.BuildCommand,
			StartCommand:    result.StartCommand,
		}

		// Add package manager info if available
		if result.PackageManager != nil {
			response.Config.PackageManager = &buildv1.PackageManagerInfo{
				Detected:         result.PackageManager.Detected,
				Name:             result.PackageManager.Name,
				Source:           result.PackageManager.Source,
				Lockfile:         result.PackageManager.Lockfile,
				RequestedVersion: result.PackageManager.RequestedVersion,
				VersionSupported: result.PackageManager.VersionSupported,
				SupportedRange:   result.PackageManager.SupportedRange,
			}
		}
	}

	return response, nil
}

// BuildImage builds and pushes a container image
func (s *BuildServer) BuildImage(
	ctx context.Context,
	req *buildv1.BuildImageRequest,
) (*buildv1.BuildImageResponse, error) {
	// Log token info for debugging GHCR auth issues
	registryTokenPrefix := ""
	if req.Registry != nil && len(req.Registry.Token) >= 10 {
		registryTokenPrefix = req.Registry.Token[:10] + "..."
	}

	s.logger.Info("BuildImage called",
		"request_id", req.RequestId,
		"app_id", req.AppId,
		"repo_url", req.RepoUrl,
		"registryTokenLength", func() int {
			if req.Registry != nil {
				return len(req.Registry.Token)
			}
			return 0
		}(),
		"registryTokenPrefix", registryTokenPrefix,
	)

	// Validate registry is provided
	if req.Registry == nil {
		return &buildv1.BuildImageResponse{
			Success: false,
			Error:   "registry configuration is required",
		}, nil
	}

	// Convert proto request to builder request
	buildReq := &builder.BuildRequest{
		RequestID:         req.RequestId,
		AppID:             req.AppId,
		RepoURL:           req.RepoUrl,
		Ref:               req.Ref,
		InstallationToken: req.InstallationToken,
		BuildEnv:          req.BuildEnv,
		ImageTag:          req.ImageTag,
		PackageManager:    req.PackageManager,
	}

	// Handle optional fields
	if req.LanguageVersion != nil {
		buildReq.LanguageVersion = *req.LanguageVersion
	}
	if req.BuildCommand != nil {
		buildReq.BuildCommand = *req.BuildCommand
	}
	if req.StartCommand != nil {
		buildReq.StartCommand = *req.StartCommand
	}

	// Convert registry config
	if req.Registry != nil {
		buildReq.Registry = builder.RegistryConfig{
			URL:        req.Registry.Url,
			Repository: req.Registry.Repository,
			Token:      req.Registry.Token,
		}

		// Convert registry type
		switch req.Registry.Type {
		case buildv1.RegistryType_REGISTRY_TYPE_GHCR:
			buildReq.Registry.Type = builder.RegistryTypeGHCR
		case buildv1.RegistryType_REGISTRY_TYPE_ACR:
			buildReq.Registry.Type = builder.RegistryTypeACR
			if req.Registry.Username != nil {
				buildReq.Registry.Username = *req.Registry.Username
			}
	case buildv1.RegistryType_REGISTRY_TYPE_ORBIT:
		buildReq.Registry.Type = builder.RegistryTypeOrbit
	default:
			return &buildv1.BuildImageResponse{
				Success: false,
				Error:   "unsupported registry type",
			}, nil
		}
	}

	// Call builder
	result, err := s.builder.Build(ctx, buildReq)
	if err != nil {
		s.logger.Error("Build failed", "error", err)
		return &buildv1.BuildImageResponse{
			Success: false,
			Error:   fmt.Sprintf("build failed: %v", err),
		}, nil
	}

	// Convert result to proto response
	response := &buildv1.BuildImageResponse{
		Success:     result.Success,
		ImageUrl:    result.ImageURL,
		ImageDigest: result.ImageDigest,
		Error:       result.Error,
		Steps:       make([]*buildv1.BuildStep, len(result.Steps)),
	}

	// Convert build steps
	for i, step := range result.Steps {
		var status buildv1.BuildStepStatus
		switch step.Status {
		case "pending":
			status = buildv1.BuildStepStatus_BUILD_STEP_STATUS_PENDING
		case "running":
			status = buildv1.BuildStepStatus_BUILD_STEP_STATUS_RUNNING
		case "completed":
			status = buildv1.BuildStepStatus_BUILD_STEP_STATUS_COMPLETED
		case "failed":
			status = buildv1.BuildStepStatus_BUILD_STEP_STATUS_FAILED
		default:
			status = buildv1.BuildStepStatus_BUILD_STEP_STATUS_UNSPECIFIED
		}

		response.Steps[i] = &buildv1.BuildStep{
			Name:       step.Name,
			Status:     status,
			Message:    step.Message,
			DurationMs: step.DurationMs,
		}
	}

	return response, nil
}

// StreamBuildLogs streams build logs in real-time
func (s *BuildServer) StreamBuildLogs(
	req *buildv1.StreamBuildLogsRequest,
	stream buildv1.BuildService_StreamBuildLogsServer,
) error {
	s.logger.Info("StreamBuildLogs called",
		"request_id", req.RequestId,
	)

	// TODO: Implement log streaming
	return status.Error(codes.Unimplemented, "StreamBuildLogs not yet implemented")
}

// CheckQuotaAndCleanup checks workspace quota and cleans up old images if needed
func (s *BuildServer) CheckQuotaAndCleanup(ctx context.Context, req *buildv1.CheckQuotaRequest) (*buildv1.CheckQuotaResponse, error) {
	s.logger.Info("CheckQuotaAndCleanup called",
		"workspaceID", req.WorkspaceId,
		"incomingSizeEstimate", req.IncomingImageSizeEstimate,
	)

	if req.WorkspaceId == "" {
		return &buildv1.CheckQuotaResponse{
			Error: "workspace_id is required",
		}, nil
	}

	// Use cleaner to check quota and cleanup if needed
	result, err := s.cleaner.CleanupIfNeeded(ctx, req.WorkspaceId)
	if err != nil {
		s.logger.Error("Cleanup check failed",
			"error", err,
			"workspaceID", req.WorkspaceId,
		)
		return &buildv1.CheckQuotaResponse{
			Error: fmt.Sprintf("cleanup check failed: %v", err),
		}, nil
	}

	// Convert cleaned images to proto format
	cleanedImages := make([]*buildv1.CleanedImage, len(result.CleanedImages))
	for i, img := range result.CleanedImages {
		cleanedImages[i] = &buildv1.CleanedImage{
			AppName:   img.AppName,
			Tag:       img.Tag,
			SizeBytes: img.SizeBytes,
		}
	}

	if result.CleanupPerformed {
		var totalFreed int64
		for _, img := range result.CleanedImages {
			totalFreed += img.SizeBytes
		}
		s.logger.Info("Cleanup completed",
			"workspaceID", req.WorkspaceId,
			"imagesDeleted", len(result.CleanedImages),
			"bytesFreed", totalFreed,
			"newUsage", result.CurrentUsage,
		)
	}

	return &buildv1.CheckQuotaResponse{
		CleanupPerformed:  result.CleanupPerformed,
		CurrentUsageBytes: result.CurrentUsage,
		QuotaBytes:        result.QuotaBytes,
		CleanedImages:     cleanedImages,
	}, nil
}

// TrackImage records a pushed image in the registry tracking system
func (s *BuildServer) TrackImage(ctx context.Context, req *buildv1.TrackImageRequest) (*buildv1.TrackImageResponse, error) {
	s.logger.Info("TrackImage called",
		"workspaceID", req.WorkspaceId,
		"appID", req.AppId,
		"tag", req.Tag,
		"repository", req.Repository,
		"registryType", req.RegistryType,
	)

	if req.WorkspaceId == "" || req.AppId == "" || req.Tag == "" {
		return &buildv1.TrackImageResponse{
			Error: "workspace_id, app_id, and tag are required",
		}, nil
	}

	repository := req.Repository
	if repository == "" {
		return &buildv1.TrackImageResponse{
			Error: "repository is required",
		}, nil
	}

	var size int64
	var err error

	// Only try to get image size for Orbit registry (we control it)
	// For external registries (GHCR, ACR), we can't easily query the size
	if req.RegistryType == "orbit" {
		size, err = s.registryClient.ImageSize(ctx, repository, req.Tag)
		if err != nil {
			s.logger.Warn("Failed to get image size from Orbit registry, will record with zero size",
				"error", err,
				"repository", repository,
				"tag", req.Tag,
			)
			size = 0 // Will be updated on next query or sync
		}
	} else {
		// For GHCR/ACR, we don't track size (external registries have their own billing/quotas)
		s.logger.Info("Skipping size lookup for external registry",
			"registryType", req.RegistryType,
			"repository", repository,
		)
		size = 0
	}

	// Create/update image record in Payload
	image := payload.RegistryImage{
		Workspace: req.WorkspaceId,
		App:       req.AppId,
		Tag:       req.Tag,
		Digest:    req.Digest,
		SizeBytes: size,
		PushedAt:  time.Now(),
	}

	if err := s.payloadClient.CreateRegistryImage(ctx, image); err != nil {
		s.logger.Error("Failed to track image in Payload",
			"error", err,
			"workspaceID", req.WorkspaceId,
			"appID", req.AppId,
			"tag", req.Tag,
		)
		return &buildv1.TrackImageResponse{
			Error: fmt.Sprintf("failed to track image: %v", err),
		}, nil
	}

	// Get updated total usage (only meaningful for Orbit registry)
	var newTotalUsage int64
	if req.RegistryType == "orbit" {
		usage, err := s.payloadClient.GetRegistryUsage(ctx, req.WorkspaceId)
		if err != nil {
			s.logger.Warn("Failed to get updated usage after tracking",
				"error", err,
				"workspaceID", req.WorkspaceId,
			)
		} else {
			newTotalUsage = usage.CurrentBytes
		}
	}

	s.logger.Info("Image tracked successfully",
		"workspaceID", req.WorkspaceId,
		"appID", req.AppId,
		"tag", req.Tag,
		"registryType", req.RegistryType,
		"sizeBytes", size,
		"newTotalUsage", newTotalUsage,
	)

	return &buildv1.TrackImageResponse{
		SizeBytes:     size,
		NewTotalUsage: newTotalUsage,
	}, nil
}

// Helper functions

// generateRequestID generates a unique request ID for temporary directories
func generateRequestID() string {
	return uuid.New().String()
}

// cloneForAnalysis clones a repository for analysis
func cloneForAnalysis(ctx context.Context, logger *slog.Logger, req *buildv1.AnalyzeRepositoryRequest, cloneDir string, requestID string) error {
	// DEBUG: Log token presence (not the actual token for security)
	tokenLen := len(req.InstallationToken)
	logger.Info("Cloning repository for analysis",
		"url", req.RepoUrl,
		"ref", req.Ref,
		"hasToken", tokenLen > 0,
		"tokenLength", tokenLen,
	)

	// Determine clone URL - embed credentials for private repos
	cloneURL := req.RepoUrl
	if req.InstallationToken != "" {
		// For GitHub, use x-access-token as username with the token
		// Convert https://github.com/owner/repo to https://x-access-token:TOKEN@github.com/owner/repo
		cloneURL = strings.Replace(req.RepoUrl, "https://github.com/",
			fmt.Sprintf("https://x-access-token:%s@github.com/", req.InstallationToken), 1)
		logger.Info("URL transformed for auth", "hasCredentials", strings.Contains(cloneURL, "@github.com"))
	}

	// Build git clone command
	cmd := exec.CommandContext(ctx, "git", "clone", "--depth", "1", "--single-branch")
	if req.Ref != "" {
		cmd.Args = append(cmd.Args, "--branch", req.Ref)
	}
	cmd.Args = append(cmd.Args, cloneURL, cloneDir)
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")

	// Run the clone command and capture output for debugging
	output, err := cmd.CombinedOutput()
	if err != nil {
		// Log full output for debugging (may contain useful error info)
		logger.Error("Git clone failed",
			"error", err,
			"output", string(output),
			"cloneDir", cloneDir,
		)
		return fmt.Errorf("git clone failed: %w (output: %s)", err, string(output))
	}

	logger.Info("Repository cloned successfully")
	return nil
}
