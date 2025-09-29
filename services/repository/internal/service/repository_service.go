/**
 * T036 - Service Layer: RepositoryService with Template Handling
 *
 * This service implements business logic for repository operations including
 * creation from templates, code generation orchestration, dependency management,
 * and integration with external Git providers.
 *
 * Constitutional Requirements:
 * - Template-based repository creation with validation
 * - Code generation workflow orchestration via Temporal
 * - Dependency management and conflict resolution
 * - Git provider integration and synchronization
 * - Multi-tenant workspace isolation
 * - Comprehensive audit trails and event publishing
 */

package service

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/drewpayment/orbit/services/repository/internal/domain"
	"github.com/google/uuid"
)

// RepositoryRepository defines the repository interface for repository operations
type RepositoryRepository interface {
	// Basic CRUD operations
	Create(ctx context.Context, repository *domain.Repository) error
	Update(ctx context.Context, repository *domain.Repository) error
	Delete(ctx context.Context, id uuid.UUID) error
	GetByID(ctx context.Context, id uuid.UUID) (*domain.Repository, error)
	GetByName(ctx context.Context, workspaceID uuid.UUID, name string) (*domain.Repository, error)
	GetBySlug(ctx context.Context, workspaceID uuid.UUID, slug string) (*domain.Repository, error)

	// Listing and search
	ListByWorkspace(ctx context.Context, workspaceID uuid.UUID, filters RepositoryFilters) ([]*domain.Repository, error)
	ListTemplates(ctx context.Context, filters TemplateFilters) ([]*domain.Repository, error)
	Search(ctx context.Context, workspaceID uuid.UUID, query string, filters RepositoryFilters) ([]*domain.Repository, error)

	// Dependencies
	GetDependencies(ctx context.Context, repositoryID uuid.UUID) ([]*domain.RepositoryDependency, error)
	AddDependency(ctx context.Context, dependency *domain.RepositoryDependency) error
	UpdateDependency(ctx context.Context, dependency *domain.RepositoryDependency) error
	RemoveDependency(ctx context.Context, repositoryID, dependentID uuid.UUID) error

	// Statistics and usage
	GetStats(ctx context.Context, repositoryID uuid.UUID) (*RepositoryStats, error)
	GetUsageMetrics(ctx context.Context, workspaceID uuid.UUID) (*WorkspaceRepositoryUsage, error)

	// Template operations
	GetTemplateUsage(ctx context.Context, templateID uuid.UUID) ([]*TemplateUsageRecord, error)
	MarkTemplateUsed(ctx context.Context, templateID, repositoryID uuid.UUID) error
}

// GitProviderClient defines the interface for Git provider operations
type GitProviderClient interface {
	CreateRepository(ctx context.Context, config *GitRepositoryConfig) (*GitRepositoryInfo, error)
	DeleteRepository(ctx context.Context, provider domain.GitProvider, repoFullName string) error
	GetRepository(ctx context.Context, provider domain.GitProvider, repoFullName string) (*GitRepositoryInfo, error)
	CreateWebhook(ctx context.Context, provider domain.GitProvider, repoFullName string, webhookConfig *WebhookConfig) error
	SyncRepository(ctx context.Context, provider domain.GitProvider, repoFullName string) (*SyncResult, error)
}

// TemporalClient defines the interface for Temporal workflow operations
type TemporalClient interface {
	StartRepositoryGeneration(ctx context.Context, req *GenerationWorkflowRequest) (*WorkflowExecution, error)
	StartCodeGeneration(ctx context.Context, req *CodeGenerationRequest) (*WorkflowExecution, error)
	GetWorkflowStatus(ctx context.Context, workflowID string) (*WorkflowStatus, error)
	CancelWorkflow(ctx context.Context, workflowID string) error
}

// RepositoryFilters contains filtering options for repository queries
type RepositoryFilters struct {
	RepositoryType []domain.RepositoryType `json:"repository_type"`
	Language       []string                `json:"language"`
	Status         []string                `json:"status"`
	CreatedBy      *uuid.UUID              `json:"created_by"`
	CreatedAfter   *time.Time              `json:"created_after"`
	CreatedBefore  *time.Time              `json:"created_before"`
	HasTemplate    *bool                   `json:"has_template"`
	TemplateID     *uuid.UUID              `json:"template_id"`
	Tags           []string                `json:"tags"`
	GitProvider    *domain.GitProvider     `json:"git_provider"`
	Limit          int                     `json:"limit"`
	Offset         int                     `json:"offset"`
	SortBy         string                  `json:"sort_by"`    // name, created_at, updated_at, last_activity
	SortOrder      string                  `json:"sort_order"` // asc, desc
}

// TemplateFilters contains filtering options for template queries
type TemplateFilters struct {
	RepositoryType []domain.RepositoryType `json:"repository_type"`
	Language       []string                `json:"language"`
	Category       []string                `json:"category"`
	Tags           []string                `json:"tags"`
	CreatedBy      *uuid.UUID              `json:"created_by"`
	IsOfficial     *bool                   `json:"is_official"`
	IsActive       *bool                   `json:"is_active"`
	Limit          int                     `json:"limit"`
	Offset         int                     `json:"offset"`
	SortBy         string                  `json:"sort_by"`    // name, usage_count, created_at, updated_at
	SortOrder      string                  `json:"sort_order"` // asc, desc
}

// CreateRepositoryRequest contains data for creating a new repository
type CreateRepositoryRequest struct {
	WorkspaceID    uuid.UUID                  `json:"workspace_id" validate:"required"`
	Name           string                     `json:"name" validate:"required,min=1,max=100"`
	Slug           string                     `json:"slug" validate:"required,min=1,max=50,alphanum_dash"`
	Description    string                     `json:"description" validate:"max=500"`
	RepositoryType domain.RepositoryType      `json:"repository_type" validate:"required"`
	Language       string                     `json:"language" validate:"required"`
	Visibility     domain.WorkspaceVisibility `json:"visibility" validate:"required"`

	// Template-based creation
	TemplateID     *uuid.UUID             `json:"template_id,omitempty"`
	TemplateConfig *TemplateConfiguration `json:"template_config,omitempty"`

	// Git provider integration
	GitProvider   *domain.GitProvider `json:"git_provider,omitempty"`
	CreateGitRepo bool                `json:"create_git_repo"`

	// Initial configuration
	Tags         []string         `json:"tags"`
	Dependencies []DependencySpec `json:"dependencies"`

	CreatedBy uuid.UUID `json:"created_by" validate:"required"`
}

// UpdateRepositoryRequest contains data for updating a repository
type UpdateRepositoryRequest struct {
	ID             uuid.UUID                   `json:"id" validate:"required"`
	Name           *string                     `json:"name,omitempty" validate:"omitempty,min=1,max=100"`
	Description    *string                     `json:"description,omitempty" validate:"omitempty,max=500"`
	Visibility     *domain.WorkspaceVisibility `json:"visibility,omitempty"`
	Tags           []string                    `json:"tags,omitempty"`
	TemplateConfig *TemplateConfiguration      `json:"template_config,omitempty"`
	UpdatedBy      uuid.UUID                   `json:"updated_by" validate:"required"`
}

// TemplateConfiguration contains template-specific configuration
type TemplateConfiguration struct {
	Variables      map[string]interface{} `json:"variables"`
	EnabledHooks   []string               `json:"enabled_hooks"`
	CustomSettings map[string]interface{} `json:"custom_settings"`
	TargetPath     string                 `json:"target_path"`
	SkipFiles      []string               `json:"skip_files"`
}

// DependencySpec specifies a dependency to add during creation
type DependencySpec struct {
	DependentRepositoryID *uuid.UUID            `json:"dependent_repository_id,omitempty"`
	DependentName         string                `json:"dependent_name,omitempty"`
	DependencyType        domain.DependencyType `json:"dependency_type"`
	Version               string                `json:"version,omitempty"`
	IsRequired            bool                  `json:"is_required"`
	Description           string                `json:"description,omitempty"`
}

// GitRepositoryConfig contains configuration for Git repository creation
type GitRepositoryConfig struct {
	Name          string             `json:"name"`
	Description   string             `json:"description"`
	Private       bool               `json:"private"`
	Provider      domain.GitProvider `json:"provider"`
	Organization  string             `json:"organization"`
	DefaultBranch string             `json:"default_branch"`
	AutoInit      bool               `json:"auto_init"`
	Template      *GitTemplateConfig `json:"template,omitempty"`
}

// GitTemplateConfig contains Git template configuration
type GitTemplateConfig struct {
	Owner string `json:"owner"`
	Name  string `json:"name"`
}

// GitRepositoryInfo contains information about a Git repository
type GitRepositoryInfo struct {
	ID            string    `json:"id"`
	Name          string    `json:"name"`
	FullName      string    `json:"full_name"`
	Description   string    `json:"description"`
	Private       bool      `json:"private"`
	HTMLURL       string    `json:"html_url"`
	CloneURL      string    `json:"clone_url"`
	SSHUrl        string    `json:"ssh_url"`
	DefaultBranch string    `json:"default_branch"`
	CreatedAt     time.Time `json:"created_at"`
}

// WebhookConfig contains webhook configuration
type WebhookConfig struct {
	URL    string   `json:"url"`
	Events []string `json:"events"`
	Secret string   `json:"secret"`
}

// SyncResult contains the result of a repository sync operation
type SyncResult struct {
	Success     bool      `json:"success"`
	LastSyncAt  time.Time `json:"last_sync_at"`
	CommitCount int       `json:"commit_count"`
	BranchCount int       `json:"branch_count"`
	Error       string    `json:"error,omitempty"`
}

// GenerationWorkflowRequest contains data for starting a repository generation workflow
type GenerationWorkflowRequest struct {
	RepositoryID  uuid.UUID             `json:"repository_id"`
	WorkspaceID   uuid.UUID             `json:"workspace_id"`
	TemplateID    uuid.UUID             `json:"template_id"`
	Configuration TemplateConfiguration `json:"configuration"`
	GitConfig     *GitRepositoryConfig  `json:"git_config,omitempty"`
	CreatedBy     uuid.UUID             `json:"created_by"`
}

// CodeGenerationRequest contains data for code generation workflows
type CodeGenerationRequest struct {
	RepositoryID   uuid.UUID              `json:"repository_id"`
	GenerationType string                 `json:"generation_type"` // api, docs, client, tests
	Configuration  map[string]interface{} `json:"configuration"`
	CreatedBy      uuid.UUID              `json:"created_by"`
}

// WorkflowExecution contains information about a started workflow
type WorkflowExecution struct {
	WorkflowID string    `json:"workflow_id"`
	RunID      string    `json:"run_id"`
	StartedAt  time.Time `json:"started_at"`
}

// WorkflowStatus contains the current status of a workflow
type WorkflowStatus struct {
	WorkflowID  string     `json:"workflow_id"`
	RunID       string     `json:"run_id"`
	Status      string     `json:"status"` // running, completed, failed, cancelled
	Progress    float64    `json:"progress"`
	CurrentStep string     `json:"current_step"`
	Error       string     `json:"error,omitempty"`
	StartedAt   time.Time  `json:"started_at"`
	CompletedAt *time.Time `json:"completed_at,omitempty"`
}

// RepositoryStats contains statistics about a repository
type RepositoryStats struct {
	CommitCount        int            `json:"commit_count"`
	BranchCount        int            `json:"branch_count"`
	ContributorCount   int            `json:"contributor_count"`
	IssueCount         int            `json:"issue_count"`
	PullRequestCount   int            `json:"pull_request_count"`
	LastActivity       *time.Time     `json:"last_activity"`
	Languages          map[string]int `json:"languages"` // Language -> lines of code
	DependencyCount    int            `json:"dependency_count"`
	DependentCount     int            `json:"dependent_count"`
	GenerationJobCount int            `json:"generation_job_count"`
	TemplateUsage      int            `json:"template_usage"` // If this is a template
}

// WorkspaceRepositoryUsage contains repository usage metrics for a workspace
type WorkspaceRepositoryUsage struct {
	TotalRepositories      int                           `json:"total_repositories"`
	RepositoriesByType     map[domain.RepositoryType]int `json:"repositories_by_type"`
	RepositoriesByLanguage map[string]int                `json:"repositories_by_language"`
	ActiveRepositories     int                           `json:"active_repositories"`
	TemplateUsage          map[uuid.UUID]int             `json:"template_usage"`
	RecentActivity         []ActivityRecord              `json:"recent_activity"`
}

// TemplateUsageRecord tracks template usage
type TemplateUsageRecord struct {
	TemplateID     uuid.UUID `json:"template_id"`
	RepositoryID   uuid.UUID `json:"repository_id"`
	RepositoryName string    `json:"repository_name"`
	CreatedBy      uuid.UUID `json:"created_by"`
	CreatedAt      time.Time `json:"created_at"`
}

// RepositoryService implements business logic for repository operations
type RepositoryService struct {
	repositoryRepo RepositoryRepository
	workspaceRepo  WorkspaceRepository
	userRepo       UserRepository
	gitClient      GitProviderClient
	temporalClient TemporalClient
	eventPub       EventPublisher
	cache          CacheManager
	logger         *slog.Logger
}

// NewRepositoryService creates a new repository service instance
func NewRepositoryService(
	repositoryRepo RepositoryRepository,
	workspaceRepo WorkspaceRepository,
	userRepo UserRepository,
	gitClient GitProviderClient,
	temporalClient TemporalClient,
	eventPub EventPublisher,
	cache CacheManager,
	logger *slog.Logger,
) *RepositoryService {
	return &RepositoryService{
		repositoryRepo: repositoryRepo,
		workspaceRepo:  workspaceRepo,
		userRepo:       userRepo,
		gitClient:      gitClient,
		temporalClient: temporalClient,
		eventPub:       eventPub,
		cache:          cache,
		logger:         logger.With("service", "repository"),
	}
}

// CreateRepository creates a new repository with optional template-based generation
func (s *RepositoryService) CreateRepository(ctx context.Context, req CreateRepositoryRequest) (*domain.Repository, error) {
	s.logger.InfoContext(ctx, "Creating repository",
		"name", req.Name, "workspace_id", req.WorkspaceID, "template_id", req.TemplateID, "created_by", req.CreatedBy)

	// Validate the request
	if err := s.validateCreateRequest(ctx, req); err != nil {
		return nil, fmt.Errorf("validation failed: %w", err)
	}

	// Check workspace exists and user has permission
	workspace, err := s.workspaceRepo.GetByID(ctx, req.WorkspaceID)
	if err != nil {
		return nil, fmt.Errorf("failed to get workspace: %w", err)
	}

	if !s.canUserCreateRepository(ctx, workspace, req.CreatedBy) {
		return nil, domain.ErrInsufficientPermission
	}

	// Check repository name/slug availability
	if exists, err := s.checkRepositoryExists(ctx, req.WorkspaceID, req.Name, req.Slug); err != nil {
		return nil, fmt.Errorf("failed to check repository existence: %w", err)
	} else if exists {
		return nil, domain.ErrRepositoryExists
	}

	// Get template if specified
	var template *domain.Repository
	if req.TemplateID != nil {
		template, err = s.repositoryRepo.GetByID(ctx, *req.TemplateID)
		if err != nil {
			return nil, fmt.Errorf("failed to get template: %w", err)
		}
		if !template.IsTemplate() {
			return nil, ErrInvalidTemplate
		}
	}

	// Create the repository domain object
	repository := domain.NewRepository(
		req.WorkspaceID,
		req.Name,
		req.Slug,
		req.Description,
		req.RepositoryType,
		req.CreatedBy,
	)

	// Set additional properties
	repository.Language = req.Language
	repository.Visibility = req.Visibility

	// Configure template settings if using a template
	if template != nil {
		s.configureFromTemplate(repository, template, req.TemplateConfig)
	}

	// Set additional properties
	if len(req.Tags) > 0 {
		repository.Tags = req.Tags
	}

	// Validate the repository
	if err := repository.Validate(); err != nil {
		return nil, fmt.Errorf("repository validation failed: %w", err)
	}

	// Create Git repository if requested
	var gitInfo *GitRepositoryInfo
	if req.CreateGitRepo && req.GitProvider != nil {
		gitConfig := &GitRepositoryConfig{
			Name:          req.Name,
			Description:   req.Description,
			Private:       req.Visibility == domain.WorkspaceVisibilityPrivate,
			Provider:      *req.GitProvider,
			Organization:  workspace.Name, // Use workspace name as organization
			DefaultBranch: "main",
			AutoInit:      true,
		}

		if template != nil && template.GitURL != "" {
			// Use template as Git template
			parts := strings.Split(template.GitURL, "/")
			if len(parts) >= 2 {
				gitConfig.Template = &GitTemplateConfig{
					Owner: parts[len(parts)-2],
					Name:  strings.TrimSuffix(parts[len(parts)-1], ".git"),
				}
			}
		}

		gitInfo, err = s.gitClient.CreateRepository(ctx, gitConfig)
		if err != nil {
			return nil, fmt.Errorf("failed to create Git repository: %w", err)
		}

		// Update repository with Git information
		repository.GitURL = gitInfo.CloneURL
		repository.DefaultBranch = gitInfo.DefaultBranch
		repository.GitProvider = *req.GitProvider
	}

	// Persist the repository
	if err := s.repositoryRepo.Create(ctx, repository); err != nil {
		// If we created a Git repo but failed to save, try to clean up
		if gitInfo != nil {
			s.logger.WarnContext(ctx, "Cleaning up Git repository after save failure", "git_repo", gitInfo.FullName)
			if cleanupErr := s.gitClient.DeleteRepository(ctx, *req.GitProvider, gitInfo.FullName); cleanupErr != nil {
				s.logger.ErrorContext(ctx, "Failed to cleanup Git repository", "error", cleanupErr)
			}
		}
		return nil, fmt.Errorf("failed to create repository: %w", err)
	}

	// Add dependencies if specified
	for _, depSpec := range req.Dependencies {
		if err := s.addDependency(ctx, repository.ID, depSpec, req.CreatedBy); err != nil {
			s.logger.WarnContext(ctx, "Failed to add dependency", "error", err, "dependency", depSpec)
		}
	}

	// Mark template as used if applicable
	if template != nil {
		if err := s.repositoryRepo.MarkTemplateUsed(ctx, template.ID, repository.ID); err != nil {
			s.logger.WarnContext(ctx, "Failed to mark template as used", "error", err, "template_id", template.ID)
		}
	}

	// Start repository generation workflow if using a template
	if template != nil {
		workflowReq := &GenerationWorkflowRequest{
			RepositoryID:  repository.ID,
			WorkspaceID:   req.WorkspaceID,
			TemplateID:    template.ID,
			Configuration: *req.TemplateConfig,
			CreatedBy:     req.CreatedBy,
		}

		if gitInfo != nil {
			workflowReq.GitConfig = &GitRepositoryConfig{
				Name:        gitInfo.Name,
				Description: gitInfo.Description,
				Private:     gitInfo.Private,
				Provider:    *req.GitProvider,
			}
		}

		execution, err := s.temporalClient.StartRepositoryGeneration(ctx, workflowReq)
		if err != nil {
			s.logger.ErrorContext(ctx, "Failed to start repository generation workflow", "error", err)
		} else {
			// Update repository with generation job info
			generationJob := repository.StartGeneration(
				execution.WorkflowID,
				execution.RunID,
				req.CreatedBy,
				map[string]interface{}{
					"generation_type": "repository_creation",
					"template_id":     template.ID.String(),
				},
			)

			// Update the repository with the job
			if updateErr := s.repositoryRepo.Update(ctx, repository); updateErr != nil {
				s.logger.WarnContext(ctx, "Failed to update repository with generation job", "error", updateErr)
			}

			s.logger.InfoContext(ctx, "Repository generation workflow started",
				"workflow_id", execution.WorkflowID, "job_id", generationJob.ID)
		}
	}

	// Setup Git webhooks if needed
	if gitInfo != nil {
		webhookConfig := &WebhookConfig{
			URL:    fmt.Sprintf("https://api.internal-dev-portal.com/webhooks/%s", repository.ID),
			Events: []string{"push", "pull_request", "issues"},
			Secret: s.generateWebhookSecret(),
		}

		if err := s.gitClient.CreateWebhook(ctx, *req.GitProvider, gitInfo.FullName, webhookConfig); err != nil {
			s.logger.WarnContext(ctx, "Failed to create webhook", "error", err)
		}
	}

	// Publish domain event
	// TODO: Add PublishRepositoryCreated method to EventPublisher interface
	// if err := s.eventPub.PublishRepositoryCreated(ctx, repository); err != nil {
	//		s.logger.WarnContext(ctx, "Failed to publish repository created event", "error", err)
	// }

	// Clear relevant caches
	s.clearRepositoryListCaches(ctx, req.WorkspaceID)

	s.logger.InfoContext(ctx, "Repository created successfully",
		"repository_id", repository.ID, "name", repository.Name, "git_repo", gitInfo != nil)

	return repository, nil
}

// GetRepository retrieves a repository by ID with permission checking
func (s *RepositoryService) GetRepository(ctx context.Context, id uuid.UUID, userID uuid.UUID) (*domain.Repository, error) {
	s.logger.DebugContext(ctx, "Getting repository", "repository_id", id, "user_id", userID)

	// Check cache first
	cacheKey := fmt.Sprintf("repository:id:%s", id.String())
	if cached, err := s.cache.Get(ctx, cacheKey); err == nil {
		if repository, ok := cached.(*domain.Repository); ok {
			if s.canUserAccessRepository(ctx, repository, userID) {
				return repository, nil
			}
			return nil, domain.ErrInsufficientPermission
		}
	}

	// Get from repository
	repository, err := s.repositoryRepo.GetByID(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("failed to get repository: %w", err)
	}

	// Check access permissions
	if !s.canUserAccessRepository(ctx, repository, userID) {
		return nil, domain.ErrInsufficientPermission
	}

	// Cache the result
	s.cache.Set(ctx, cacheKey, repository, 15*time.Minute)

	return repository, nil
}

// UpdateRepository updates a repository with validation
func (s *RepositoryService) UpdateRepository(ctx context.Context, req UpdateRepositoryRequest) (*domain.Repository, error) {
	s.logger.InfoContext(ctx, "Updating repository", "repository_id", req.ID, "updated_by", req.UpdatedBy)

	// Get the existing repository
	repository, err := s.repositoryRepo.GetByID(ctx, req.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to get repository: %w", err)
	}

	// Check permissions
	if !s.canUserModifyRepository(ctx, repository, req.UpdatedBy) {
		return nil, domain.ErrInsufficientPermission
	}

	// Apply updates
	updated := false
	if req.Name != nil && *req.Name != repository.Name {
		repository.Name = *req.Name
		updated = true
	}

	if req.Description != nil && *req.Description != repository.Description {
		repository.Description = *req.Description
		updated = true
	}

	if req.Visibility != nil && *req.Visibility != repository.Visibility {
		repository.Visibility = *req.Visibility
		updated = true
	}

	if req.Tags != nil {
		repository.Tags = req.Tags
		updated = true
	}

	if req.TemplateConfig != nil && repository.IsTemplate() {
		// Update template configuration
		if repository.TemplateConfig != nil {
			repository.TemplateConfig.Customizations = req.TemplateConfig.Variables
			updated = true
		}
	}

	if updated {
		repository.UpdatedAt = time.Now()
		repository.UpdatedBy = req.UpdatedBy

		// Validate the updated repository
		if err := repository.Validate(); err != nil {
			return nil, fmt.Errorf("repository validation failed: %w", err)
		}

		// Persist the changes
		if err := s.repositoryRepo.Update(ctx, repository); err != nil {
			return nil, fmt.Errorf("failed to update repository: %w", err)
		}

		// Publish domain event
		// TODO: Add PublishRepositoryUpdated method to EventPublisher interface
		// if err := s.eventPub.PublishRepositoryUpdated(ctx, repository); err != nil {
		//		s.logger.WarnContext(ctx, "Failed to publish repository updated event", "error", err)
		// }

		// Clear caches
		s.clearRepositoryCaches(ctx, repository)

		s.logger.InfoContext(ctx, "Repository updated successfully", "repository_id", repository.ID)
	}

	return repository, nil
}

// DeleteRepository deletes a repository with cleanup
func (s *RepositoryService) DeleteRepository(ctx context.Context, id uuid.UUID, deletedBy uuid.UUID) error {
	s.logger.InfoContext(ctx, "Deleting repository", "repository_id", id, "deleted_by", deletedBy)

	// Get the repository
	repository, err := s.repositoryRepo.GetByID(ctx, id)
	if err != nil {
		return fmt.Errorf("failed to get repository: %w", err)
	}

	// Check permissions
	if !s.canUserDeleteRepository(ctx, repository, deletedBy) {
		return domain.ErrInsufficientPermission
	}

	// Check for dependencies that would be broken
	if dependents, err := s.getDependents(ctx, id); err != nil {
		s.logger.WarnContext(ctx, "Failed to check dependents", "error", err)
	} else if len(dependents) > 0 {
		return ErrRepositoryHasDependents
	}

	// Delete Git repository if linked
	if repository.GitURL != "" {
		parts := strings.Split(repository.GitURL, "/")
		if len(parts) >= 2 {
			fullName := fmt.Sprintf("%s/%s", parts[len(parts)-2],
				strings.TrimSuffix(parts[len(parts)-1], ".git"))

			if err := s.gitClient.DeleteRepository(ctx, repository.GitProvider, fullName); err != nil {
				s.logger.ErrorContext(ctx, "Failed to delete Git repository", "error", err)
				// Continue with domain deletion even if Git cleanup fails
			}
		}
	}

	// Perform the deletion (soft delete)
	if err := s.repositoryRepo.Delete(ctx, id); err != nil {
		return fmt.Errorf("failed to delete repository: %w", err)
	}

	// Publish domain event
	// TODO: Add PublishRepositoryDeleted method to EventPublisher interface
	// if err := s.eventPub.PublishRepositoryDeleted(ctx, id); err != nil {
	//		s.logger.WarnContext(ctx, "Failed to publish repository deleted event", "error", err)
	// }

	// Clear caches
	s.clearRepositoryCaches(ctx, repository)

	s.logger.InfoContext(ctx, "Repository deleted successfully", "repository_id", id)

	return nil
}

// ListRepositories lists repositories with filtering and pagination
func (s *RepositoryService) ListRepositories(ctx context.Context, workspaceID uuid.UUID, userID uuid.UUID, filters RepositoryFilters) ([]*domain.Repository, error) {
	s.logger.DebugContext(ctx, "Listing repositories", "workspace_id", workspaceID, "user_id", userID)

	// Check workspace access
	workspace, err := s.workspaceRepo.GetByID(ctx, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("failed to get workspace: %w", err)
	}

	if !s.canUserAccessWorkspace(ctx, workspace, userID) {
		return nil, domain.ErrInsufficientPermission
	}

	// Get repositories
	repositories, err := s.repositoryRepo.ListByWorkspace(ctx, workspaceID, filters)
	if err != nil {
		return nil, fmt.Errorf("failed to list repositories: %w", err)
	}

	// Filter based on individual repository permissions
	var accessible []*domain.Repository
	for _, repo := range repositories {
		if s.canUserAccessRepository(ctx, repo, userID) {
			accessible = append(accessible, repo)
		}
	}

	return accessible, nil
}

// ListTemplates lists available templates
func (s *RepositoryService) ListTemplates(ctx context.Context, userID uuid.UUID, filters TemplateFilters) ([]*domain.Repository, error) {
	s.logger.DebugContext(ctx, "Listing templates", "user_id", userID)

	// Get templates
	templates, err := s.repositoryRepo.ListTemplates(ctx, filters)
	if err != nil {
		return nil, fmt.Errorf("failed to list templates: %w", err)
	}

	// Filter templates based on visibility and access
	var accessible []*domain.Repository
	for _, template := range templates {
		if s.canUserAccessTemplate(ctx, template, userID) {
			accessible = append(accessible, template)
		}
	}

	return accessible, nil
}

// GenerateCode starts a code generation workflow for a repository
func (s *RepositoryService) GenerateCode(ctx context.Context, repositoryID uuid.UUID, generationType string, config map[string]interface{}, requestedBy uuid.UUID) (*WorkflowExecution, error) {
	s.logger.InfoContext(ctx, "Starting code generation",
		"repository_id", repositoryID, "type", generationType, "requested_by", requestedBy)

	// Get and validate repository
	repository, err := s.repositoryRepo.GetByID(ctx, repositoryID)
	if err != nil {
		return nil, fmt.Errorf("failed to get repository: %w", err)
	}

	if !s.canUserModifyRepository(ctx, repository, requestedBy) {
		return nil, domain.ErrInsufficientPermission
	}

	// Start code generation workflow
	req := &CodeGenerationRequest{
		RepositoryID:   repositoryID,
		GenerationType: generationType,
		Configuration:  config,
		CreatedBy:      requestedBy,
	}

	execution, err := s.temporalClient.StartCodeGeneration(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("failed to start code generation workflow: %w", err)
	}

	// Track the generation job
	generationJob := repository.StartGeneration(
		execution.WorkflowID,
		execution.RunID,
		requestedBy,
		map[string]interface{}{
			"generation_type": generationType,
			"configuration":   config,
		},
	)

	// Update repository
	if err := s.repositoryRepo.Update(ctx, repository); err != nil {
		s.logger.WarnContext(ctx, "Failed to update repository with generation job", "error", err)
	}

	s.logger.InfoContext(ctx, "Code generation workflow started",
		"workflow_id", execution.WorkflowID, "job_id", generationJob.ID)

	return execution, nil
}

// Helper methods

// validateCreateRequest validates a create repository request
func (s *RepositoryService) validateCreateRequest(ctx context.Context, req CreateRepositoryRequest) error {
	if req.Name == "" {
		return domain.ErrInvalidRepositoryName
	}

	if req.Slug == "" {
		return domain.ErrInvalidRepositorySlug
	}

	if req.WorkspaceID == uuid.Nil {
		return domain.ErrWorkspaceNotFound
	}

	if req.CreatedBy == uuid.Nil {
		return domain.ErrUserNotFound
	}

	// Validate slug format
	if !isValidRepositorySlug(req.Slug) {
		return domain.ErrInvalidRepositorySlug
	}

	return nil
}

// checkRepositoryExists checks if a repository with the same name or slug exists
func (s *RepositoryService) checkRepositoryExists(ctx context.Context, workspaceID uuid.UUID, name, slug string) (bool, error) {
	if existing, err := s.repositoryRepo.GetByName(ctx, workspaceID, name); err == nil && existing != nil {
		return true, nil
	}

	if existing, err := s.repositoryRepo.GetBySlug(ctx, workspaceID, slug); err == nil && existing != nil {
		return true, nil
	}

	return false, nil
}

// configureFromTemplate configures a repository based on a template
func (s *RepositoryService) configureFromTemplate(repository *domain.Repository, template *domain.Repository, config *TemplateConfiguration) {
	// Copy template configuration if it exists
	if template.TemplateConfig != nil {
		repository.TemplateConfig = &domain.TemplateConfig{
			ID:              uuid.New(),
			RepositoryID:    repository.ID,
			BaseTemplate:    template.ID.String(),
			TemplateVersion: template.TemplateConfig.TemplateVersion,
			Language:        template.Language,
			Framework:       template.Framework,
			Customizations:  make(map[string]interface{}),
			EnableTests:     template.TemplateConfig.EnableTests,
			EnableDocs:      template.TemplateConfig.EnableDocs,
			EnableCI:        template.TemplateConfig.EnableCI,
			EnableDocker:    template.TemplateConfig.EnableDocker,
			CreatedAt:       time.Now(),
			UpdatedAt:       time.Now(),
			UpdatedBy:       repository.CreatedBy,
		}

		// Copy template customizations
		if template.TemplateConfig.Customizations != nil {
			for k, v := range template.TemplateConfig.Customizations {
				repository.TemplateConfig.Customizations[k] = v
			}
		}

		// Apply custom configuration if provided
		if config != nil && config.Variables != nil {
			for k, v := range config.Variables {
				repository.TemplateConfig.Customizations[k] = v
			}
		}
	}
}

// addDependency adds a dependency to a repository
func (s *RepositoryService) addDependency(ctx context.Context, repositoryID uuid.UUID, spec DependencySpec, createdBy uuid.UUID) error {
	dependency := &domain.RepositoryDependency{
		ID:                uuid.New(),
		RepositoryID:      repositoryID,
		DependencyType:    spec.DependencyType,
		VersionConstraint: spec.Version,
		Critical:          spec.IsRequired,
		Notes:             spec.Description,
		CreatedAt:         time.Now(),
		UpdatedAt:         time.Now(),
		CreatedBy:         createdBy,
	}

	if spec.DependentRepositoryID != nil {
		dependency.DependencyID = *spec.DependentRepositoryID
	}

	return s.repositoryRepo.AddDependency(ctx, dependency)
}

// getDependents gets repositories that depend on this repository
func (s *RepositoryService) getDependents(ctx context.Context, repositoryID uuid.UUID) ([]*domain.Repository, error) {
	// This would query for repositories that have this repository as a dependency
	// Implementation depends on how dependencies are stored
	return []*domain.Repository{}, nil // Simplified for now
}

// Permission checking methods

func (s *RepositoryService) canUserCreateRepository(ctx context.Context, workspace *domain.Workspace, userID uuid.UUID) bool {
	member := workspace.GetMember(userID)
	if member == nil {
		return false
	}

	return member.Role == domain.WorkspaceRoleOwner ||
		member.Role == domain.WorkspaceRoleAdmin ||
		member.Role == domain.WorkspaceRoleDeveloper
}

func (s *RepositoryService) canUserAccessRepository(ctx context.Context, repository *domain.Repository, userID uuid.UUID) bool {
	// Public repositories are accessible to workspace members
	if repository.Visibility == domain.WorkspaceVisibilityPublic {
		// Check if user is workspace member
		workspace, err := s.workspaceRepo.GetByID(ctx, repository.WorkspaceID)
		if err != nil {
			return false
		}
		return workspace.HasMember(userID)
	}

	// Private repositories need explicit access
	return repository.CreatedBy == userID || s.canUserAccessWorkspace(ctx, nil, userID)
}

func (s *RepositoryService) canUserModifyRepository(ctx context.Context, repository *domain.Repository, userID uuid.UUID) bool {
	// Repository owner can always modify
	if repository.CreatedBy == userID {
		return true
	}

	// Workspace admin/owner can modify
	workspace, err := s.workspaceRepo.GetByID(ctx, repository.WorkspaceID)
	if err != nil {
		return false
	}

	member := workspace.GetMember(userID)
	if member == nil {
		return false
	}

	return member.Role == domain.WorkspaceRoleOwner ||
		member.Role == domain.WorkspaceRoleAdmin
}

func (s *RepositoryService) canUserDeleteRepository(ctx context.Context, repository *domain.Repository, userID uuid.UUID) bool {
	// Only repository owner or workspace owner can delete
	if repository.CreatedBy == userID {
		return true
	}

	workspace, err := s.workspaceRepo.GetByID(ctx, repository.WorkspaceID)
	if err != nil {
		return false
	}

	member := workspace.GetMember(userID)
	return member != nil && member.Role == domain.WorkspaceRoleOwner
}

func (s *RepositoryService) canUserAccessTemplate(ctx context.Context, template *domain.Repository, userID uuid.UUID) bool {
	// Templates with public visibility are accessible to all
	if template.Visibility == domain.WorkspaceVisibilityPublic {
		return true
	}

	// Internal templates require workspace membership
	if template.Visibility == domain.WorkspaceVisibilityInternal {
		workspace, err := s.workspaceRepo.GetByID(ctx, template.WorkspaceID)
		if err != nil {
			return false
		}
		return workspace.HasMember(userID)
	}

	// Private templates require explicit access
	return template.CreatedBy == userID
}

func (s *RepositoryService) canUserAccessWorkspace(ctx context.Context, workspace *domain.Workspace, userID uuid.UUID) bool {
	if workspace == nil {
		return false
	}
	return workspace.HasMember(userID)
}

// Cache management

func (s *RepositoryService) clearRepositoryCaches(ctx context.Context, repository *domain.Repository) {
	patterns := []string{
		fmt.Sprintf("repository:id:%s", repository.ID.String()),
		fmt.Sprintf("repository:name:%s:%s", repository.WorkspaceID.String(), repository.Name),
		fmt.Sprintf("repository:slug:%s:%s", repository.WorkspaceID.String(), repository.Slug),
		fmt.Sprintf("workspace:repositories:%s", repository.WorkspaceID.String()),
	}

	for _, pattern := range patterns {
		if err := s.cache.Delete(ctx, pattern); err != nil {
			s.logger.WarnContext(ctx, "Failed to clear cache", "pattern", pattern, "error", err)
		}
	}
}

func (s *RepositoryService) clearRepositoryListCaches(ctx context.Context, workspaceID uuid.UUID) {
	patterns := []string{
		fmt.Sprintf("workspace:repositories:%s", workspaceID.String()),
		"templates:list:*",
	}

	for _, pattern := range patterns {
		if err := s.cache.DeleteByPattern(ctx, pattern); err != nil {
			s.logger.WarnContext(ctx, "Failed to clear cache", "pattern", pattern, "error", err)
		}
	}
}

// Utility functions

func (s *RepositoryService) generateWebhookSecret() string {
	// Generate a secure webhook secret
	return fmt.Sprintf("wh_%s", uuid.New().String()[:16])
}

func isValidRepositorySlug(slug string) bool {
	if len(slug) == 0 || len(slug) > 50 {
		return false
	}

	for _, char := range slug {
		if !((char >= 'a' && char <= 'z') ||
			(char >= 'A' && char <= 'Z') ||
			(char >= '0' && char <= '9') ||
			char == '-' || char == '_') {
			return false
		}
	}

	return !strings.HasPrefix(slug, "-") && !strings.HasPrefix(slug, "_") &&
		!strings.HasSuffix(slug, "-") && !strings.HasSuffix(slug, "_")
}

// Service-specific errors
var (
	ErrInvalidTemplate         = domain.NewDomainError("INVALID_TEMPLATE", "Invalid repository template")
	ErrRepositoryHasDependents = domain.NewDomainError("REPOSITORY_HAS_DEPENDENTS", "Repository has dependent repositories")
	ErrTemplateNotFound        = domain.NewDomainError("TEMPLATE_NOT_FOUND", "Repository template not found")
	ErrGenerationInProgress    = domain.NewDomainError("GENERATION_IN_PROGRESS", "Code generation already in progress")
	ErrInvalidGenerationType   = domain.NewDomainError("INVALID_GENERATION_TYPE", "Invalid code generation type")
)
