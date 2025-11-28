package activities

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/drewpayment/orbit/temporal-workflows/internal/services"
)

// TemplateInstantiationInput contains all parameters needed for template instantiation
type TemplateInstantiationInput struct {
	TemplateID       string            // ID of the template being instantiated
	WorkspaceID      string            // Workspace where repo will be created
	TargetOrg        string            // GitHub org/user for the new repo
	RepositoryName   string            // Name for the new repository
	Description      string            // Description for the new repository
	IsPrivate        bool              // Whether the repo should be private
	IsGitHubTemplate bool              // True if template repo has GitHub template enabled
	SourceRepoOwner  string            // Owner of the source template repo
	SourceRepoName   string            // Name of the source template repo
	SourceRepoURL    string            // Full URL of source repo (for non-GitHub templates)
	Variables        map[string]string // Template variables to substitute
	UserID           string            // ID of user initiating instantiation
	InstallationID   string            // GitHub App installation ID for authentication
}

// CreateRepoResult contains information about a created repository
type CreateRepoResult struct {
	RepoURL  string
	RepoName string
}

// ApplyTemplateVariablesActivityInput contains parameters for variable substitution
type ApplyTemplateVariablesActivityInput struct {
	WorkDir   string
	Variables map[string]string
}

// PushToNewRepoActivityInput contains parameters for pushing to new repository
type PushToNewRepoActivityInput struct {
	WorkDir        string
	RepoURL        string
	InstallationID string // GitHub App installation ID for authentication
}

// FinalizeInstantiationActivityInput contains parameters for finalization
type FinalizeInstantiationActivityInput struct {
	TemplateID  string
	WorkspaceID string
	RepoURL     string
	RepoName    string
	UserID      string
}

// TokenService defines the interface for fetching GitHub tokens
type TokenService interface {
	GetInstallationToken(ctx context.Context, installationID string) (string, error)
}

// GitHubTemplateClient defines the interface for GitHub template operations
type GitHubTemplateClient interface {
	// CreateRepoFromTemplate creates a new repository from a GitHub template
	CreateRepoFromTemplate(ctx context.Context, sourceOwner, sourceRepo, targetOrg, targetName, description string, private bool) (string, error)

	// CreateRepository creates an empty GitHub repository
	CreateRepository(ctx context.Context, org, name, description string, private bool) (string, error)
}

// TemplateActivities holds the dependencies for template instantiation activities
type TemplateActivities struct {
	tokenService TokenService
	workDir      string
	logger       *slog.Logger
}

// NewTemplateActivities creates a new instance of TemplateActivities
func NewTemplateActivities(tokenService TokenService, workDir string, logger *slog.Logger) *TemplateActivities {
	if logger == nil {
		logger = slog.Default()
	}
	return &TemplateActivities{
		tokenService: tokenService,
		workDir:      workDir,
		logger:       logger,
	}
}

var repoNameRegex = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)

// ValidateInstantiationInput validates required fields and repository name format
func (a *TemplateActivities) ValidateInstantiationInput(ctx context.Context, input TemplateInstantiationInput) error {
	if input.TemplateID == "" {
		return errors.New("required field missing: TemplateID")
	}
	if input.WorkspaceID == "" {
		return errors.New("required field missing: WorkspaceID")
	}
	if input.TargetOrg == "" {
		return errors.New("required field missing: TargetOrg")
	}
	if input.RepositoryName == "" {
		return errors.New("required field missing: RepositoryName")
	}

	// Validate repository name format
	if !repoNameRegex.MatchString(input.RepositoryName) {
		return errors.New("invalid repository name: must contain only alphanumeric characters, hyphens, and underscores")
	}

	// If GitHub template, validate source repo fields
	if input.IsGitHubTemplate {
		if input.SourceRepoOwner == "" {
			return errors.New("required field missing: SourceRepoOwner (for GitHub template)")
		}
		if input.SourceRepoName == "" {
			return errors.New("required field missing: SourceRepoName (for GitHub template)")
		}
	} else {
		// For non-GitHub templates, validate source repo URL
		if input.SourceRepoURL == "" {
			return errors.New("required field missing: SourceRepoURL (for non-GitHub template)")
		}
	}

	return nil
}

// CreateRepoFromTemplate creates a repository using GitHub's Template API
func (a *TemplateActivities) CreateRepoFromTemplate(ctx context.Context, input TemplateInstantiationInput) (*CreateRepoResult, error) {
	a.logger.Info("Creating repository from GitHub template",
		"sourceOwner", input.SourceRepoOwner,
		"sourceRepo", input.SourceRepoName,
		"targetOrg", input.TargetOrg,
		"targetName", input.RepositoryName)

	// Fetch token for this installation
	token, err := a.tokenService.GetInstallationToken(ctx, input.InstallationID)
	if err != nil {
		return nil, fmt.Errorf("failed to get GitHub token: %w", err)
	}

	// Create client with token
	client := services.NewGitHubTemplateClient("", token)

	repoURL, err := client.CreateRepoFromTemplate(
		ctx,
		input.SourceRepoOwner,
		input.SourceRepoName,
		input.TargetOrg,
		input.RepositoryName,
		input.Description,
		input.IsPrivate,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create repository from template: %w", err)
	}

	return &CreateRepoResult{
		RepoURL:  repoURL,
		RepoName: input.RepositoryName,
	}, nil
}

// CreateEmptyRepo creates an empty GitHub repository
func (a *TemplateActivities) CreateEmptyRepo(ctx context.Context, input TemplateInstantiationInput) (*CreateRepoResult, error) {
	a.logger.Info("Creating empty repository",
		"org", input.TargetOrg,
		"name", input.RepositoryName)

	// Fetch token for this installation
	token, err := a.tokenService.GetInstallationToken(ctx, input.InstallationID)
	if err != nil {
		return nil, fmt.Errorf("failed to get GitHub token: %w", err)
	}

	// Create client with token
	client := services.NewGitHubTemplateClient("", token)

	repoURL, err := client.CreateRepository(
		ctx,
		input.TargetOrg,
		input.RepositoryName,
		input.Description,
		input.IsPrivate,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create empty repository: %w", err)
	}

	return &CreateRepoResult{
		RepoURL:  repoURL,
		RepoName: input.RepositoryName,
	}, nil
}

// CloneTemplateRepo clones the template repository, removes .git directory, and returns the work directory path
func (a *TemplateActivities) CloneTemplateRepo(ctx context.Context, input TemplateInstantiationInput) (string, error) {
	a.logger.Info("Cloning template repository", "sourceURL", input.SourceRepoURL)

	// Create unique work directory
	workDir := filepath.Join(a.workDir, fmt.Sprintf("template-%s-%s", input.TemplateID, input.RepositoryName))
	if err := os.MkdirAll(workDir, 0755); err != nil {
		return "", fmt.Errorf("failed to create work directory: %w", err)
	}

	// Build clone URL with authentication if we have an installation ID
	cloneURL := input.SourceRepoURL
	if input.InstallationID != "" {
		token, err := a.tokenService.GetInstallationToken(ctx, input.InstallationID)
		if err != nil {
			a.logger.Warn("Failed to get token for clone, attempting unauthenticated", "error", err)
		} else {
			// Insert token into URL for authenticated clone
			cloneURL = strings.Replace(cloneURL, "https://", fmt.Sprintf("https://x-access-token:%s@", token), 1)
		}
	}

	// Clone the repository
	cmd := exec.CommandContext(ctx, "git", "clone", cloneURL, workDir)
	output, err := cmd.CombinedOutput()
	if err != nil {
		// Clean up on failure
		_ = os.RemoveAll(workDir)
		// Sanitize output to remove any tokens
		sanitizedOutput := sanitizeGitOutput(string(output))
		return "", fmt.Errorf("failed to clone repository: %w (output: %s)", err, sanitizedOutput)
	}

	// Remove .git directory to start fresh
	gitDir := filepath.Join(workDir, ".git")
	if err := os.RemoveAll(gitDir); err != nil {
		// Clean up on failure
		_ = os.RemoveAll(workDir)
		return "", fmt.Errorf("failed to remove .git directory: %w", err)
	}

	a.logger.Info("Template repository cloned successfully", "workDir", workDir)
	return workDir, nil
}

// ApplyTemplateVariables substitutes {{variable}} patterns in all text files
func (a *TemplateActivities) ApplyTemplateVariables(ctx context.Context, input ApplyTemplateVariablesActivityInput) error {
	a.logger.Info("Applying template variables", "workDir", input.WorkDir, "variableCount", len(input.Variables))

	if len(input.Variables) == 0 {
		a.logger.Info("No variables to apply, skipping")
		return nil
	}

	// Walk through all files in the work directory
	err := filepath.WalkDir(input.WorkDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}

		// Skip directories
		if d.IsDir() {
			return nil
		}

		// Read file content
		content, err := os.ReadFile(path)
		if err != nil {
			return fmt.Errorf("failed to read file %s: %w", path, err)
		}

		// Skip binary files (heuristic: if file contains null bytes in first 512 bytes)
		sampleSize := 512
		if len(content) < sampleSize {
			sampleSize = len(content)
		}
		if strings.Contains(string(content[:sampleSize]), "\x00") {
			a.logger.Debug("Skipping binary file", "path", path)
			return nil
		}

		// Apply variable substitutions
		contentStr := string(content)
		modified := false
		for key, value := range input.Variables {
			placeholder := fmt.Sprintf("{{%s}}", key)
			if strings.Contains(contentStr, placeholder) {
				contentStr = strings.ReplaceAll(contentStr, placeholder, value)
				modified = true
			}
		}

		// Write back if modified
		if modified {
			if err := os.WriteFile(path, []byte(contentStr), d.Type().Perm()); err != nil {
				return fmt.Errorf("failed to write file %s: %w", path, err)
			}
			a.logger.Debug("Applied variables to file", "path", path)
		}

		return nil
	})

	if err != nil {
		return fmt.Errorf("failed to apply template variables: %w", err)
	}

	a.logger.Info("Template variables applied successfully")
	return nil
}

// PushToNewRepo initializes git, adds all files, commits, and pushes to the new repository
func (a *TemplateActivities) PushToNewRepo(ctx context.Context, input PushToNewRepoActivityInput) error {
	a.logger.Info("Pushing to new repository", "workDir", input.WorkDir, "repoURL", input.RepoURL)

	// Initialize git repository
	if err := a.runGitCommand(ctx, input.WorkDir, "init"); err != nil {
		return fmt.Errorf("failed to initialize git: %w", err)
	}

	// Configure git
	_ = a.runGitCommand(ctx, input.WorkDir, "config", "user.name", "Orbit IDP")
	_ = a.runGitCommand(ctx, input.WorkDir, "config", "user.email", "bot@orbit.dev")

	// Add all files
	if err := a.runGitCommand(ctx, input.WorkDir, "add", "."); err != nil {
		return fmt.Errorf("failed to add files: %w", err)
	}

	// Commit
	if err := a.runGitCommand(ctx, input.WorkDir, "commit", "-m", "Initial commit from template"); err != nil {
		return fmt.Errorf("failed to commit: %w", err)
	}

	// Build remote URL with authentication if we have installation ID
	remoteURL := input.RepoURL
	if input.InstallationID != "" {
		token, err := a.tokenService.GetInstallationToken(ctx, input.InstallationID)
		if err != nil {
			return fmt.Errorf("failed to get GitHub token for push: %w", err)
		}
		remoteURL = strings.Replace(remoteURL, "https://", fmt.Sprintf("https://x-access-token:%s@", token), 1)
	}

	// Add remote
	if err := a.runGitCommand(ctx, input.WorkDir, "remote", "add", "origin", remoteURL); err != nil {
		// Remote might already exist, try setting URL instead
		_ = a.runGitCommand(ctx, input.WorkDir, "remote", "set-url", "origin", remoteURL)
	}

	// Push to main branch
	if err := a.runGitCommand(ctx, input.WorkDir, "push", "-u", "origin", "main"); err != nil {
		return fmt.Errorf("failed to push: %w", err)
	}

	a.logger.Info("Successfully pushed to new repository")
	return nil
}

// CleanupWorkDir removes the temporary work directory
func (a *TemplateActivities) CleanupWorkDir(ctx context.Context, workDir string) error {
	a.logger.Info("Cleaning up work directory", "workDir", workDir)

	if err := os.RemoveAll(workDir); err != nil {
		return fmt.Errorf("failed to remove work directory: %w", err)
	}

	a.logger.Info("Work directory cleaned up successfully")
	return nil
}

// FinalizeInstantiation records template usage and sends notifications
func (a *TemplateActivities) FinalizeInstantiation(ctx context.Context, input FinalizeInstantiationActivityInput) error {
	a.logger.Info("Finalizing template instantiation",
		"templateID", input.TemplateID,
		"workspaceID", input.WorkspaceID,
		"repoURL", input.RepoURL,
		"repoName", input.RepoName,
		"userID", input.UserID)

	// TODO: Record usage in database
	// TODO: Send notification to user
	// TODO: Update template usage statistics

	// For now, just log
	a.logger.Info("Template instantiation finalized (placeholder implementation)")
	return nil
}

// runGitCommand is a helper to run git commands in a specific directory
func (a *TemplateActivities) runGitCommand(ctx context.Context, dir string, args ...string) error {
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = dir
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("git %v failed: %w (output: %s)", args, err, string(output))
	}
	return nil
}
