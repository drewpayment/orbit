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

	"gopkg.in/yaml.v3"

	"github.com/drewpayment/orbit/temporal-workflows/internal/services"
	"github.com/drewpayment/orbit/temporal-workflows/internal/templating"
)

// TemplateInstantiationInput contains all parameters needed for template instantiation
// JSON tags must match what the repository-service sends (via pkg/types)
type TemplateInstantiationInput struct {
	TemplateID       string            `json:"templateId"`       // ID of the template being instantiated
	WorkspaceID      string            `json:"workspaceId"`      // Workspace where repo will be created
	TargetOrg        string            `json:"targetOrg"`        // GitHub org/user for the new repo
	RepositoryName   string            `json:"repositoryName"`   // Name for the new repository
	Description      string            `json:"description"`      // Description for the new repository
	IsPrivate        bool              `json:"isPrivate"`        // Whether the repo should be private
	IsGitHubTemplate bool              `json:"isGitHubTemplate"` // True if template repo has GitHub template enabled
	SourceRepoOwner  string            `json:"sourceRepoOwner"`  // Owner of the source template repo
	SourceRepoName   string            `json:"sourceRepoName"`   // Name of the source template repo
	SourceRepoURL    string            `json:"sourceRepoUrl"`    // Full URL of source repo (for non-GitHub templates)
	Variables        map[string]string `json:"variables"`        // Template variables to substitute
	UserID           string            `json:"userId"`           // ID of user initiating instantiation
	InstallationID   string            `json:"installationId"`   // GitHub App installation ID for authentication
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

// ApplyTemplateVariablesResult reports files that could not be rendered as a
// template (content or name). Such files are left byte-for-byte unmodified;
// this is not a fatal condition for the activity as a whole.
type ApplyTemplateVariablesResult struct {
	SkippedFiles []string
}

// templateManifest is the subset of orbit-template.yaml/.yml this activity
// reads. Parsed best-effort: a missing or malformed manifest simply yields
// an empty rawFiles list rather than failing the activity.
type templateManifest struct {
	RawFiles []string `yaml:"rawFiles"`
}

// loadRawFilePatterns best-effort reads orbit-template.yaml (or .yml) from
// workDir's root and returns its rawFiles glob patterns. Any error (missing
// file, malformed YAML) yields an empty, non-fatal result.
func loadRawFilePatterns(workDir string, logger *slog.Logger) []string {
	for _, name := range []string{"orbit-template.yaml", "orbit-template.yml"} {
		data, err := os.ReadFile(filepath.Join(workDir, name))
		if err != nil {
			continue
		}
		var manifest templateManifest
		if err := yaml.Unmarshal(data, &manifest); err != nil {
			logger.Warn("Failed to parse template manifest for rawFiles, ignoring", "file", name, "error", err)
			return nil
		}
		return manifest.RawFiles
	}
	return nil
}

// matchesRawFilePattern reports whether relPath matches any of the given
// filepath.Match glob patterns. Patterns are single-segment (no `**`); a
// pattern like "charts/*.yaml" matches "charts/values.yaml" but not
// "charts/nested/values.yaml" — filepath.Match's documented limitation.
func matchesRawFilePattern(relPath string, patterns []string) bool {
	for _, pattern := range patterns {
		if ok, err := filepath.Match(pattern, relPath); err == nil && ok {
			return true
		}
	}
	return false
}

// isBinaryContent applies the existing null-byte heuristic to a content
// sample.
func isBinaryContent(content []byte) bool {
	sampleSize := 512
	if len(content) < sampleSize {
		sampleSize = len(content)
	}
	return strings.Contains(string(content[:sampleSize]), "\x00")
}

// isSafeRenderedName reports whether a rendered file/dir name is safe to use
// as a single path segment: non-empty and free of path separators or ".."
// (guards against a malicious/misconfigured template variable value, e.g.
// {"SERVICE_NAME": "../../etc"}, escaping the work directory via rename).
func isSafeRenderedName(name string) bool {
	if name == "" {
		return false
	}
	if name == "." || name == ".." {
		return false
	}
	if strings.ContainsAny(name, `/\`) {
		return false
	}
	return true
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

// PayloadTemplateClient defines the interface for finalizing a template
// instantiation against orbit-www's internal API. Satisfied by
// services.PayloadTemplateClient; an interface here so tests can supply a
// mock (mirrors the PatternInstance activities' client-interface pattern).
type PayloadTemplateClient interface {
	FinalizeInstantiation(ctx context.Context, templateID string, in services.FinalizeInstantiationInput) (*services.FinalizeInstantiationResult, error)
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
	tokenService  TokenService
	payloadClient PayloadTemplateClient
	workDir       string
	logger        *slog.Logger
}

// NewTemplateActivities creates a new instance of TemplateActivities
func NewTemplateActivities(tokenService TokenService, payloadClient PayloadTemplateClient, workDir string, logger *slog.Logger) *TemplateActivities {
	if logger == nil {
		logger = slog.Default()
	}
	return &TemplateActivities{
		tokenService:  tokenService,
		payloadClient: payloadClient,
		workDir:       workDir,
		logger:        logger,
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

// ApplyTemplateVariables substitutes template variables into file contents
// and file/directory names throughout the work directory, using the
// templating engine (real Go text/template + curated FuncMap). Files
// matching a rawFiles glob pattern from orbit-template.yaml are skipped
// entirely (content and name). A file that fails to parse/execute as a
// template is left unmodified and reported in the result's SkippedFiles;
// this is not a fatal condition for the activity.
func (a *TemplateActivities) ApplyTemplateVariables(ctx context.Context, input ApplyTemplateVariablesActivityInput) (*ApplyTemplateVariablesResult, error) {
	a.logger.Info("Applying template variables", "workDir", input.WorkDir, "variableCount", len(input.Variables))

	result := &ApplyTemplateVariablesResult{}

	// No variables means no bare tokens can match and no dot-context is
	// meaningful; skip entirely rather than attempting to parse arbitrary
	// Go-template syntax in files that were never meant to be rendered.
	if len(input.Variables) == 0 {
		a.logger.Info("No variables to apply, skipping")
		return result, nil
	}

	rawPatterns := loadRawFilePatterns(input.WorkDir, a.logger)

	var allPaths []string

	// Pass 1: content substitution (top-down walk). Collect every visited
	// path (files and dirs) along the way for the rename pass below.
	err := filepath.WalkDir(input.WorkDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}

		if path != input.WorkDir {
			allPaths = append(allPaths, path)
		}

		if d.IsDir() {
			return nil
		}

		// Symlinks: do not follow, do not attempt to render their target
		// content (a dangling or absolute-path symlink could point outside
		// WorkDir); treat like a raw/binary file for content purposes.
		if d.Type()&fs.ModeSymlink != 0 {
			a.logger.Debug("Skipping content render for symlink", "path", path)
			return nil
		}

		relPath, relErr := filepath.Rel(input.WorkDir, path)
		if relErr != nil {
			return fmt.Errorf("failed to compute relative path for %s: %w", path, relErr)
		}

		if matchesRawFilePattern(relPath, rawPatterns) {
			a.logger.Debug("Skipping raw-file-matched content", "path", relPath)
			return nil
		}

		content, err := os.ReadFile(path)
		if err != nil {
			return fmt.Errorf("failed to read file %s: %w", path, err)
		}

		if isBinaryContent(content) {
			a.logger.Debug("Skipping binary file content", "path", path)
			return nil
		}

		rendered, renderErr := templating.Render(string(content), input.Variables)
		if renderErr != nil {
			a.logger.Warn("Failed to render template file, leaving unchanged", "path", path, "error", renderErr)
			result.SkippedFiles = append(result.SkippedFiles, path)
			return nil
		}

		if rendered != string(content) {
			info, statErr := d.Info()
			if statErr != nil {
				return fmt.Errorf("failed to stat file %s: %w", path, statErr)
			}
			if err := os.WriteFile(path, []byte(rendered), info.Mode().Perm()); err != nil {
				return fmt.Errorf("failed to write file %s: %w", path, err)
			}
			a.logger.Debug("Applied variables to file", "path", path)
		}

		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("failed to apply template variables: %w", err)
	}

	// Pass 2: rename file/dir base names, deepest-first. allPaths was
	// collected in top-down (pre-)order by WalkDir, so iterating it in
	// reverse visits children before their parents — a valid bottom-up
	// order without a second directory walk.
	for i := len(allPaths) - 1; i >= 0; i-- {
		oldPath := allPaths[i]

		dir := filepath.Dir(oldPath)
		base := filepath.Base(oldPath)

		relPath, relErr := filepath.Rel(input.WorkDir, oldPath)
		if relErr != nil {
			a.logger.Warn("Failed to compute relative path for rename, skipping", "path", oldPath, "error", relErr)
			result.SkippedFiles = append(result.SkippedFiles, oldPath)
			continue
		}
		if matchesRawFilePattern(relPath, rawPatterns) {
			continue
		}

		newBase, renderErr := templating.RenderName(base, input.Variables)
		if renderErr != nil {
			a.logger.Warn("Failed to render name, leaving unchanged", "path", oldPath, "error", renderErr)
			result.SkippedFiles = append(result.SkippedFiles, oldPath)
			continue
		}

		if newBase == base {
			continue
		}

		if !isSafeRenderedName(newBase) {
			a.logger.Warn("Rendered name is unsafe (path separator or '..'), leaving unchanged", "path", oldPath, "renderedName", newBase)
			result.SkippedFiles = append(result.SkippedFiles, oldPath)
			continue
		}

		newPath := filepath.Join(dir, newBase)
		if err := os.Rename(oldPath, newPath); err != nil {
			a.logger.Warn("Failed to rename path, leaving unchanged", "path", oldPath, "newPath", newPath, "error", err)
			result.SkippedFiles = append(result.SkippedFiles, oldPath)
			continue
		}
		a.logger.Debug("Renamed path", "oldPath", oldPath, "newPath", newPath)
	}

	a.logger.Info("Template variables applied", "skippedFiles", len(result.SkippedFiles))
	return result, nil
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

// FinalizeInstantiation records template usage (usageCount) and creates the
// resulting catalog entity via orbit-www's internal API. Notification
// sending is out of scope for Phase 0.
func (a *TemplateActivities) FinalizeInstantiation(ctx context.Context, input FinalizeInstantiationActivityInput) error {
	a.logger.Info("Finalizing template instantiation",
		"templateID", input.TemplateID,
		"workspaceID", input.WorkspaceID,
		"repoURL", input.RepoURL,
		"repoName", input.RepoName,
		"userID", input.UserID)

	result, err := a.payloadClient.FinalizeInstantiation(ctx, input.TemplateID, services.FinalizeInstantiationInput{
		WorkspaceID: input.WorkspaceID,
		RepoURL:     input.RepoURL,
		RepoName:    input.RepoName,
		UserID:      input.UserID,
	})
	if err != nil {
		return fmt.Errorf("failed to finalize instantiation: %w", err)
	}

	a.logger.Info("Template instantiation finalized",
		"catalogEntityID", result.CatalogEntityID,
		"usageCount", result.UsageCount)
	return nil
}

// runGitCommand is a helper to run git commands in a specific directory
func (a *TemplateActivities) runGitCommand(ctx context.Context, dir string, args ...string) error {
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = dir
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("git %v failed: %w (output: %s)", args, err, sanitizeGitOutput(string(output)))
	}
	return nil
}
