package builder

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// RegistryType represents the type of container registry
type RegistryType string

const (
	RegistryTypeGHCR RegistryType = "ghcr"
	RegistryTypeACR  RegistryType = "acr"
)

// RegistryConfig contains registry authentication details
type RegistryConfig struct {
	Type       RegistryType
	URL        string
	Repository string
	Token      string
	Username   string // For ACR
}

// BuildRequest contains parameters for building an image
type BuildRequest struct {
	RequestID         string
	AppID             string
	RepoURL           string
	Ref               string
	InstallationToken string
	LanguageVersion   string
	BuildCommand      string
	StartCommand      string
	BuildEnv          map[string]string
	Registry          RegistryConfig
	ImageTag          string // Optional - auto-generated if empty
}

// BuildResult contains the results of a build
type BuildResult struct {
	Success     bool
	ImageURL    string
	ImageDigest string
	Error       string
	Steps       []BuildStep
}

// BuildStep represents a step in the build process
type BuildStep struct {
	Name       string
	Status     string
	Message    string
	DurationMs int64
}

// Builder handles container image building
type Builder struct {
	logger  *slog.Logger
	workDir string
}

// NewBuilder creates a new Builder instance
func NewBuilder(logger *slog.Logger, workDir string) *Builder {
	if logger == nil {
		logger = slog.Default()
	}
	return &Builder{
		logger:  logger,
		workDir: workDir,
	}
}

// Build builds and pushes a container image
func (b *Builder) Build(ctx context.Context, req *BuildRequest) (*BuildResult, error) {
	// Validate input
	if err := b.validateRequest(req); err != nil {
		return nil, err
	}

	result := &BuildResult{
		Steps: []BuildStep{},
	}

	// Define build directory (will be created during clone)
	buildDir := filepath.Join(b.workDir, req.RequestID)
	defer os.RemoveAll(buildDir)

	// Step 1: Clone repository
	result.Steps = append(result.Steps, BuildStep{Name: "clone", Status: "running"})
	if err := b.cloneRepo(ctx, req, buildDir); err != nil {
		result.Steps[len(result.Steps)-1].Status = "failed"
		result.Steps[len(result.Steps)-1].Message = err.Error()
		result.Error = fmt.Sprintf("failed to clone repository: %v", err)
		return result, nil
	}
	result.Steps[len(result.Steps)-1].Status = "completed"

	// Step 2: Build image with Railpack/BuildKit
	result.Steps = append(result.Steps, BuildStep{Name: "build", Status: "running"})
	imageURL := generateImageTag(req)
	digest, err := b.buildImage(ctx, req, buildDir, imageURL)
	if err != nil {
		result.Steps[len(result.Steps)-1].Status = "failed"
		result.Steps[len(result.Steps)-1].Message = err.Error()
		result.Error = fmt.Sprintf("failed to build image: %v", err)
		return result, nil
	}
	result.Steps[len(result.Steps)-1].Status = "completed"

	// Step 3: Push image to registry
	result.Steps = append(result.Steps, BuildStep{Name: "push", Status: "running"})
	if err := b.pushImage(ctx, req, imageURL); err != nil {
		result.Steps[len(result.Steps)-1].Status = "failed"
		result.Steps[len(result.Steps)-1].Message = err.Error()
		result.Error = fmt.Sprintf("failed to push image: %v", err)
		return result, nil
	}
	result.Steps[len(result.Steps)-1].Status = "completed"

	result.Success = true
	result.ImageURL = imageURL
	result.ImageDigest = digest

	return result, nil
}

func (b *Builder) validateRequest(req *BuildRequest) error {
	if req.RequestID == "" {
		return fmt.Errorf("request_id is required")
	}
	if req.RepoURL == "" {
		return fmt.Errorf("repo_url is required")
	}
	if req.Registry.URL == "" {
		return fmt.Errorf("registry url is required")
	}
	if req.Registry.Repository == "" {
		return fmt.Errorf("registry repository is required")
	}
	return nil
}

func (b *Builder) cloneRepo(ctx context.Context, req *BuildRequest, buildDir string) error {
	b.logger.Info("Cloning repository", "url", req.RepoURL, "ref", req.Ref)

	// Clone the repository
	cmd := exec.CommandContext(ctx, "git", "clone", "--depth", "1", "--single-branch")
	if req.Ref != "" {
		cmd.Args = append(cmd.Args, "--branch", req.Ref)
	}
	cmd.Args = append(cmd.Args, req.RepoURL, buildDir)
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")

	// If token is provided, use git credential helper via GIT_ASKPASS
	// This avoids exposing the token in process listings
	var helperPath string
	if req.InstallationToken != "" {
		// Create a credential helper script that outputs the token
		// For GitHub App installation tokens, use x-access-token as username
		// Escape single quotes in the token for shell safety
		// Replace ' with '\'' (end quote, escaped quote, start quote)
		escapedToken := strings.ReplaceAll(req.InstallationToken, "'", "'\\''")
		helperScript := fmt.Sprintf("#!/bin/sh\necho '%s'\n", escapedToken)
		helperPath = filepath.Join(os.TempDir(), fmt.Sprintf("git-askpass-%s", req.RequestID))

		if err := os.WriteFile(helperPath, []byte(helperScript), 0700); err != nil {
			return fmt.Errorf("failed to create credential helper: %w", err)
		}
		defer os.Remove(helperPath)

		cmd.Env = append(cmd.Env, fmt.Sprintf("GIT_ASKPASS=%s", helperPath))
		cmd.Env = append(cmd.Env, "GIT_USERNAME=x-access-token")
	}

	// Run the clone command
	// Note: We don't log output as it may contain credentials in error messages
	if err := cmd.Run(); err != nil {
		b.logger.Error("Git clone failed", "error", err)
		return fmt.Errorf("git clone failed: %w", err)
	}

	b.logger.Info("Repository cloned successfully")
	return nil
}

func (b *Builder) buildImage(ctx context.Context, req *BuildRequest, buildDir, imageURL string) (string, error) {
	b.logger.Info("Building image", "dir", buildDir, "image", imageURL)

	// Check if Railpack is available
	railpackPath, err := exec.LookPath("railpack")
	if err != nil {
		// Fallback to docker build if Dockerfile exists
		return b.buildWithDocker(ctx, req, buildDir, imageURL)
	}

	// Build with Railpack
	cmd := exec.CommandContext(ctx, railpackPath, "build", buildDir, "-t", imageURL)

	// Start with current environment and add build-specific variables
	cmd.Env = os.Environ()
	for k, v := range req.BuildEnv {
		cmd.Env = append(cmd.Env, fmt.Sprintf("%s=%s", k, v))
	}

	output, err := cmd.CombinedOutput()
	if err != nil {
		b.logger.Error("Railpack build failed", "error", err, "output", string(output))
		return "", fmt.Errorf("railpack build failed: %w", err)
	}

	// TODO: Parse digest from Railpack output
	return "sha256:placeholder", nil
}

func (b *Builder) buildWithDocker(ctx context.Context, req *BuildRequest, buildDir, imageURL string) (string, error) {
	b.logger.Info("Building with Docker", "dir", buildDir, "image", imageURL)

	dockerfilePath := filepath.Join(buildDir, "Dockerfile")
	if _, err := os.Stat(dockerfilePath); os.IsNotExist(err) {
		return "", fmt.Errorf("no Dockerfile found and Railpack not available")
	}

	cmd := exec.CommandContext(ctx, "docker", "build", "-t", imageURL, buildDir)
	output, err := cmd.CombinedOutput()
	if err != nil {
		b.logger.Error("Docker build failed", "error", err, "output", string(output))
		return "", fmt.Errorf("docker build failed: %w", err)
	}

	// Get image digest
	inspectCmd := exec.CommandContext(ctx, "docker", "inspect", "--format={{index .RepoDigests 0}}", imageURL)
	digestOutput, _ := inspectCmd.Output()

	return strings.TrimSpace(string(digestOutput)), nil
}

func (b *Builder) pushImage(ctx context.Context, req *BuildRequest, imageURL string) error {
	b.logger.Info("Pushing image", "image", imageURL)

	// Login to registry
	if err := b.loginToRegistry(ctx, req); err != nil {
		return fmt.Errorf("registry login failed: %w", err)
	}

	// Push image
	cmd := exec.CommandContext(ctx, "docker", "push", imageURL)
	output, err := cmd.CombinedOutput()
	if err != nil {
		b.logger.Error("Docker push failed", "error", err, "output", string(output))
		return fmt.Errorf("docker push failed: %w", err)
	}

	return nil
}

func (b *Builder) loginToRegistry(ctx context.Context, req *BuildRequest) error {
	var cmd *exec.Cmd

	switch req.Registry.Type {
	case RegistryTypeGHCR:
		// For GHCR, use the installation token
		cmd = exec.CommandContext(ctx, "docker", "login", "ghcr.io",
			"-u", "x-access-token",
			"--password-stdin")
		cmd.Stdin = strings.NewReader(req.Registry.Token)

	case RegistryTypeACR:
		// For ACR, use provided credentials
		cmd = exec.CommandContext(ctx, "docker", "login", req.Registry.URL,
			"-u", req.Registry.Username,
			"--password-stdin")
		cmd.Stdin = strings.NewReader(req.Registry.Token)

	default:
		return fmt.Errorf("unsupported registry type: %s", req.Registry.Type)
	}

	output, err := cmd.CombinedOutput()
	if err != nil {
		b.logger.Error("Docker login failed", "error", err, "output", string(output))
		return fmt.Errorf("docker login failed: %w", err)
	}

	return nil
}

// generateImageTag creates the full image URL with tag
func generateImageTag(req *BuildRequest) string {
	tag := req.ImageTag
	if tag == "" {
		// Use first 7 chars of ref (commit SHA) as tag
		if len(req.Ref) >= 7 {
			tag = req.Ref[:7]
		} else if req.Ref != "" {
			tag = req.Ref
		} else {
			tag = "latest"
		}
	}

	return fmt.Sprintf("%s/%s:%s", req.Registry.URL, req.Registry.Repository, tag)
}
