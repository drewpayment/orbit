/**
 * T031 - Data Model: Repository with Template Configuration
 *
 * This model defines the core Repository entity with template handling,
 * code generation support, and dependency management for the Internal Developer Portal.
 *
 * Constitutional Requirements:
 * - Template-based repository generation
 * - Git provider integration and webhook support
 * - Dependency tracking and impact analysis
 * - Code generation workflow integration
 * - Multi-tenant workspace isolation
 */

package domain

import (
	"time"

	"github.com/google/uuid"
)

// RepositoryType defines the type/purpose of repository
type RepositoryType string

const (
	RepositoryTypeService        RepositoryType = "service"        // Microservice or API
	RepositoryTypeLibrary        RepositoryType = "library"        // Shared library/package
	RepositoryTypeFrontend       RepositoryType = "frontend"       // Web/mobile frontend
	RepositoryTypeMobile         RepositoryType = "mobile"         // Native mobile app
	RepositoryTypeDocumentation  RepositoryType = "documentation"  // Documentation site
	RepositoryTypeInfrastructure RepositoryType = "infrastructure" // Infrastructure as code
	RepositoryTypeTemplate       RepositoryType = "template"       // Repository template
)

// RepositoryStatus represents the current state of the repository
type RepositoryStatus string

const (
	RepositoryStatusActive     RepositoryStatus = "active"     // Normal active repository
	RepositoryStatusGenerating RepositoryStatus = "generating" // Code generation in progress
	RepositoryStatusArchived   RepositoryStatus = "archived"   // Archived/read-only
	RepositoryStatusError      RepositoryStatus = "error"      // Generation or sync error
	RepositoryStatusTemplate   RepositoryStatus = "template"   // Used as template only
)

// GenerationStatus represents the status of code generation
type GenerationStatus string

const (
	GenerationStatusPending   GenerationStatus = "pending"   // Generation requested
	GenerationStatusRunning   GenerationStatus = "running"   // Generation in progress
	GenerationStatusCompleted GenerationStatus = "completed" // Generation successful
	GenerationStatusFailed    GenerationStatus = "failed"    // Generation failed
	GenerationStatusCancelled GenerationStatus = "cancelled" // Generation cancelled
)

// DependencyType defines the relationship type between repositories
type DependencyType string

const (
	DependencyTypeDependsOn  DependencyType = "depends_on" // Direct dependency
	DependencyTypeImplements DependencyType = "implements" // Implements interface/contract
	DependencyTypeExtends    DependencyType = "extends"    // Extends base functionality
	DependencyTypeUses       DependencyType = "uses"       // Uses as service/utility
	DependencyTypeProvides   DependencyType = "provides"   // Provides service to
	DependencyTypeIncludes   DependencyType = "includes"   // Includes as module
)

// ValidationRuleType defines types of validation rules for variables
type ValidationRuleType string

const (
	ValidationTypeRequired  ValidationRuleType = "required"   // Field is required
	ValidationTypeMinLength ValidationRuleType = "min_length" // Minimum string length
	ValidationTypeMaxLength ValidationRuleType = "max_length" // Maximum string length
	ValidationTypePattern   ValidationRuleType = "pattern"    // Regex pattern match
	ValidationTypeRange     ValidationRuleType = "range"      // Numeric range
	ValidationTypeEnum      ValidationRuleType = "enum"       // Allowed values
	ValidationTypeCustom    ValidationRuleType = "custom"     // Custom validation function
)

// ValidationRule defines a validation rule for repository variables
type ValidationRule struct {
	Type       ValidationRuleType `json:"type" db:"type"`
	Value      string             `json:"value" db:"value"`
	Message    string             `json:"message" db:"message"`
	Parameters map[string]string  `json:"parameters" db:"parameters"`
}

// RepositoryVariable defines a configurable variable for repository templates
type RepositoryVariable struct {
	ID              uuid.UUID        `json:"id" db:"id"`
	RepositoryID    uuid.UUID        `json:"repository_id" db:"repository_id"`
	Key             string           `json:"key" db:"key"`
	Value           string           `json:"value" db:"value"`
	DefaultValue    string           `json:"default_value" db:"default_value"`
	Type            string           `json:"type" db:"type"` // string, number, boolean, select, multiselect
	Required        bool             `json:"required" db:"required"`
	Description     string           `json:"description" db:"description"`
	ValidationRules []ValidationRule `json:"validation_rules" db:"validation_rules"`
	Options         []string         `json:"options" db:"options"` // For select/multiselect types
	SortOrder       int              `json:"sort_order" db:"sort_order"`

	// Metadata
	CreatedAt time.Time `json:"created_at" db:"created_at"`
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
	CreatedBy uuid.UUID `json:"created_by" db:"created_by"`
}

// TemplateHook defines lifecycle hooks for template processing
type TemplateHook struct {
	ID           uuid.UUID         `json:"id" db:"id"`
	RepositoryID uuid.UUID         `json:"repository_id" db:"repository_id"`
	HookType     string            `json:"hook_type" db:"hook_type"` // pre_generation, post_generation, pre_commit
	Command      string            `json:"command" db:"command"`
	WorkingDir   string            `json:"working_dir" db:"working_dir"`
	Environment  map[string]string `json:"environment" db:"environment"`
	TimeoutSecs  int               `json:"timeout_secs" db:"timeout_secs"`
	SortOrder    int               `json:"sort_order" db:"sort_order"`
	Enabled      bool              `json:"enabled" db:"enabled"`

	// Metadata
	CreatedAt time.Time `json:"created_at" db:"created_at"`
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
}

// TemplateConfig contains configuration for repository templates
type TemplateConfig struct {
	ID           uuid.UUID `json:"id" db:"id"`
	RepositoryID uuid.UUID `json:"repository_id" db:"repository_id"`

	// Base template information
	BaseTemplate    string `json:"base_template" db:"base_template"`
	TemplateVersion string `json:"template_version" db:"template_version"`
	Language        string `json:"language" db:"language"`
	Framework       string `json:"framework" db:"framework"`

	// Configuration
	Customizations map[string]interface{} `json:"customizations" db:"customizations"`

	// Hooks and lifecycle (stored separately)
	Hooks []TemplateHook `json:"hooks" db:"-"`

	// Feature flags
	EnableTests  bool `json:"enable_tests" db:"enable_tests"`
	EnableDocs   bool `json:"enable_docs" db:"enable_docs"`
	EnableCI     bool `json:"enable_ci" db:"enable_ci"`
	EnableDocker bool `json:"enable_docker" db:"enable_docker"`

	// Metadata
	CreatedAt time.Time `json:"created_at" db:"created_at"`
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
	UpdatedBy uuid.UUID `json:"updated_by" db:"updated_by"`
}

// RepositoryDependency represents a dependency relationship between repositories
type RepositoryDependency struct {
	ID             uuid.UUID      `json:"id" db:"id"`
	RepositoryID   uuid.UUID      `json:"repository_id" db:"repository_id"`
	DependencyID   uuid.UUID      `json:"dependency_id" db:"dependency_id"`
	DependencyType DependencyType `json:"dependency_type" db:"dependency_type"`

	// Version constraints
	VersionConstraint string `json:"version_constraint" db:"version_constraint"`
	CurrentVersion    string `json:"current_version" db:"current_version"`

	// Metadata
	Notes    string `json:"notes" db:"notes"`
	Critical bool   `json:"critical" db:"critical"` // Breaking changes cause failures

	// Audit fields
	CreatedAt time.Time `json:"created_at" db:"created_at"`
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
	CreatedBy uuid.UUID `json:"created_by" db:"created_by"`
}

// GenerationJob represents a code generation job for a repository
type GenerationJob struct {
	ID           uuid.UUID `json:"id" db:"id"`
	RepositoryID uuid.UUID `json:"repository_id" db:"repository_id"`
	WorkspaceID  uuid.UUID `json:"workspace_id" db:"workspace_id"`

	// Temporal workflow tracking
	WorkflowID string `json:"workflow_id" db:"workflow_id"`
	RunID      string `json:"run_id" db:"run_id"`

	// Job configuration
	GenerationType string `json:"generation_type" db:"generation_type"` // initial, update, refresh
	TargetBranch   string `json:"target_branch" db:"target_branch"`
	CommitMessage  string `json:"commit_message" db:"commit_message"`

	// Status and timing
	Status      GenerationStatus `json:"status" db:"status"`
	StartedAt   *time.Time       `json:"started_at" db:"started_at"`
	CompletedAt *time.Time       `json:"completed_at" db:"completed_at"`
	DurationMs  *int64           `json:"duration_ms" db:"duration_ms"`

	// Progress tracking
	TotalSteps     int    `json:"total_steps" db:"total_steps"`
	CompletedSteps int    `json:"completed_steps" db:"completed_steps"`
	CurrentStep    string `json:"current_step" db:"current_step"`

	// Results
	GeneratedFiles []string `json:"generated_files" db:"generated_files"`
	ModifiedFiles  []string `json:"modified_files" db:"modified_files"`
	ErrorMessage   string   `json:"error_message" db:"error_message"`
	ArtifactURLs   []string `json:"artifact_urls" db:"artifact_urls"`

	// Request context
	RequestedBy uuid.UUID              `json:"requested_by" db:"requested_by"`
	RequestData map[string]interface{} `json:"request_data" db:"request_data"`

	// Audit fields
	CreatedAt time.Time `json:"created_at" db:"created_at"`
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
}

// RepositoryWebhook represents webhook configuration for Git provider integration
type RepositoryWebhook struct {
	ID           uuid.UUID `json:"id" db:"id"`
	RepositoryID uuid.UUID `json:"repository_id" db:"repository_id"`

	// Webhook configuration
	URL    string   `json:"url" db:"url"`
	Secret string   `json:"-" db:"secret"`      // Never serialize
	Events []string `json:"events" db:"events"` // push, pull_request, etc.
	Active bool     `json:"active" db:"active"`

	// Provider specific
	ProviderID string      `json:"provider_id" db:"provider_id"` // ID from Git provider
	Provider   GitProvider `json:"provider" db:"provider"`

	// Statistics
	LastTriggered *time.Time `json:"last_triggered" db:"last_triggered"`
	TriggerCount  int        `json:"trigger_count" db:"trigger_count"`

	// Metadata
	CreatedAt time.Time `json:"created_at" db:"created_at"`
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
}

// Repository represents a repository in the Internal Developer Portal
type Repository struct {
	// Core identity fields
	ID          uuid.UUID `json:"id" db:"id"`
	WorkspaceID uuid.UUID `json:"workspace_id" db:"workspace_id"`
	Name        string    `json:"name" db:"name"`
	Slug        string    `json:"slug" db:"slug"`
	Description string    `json:"description" db:"description"`

	// Repository classification
	Type      RepositoryType `json:"type" db:"type"`
	Language  string         `json:"language" db:"language"`
	Framework string         `json:"framework" db:"framework"`

	// Git integration
	GitURL        string      `json:"git_url" db:"git_url"`
	GitProvider   GitProvider `json:"git_provider" db:"git_provider"`
	DefaultBranch string      `json:"default_branch" db:"default_branch"`

	// Access control
	Visibility WorkspaceVisibility `json:"visibility" db:"visibility"`

	// Template information
	IsTemplateRepo bool                 `json:"is_template" db:"is_template"`
	TemplateConfig *TemplateConfig      `json:"template_config" db:"-"` // Loaded separately
	Variables      []RepositoryVariable `json:"variables" db:"-"`       // Loaded separately

	// Generation tracking
	LastGeneratedAt  *time.Time       `json:"last_generated_at" db:"last_generated_at"`
	GenerationStatus GenerationStatus `json:"generation_status" db:"generation_status"`
	CurrentJobID     *uuid.UUID       `json:"current_job_id" db:"current_job_id"`

	// Repository relationships
	Dependencies []RepositoryDependency `json:"dependencies" db:"-"` // Loaded separately
	Dependents   []RepositoryDependency `json:"dependents" db:"-"`   // Loaded separately

	// Integration
	Webhooks []RepositoryWebhook `json:"webhooks" db:"-"` // Loaded separately

	// Status and lifecycle
	Status RepositoryStatus `json:"status" db:"status"`

	// Statistics
	StarCount        int `json:"star_count" db:"star_count"`
	ForkCount        int `json:"fork_count" db:"fork_count"`
	IssueCount       int `json:"issue_count" db:"issue_count"`
	PullRequestCount int `json:"pull_request_count" db:"pull_request_count"`

	// Metadata
	Tags     []string `json:"tags" db:"tags"`
	Topics   []string `json:"topics" db:"topics"`
	Homepage string   `json:"homepage" db:"homepage"`

	// Audit trail fields
	CreatedAt time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt time.Time  `json:"updated_at" db:"updated_at"`
	CreatedBy uuid.UUID  `json:"created_by" db:"created_by"`
	UpdatedBy uuid.UUID  `json:"updated_by" db:"updated_by"`
	DeletedAt *time.Time `json:"deleted_at" db:"deleted_at"` // Soft delete
}

// NewRepository creates a new repository with required fields and sensible defaults
func NewRepository(workspaceID uuid.UUID, name, slug, description string, repoType RepositoryType, createdBy uuid.UUID) *Repository {
	now := time.Now()

	return &Repository{
		ID:               uuid.New(),
		WorkspaceID:      workspaceID,
		Name:             name,
		Slug:             slug,
		Description:      description,
		Type:             repoType,
		Visibility:       WorkspaceVisibilityInternal, // Default visibility
		DefaultBranch:    "main",
		IsTemplateRepo:   false,
		GenerationStatus: GenerationStatusPending,
		Status:           RepositoryStatusActive,
		StarCount:        0,
		ForkCount:        0,
		IssueCount:       0,
		PullRequestCount: 0,
		Tags:             []string{},
		Topics:           []string{},
		CreatedAt:        now,
		UpdatedAt:        now,
		CreatedBy:        createdBy,
		UpdatedBy:        createdBy,
	}
}

// NewRepositoryFromTemplate creates a new repository from a template
func NewRepositoryFromTemplate(workspaceID uuid.UUID, templateRepo *Repository, name, slug, description string, variables map[string]string, createdBy uuid.UUID) *Repository {
	repo := NewRepository(workspaceID, name, slug, description, templateRepo.Type, createdBy)

	// Copy template properties
	repo.Language = templateRepo.Language
	repo.Framework = templateRepo.Framework
	repo.Type = templateRepo.Type

	// Copy template configuration (will be customized during generation)
	if templateRepo.TemplateConfig != nil {
		repo.TemplateConfig = &TemplateConfig{
			ID:              uuid.New(),
			RepositoryID:    repo.ID,
			BaseTemplate:    templateRepo.ID.String(),
			TemplateVersion: templateRepo.TemplateConfig.TemplateVersion,
			Language:        templateRepo.Language,
			Framework:       templateRepo.Framework,
			Customizations:  make(map[string]interface{}),
			EnableTests:     templateRepo.TemplateConfig.EnableTests,
			EnableDocs:      templateRepo.TemplateConfig.EnableDocs,
			EnableCI:        templateRepo.TemplateConfig.EnableCI,
			EnableDocker:    templateRepo.TemplateConfig.EnableDocker,
			CreatedAt:       time.Now(),
			UpdatedAt:       time.Now(),
			UpdatedBy:       createdBy,
		}

		// Apply variable customizations
		for key, value := range variables {
			repo.TemplateConfig.Customizations[key] = value
		}
	}

	return repo
}

// IsActive returns true if the repository is not soft-deleted
func (r *Repository) IsActive() bool {
	return r.DeletedAt == nil && r.Status != RepositoryStatusArchived
}

// CanUserAccess checks if a user has access to this repository
func (r *Repository) CanUserAccess(userID uuid.UUID, workspace *Workspace) bool {
	if workspace == nil {
		return false
	}

	// Check workspace access first
	if !workspace.HasMember(userID) {
		// Check if repository visibility allows access
		switch r.Visibility {
		case WorkspaceVisibilityPublic:
			return true
		case WorkspaceVisibilityInternal:
			return workspace.CanUserAccess(userID, RoleDeveloper) // Require authenticated user
		default:
			return false
		}
	}

	return true
}

// HasDependency checks if this repository depends on another repository
func (r *Repository) HasDependency(dependencyID uuid.UUID) bool {
	for _, dep := range r.Dependencies {
		if dep.DependencyID == dependencyID {
			return true
		}
	}
	return false
}

// AddDependency adds a dependency to this repository
func (r *Repository) AddDependency(dependencyID uuid.UUID, depType DependencyType, versionConstraint string, createdBy uuid.UUID) *RepositoryDependency {
	// Check if dependency already exists
	if r.HasDependency(dependencyID) {
		return nil
	}

	now := time.Now()
	dependency := &RepositoryDependency{
		ID:                uuid.New(),
		RepositoryID:      r.ID,
		DependencyID:      dependencyID,
		DependencyType:    depType,
		VersionConstraint: versionConstraint,
		CurrentVersion:    "",
		Critical:          false,
		CreatedAt:         now,
		UpdatedAt:         now,
		CreatedBy:         createdBy,
	}

	r.Dependencies = append(r.Dependencies, *dependency)
	return dependency
}

// RemoveDependency removes a dependency from this repository
func (r *Repository) RemoveDependency(dependencyID uuid.UUID) bool {
	for i, dep := range r.Dependencies {
		if dep.DependencyID == dependencyID {
			r.Dependencies = append(r.Dependencies[:i], r.Dependencies[i+1:]...)
			return true
		}
	}
	return false
}

// GetDependenciesByType returns dependencies filtered by type
func (r *Repository) GetDependenciesByType(depType DependencyType) []RepositoryDependency {
	var filtered []RepositoryDependency
	for _, dep := range r.Dependencies {
		if dep.DependencyType == depType {
			filtered = append(filtered, dep)
		}
	}
	return filtered
}

// IsTemplate returns true if this repository can be used as a template
func (r *Repository) IsTemplate() bool {
	return r.IsTemplateRepo && r.Status == RepositoryStatusTemplate
}

// StartGeneration starts a new generation job for this repository
func (r *Repository) StartGeneration(workflowID, runID string, requestedBy uuid.UUID, requestData map[string]interface{}) *GenerationJob {
	now := time.Now()

	job := &GenerationJob{
		ID:             uuid.New(),
		RepositoryID:   r.ID,
		WorkspaceID:    r.WorkspaceID,
		WorkflowID:     workflowID,
		RunID:          runID,
		GenerationType: "initial",
		TargetBranch:   r.DefaultBranch,
		Status:         GenerationStatusRunning,
		StartedAt:      &now,
		TotalSteps:     0,
		CompletedSteps: 0,
		CurrentStep:    "initializing",
		RequestedBy:    requestedBy,
		RequestData:    requestData,
		CreatedAt:      now,
		UpdatedAt:      now,
	}

	// Update repository status
	r.GenerationStatus = GenerationStatusRunning
	r.CurrentJobID = &job.ID
	r.UpdatedAt = now

	return job
}

// CompleteGeneration marks the current generation job as completed
func (r *Repository) CompleteGeneration(generatedFiles, modifiedFiles []string) {
	now := time.Now()
	r.LastGeneratedAt = &now
	r.GenerationStatus = GenerationStatusCompleted
	r.CurrentJobID = nil
	r.UpdatedAt = now
}

// FailGeneration marks the current generation job as failed
func (r *Repository) FailGeneration(errorMessage string) {
	now := time.Now()
	r.GenerationStatus = GenerationStatusFailed
	r.UpdatedAt = now
}

// GetVariable returns a repository variable by key
func (r *Repository) GetVariable(key string) *RepositoryVariable {
	for _, variable := range r.Variables {
		if variable.Key == key {
			return &variable
		}
	}
	return nil
}

// SetVariable sets a repository variable value
func (r *Repository) SetVariable(key, value string, updatedBy uuid.UUID) bool {
	for i, variable := range r.Variables {
		if variable.Key == key {
			r.Variables[i].Value = value
			r.Variables[i].UpdatedAt = time.Now()
			return true
		}
	}
	return false
}

// AddVariable adds a new variable to the repository
func (r *Repository) AddVariable(key, value, defaultValue, description, variableType string, required bool, createdBy uuid.UUID) *RepositoryVariable {
	now := time.Now()

	variable := &RepositoryVariable{
		ID:              uuid.New(),
		RepositoryID:    r.ID,
		Key:             key,
		Value:           value,
		DefaultValue:    defaultValue,
		Type:            variableType,
		Required:        required,
		Description:     description,
		ValidationRules: []ValidationRule{},
		Options:         []string{},
		SortOrder:       len(r.Variables),
		CreatedAt:       now,
		UpdatedAt:       now,
		CreatedBy:       createdBy,
	}

	r.Variables = append(r.Variables, *variable)
	return variable
}

// ValidateVariables validates all repository variables against their rules
func (r *Repository) ValidateVariables() []error {
	var errors []error

	for _, variable := range r.Variables {
		if variable.Required && variable.Value == "" {
			errors = append(errors, NewDomainError("REQUIRED_VARIABLE_MISSING",
				"Required variable '"+variable.Key+"' is missing"))
		}

		// Apply validation rules
		for _, rule := range variable.ValidationRules {
			if err := r.validateVariableRule(variable, rule); err != nil {
				errors = append(errors, err)
			}
		}
	}

	return errors
}

// validateVariableRule validates a single variable against a validation rule
func (r *Repository) validateVariableRule(variable RepositoryVariable, rule ValidationRule) error {
	switch rule.Type {
	case ValidationTypeMinLength:
		// Implementation would go here
		return nil
	case ValidationTypeMaxLength:
		// Implementation would go here
		return nil
	case ValidationTypePattern:
		// Implementation would go here
		return nil
	default:
		return nil
	}
}

// Archive archives the repository (soft delete with special status)
func (r *Repository) Archive(archivedBy uuid.UUID) {
	now := time.Now()
	r.Status = RepositoryStatusArchived
	r.UpdatedAt = now
	r.UpdatedBy = archivedBy
}

// Unarchive restores an archived repository
func (r *Repository) Unarchive(unarchivedBy uuid.UUID) {
	now := time.Now()
	r.Status = RepositoryStatusActive
	r.UpdatedAt = now
	r.UpdatedBy = unarchivedBy
}

// Validate performs business logic validation on the repository
func (r *Repository) Validate() error {
	if r.Name == "" {
		return ErrInvalidRepositoryName
	}

	if r.Slug == "" {
		return ErrInvalidRepositorySlug
	}

	if r.WorkspaceID == uuid.Nil {
		return ErrInvalidWorkspaceID
	}

	// Validate repository type
	switch r.Type {
	case RepositoryTypeService, RepositoryTypeLibrary, RepositoryTypeFrontend,
		RepositoryTypeMobile, RepositoryTypeDocumentation, RepositoryTypeInfrastructure, RepositoryTypeTemplate:
		// Valid types
	default:
		return ErrInvalidRepositoryType
	}

	// Validate variables
	if errors := r.ValidateVariables(); len(errors) > 0 {
		return errors[0] // Return first error
	}

	return nil
}

// ToPublicProfile returns a repository profile safe for public consumption
func (r *Repository) ToPublicProfile() map[string]interface{} {
	return map[string]interface{}{
		"id":          r.ID,
		"name":        r.Name,
		"slug":        r.Slug,
		"description": r.Description,
		"type":        r.Type,
		"language":    r.Language,
		"framework":   r.Framework,
		"visibility":  r.Visibility,
		"star_count":  r.StarCount,
		"fork_count":  r.ForkCount,
		"tags":        r.Tags,
		"topics":      r.Topics,
		"created_at":  r.CreatedAt,
		"updated_at":  r.UpdatedAt,
	}
}

// Domain errors for repository operations
var (
	ErrInvalidRepositoryName   = NewDomainError("INVALID_REPOSITORY_NAME", "Repository name is required and must be valid")
	ErrInvalidRepositorySlug   = NewDomainError("INVALID_REPOSITORY_SLUG", "Repository slug is required and must be valid")
	ErrInvalidRepositoryType   = NewDomainError("INVALID_REPOSITORY_TYPE", "Repository type is invalid")
	ErrInvalidWorkspaceID      = NewDomainError("INVALID_WORKSPACE_ID", "Workspace ID is required")
	ErrRepositoryNotFound      = NewDomainError("REPOSITORY_NOT_FOUND", "Repository not found")
	ErrRepositoryExists        = NewDomainError("REPOSITORY_EXISTS", "Repository already exists")
	ErrRepositoryArchived      = NewDomainError("REPOSITORY_ARCHIVED", "Repository is archived")
	ErrGenerationInProgress    = NewDomainError("GENERATION_IN_PROGRESS", "Code generation is already in progress")
	ErrInvalidTemplate         = NewDomainError("INVALID_TEMPLATE", "Repository is not a valid template")
	ErrCircularDependency      = NewDomainError("CIRCULAR_DEPENDENCY", "Circular dependency detected")
	ErrDependencyNotFound      = NewDomainError("DEPENDENCY_NOT_FOUND", "Repository dependency not found")
	ErrDependencyExists        = NewDomainError("DEPENDENCY_EXISTS", "Repository dependency already exists")
	ErrInvalidGitURL           = NewDomainError("INVALID_GIT_URL", "Git URL is invalid")
	ErrTemplateVariableMissing = NewDomainError("TEMPLATE_VARIABLE_MISSING", "Required template variable is missing")
)
