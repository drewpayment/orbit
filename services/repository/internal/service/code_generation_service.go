/**
 * T037 - Service Layer: CodeGenerationService with Temporal Workflow Integration
 *
 * This service implements business logic for code generation operations including
 * template processing, workflow orchestration, artifact management, and
 * integration with external code generation tools.
 *
 * Constitutional Requirements:
 * - Template-based code generation with validation
 * - Temporal workflow orchestration for long-running operations
 * - Multi-format output support (OpenAPI, gRPC, GraphQL, etc.)
 * - Git integration for code deployment
 * - Multi-tenant workspace isolation
 * - Comprehensive audit trails and progress tracking
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

// GenerationJobRepository defines the repository interface for generation job operations
type GenerationJobRepository interface {
	// Basic CRUD operations
	Create(ctx context.Context, job *domain.GenerationJob) error
	Update(ctx context.Context, job *domain.GenerationJob) error
	GetByID(ctx context.Context, id uuid.UUID) (*domain.GenerationJob, error)
	GetByWorkflowID(ctx context.Context, workflowID string) (*domain.GenerationJob, error)

	// Listing and filtering
	ListByRepository(ctx context.Context, repositoryID uuid.UUID, filters GenerationJobFilters) ([]*domain.GenerationJob, error)
	ListByWorkspace(ctx context.Context, workspaceID uuid.UUID, filters GenerationJobFilters) ([]*domain.GenerationJob, error)
	ListActive(ctx context.Context, filters GenerationJobFilters) ([]*domain.GenerationJob, error)

	// Statistics
	GetJobStats(ctx context.Context, repositoryID uuid.UUID) (*GenerationJobStats, error)
	GetWorkspaceStats(ctx context.Context, workspaceID uuid.UUID) (*WorkspaceGenerationStats, error)
}

// TemplateRepository defines the repository interface for template operations
type TemplateRepository interface {
	GetTemplateContent(ctx context.Context, templateID uuid.UUID) (*TemplateContent, error)
	GetTemplateVariables(ctx context.Context, templateID uuid.UUID) ([]*domain.RepositoryVariable, error)
	ValidateTemplate(ctx context.Context, templateID uuid.UUID) (*TemplateValidationResult, error)
}

// WorkflowClient defines the interface for Temporal workflow operations
type WorkflowClient interface {
	StartCodeGenerationWorkflow(ctx context.Context, req *CodeGenerationWorkflowRequest) (*WorkflowExecution, error)
	StartTemplateProcessingWorkflow(ctx context.Context, req *TemplateProcessingRequest) (*WorkflowExecution, error)
	StartArtifactGenerationWorkflow(ctx context.Context, req *ArtifactGenerationRequest) (*WorkflowExecution, error)

	GetWorkflowStatus(ctx context.Context, workflowID string) (*WorkflowStatus, error)
	CancelWorkflow(ctx context.Context, workflowID string) error
	GetWorkflowHistory(ctx context.Context, workflowID string) ([]*WorkflowEvent, error)

	SignalWorkflow(ctx context.Context, workflowID, signalName string, data interface{}) error
	QueryWorkflow(ctx context.Context, workflowID, queryName string) (interface{}, error)
}

// ArtifactStorage defines the interface for storing generation artifacts
type ArtifactStorage interface {
	StoreArtifact(ctx context.Context, key string, content []byte, metadata ArtifactMetadata) error
	GetArtifact(ctx context.Context, key string) ([]byte, error)
	DeleteArtifact(ctx context.Context, key string) error
	ListArtifacts(ctx context.Context, prefix string) ([]*ArtifactInfo, error)
	GetArtifactURL(ctx context.Context, key string, expiry time.Duration) (string, error)
}

// CodeGenerationFilters contains filtering options for code generation queries
type CodeGenerationFilters struct {
	GenerationType []string                  `json:"generation_type"`
	Status         []domain.GenerationStatus `json:"status"`
	CreatedBy      *uuid.UUID                `json:"created_by"`
	CreatedAfter   *time.Time                `json:"created_after"`
	CreatedBefore  *time.Time                `json:"created_before"`
	HasErrors      *bool                     `json:"has_errors"`
	TemplateID     *uuid.UUID                `json:"template_id"`
	Language       []string                  `json:"language"`
	Framework      []string                  `json:"framework"`
	Limit          int                       `json:"limit"`
	Offset         int                       `json:"offset"`
	SortBy         string                    `json:"sort_by"`    // created_at, updated_at, duration
	SortOrder      string                    `json:"sort_order"` // asc, desc
}

// GenerationJobFilters contains filtering options for generation job queries
type GenerationJobFilters struct {
	Status         []domain.GenerationStatus `json:"status"`
	GenerationType []string                  `json:"generation_type"`
	RequestedBy    *uuid.UUID                `json:"requested_by"`
	StartedAfter   *time.Time                `json:"started_after"`
	StartedBefore  *time.Time                `json:"started_before"`
	HasErrors      *bool                     `json:"has_errors"`
	WorkflowStatus []string                  `json:"workflow_status"`
	Limit          int                       `json:"limit"`
	Offset         int                       `json:"offset"`
	SortBy         string                    `json:"sort_by"`    // created_at, started_at, duration
	SortOrder      string                    `json:"sort_order"` // asc, desc
}

// CreateGenerationJobRequest contains data for creating a new code generation job
type CreateGenerationJobRequest struct {
	RepositoryID   uuid.UUID            `json:"repository_id" validate:"required"`
	WorkspaceID    uuid.UUID            `json:"workspace_id" validate:"required"`
	GenerationType string               `json:"generation_type" validate:"required"`
	TargetBranch   string               `json:"target_branch" validate:"required"`
	Configuration  CodeGenerationConfig `json:"configuration" validate:"required"`
	TemplateID     *uuid.UUID           `json:"template_id,omitempty"`
	RequestedBy    uuid.UUID            `json:"requested_by" validate:"required"`
	Priority       GenerationPriority   `json:"priority"`
	Tags           []string             `json:"tags"`
}

// CodeGenerationConfig contains configuration for code generation
type CodeGenerationConfig struct {
	// Generation settings
	OutputFormat string `json:"output_format"` // openapi, grpc, graphql, rest, docs
	Language     string `json:"language"`
	Framework    string `json:"framework"`
	Version      string `json:"version"`

	// Template variables
	Variables map[string]interface{} `json:"variables"`

	// Output configuration
	OutputPath string           `json:"output_path"`
	FileNaming FileNamingConfig `json:"file_naming"`

	// Generation options
	GenerateTests  bool `json:"generate_tests"`
	GenerateDocs   bool `json:"generate_docs"`
	GenerateClient bool `json:"generate_client"`
	GenerateServer bool `json:"generate_server"`
	GenerateModels bool `json:"generate_models"`

	// Quality settings
	ValidateOutput bool `json:"validate_output"`
	RunLinting     bool `json:"run_linting"`
	RunTests       bool `json:"run_tests"`

	// Git integration
	CreatePR      bool   `json:"create_pr"`
	PRTitle       string `json:"pr_title"`
	PRDescription string `json:"pr_description"`
	CommitMessage string `json:"commit_message"`

	// Hooks and customization
	PreHooks      []GenerationHook `json:"pre_hooks"`
	PostHooks     []GenerationHook `json:"post_hooks"`
	CustomScripts []CustomScript   `json:"custom_scripts"`

	// Advanced options
	Overwrite    bool `json:"overwrite"`
	SkipExisting bool `json:"skip_existing"`
	DryRun       bool `json:"dry_run"`

	// Integration settings
	ExternalTools []ExternalToolConfig `json:"external_tools"`
	Notifications NotificationConfig   `json:"notifications"`
}

// FileNamingConfig contains file naming configuration
type FileNamingConfig struct {
	Pattern        string `json:"pattern"`    // Template pattern for file names
	CaseStyle      string `json:"case_style"` // camel, pascal, snake, kebab
	Prefix         string `json:"prefix"`
	Suffix         string `json:"suffix"`
	Extension      string `json:"extension"`
	DirectoryStyle string `json:"directory_style"` // flat, nested, by_type
}

// GenerationHook defines a hook to run during generation
type GenerationHook struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	Command     string            `json:"command"`
	WorkingDir  string            `json:"working_dir"`
	Environment map[string]string `json:"environment"`
	TimeoutSecs int               `json:"timeout_secs"`
	OnFailure   string            `json:"on_failure"` // continue, stop, retry
	Condition   string            `json:"condition"`  // Expression to evaluate
}

// CustomScript defines a custom script to run
type CustomScript struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	Language    string            `json:"language"` // bash, python, node, go
	Content     string            `json:"content"`
	Arguments   []string          `json:"arguments"`
	Environment map[string]string `json:"environment"`
	TimeoutSecs int               `json:"timeout_secs"`
}

// ExternalToolConfig defines configuration for external tools
type ExternalToolConfig struct {
	Tool      string                 `json:"tool"` // swagger-codegen, openapi-generator, protoc
	Version   string                 `json:"version"`
	Config    map[string]interface{} `json:"config"`
	Arguments []string               `json:"arguments"`
	Enabled   bool                   `json:"enabled"`
}

// NotificationConfig defines notification settings
type NotificationConfig struct {
	OnSuccess        []NotificationTarget `json:"on_success"`
	OnFailure        []NotificationTarget `json:"on_failure"`
	OnProgress       []NotificationTarget `json:"on_progress"`
	IncludeArtifacts bool                 `json:"include_artifacts"`
}

// NotificationTarget defines a notification target
type NotificationTarget struct {
	Type    string                 `json:"type"`   // email, slack, webhook, teams
	Target  string                 `json:"target"` // email address, webhook URL, etc.
	Config  map[string]interface{} `json:"config"`
	Enabled bool                   `json:"enabled"`
}

// GenerationPriority defines the priority of a generation job
type GenerationPriority string

const (
	PriorityLow      GenerationPriority = "low"
	PriorityNormal   GenerationPriority = "normal"
	PriorityHigh     GenerationPriority = "high"
	PriorityCritical GenerationPriority = "critical"
)

// CodeGenerationWorkflowRequest contains data for starting a code generation workflow
type CodeGenerationWorkflowRequest struct {
	JobID         uuid.UUID               `json:"job_id"`
	RepositoryID  uuid.UUID               `json:"repository_id"`
	WorkspaceID   uuid.UUID               `json:"workspace_id"`
	Configuration CodeGenerationConfig    `json:"configuration"`
	TemplateData  *TemplateProcessingData `json:"template_data,omitempty"`
	RequestedBy   uuid.UUID               `json:"requested_by"`
}

// TemplateProcessingRequest contains data for template processing
type TemplateProcessingRequest struct {
	TemplateID    uuid.UUID              `json:"template_id"`
	Variables     map[string]interface{} `json:"variables"`
	OutputPath    string                 `json:"output_path"`
	Configuration TemplateConfig         `json:"configuration"`
}

// TemplateConfig contains template processing configuration
type TemplateConfig struct {
	Engine     string             `json:"engine"` // go-template, jinja2, handlebars
	Delimiters TemplateDelimiters `json:"delimiters"`
	Functions  []string           `json:"functions"` // Available template functions
	Strict     bool               `json:"strict"`    // Strict variable checking
	Whitespace WhitespaceConfig   `json:"whitespace"`
}

// TemplateDelimiters defines template delimiters
type TemplateDelimiters struct {
	Left  string `json:"left"`
	Right string `json:"right"`
}

// WhitespaceConfig defines whitespace handling
type WhitespaceConfig struct {
	TrimBlocks   bool `json:"trim_blocks"`
	LstripBlocks bool `json:"lstrip_blocks"`
	KeepTrailing bool `json:"keep_trailing"`
}

// ArtifactGenerationRequest contains data for artifact generation
type ArtifactGenerationRequest struct {
	JobID          uuid.UUID      `json:"job_id"`
	GenerationType string         `json:"generation_type"`
	SourceFiles    []SourceFile   `json:"source_files"`
	Configuration  ArtifactConfig `json:"configuration"`
	OutputPath     string         `json:"output_path"`
}

// SourceFile represents a source file for generation
type SourceFile struct {
	Path        string            `json:"path"`
	Content     string            `json:"content"`
	ContentType string            `json:"content_type"`
	Metadata    map[string]string `json:"metadata"`
}

// ArtifactConfig contains artifact generation configuration
type ArtifactConfig struct {
	Format      string            `json:"format"`
	Compression string            `json:"compression"` // none, gzip, zip
	Encryption  *EncryptionConfig `json:"encryption,omitempty"`
	Metadata    map[string]string `json:"metadata"`
	TTL         *time.Duration    `json:"ttl,omitempty"`
}

// EncryptionConfig defines encryption settings
type EncryptionConfig struct {
	Algorithm string `json:"algorithm"` // AES256, RSA
	KeyID     string `json:"key_id"`
	Enabled   bool   `json:"enabled"`
}

// WorkflowEvent represents a workflow event
type WorkflowEvent struct {
	ID         uuid.UUID              `json:"id"`
	WorkflowID string                 `json:"workflow_id"`
	EventType  string                 `json:"event_type"`
	EventData  map[string]interface{} `json:"event_data"`
	Timestamp  time.Time              `json:"timestamp"`
	Actor      *uuid.UUID             `json:"actor,omitempty"`
}

// TemplateContent represents template content and metadata
type TemplateContent struct {
	ID          uuid.UUID                    `json:"id"`
	TemplateID  uuid.UUID                    `json:"template_id"`
	Content     string                       `json:"content"`
	ContentType string                       `json:"content_type"`
	Version     string                       `json:"version"`
	Metadata    map[string]interface{}       `json:"metadata"`
	Variables   []*domain.RepositoryVariable `json:"variables"`
	CreatedAt   time.Time                    `json:"created_at"`
	UpdatedAt   time.Time                    `json:"updated_at"`
}

// TemplateValidationResult contains template validation results
type TemplateValidationResult struct {
	IsValid      bool                  `json:"is_valid"`
	Errors       []ValidationError     `json:"errors"`
	Warnings     []ValidationWarning   `json:"warnings"`
	Variables    []*VariableValidation `json:"variables"`
	Dependencies []string              `json:"dependencies"`
	ValidatedAt  time.Time             `json:"validated_at"`
}

// ValidationError represents a validation error
type ValidationError struct {
	Code     string `json:"code"`
	Message  string `json:"message"`
	Line     int    `json:"line"`
	Column   int    `json:"column"`
	Severity string `json:"severity"`
	Context  string `json:"context"`
}

// ValidationWarning represents a validation warning
type ValidationWarning struct {
	Code       string `json:"code"`
	Message    string `json:"message"`
	Line       int    `json:"line"`
	Column     int    `json:"column"`
	Suggestion string `json:"suggestion"`
}

// VariableValidation represents variable validation result
type VariableValidation struct {
	Variable    *domain.RepositoryVariable `json:"variable"`
	IsValid     bool                       `json:"is_valid"`
	Errors      []ValidationError          `json:"errors"`
	Suggestions []string                   `json:"suggestions"`
}

// TemplateProcessingData contains data for template processing
type TemplateProcessingData struct {
	Template  *TemplateContent       `json:"template"`
	Variables map[string]interface{} `json:"variables"`
	Functions map[string]interface{} `json:"functions"`
	Includes  []*TemplateInclude     `json:"includes"`
	Context   TemplateContext        `json:"context"`
}

// TemplateInclude represents an included template
type TemplateInclude struct {
	Name        string `json:"name"`
	Path        string `json:"path"`
	Content     string `json:"content"`
	Conditional bool   `json:"conditional"`
}

// TemplateContext provides context for template processing
type TemplateContext struct {
	Repository  *domain.Repository     `json:"repository"`
	Workspace   *domain.Workspace      `json:"workspace"`
	User        *domain.User           `json:"user"`
	Timestamp   time.Time              `json:"timestamp"`
	Environment string                 `json:"environment"`
	Version     string                 `json:"version"`
	Metadata    map[string]interface{} `json:"metadata"`
}

// ArtifactMetadata contains metadata for stored artifacts
type ArtifactMetadata struct {
	ContentType string            `json:"content_type"`
	Size        int64             `json:"size"`
	Checksum    string            `json:"checksum"`
	Tags        []string          `json:"tags"`
	JobID       uuid.UUID         `json:"job_id"`
	GeneratedBy uuid.UUID         `json:"generated_by"`
	CreatedAt   time.Time         `json:"created_at"`
	ExpiresAt   *time.Time        `json:"expires_at,omitempty"`
	Metadata    map[string]string `json:"metadata"`
}

// ArtifactInfo contains information about stored artifacts
type ArtifactInfo struct {
	Key         string           `json:"key"`
	Size        int64            `json:"size"`
	ContentType string           `json:"content_type"`
	Checksum    string           `json:"checksum"`
	Metadata    ArtifactMetadata `json:"metadata"`
	URL         string           `json:"url"`
	CreatedAt   time.Time        `json:"created_at"`
}

// GenerationJobStats contains statistics about generation jobs
type GenerationJobStats struct {
	TotalJobs         int                             `json:"total_jobs"`
	JobsByStatus      map[domain.GenerationStatus]int `json:"jobs_by_status"`
	JobsByType        map[string]int                  `json:"jobs_by_type"`
	AverageExecution  time.Duration                   `json:"average_execution"`
	SuccessRate       float64                         `json:"success_rate"`
	LastJobAt         *time.Time                      `json:"last_job_at"`
	MostUsedTemplates []TemplateUsageStats            `json:"most_used_templates"`
}

// WorkspaceGenerationStats contains workspace-level generation statistics
type WorkspaceGenerationStats struct {
	TotalJobs          int                             `json:"total_jobs"`
	ActiveJobs         int                             `json:"active_jobs"`
	JobsByRepository   map[uuid.UUID]int               `json:"jobs_by_repository"`
	JobsByType         map[string]int                  `json:"jobs_by_type"`
	JobsByStatus       map[domain.GenerationStatus]int `json:"jobs_by_status"`
	MonthlyJobCount    int                             `json:"monthly_job_count"`
	AverageJobDuration time.Duration                   `json:"average_job_duration"`
	SuccessRate        float64                         `json:"success_rate"`
	TopGenerators      []UserGenerationStats           `json:"top_generators"`
	ResourceUsage      ResourceUsageStats              `json:"resource_usage"`
}

// TemplateUsageStats contains template usage statistics
type TemplateUsageStats struct {
	TemplateID   uuid.UUID `json:"template_id"`
	TemplateName string    `json:"template_name"`
	UsageCount   int       `json:"usage_count"`
	SuccessRate  float64   `json:"success_rate"`
	LastUsed     time.Time `json:"last_used"`
}

// UserGenerationStats contains user generation statistics
type UserGenerationStats struct {
	UserID      uuid.UUID `json:"user_id"`
	Username    string    `json:"username"`
	JobCount    int       `json:"job_count"`
	SuccessRate float64   `json:"success_rate"`
	LastJobAt   time.Time `json:"last_job_at"`
}

// ResourceUsageStats contains resource usage statistics
type ResourceUsageStats struct {
	CPUUsage      float64 `json:"cpu_usage"`
	MemoryUsage   int64   `json:"memory_usage"`
	StorageUsage  int64   `json:"storage_usage"`
	NetworkUsage  int64   `json:"network_usage"`
	ExecutionTime int64   `json:"execution_time"`
}

// CodeGenerationService implements business logic for code generation operations
type CodeGenerationService struct {
	jobRepo        GenerationJobRepository
	templateRepo   TemplateRepository
	repositoryRepo RepositoryRepository
	workspaceRepo  WorkspaceRepository
	userRepo       UserRepository
	workflowClient WorkflowClient
	artifactStore  ArtifactStorage
	eventPub       EventPublisher
	cache          CacheManager
	logger         *slog.Logger
}

// NewCodeGenerationService creates a new code generation service instance
func NewCodeGenerationService(
	jobRepo GenerationJobRepository,
	templateRepo TemplateRepository,
	repositoryRepo RepositoryRepository,
	workspaceRepo WorkspaceRepository,
	userRepo UserRepository,
	workflowClient WorkflowClient,
	artifactStore ArtifactStorage,
	eventPub EventPublisher,
	cache CacheManager,
	logger *slog.Logger,
) *CodeGenerationService {
	return &CodeGenerationService{
		jobRepo:        jobRepo,
		templateRepo:   templateRepo,
		repositoryRepo: repositoryRepo,
		workspaceRepo:  workspaceRepo,
		userRepo:       userRepo,
		workflowClient: workflowClient,
		artifactStore:  artifactStore,
		eventPub:       eventPub,
		cache:          cache,
		logger:         logger.With("service", "code_generation"),
	}
}

// CreateGenerationJob creates a new code generation job
func (s *CodeGenerationService) CreateGenerationJob(ctx context.Context, req CreateGenerationJobRequest) (*domain.GenerationJob, error) {
	s.logger.InfoContext(ctx, "Creating code generation job",
		"repository_id", req.RepositoryID, "type", req.GenerationType, "requested_by", req.RequestedBy)

	// Validate the request
	if err := s.validateCreateJobRequest(ctx, req); err != nil {
		return nil, fmt.Errorf("validation failed: %w", err)
	}

	// Check repository exists and user has permission
	repository, err := s.repositoryRepo.GetByID(ctx, req.RepositoryID)
	if err != nil {
		return nil, fmt.Errorf("failed to get repository: %w", err)
	}

	if !s.canUserGenerateCode(ctx, repository, req.RequestedBy) {
		return nil, domain.ErrInsufficientPermission
	}

	// Check for concurrent jobs limit
	if err := s.checkConcurrentJobsLimit(ctx, req.WorkspaceID, req.RequestedBy); err != nil {
		return nil, err
	}

	// Prepare template data if using a template
	var templateData *TemplateProcessingData
	if req.TemplateID != nil {
		templateData, err = s.prepareTemplateData(ctx, *req.TemplateID, req.Configuration.Variables, repository)
		if err != nil {
			return nil, fmt.Errorf("failed to prepare template data: %w", err)
		}
	}

	// Create the generation job domain object
	job := &domain.GenerationJob{
		ID:             uuid.New(),
		RepositoryID:   req.RepositoryID,
		WorkspaceID:    req.WorkspaceID,
		GenerationType: req.GenerationType,
		TargetBranch:   req.TargetBranch,
		Status:         domain.GenerationStatusPending,
		TotalSteps:     s.calculateTotalSteps(req.Configuration),
		CompletedSteps: 0,
		CurrentStep:    "queued",
		RequestedBy:    req.RequestedBy,
		RequestData:    s.serializeConfig(req.Configuration),
		CreatedAt:      time.Now(),
		UpdatedAt:      time.Now(),
	}

	// Set commit message
	if req.Configuration.CommitMessage != "" {
		job.CommitMessage = req.Configuration.CommitMessage
	} else {
		job.CommitMessage = fmt.Sprintf("Generate %s for %s", req.GenerationType, repository.Name)
	}

	// Persist the job
	if err := s.jobRepo.Create(ctx, job); err != nil {
		return nil, fmt.Errorf("failed to create generation job: %w", err)
	}

	// Start the workflow
	workflowReq := &CodeGenerationWorkflowRequest{
		JobID:         job.ID,
		RepositoryID:  req.RepositoryID,
		WorkspaceID:   req.WorkspaceID,
		Configuration: req.Configuration,
		TemplateData:  templateData,
		RequestedBy:   req.RequestedBy,
	}

	execution, err := s.workflowClient.StartCodeGenerationWorkflow(ctx, workflowReq)
	if err != nil {
		// Update job status to failed
		job.Status = domain.GenerationStatusFailed
		job.ErrorMessage = fmt.Sprintf("Failed to start workflow: %v", err)
		s.jobRepo.Update(ctx, job)

		return nil, fmt.Errorf("failed to start code generation workflow: %w", err)
	}

	// Update job with workflow information
	job.WorkflowID = execution.WorkflowID
	job.RunID = execution.RunID
	job.Status = domain.GenerationStatusRunning
	job.CurrentStep = "initializing"
	startTime := time.Now()
	job.StartedAt = &startTime
	job.UpdatedAt = time.Now()

	if err := s.jobRepo.Update(ctx, job); err != nil {
		s.logger.WarnContext(ctx, "Failed to update job with workflow info", "error", err)
	}

	// Clear relevant caches
	s.clearJobCaches(ctx, req.RepositoryID, req.WorkspaceID)

	// TODO: Publish generation job created event when EventPublisher is updated
	s.logger.InfoContext(ctx, "Code generation job created",
		"job_id", job.ID, "workflow_id", execution.WorkflowID)

	return job, nil
}

// GetGenerationJob retrieves a generation job by ID with permission checking
func (s *CodeGenerationService) GetGenerationJob(ctx context.Context, id uuid.UUID, userID uuid.UUID) (*domain.GenerationJob, error) {
	s.logger.DebugContext(ctx, "Getting generation job", "job_id", id, "user_id", userID)

	// Check cache first
	cacheKey := fmt.Sprintf("generation_job:id:%s", id.String())
	if cached, err := s.cache.Get(ctx, cacheKey); err == nil {
		if job, ok := cached.(*domain.GenerationJob); ok {
			if s.canUserAccessGenerationJob(ctx, job, userID) {
				return job, nil
			}
			return nil, domain.ErrInsufficientPermission
		}
	}

	// Get from repository
	job, err := s.jobRepo.GetByID(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("failed to get generation job: %w", err)
	}

	// Check access permissions
	if !s.canUserAccessGenerationJob(ctx, job, userID) {
		return nil, domain.ErrInsufficientPermission
	}

	// Cache the result
	s.cache.Set(ctx, cacheKey, job, 10*time.Minute)

	return job, nil
}

// ListGenerationJobs lists generation jobs with filtering and pagination
func (s *CodeGenerationService) ListGenerationJobs(ctx context.Context, repositoryID uuid.UUID, userID uuid.UUID, filters GenerationJobFilters) ([]*domain.GenerationJob, error) {
	s.logger.DebugContext(ctx, "Listing generation jobs", "repository_id", repositoryID, "user_id", userID)

	// Get repository and check access
	repository, err := s.repositoryRepo.GetByID(ctx, repositoryID)
	if err != nil {
		return nil, fmt.Errorf("failed to get repository: %w", err)
	}

	if !s.canUserAccessRepository(ctx, repository, userID) {
		return nil, domain.ErrInsufficientPermission
	}

	// Get jobs
	jobs, err := s.jobRepo.ListByRepository(ctx, repositoryID, filters)
	if err != nil {
		return nil, fmt.Errorf("failed to list generation jobs: %w", err)
	}

	// Filter based on individual job permissions (additional security layer)
	var accessible []*domain.GenerationJob
	for _, job := range jobs {
		if s.canUserAccessGenerationJob(ctx, job, userID) {
			accessible = append(accessible, job)
		}
	}

	return accessible, nil
}

// CancelGenerationJob cancels a running generation job
func (s *CodeGenerationService) CancelGenerationJob(ctx context.Context, id uuid.UUID, cancelledBy uuid.UUID) error {
	s.logger.InfoContext(ctx, "Cancelling generation job", "job_id", id, "cancelled_by", cancelledBy)

	// Get the job
	job, err := s.jobRepo.GetByID(ctx, id)
	if err != nil {
		return fmt.Errorf("failed to get generation job: %w", err)
	}

	// Check permissions
	if !s.canUserCancelGenerationJob(ctx, job, cancelledBy) {
		return domain.ErrInsufficientPermission
	}

	// Check if job can be cancelled
	if job.Status != domain.GenerationStatusRunning && job.Status != domain.GenerationStatusPending {
		return ErrJobNotCancellable
	}

	// Cancel the workflow
	if job.WorkflowID != "" {
		if err := s.workflowClient.CancelWorkflow(ctx, job.WorkflowID); err != nil {
			s.logger.ErrorContext(ctx, "Failed to cancel workflow", "error", err, "workflow_id", job.WorkflowID)
			// Continue with job cancellation even if workflow cancellation fails
		}
	}

	// Update job status
	job.Status = domain.GenerationStatusCancelled
	job.CurrentStep = "cancelled"
	job.ErrorMessage = fmt.Sprintf("Job cancelled by user %s", cancelledBy.String())
	completedTime := time.Now()
	job.CompletedAt = &completedTime
	job.UpdatedAt = time.Now()

	// Calculate duration
	if job.StartedAt != nil {
		duration := completedTime.Sub(*job.StartedAt)
		durationMs := duration.Milliseconds()
		job.DurationMs = &durationMs
	}

	// Persist the changes
	if err := s.jobRepo.Update(ctx, job); err != nil {
		return fmt.Errorf("failed to update generation job: %w", err)
	}

	// Clear caches
	s.clearJobCaches(ctx, job.RepositoryID, job.WorkspaceID)

	// TODO: Publish generation job cancelled event when EventPublisher is updated

	s.logger.InfoContext(ctx, "Generation job cancelled", "job_id", id)

	return nil
}

// GetJobStatus gets the current status of a generation job including workflow progress
func (s *CodeGenerationService) GetJobStatus(ctx context.Context, id uuid.UUID, userID uuid.UUID) (*JobStatusResponse, error) {
	s.logger.DebugContext(ctx, "Getting job status", "job_id", id, "user_id", userID)

	// Get the job
	job, err := s.GetGenerationJob(ctx, id, userID)
	if err != nil {
		return nil, err
	}

	// Get workflow status if workflow is running
	var workflowStatus *WorkflowStatus
	if job.WorkflowID != "" && (job.Status == domain.GenerationStatusRunning || job.Status == domain.GenerationStatusPending) {
		workflowStatus, err = s.workflowClient.GetWorkflowStatus(ctx, job.WorkflowID)
		if err != nil {
			s.logger.WarnContext(ctx, "Failed to get workflow status", "error", err, "workflow_id", job.WorkflowID)
		}
	}

	// Get artifacts if job is completed
	var artifacts []*ArtifactInfo
	if job.Status == domain.GenerationStatusCompleted && len(job.ArtifactURLs) > 0 {
		artifacts, err = s.getJobArtifacts(ctx, job)
		if err != nil {
			s.logger.WarnContext(ctx, "Failed to get job artifacts", "error", err)
		}
	}

	// Calculate progress
	progress := s.calculateProgress(job, workflowStatus)

	response := &JobStatusResponse{
		Job:            job,
		WorkflowStatus: workflowStatus,
		Artifacts:      artifacts,
		Progress:       progress,
		EstimatedTime:  s.estimateRemainingTime(job, workflowStatus),
		UpdatedAt:      time.Now(),
	}

	return response, nil
}

// JobStatusResponse contains the complete status of a generation job
type JobStatusResponse struct {
	Job            *domain.GenerationJob `json:"job"`
	WorkflowStatus *WorkflowStatus       `json:"workflow_status,omitempty"`
	Artifacts      []*ArtifactInfo       `json:"artifacts,omitempty"`
	Progress       float64               `json:"progress"`
	EstimatedTime  *time.Duration        `json:"estimated_time,omitempty"`
	UpdatedAt      time.Time             `json:"updated_at"`
}

// Helper methods

// validateCreateJobRequest validates a create job request
func (s *CodeGenerationService) validateCreateJobRequest(ctx context.Context, req CreateGenerationJobRequest) error {
	if req.RepositoryID == uuid.Nil {
		return ErrInvalidRepositoryID
	}

	if req.WorkspaceID == uuid.Nil {
		return ErrInvalidWorkspaceID
	}

	if req.RequestedBy == uuid.Nil {
		return ErrInvalidUserID
	}

	if req.GenerationType == "" {
		return ErrInvalidGenerationType
	}

	if req.TargetBranch == "" {
		return ErrInvalidTargetBranch
	}

	// Validate generation type
	validTypes := []string{"api", "client", "server", "docs", "tests", "models", "full"}
	isValidType := false
	for _, validType := range validTypes {
		if req.GenerationType == validType {
			isValidType = true
			break
		}
	}
	if !isValidType {
		return ErrCodeGenerationTypeMismatch
	}

	return nil
}

// checkConcurrentJobsLimit checks if user has exceeded concurrent jobs limit
func (s *CodeGenerationService) checkConcurrentJobsLimit(ctx context.Context, workspaceID uuid.UUID, userID uuid.UUID) error {
	// Get workspace settings to check limits
	workspace, err := s.workspaceRepo.GetByID(ctx, workspaceID)
	if err != nil {
		return fmt.Errorf("failed to get workspace: %w", err)
	}

	// Count active jobs for user in workspace
	filters := GenerationJobFilters{
		Status:      []domain.GenerationStatus{domain.GenerationStatusPending, domain.GenerationStatusRunning},
		RequestedBy: &userID,
		Limit:       100,
	}

	activeJobs, err := s.jobRepo.ListByWorkspace(ctx, workspaceID, filters)
	if err != nil {
		return fmt.Errorf("failed to count active jobs: %w", err)
	}

	// Check against workspace limit
	maxConcurrentJobs := workspace.Settings.MaxConcurrentBuilds
	if len(activeJobs) >= maxConcurrentJobs {
		return ErrConcurrentJobsLimitExceeded
	}

	return nil
}

// prepareTemplateData prepares template data for processing
func (s *CodeGenerationService) prepareTemplateData(ctx context.Context, templateID uuid.UUID, variables map[string]interface{}, repository *domain.Repository) (*TemplateProcessingData, error) {
	// Get template content
	templateContent, err := s.templateRepo.GetTemplateContent(ctx, templateID)
	if err != nil {
		return nil, fmt.Errorf("failed to get template content: %w", err)
	}

	// Validate template
	validation, err := s.templateRepo.ValidateTemplate(ctx, templateID)
	if err != nil {
		return nil, fmt.Errorf("failed to validate template: %w", err)
	}

	if !validation.IsValid {
		return nil, fmt.Errorf("template validation failed: %v", validation.Errors)
	}

	// Get workspace and user for context
	workspace, _ := s.workspaceRepo.GetByID(ctx, repository.WorkspaceID)
	user, _ := s.userRepo.GetByID(ctx, repository.CreatedBy)

	// Prepare template context
	context := TemplateContext{
		Repository:  repository,
		Workspace:   workspace,
		User:        user,
		Timestamp:   time.Now(),
		Environment: "development", // TODO: Make this configurable
		Version:     "1.0.0",       // TODO: Get from configuration
		Metadata:    make(map[string]interface{}),
	}

	// Merge variables with defaults
	mergedVariables := make(map[string]interface{})
	for _, variable := range templateContent.Variables {
		if value, exists := variables[variable.Key]; exists {
			mergedVariables[variable.Key] = value
		} else if variable.DefaultValue != "" {
			mergedVariables[variable.Key] = variable.DefaultValue
		}
	}

	templateData := &TemplateProcessingData{
		Template:  templateContent,
		Variables: mergedVariables,
		Functions: s.getTemplateFunctions(),
		Context:   context,
	}

	return templateData, nil
}

// calculateTotalSteps calculates the total number of steps for a generation job
func (s *CodeGenerationService) calculateTotalSteps(config CodeGenerationConfig) int {
	steps := 1 // Base generation step

	if config.GenerateTests {
		steps++
	}
	if config.GenerateDocs {
		steps++
	}
	if config.GenerateClient {
		steps++
	}
	if config.GenerateServer {
		steps++
	}
	if config.GenerateModels {
		steps++
	}
	if config.ValidateOutput {
		steps++
	}
	if config.RunLinting {
		steps++
	}
	if config.RunTests {
		steps++
	}
	if config.CreatePR {
		steps++
	}

	// Add steps for hooks
	steps += len(config.PreHooks) + len(config.PostHooks)

	return steps
}

// serializeConfig serializes the generation configuration for storage
func (s *CodeGenerationService) serializeConfig(config CodeGenerationConfig) map[string]interface{} {
	// This would typically use JSON marshaling or similar
	// Simplified for now
	return map[string]interface{}{
		"output_format":  config.OutputFormat,
		"language":       config.Language,
		"framework":      config.Framework,
		"generate_tests": config.GenerateTests,
		"generate_docs":  config.GenerateDocs,
	}
}

// getTemplateFunctions returns available template functions
func (s *CodeGenerationService) getTemplateFunctions() map[string]interface{} {
	return map[string]interface{}{
		"camelCase":   s.toCamelCase,
		"pascalCase":  s.toPascalCase,
		"snakeCase":   s.toSnakeCase,
		"kebabCase":   s.toKebabCase,
		"pluralize":   s.pluralize,
		"singularize": s.singularize,
		"upper":       strings.ToUpper,
		"lower":       strings.ToLower,
		"title":       strings.Title,
	}
}

// getJobArtifacts gets artifacts for a completed job
func (s *CodeGenerationService) getJobArtifacts(ctx context.Context, job *domain.GenerationJob) ([]*ArtifactInfo, error) {
	prefix := fmt.Sprintf("jobs/%s/artifacts/", job.ID.String())
	return s.artifactStore.ListArtifacts(ctx, prefix)
}

// calculateProgress calculates job progress based on job and workflow status
func (s *CodeGenerationService) calculateProgress(job *domain.GenerationJob, workflowStatus *WorkflowStatus) float64 {
	if job.Status == domain.GenerationStatusCompleted {
		return 1.0
	}

	if job.Status == domain.GenerationStatusFailed || job.Status == domain.GenerationStatusCancelled {
		return 0.0
	}

	if job.TotalSteps == 0 {
		return 0.0
	}

	baseProgress := float64(job.CompletedSteps) / float64(job.TotalSteps)

	// Add workflow progress if available
	if workflowStatus != nil && workflowStatus.Progress > 0 {
		return baseProgress + (workflowStatus.Progress / float64(job.TotalSteps))
	}

	return baseProgress
}

// estimateRemainingTime estimates remaining time for job completion
func (s *CodeGenerationService) estimateRemainingTime(job *domain.GenerationJob, workflowStatus *WorkflowStatus) *time.Duration {
	if job.Status != domain.GenerationStatusRunning || job.StartedAt == nil {
		return nil
	}

	elapsed := time.Since(*job.StartedAt)
	progress := s.calculateProgress(job, workflowStatus)

	if progress <= 0 {
		return nil
	}

	totalEstimate := time.Duration(float64(elapsed) / progress)
	remaining := totalEstimate - elapsed

	if remaining < 0 {
		return nil
	}

	return &remaining
}

// Permission checking methods

func (s *CodeGenerationService) canUserGenerateCode(ctx context.Context, repository *domain.Repository, userID uuid.UUID) bool {
	// Repository owner can generate code
	if repository.CreatedBy == userID {
		return true
	}

	// Check workspace permissions
	workspace, err := s.workspaceRepo.GetByID(ctx, repository.WorkspaceID)
	if err != nil {
		return false
	}

	member := workspace.GetMember(userID)
	if member == nil {
		return false
	}

	return member.Role == domain.WorkspaceRoleOwner ||
		member.Role == domain.WorkspaceRoleAdmin ||
		member.Role == domain.WorkspaceRoleDeveloper
}

func (s *CodeGenerationService) canUserAccessGenerationJob(ctx context.Context, job *domain.GenerationJob, userID uuid.UUID) bool {
	// Job creator can always access
	if job.RequestedBy == userID {
		return true
	}

	// Check repository access
	repository, err := s.repositoryRepo.GetByID(ctx, job.RepositoryID)
	if err != nil {
		return false
	}

	return s.canUserAccessRepository(ctx, repository, userID)
}

func (s *CodeGenerationService) canUserAccessRepository(ctx context.Context, repository *domain.Repository, userID uuid.UUID) bool {
	// Repository owner can access
	if repository.CreatedBy == userID {
		return true
	}

	// Check workspace membership
	workspace, err := s.workspaceRepo.GetByID(ctx, repository.WorkspaceID)
	if err != nil {
		return false
	}

	return workspace.HasMember(userID)
}

func (s *CodeGenerationService) canUserCancelGenerationJob(ctx context.Context, job *domain.GenerationJob, userID uuid.UUID) bool {
	// Job creator can cancel their own jobs
	if job.RequestedBy == userID {
		return true
	}

	// Workspace admin/owner can cancel any job
	workspace, err := s.workspaceRepo.GetByID(ctx, job.WorkspaceID)
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

// Cache management

func (s *CodeGenerationService) clearJobCaches(ctx context.Context, repositoryID, workspaceID uuid.UUID) {
	patterns := []string{
		fmt.Sprintf("generation_job:repository:%s", repositoryID.String()),
		fmt.Sprintf("generation_job:workspace:%s", workspaceID.String()),
		"generation_jobs:list:*",
		"generation_stats:*",
	}

	for _, pattern := range patterns {
		if err := s.cache.DeleteByPattern(ctx, pattern); err != nil {
			s.logger.WarnContext(ctx, "Failed to clear cache", "pattern", pattern, "error", err)
		}
	}
}

// String transformation utility functions

func (s *CodeGenerationService) toCamelCase(str string) string {
	// Simplified implementation - in production, use a proper library
	parts := strings.Split(strings.ReplaceAll(str, "-", "_"), "_")
	if len(parts) == 0 {
		return str
	}

	result := strings.ToLower(parts[0])
	for i := 1; i < len(parts); i++ {
		if len(parts[i]) > 0 {
			result += strings.ToUpper(string(parts[i][0])) + strings.ToLower(parts[i][1:])
		}
	}
	return result
}

func (s *CodeGenerationService) toPascalCase(str string) string {
	camel := s.toCamelCase(str)
	if len(camel) > 0 {
		return strings.ToUpper(string(camel[0])) + camel[1:]
	}
	return camel
}

func (s *CodeGenerationService) toSnakeCase(str string) string {
	// Simplified implementation
	return strings.ToLower(strings.ReplaceAll(str, "-", "_"))
}

func (s *CodeGenerationService) toKebabCase(str string) string {
	// Simplified implementation
	return strings.ToLower(strings.ReplaceAll(str, "_", "-"))
}

func (s *CodeGenerationService) pluralize(str string) string {
	// Very simplified pluralization - use a proper library in production
	if strings.HasSuffix(str, "s") {
		return str
	}
	if strings.HasSuffix(str, "y") {
		return str[:len(str)-1] + "ies"
	}
	return str + "s"
}

func (s *CodeGenerationService) singularize(str string) string {
	// Very simplified singularization - use a proper library in production
	if strings.HasSuffix(str, "ies") {
		return str[:len(str)-3] + "y"
	}
	if strings.HasSuffix(str, "s") && len(str) > 1 {
		return str[:len(str)-1]
	}
	return str
}

// Service-specific errors
var (
	ErrInvalidRepositoryID         = domain.NewDomainError("INVALID_REPOSITORY_ID", "Invalid repository ID")
	ErrInvalidWorkspaceID          = domain.NewDomainError("INVALID_WORKSPACE_ID", "Invalid workspace ID")
	ErrInvalidUserID               = domain.NewDomainError("INVALID_USER_ID", "Invalid user ID")
	ErrCodeGenerationTypeMismatch  = domain.NewDomainError("GENERATION_TYPE_MISMATCH", "Generation type mismatch")
	ErrInvalidTargetBranch         = domain.NewDomainError("INVALID_TARGET_BRANCH", "Invalid target branch")
	ErrJobNotFound                 = domain.NewDomainError("JOB_NOT_FOUND", "Generation job not found")
	ErrJobNotCancellable           = domain.NewDomainError("JOB_NOT_CANCELLABLE", "Generation job cannot be cancelled")
	ErrConcurrentJobsLimitExceeded = domain.NewDomainError("CONCURRENT_JOBS_LIMIT_EXCEEDED", "Concurrent jobs limit exceeded")
	ErrTemplateProcessingFailed    = domain.NewDomainError("TEMPLATE_PROCESSING_FAILED", "Template processing failed")
	ErrWorkflowExecutionFailed     = domain.NewDomainError("WORKFLOW_EXECUTION_FAILED", "Workflow execution failed")
	ErrArtifactStorageFailed       = domain.NewDomainError("ARTIFACT_STORAGE_FAILED", "Artifact storage failed")
)
