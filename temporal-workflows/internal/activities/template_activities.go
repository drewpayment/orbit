package activities

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"

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

// LoadRawFilePatterns best-effort reads orbit-template.yaml (or .yml) from
// workDir's root and returns its rawFiles glob patterns. Any error (missing
// file, malformed YAML) yields an empty, non-fatal result. Exported so the
// fs:render scaffolder action reads the manifest the same way the v1
// ApplyTemplateVariables activity does.
func LoadRawFilePatterns(workDir string, logger *slog.Logger) []string {
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

	// Fetch a token if we have an installation ID.
	token := ""
	if input.InstallationID != "" {
		t, err := a.tokenService.GetInstallationToken(ctx, input.InstallationID)
		if err != nil {
			a.logger.Warn("Failed to get token for clone, attempting unauthenticated", "error", err)
		} else {
			token = t
		}
	}

	if err := CloneGitRepo(ctx, workDir, input.SourceRepoURL, "", token); err != nil {
		return "", fmt.Errorf("failed to clone repository: %w", err)
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

	rawPatterns := LoadRawFilePatterns(input.WorkDir, a.logger)

	renderResult, err := templating.RenderDir(input.WorkDir, input.Variables, rawPatterns, a.logger)
	if err != nil {
		return nil, err
	}
	result.SkippedFiles = renderResult.SkippedFiles

	a.logger.Info("Template variables applied", "skippedFiles", len(result.SkippedFiles))
	return result, nil
}

// PushToNewRepo initializes git, adds all files, commits, and pushes to the new repository
func (a *TemplateActivities) PushToNewRepo(ctx context.Context, input PushToNewRepoActivityInput) error {
	a.logger.Info("Pushing to new repository", "workDir", input.WorkDir, "repoURL", input.RepoURL)

	token := ""
	if input.InstallationID != "" {
		t, err := a.tokenService.GetInstallationToken(ctx, input.InstallationID)
		if err != nil {
			return fmt.Errorf("failed to get GitHub token for push: %w", err)
		}
		token = t
	}

	if err := PushRepo(ctx, PushRepoInput{
		WorkDir: input.WorkDir,
		RepoURL: input.RepoURL,
		Branch:  "main",
		Token:   token,
	}); err != nil {
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
