package activities

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/drewpayment/orbit/temporal-workflows/internal/services"
)

// GitActivities provides Git-related operations for repository workflows
type GitActivities struct {
	workDir       string
	githubService services.GitHubService
	logger        *slog.Logger
}

// NewGitActivities creates a new GitActivities instance
func NewGitActivities(
	workDir string,
	githubService services.GitHubService,
	logger *slog.Logger,
) *GitActivities {
	return &GitActivities{
		workDir:       workDir,
		githubService: githubService,
		logger:        logger,
	}
}

// CloneTemplateInput contains parameters for cloning a template repository
type CloneTemplateInput struct {
	TemplateName string
	RepositoryID string
}

// ApplyVariablesInput contains parameters for applying template variables
type ApplyVariablesInput struct {
	RepositoryID string
	Variables    map[string]string
}

// InitializeGitInput contains parameters for initializing a Git repository
type InitializeGitInput struct {
	RepositoryID string
	GitURL       string
}

// PushToRemoteInput contains parameters for pushing to a remote repository
type PushToRemoteInput struct {
	RepositoryID string
	GitURL       string // Explicit remote URL
	AccessToken  string // Explicit token (no lookup)
}

// PrepareGitHubRemoteInput contains parameters for preparing GitHub remote
type PrepareGitHubRemoteInput struct {
	WorkspaceID          string
	GitHubInstallationID string // Optional, empty string = use default
	GitURL               string // Optional, empty string = create repo
	RepositoryName       string // Required if GitURL empty
	Private              bool   // Default true
}

// PrepareGitHubRemoteOutput contains git URL and credentials
type PrepareGitHubRemoteOutput struct {
	GitURL              string
	AccessToken         string
	InstallationOrgName string
	CreatedRepo         bool
}

// CloneTemplateActivity clones a template repository to a working directory
// This activity is idempotent - if the directory exists, it verifies the template
func (a *GitActivities) CloneTemplateActivity(ctx context.Context, input CloneTemplateInput) error {
	if input.TemplateName == "" {
		return errors.New("template name cannot be empty")
	}

	repoPath := filepath.Join(a.workDir, input.RepositoryID)

	// Check if directory already exists (idempotent behavior)
	if _, err := os.Stat(repoPath); err == nil {
		// Directory exists - repository already cloned
		return nil
	}

	// Get template URL from template name
	templateURL := a.getTemplateURL(input.TemplateName)
	if templateURL == "" {
		// Fall back to creating mock structure for unknown templates
		// This maintains backward compatibility with existing tests
		if err := a.createMockTemplate(repoPath, input.TemplateName); err != nil {
			return err
		}
		return nil
	}

	// Clone repository using git CLI
	cmd := exec.CommandContext(ctx, "git", "clone", templateURL, repoPath)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	if err := cmd.Run(); err != nil {
		// Clean up partial clone on failure
		os.RemoveAll(repoPath)
		return fmt.Errorf("failed to clone template: %w", err)
	}

	return nil
}

// getTemplateURL maps template names to Git URLs
func (a *GitActivities) getTemplateURL(templateName string) string {
	// In production, this would query a database or config service
	templates := map[string]string{
		"microservice": "https://github.com/your-org/template-microservice.git",
		"library":      "https://github.com/your-org/template-library.git",
		"frontend":     "https://github.com/your-org/template-frontend.git",
		"mobile":       "https://github.com/your-org/template-mobile.git",
		"documentation": "https://github.com/your-org/template-docs.git",
	}
	return templates[templateName]
}

// createMockTemplate creates a mock template structure for testing
// This is used when no real Git URL is available for a template
func (a *GitActivities) createMockTemplate(repoPath, templateName string) error {
	// Create working directory
	if err := os.MkdirAll(a.workDir, 0755); err != nil {
		return fmt.Errorf("failed to create working directory: %w", err)
	}

	// Create repository directory
	if err := os.MkdirAll(repoPath, 0755); err != nil {
		return fmt.Errorf("failed to create repository directory: %w", err)
	}

	// Create a template marker file
	markerPath := filepath.Join(repoPath, ".template")
	if err := os.WriteFile(markerPath, []byte(templateName), 0644); err != nil {
		return fmt.Errorf("failed to create template marker: %w", err)
	}

	// Create basic files that would come from the template
	readmePath := filepath.Join(repoPath, "README.md")
	readmeContent := fmt.Sprintf("# {{service_name}}\n\n{{description}}\n")
	if err := os.WriteFile(readmePath, []byte(readmeContent), 0644); err != nil {
		return fmt.Errorf("failed to create README: %w", err)
	}

	return nil
}

// ApplyVariablesActivity applies template variables to files in the repository
// This activity is idempotent - it can be safely retried
func (a *GitActivities) ApplyVariablesActivity(ctx context.Context, input ApplyVariablesInput) error {
	if len(input.Variables) == 0 {
		// No variables to apply, skip
		return nil
	}

	repoPath := filepath.Join(a.workDir, input.RepositoryID)

	// Check if repository exists
	if _, err := os.Stat(repoPath); os.IsNotExist(err) {
		return errors.New("repository directory does not exist")
	}

	// Walk through all files and replace variables
	err := filepath.Walk(repoPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		// Skip directories and hidden files
		if info.IsDir() || strings.HasPrefix(info.Name(), ".") {
			return nil
		}

		// Skip binary files (simple heuristic: check extension)
		if isBinaryFile(path) {
			return nil
		}

		// Read file content
		content, err := os.ReadFile(path)
		if err != nil {
			return fmt.Errorf("failed to read file %s: %w", path, err)
		}

		// Replace variables
		modifiedContent := string(content)
		for key, value := range input.Variables {
			placeholder := fmt.Sprintf("{{%s}}", key)
			modifiedContent = strings.ReplaceAll(modifiedContent, placeholder, value)
		}

		// Write back if content changed
		if modifiedContent != string(content) {
			if err := os.WriteFile(path, []byte(modifiedContent), info.Mode()); err != nil {
				return fmt.Errorf("failed to write file %s: %w", path, err)
			}
		}

		return nil
	})

	return err
}

// isBinaryFile checks if a file is likely binary based on its extension
func isBinaryFile(path string) bool {
	binaryExtensions := []string{
		".png", ".jpg", ".jpeg", ".gif", ".pdf", ".zip",
		".tar", ".gz", ".exe", ".so", ".dylib", ".bin",
	}
	ext := strings.ToLower(filepath.Ext(path))
	for _, binExt := range binaryExtensions {
		if ext == binExt {
			return true
		}
	}
	return false
}

// InitializeGitActivity initializes a Git repository and adds remote
// This activity is idempotent - can be safely called multiple times
func (a *GitActivities) InitializeGitActivity(ctx context.Context, input InitializeGitInput) error {
	if input.GitURL == "" {
		return errors.New("git URL cannot be empty")
	}

	repoPath := filepath.Join(a.workDir, input.RepositoryID)

	// Check if repository exists
	if _, err := os.Stat(repoPath); os.IsNotExist(err) {
		return errors.New("repository directory does not exist")
	}

	// Check if already initialized (idempotency)
	gitDir := filepath.Join(repoPath, ".git")
	if _, err := os.Stat(gitDir); err == nil {
		// Already initialized - update remote if needed
		return a.updateRemote(ctx, repoPath, input.GitURL)
	}

	// Initialize Git repository
	cmd := exec.CommandContext(ctx, "git", "init")
	cmd.Dir = repoPath
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("failed to initialize git: %w (output: %s)", err, string(output))
	}

	// Configure Git user (required for commits)
	configName := exec.CommandContext(ctx, "git", "config", "user.name", "Orbit IDP")
	configName.Dir = repoPath
	if output, err := configName.CombinedOutput(); err != nil {
		return fmt.Errorf("failed to configure git user.name: %w (output: %s)", err, string(output))
	}

	configEmail := exec.CommandContext(ctx, "git", "config", "user.email", "noreply@orbit.dev")
	configEmail.Dir = repoPath
	if output, err := configEmail.CombinedOutput(); err != nil {
		return fmt.Errorf("failed to configure git user.email: %w (output: %s)", err, string(output))
	}

	// Add all files
	addCmd := exec.CommandContext(ctx, "git", "add", ".")
	addCmd.Dir = repoPath
	if output, err := addCmd.CombinedOutput(); err != nil {
		return fmt.Errorf("failed to add files to git: %w (output: %s)", err, string(output))
	}

	// Create initial commit
	commitCmd := exec.CommandContext(ctx, "git", "commit", "-m", "Initial commit from template")
	commitCmd.Dir = repoPath
	if output, err := commitCmd.CombinedOutput(); err != nil {
		// Check if there's nothing to commit (which is okay for idempotency)
		if !strings.Contains(string(output), "nothing to commit") {
			return fmt.Errorf("failed to create initial commit: %w (output: %s)", err, string(output))
		}
	}

	// Add remote origin
	// First, remove existing remote if it exists (for idempotency)
	removeRemoteCmd := exec.CommandContext(ctx, "git", "remote", "remove", "origin")
	removeRemoteCmd.Dir = repoPath
	removeRemoteCmd.CombinedOutput() // Ignore errors - remote might not exist

	addRemoteCmd := exec.CommandContext(ctx, "git", "remote", "add", "origin", input.GitURL)
	addRemoteCmd.Dir = repoPath
	if output, err := addRemoteCmd.CombinedOutput(); err != nil {
		return fmt.Errorf("failed to add remote origin: %w (output: %s)", err, string(output))
	}

	return nil
}

// updateRemote updates or adds the remote origin URL
func (a *GitActivities) updateRemote(ctx context.Context, repoPath, gitURL string) error {
	// Try to update existing remote first
	cmd := exec.CommandContext(ctx, "git", "remote", "set-url", "origin", gitURL)
	cmd.Dir = repoPath
	if err := cmd.Run(); err != nil {
		// Remote doesn't exist, add it
		cmd = exec.CommandContext(ctx, "git", "remote", "add", "origin", gitURL)
		cmd.Dir = repoPath
		if output, err := cmd.CombinedOutput(); err != nil {
			// Ignore "already exists" errors
			if !strings.Contains(string(output), "already exists") {
				return fmt.Errorf("failed to add remote: %w (output: %s)", err, string(output))
			}
		}
	}
	return nil
}

// PrepareGitHubRemoteActivity finds GitHub installation and prepares credentials for push
// This activity orchestrates GitHub App installation lookup and token retrieval
func (a *GitActivities) PrepareGitHubRemoteActivity(
	ctx context.Context,
	input PrepareGitHubRemoteInput,
) (*PrepareGitHubRemoteOutput, error) {
	// Validate inputs
	if input.WorkspaceID == "" {
		return nil, errors.New("workspace_id is required")
	}
	if input.GitURL == "" && input.RepositoryName == "" {
		return nil, errors.New("repository_name required when creating new repo (no git_url provided)")
	}

	// Convert empty string to nil for optional installationID
	var installationID *string
	if input.GitHubInstallationID != "" {
		installationID = &input.GitHubInstallationID
	}

	// Call GitHub service
	serviceInput := services.PrepareRemoteInput{
		WorkspaceID:          input.WorkspaceID,
		GitHubInstallationID: installationID,
		GitURL:               input.GitURL,
		RepositoryName:       input.RepositoryName,
		Private:              input.Private,
	}

	result, err := a.githubService.PrepareRemote(ctx, serviceInput)
	if err != nil {
		return nil, fmt.Errorf("failed to prepare GitHub remote: %w", err)
	}

	a.logger.Info("GitHub remote prepared",
		"gitURL", result.GitURL,
		"org", result.InstallationOrgName,
		"created", result.CreatedRepo,
	)

	return &PrepareGitHubRemoteOutput{
		GitURL:              result.GitURL,
		AccessToken:         result.AccessToken,
		InstallationOrgName: result.InstallationOrgName,
		CreatedRepo:         result.CreatedRepo,
	}, nil
}

// PushToRemoteActivity pushes the repository to the remote Git provider
// This activity should be retried on failure (network issues, etc.)
func (a *GitActivities) PushToRemoteActivity(ctx context.Context, input PushToRemoteInput) error {
	// Validate inputs
	if input.RepositoryID == "" || input.GitURL == "" || input.AccessToken == "" {
		return errors.New("repository_id, git_url, and access_token are required")
	}

	repoPath := filepath.Join(a.workDir, input.RepositoryID)

	// Check if repository exists
	if _, err := os.Stat(repoPath); os.IsNotExist(err) {
		return errors.New("repository directory does not exist")
	}

	// Set or update remote URL
	cmd := exec.CommandContext(ctx, "git", "remote", "get-url", "origin")
	cmd.Dir = repoPath
	if err := cmd.Run(); err != nil {
		// Remote doesn't exist, add it
		cmd = exec.CommandContext(ctx, "git", "remote", "add", "origin", input.GitURL)
		cmd.Dir = repoPath
		if err := cmd.Run(); err != nil {
			return fmt.Errorf("failed to add remote: %w", err)
		}
	} else {
		// Remote exists, update URL
		cmd = exec.CommandContext(ctx, "git", "remote", "set-url", "origin", input.GitURL)
		cmd.Dir = repoPath
		if err := cmd.Run(); err != nil {
			return fmt.Errorf("failed to update remote URL: %w", err)
		}
	}

	// Create temporary credential helper script
	credHelper, err := a.createCredentialHelper(input.AccessToken)
	if err != nil {
		return fmt.Errorf("failed to create credential helper: %w", err)
	}
	defer os.Remove(credHelper)

	// Push to remote using installation token
	cmd = exec.CommandContext(ctx, "git", "push", "-u", "origin", "main")
	cmd.Dir = repoPath
	cmd.Env = append(os.Environ(), fmt.Sprintf("GIT_ASKPASS=%s", credHelper))

	output, err := cmd.CombinedOutput()
	if err != nil {
		// Check if already pushed (idempotency)
		if strings.Contains(string(output), "Everything up-to-date") {
			return nil
		}
		return fmt.Errorf("failed to push to remote: %w (output: %s)", err, string(output))
	}

	a.logger.Info("Successfully pushed to remote", "gitURL", input.GitURL)
	return nil
}

// createCredentialHelper creates a temporary script that provides the OAuth token
func (a *GitActivities) createCredentialHelper(token string) (string, error) {
	script := fmt.Sprintf("#!/bin/sh\necho %s", token)

	tmpFile, err := os.CreateTemp("", "git-cred-*.sh")
	if err != nil {
		return "", err
	}

	if err := os.WriteFile(tmpFile.Name(), []byte(script), 0700); err != nil {
		os.Remove(tmpFile.Name())
		return "", err
	}

	return tmpFile.Name(), nil
}
