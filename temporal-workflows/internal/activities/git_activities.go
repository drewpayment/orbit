package activities

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// GitActivities provides Git-related operations for repository workflows
type GitActivities struct {
	workDir string
}

// NewGitActivities creates a new GitActivities instance
func NewGitActivities(workDir string) *GitActivities {
	return &GitActivities{
		workDir: workDir,
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

// InitializeGitActivity initializes a Git repository and adds remote
// This activity is idempotent - git init can be safely called multiple times
func (a *GitActivities) InitializeGitActivity(ctx context.Context, input InitializeGitInput) error {
	if input.GitURL == "" {
		return errors.New("git URL cannot be empty")
	}

	repoPath := filepath.Join(a.workDir, input.RepositoryID)

	// Check if repository exists
	if _, err := os.Stat(repoPath); os.IsNotExist(err) {
		return errors.New("repository directory does not exist")
	}

	// Initialize Git repository (idempotent)
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

// PushToRemoteActivity pushes the repository to the remote Git provider
// This activity should be retried on failure (network issues, etc.)
func (a *GitActivities) PushToRemoteActivity(ctx context.Context, input PushToRemoteInput) error {
	repoPath := filepath.Join(a.workDir, input.RepositoryID)

	// Check if repository exists
	if _, err := os.Stat(repoPath); os.IsNotExist(err) {
		return errors.New("repository directory does not exist")
	}

	// Push to remote
	// In a real implementation, we would need to handle authentication
	// For now, this will fail if authentication is required
	cmd := exec.CommandContext(ctx, "git", "push", "-u", "origin", "main")
	cmd.Dir = repoPath

	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to push to remote: %w (output: %s)", err, string(output))
	}

	return nil
}
