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
	PackageManager    string // "npm", "yarn", "pnpm", "bun", or "" for auto
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

	// Determine clone URL - embed credentials for private repos
	cloneURL := req.RepoURL
	if req.InstallationToken != "" {
		// For GitHub, use x-access-token as username with the token
		// Convert https://github.com/owner/repo to https://x-access-token:TOKEN@github.com/owner/repo
		cloneURL = strings.Replace(req.RepoURL, "https://github.com/",
			fmt.Sprintf("https://x-access-token:%s@github.com/", req.InstallationToken), 1)
	}

	// Clone the repository
	cmd := exec.CommandContext(ctx, "git", "clone", "--depth", "1", "--single-branch")
	if req.Ref != "" {
		cmd.Args = append(cmd.Args, "--branch", req.Ref)
	}
	cmd.Args = append(cmd.Args, cloneURL, buildDir)
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")

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
	// Note: Railpack uses --name for image name, not -t like Docker
	// Secrets must be passed via --env flags, not process environment variables
	args := []string{"build", buildDir, "--name", imageURL}

	// Pass environment variables as Railpack secrets via --env flag
	// These get mounted as BuildKit secrets during the Docker build
	for k, v := range req.BuildEnv {
		args = append(args, "--env", fmt.Sprintf("%s=%s", k, v))
	}

	b.logger.Info("Railpack build args", "envCount", len(req.BuildEnv), "envKeys", getMapKeys(req.BuildEnv))

	cmd := exec.CommandContext(ctx, railpackPath, args...)

	// Keep current environment for Railpack itself (not the Docker build)
	cmd.Env = os.Environ()

	// Pass package manager to Railpack if specified
	if req.PackageManager != "" {
		b.logger.Info("Using specified package manager", "pm", req.PackageManager)
		cmd.Env = append(cmd.Env, fmt.Sprintf("RAILPACK_PACKAGE_MANAGER=%s", req.PackageManager))
	}

	output, err := cmd.CombinedOutput()
	if err != nil {
		outputStr := string(output)
		b.logger.Error("Railpack build failed", "error", err, "output", outputStr)
		return "", fmt.Errorf("railpack build failed: %s", extractBuildErrorSummary(outputStr))
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
		outputStr := string(output)
		b.logger.Error("Docker build failed", "error", err, "output", outputStr)
		// Include relevant parts of output in error for frontend parsing
		return "", fmt.Errorf("docker build failed: %s", extractBuildErrorSummary(outputStr))
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

	b.logger.Info("Logging in to registry",
		"type", req.Registry.Type,
		"url", req.Registry.URL,
		"tokenLength", len(req.Registry.Token),
		"tokenPrefix", req.Registry.Token[:min(10, len(req.Registry.Token))]+"...",
	)

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

// getMapKeys returns the keys of a map as a slice (for logging)
func getMapKeys(m map[string]string) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}

// extractBuildErrorSummary extracts meaningful error context from build output
// It tries to capture enough context to be useful for debugging
func extractBuildErrorSummary(output string) string {
	lines := strings.Split(output, "\n")

	// First pass: look for specific error patterns and collect context
	var errorLines []string
	var foundError bool
	var errorStartIdx int

	for i, line := range lines {
		trimmed := strings.TrimSpace(line)

		// Lockfile errors - return immediately with clear message
		if strings.Contains(trimmed, "Lockfile not found") {
			return "Lockfile not found. Please commit a lockfile (bun.lock, package-lock.json, yarn.lock, or pnpm-lock.yaml) to your repository."
		}

		// TypeScript/Build errors - these are often the most useful
		if strings.Contains(trimmed, "error TS") {
			if !foundError {
				foundError = true
				errorStartIdx = i
			}
			errorLines = append(errorLines, trimmed)
		}

		// Next.js build errors
		if strings.Contains(trimmed, "Error:") || strings.Contains(trimmed, "error:") {
			if !foundError {
				foundError = true
				errorStartIdx = i
			}
			errorLines = append(errorLines, trimmed)
		}

		// npm/yarn/pnpm/bun specific errors
		if strings.Contains(trimmed, "npm ERR!") ||
			strings.Contains(trimmed, "ERR_PNPM") ||
			strings.HasPrefix(trimmed, "error:") ||
			(strings.HasPrefix(trimmed, "YN") && strings.Contains(trimmed, "Error")) {
			if !foundError {
				foundError = true
				errorStartIdx = i
			}
			errorLines = append(errorLines, trimmed)
		}

		// Module not found errors
		if strings.Contains(trimmed, "Module not found") ||
			strings.Contains(trimmed, "Cannot find module") {
			if !foundError {
				foundError = true
				errorStartIdx = i
			}
			errorLines = append(errorLines, trimmed)
		}

		// Script exit errors - capture surrounding context
		if strings.Contains(trimmed, "exited with code") {
			if !foundError {
				foundError = true
				errorStartIdx = i
			}
			errorLines = append(errorLines, trimmed)
		}
	}

	// If we found errors, return them with context
	if len(errorLines) > 0 {
		// Limit to most relevant errors (last 10 error lines)
		if len(errorLines) > 10 {
			errorLines = errorLines[len(errorLines)-10:]
		}

		// Also grab a few lines before the first error for context
		var contextLines []string
		contextStart := errorStartIdx - 3
		if contextStart < 0 {
			contextStart = 0
		}
		for i := contextStart; i < errorStartIdx && i < len(lines); i++ {
			trimmed := strings.TrimSpace(lines[i])
			if trimmed != "" && !strings.HasPrefix(trimmed, "#") {
				contextLines = append(contextLines, trimmed)
			}
		}

		// Combine context + errors
		result := strings.Join(append(contextLines, errorLines...), "\n")

		// Truncate if too long, but keep it useful
		if len(result) > 1500 {
			result = result[len(result)-1500:]
			// Find first newline to avoid cutting mid-line
			if idx := strings.Index(result, "\n"); idx > 0 {
				result = "..." + result[idx:]
			}
		}
		return result
	}

	// Fallback: return last 20 non-empty lines for context
	var lastLines []string
	for i := len(lines) - 1; i >= 0 && len(lastLines) < 20; i-- {
		trimmed := strings.TrimSpace(lines[i])
		if trimmed != "" && !strings.HasPrefix(trimmed, "DEPRECATED") && !strings.HasPrefix(trimmed, "#") {
			lastLines = append([]string{trimmed}, lastLines...)
		}
	}

	if len(lastLines) > 0 {
		return strings.Join(lastLines, "\n")
	}

	return "Build failed. Check logs for details."
}
