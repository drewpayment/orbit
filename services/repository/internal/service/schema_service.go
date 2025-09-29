/**
 * T038 - Service Layer: SchemaService with Validation and Transformation
 *
 * This service implements business logic for API schema operations including
 * schema validation, transformation, versioning, documentation generation,
 * and integration with code generation workflows.
 *
 * Constitutional Requirements:
 * - Multi-format schema support (OpenAPI, GraphQL, gRPC, JSON Schema)
 * - Schema validation and transformation pipelines
 * - Version management and compatibility checking
 * - Documentation generation and publishing
 * - Multi-tenant workspace isolation
 * - Comprehensive audit trails and change tracking
 */

package service

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/drewpayment/orbit/services/repository/internal/domain"
	"github.com/google/uuid"
)

// APISchemaRepository defines the repository interface for API schema operations
type APISchemaRepository interface {
	// Basic CRUD operations
	Create(ctx context.Context, schema *domain.APISchema) error
	Update(ctx context.Context, schema *domain.APISchema) error
	Delete(ctx context.Context, id uuid.UUID) error
	GetByID(ctx context.Context, id uuid.UUID) (*domain.APISchema, error)
	GetByName(ctx context.Context, workspaceID uuid.UUID, name string) (*domain.APISchema, error)
	GetBySlug(ctx context.Context, workspaceID uuid.UUID, slug string) (*domain.APISchema, error)

	// Version management
	GetVersion(ctx context.Context, schemaID uuid.UUID, version string) (*domain.APISchemaVersion, error)
	GetLatestVersion(ctx context.Context, schemaID uuid.UUID) (*domain.APISchemaVersion, error)
	ListVersions(ctx context.Context, schemaID uuid.UUID) ([]*domain.APISchemaVersion, error)
	CreateVersion(ctx context.Context, version *domain.APISchemaVersion) error

	// Listing and search
	ListByWorkspace(ctx context.Context, workspaceID uuid.UUID, filters SchemaFilters) ([]*domain.APISchema, error)
	SearchSchemas(ctx context.Context, workspaceID uuid.UUID, query string, filters SchemaFilters) ([]*domain.APISchema, error)

	// Dependencies and relationships
	GetDependencies(ctx context.Context, schemaID uuid.UUID) ([]*SchemaDependency, error)
	GetDependents(ctx context.Context, schemaID uuid.UUID) ([]*SchemaDependency, error)

	// Statistics
	GetSchemaStats(ctx context.Context, schemaID uuid.UUID) (*SchemaStats, error)
	GetWorkspaceStats(ctx context.Context, workspaceID uuid.UUID) (*WorkspaceSchemaStats, error)
}

// SchemaValidator defines the interface for schema validation operations
type SchemaValidator interface {
	ValidateSchema(ctx context.Context, schemaContent string, format SchemaFormat) (*ValidationResult, error)
	ValidateCompatibility(ctx context.Context, oldSchema, newSchema string, format SchemaFormat) (*CompatibilityResult, error)
	ValidateAgainstContract(ctx context.Context, schema, contract string, format SchemaFormat) (*ContractValidationResult, error)
	GetValidationRules(ctx context.Context, format SchemaFormat) ([]*ValidationRule, error)
}

// SchemaTransformer defines the interface for schema transformation operations
type SchemaTransformer interface {
	TransformSchema(ctx context.Context, req *TransformationRequest) (*TransformationResult, error)
	ConvertFormat(ctx context.Context, schema string, from, to SchemaFormat) (*ConversionResult, error)
	MergeSchemas(ctx context.Context, schemas []string, format SchemaFormat, strategy MergeStrategy) (*MergeResult, error)
	ExtractComponents(ctx context.Context, schema string, format SchemaFormat) (*ComponentsResult, error)
}

// DocumentationGenerator defines the interface for documentation generation
type DocumentationGenerator interface {
	GenerateDocumentation(ctx context.Context, req *DocumentationRequest) (*DocumentationResult, error)
	GenerateChangelog(ctx context.Context, oldVersion, newVersion *domain.APISchemaVersion) (*ChangelogResult, error)
	GenerateSDK(ctx context.Context, req *SDKGenerationRequest) (*SDKResult, error)
	PreviewDocumentation(ctx context.Context, schema string, format SchemaFormat, theme string) (*PreviewResult, error)
}

// SchemaFormat represents supported schema formats
type SchemaFormat string

const (
	SchemaFormatOpenAPI    SchemaFormat = "openapi"
	SchemaFormatGraphQL    SchemaFormat = "graphql"
	SchemaFormatGRPC       SchemaFormat = "grpc"
	SchemaFormatJSONSchema SchemaFormat = "json_schema"
	SchemaFormatAvro       SchemaFormat = "avro"
	SchemaFormatThrift     SchemaFormat = "thrift"
)

// SchemaStatus represents the current state of a schema
type SchemaStatus string

const (
	SchemaStatusDraft      SchemaStatus = "draft"
	SchemaStatusReview     SchemaStatus = "review"
	SchemaStatusApproved   SchemaStatus = "approved"
	SchemaStatusPublished  SchemaStatus = "published"
	SchemaStatusDeprecated SchemaStatus = "deprecated"
	SchemaStatusArchived   SchemaStatus = "archived"
)

// SchemaVisibility represents the visibility of a schema
type SchemaVisibility string

const (
	SchemaVisibilityPrivate  SchemaVisibility = "private"
	SchemaVisibilityInternal SchemaVisibility = "internal"
	SchemaVisibilityPublic   SchemaVisibility = "public"
)

// MergeStrategy represents schema merging strategies
type MergeStrategy string

const (
	MergeStrategyUnion     MergeStrategy = "union"
	MergeStrategyIntersect MergeStrategy = "intersect"
	MergeStrategyOverride  MergeStrategy = "override"
	MergeStrategyCompose   MergeStrategy = "compose"
)

// SchemaFilters contains filtering options for schema queries
type SchemaFilters struct {
	Format        []SchemaFormat     `json:"format"`
	Status        []SchemaStatus     `json:"status"`
	Visibility    []SchemaVisibility `json:"visibility"`
	CreatedBy     *uuid.UUID         `json:"created_by"`
	UpdatedBy     *uuid.UUID         `json:"updated_by"`
	CreatedAfter  *time.Time         `json:"created_after"`
	CreatedBefore *time.Time         `json:"created_before"`
	HasVersions   *bool              `json:"has_versions"`
	Tags          []string           `json:"tags"`
	Categories    []string           `json:"categories"`
	Limit         int                `json:"limit"`
	Offset        int                `json:"offset"`
	SortBy        string             `json:"sort_by"`    // name, created_at, updated_at, version_count
	SortOrder     string             `json:"sort_order"` // asc, desc
}

// CreateSchemaRequest contains data for creating a new API schema
type CreateSchemaRequest struct {
	WorkspaceID uuid.UUID              `json:"workspace_id" validate:"required"`
	Name        string                 `json:"name" validate:"required,min=1,max=100"`
	Slug        string                 `json:"slug" validate:"required,min=1,max=50,alphanum_dash"`
	Description string                 `json:"description" validate:"max=500"`
	Format      SchemaFormat           `json:"format" validate:"required"`
	Content     string                 `json:"content" validate:"required"`
	Version     string                 `json:"version" validate:"required"`
	Status      SchemaStatus           `json:"status"`
	Visibility  SchemaVisibility       `json:"visibility"`
	Tags        []string               `json:"tags"`
	Categories  []string               `json:"categories"`
	Metadata    map[string]interface{} `json:"metadata"`
	CreatedBy   uuid.UUID              `json:"created_by" validate:"required"`
}

// UpdateSchemaRequest contains data for updating an API schema
type UpdateSchemaRequest struct {
	ID          uuid.UUID              `json:"id" validate:"required"`
	Name        *string                `json:"name,omitempty" validate:"omitempty,min=1,max=100"`
	Description *string                `json:"description,omitempty" validate:"omitempty,max=500"`
	Status      *SchemaStatus          `json:"status,omitempty"`
	Visibility  *SchemaVisibility      `json:"visibility,omitempty"`
	Tags        []string               `json:"tags,omitempty"`
	Categories  []string               `json:"categories,omitempty"`
	Metadata    map[string]interface{} `json:"metadata,omitempty"`
	UpdatedBy   uuid.UUID              `json:"updated_by" validate:"required"`
}

// CreateVersionRequest contains data for creating a new schema version
type CreateVersionRequest struct {
	SchemaID    uuid.UUID              `json:"schema_id" validate:"required"`
	Version     string                 `json:"version" validate:"required"`
	Content     string                 `json:"content" validate:"required"`
	ChangeNotes string                 `json:"change_notes"`
	IsBreaking  bool                   `json:"is_breaking"`
	IsDraft     bool                   `json:"is_draft"`
	Metadata    map[string]interface{} `json:"metadata"`
	CreatedBy   uuid.UUID              `json:"created_by" validate:"required"`
}

// ValidationRequest contains data for schema validation
type ValidationRequest struct {
	Content  string                 `json:"content" validate:"required"`
	Format   SchemaFormat           `json:"format" validate:"required"`
	Rules    []string               `json:"rules"`
	Context  ValidationContext      `json:"context"`
	Metadata map[string]interface{} `json:"metadata"`
}

// ValidationContext provides context for schema validation
type ValidationContext struct {
	WorkspaceID uuid.UUID              `json:"workspace_id"`
	SchemaID    *uuid.UUID             `json:"schema_id,omitempty"`
	Version     string                 `json:"version"`
	Environment string                 `json:"environment"`
	Metadata    map[string]interface{} `json:"metadata"`
}

// ValidationResult contains the result of schema validation
type ValidationResult struct {
	IsValid     bool                      `json:"is_valid"`
	Errors      []SchemaValidationError   `json:"errors"`
	Warnings    []SchemaValidationWarning `json:"warnings"`
	Suggestions []ValidationSuggestion    `json:"suggestions"`
	Metrics     ValidationMetrics         `json:"metrics"`
	ValidatedAt time.Time                 `json:"validated_at"`
	Duration    time.Duration             `json:"duration"`
}

// SchemaValidationError represents a validation error
type SchemaValidationError struct {
	Code     string                 `json:"code"`
	Message  string                 `json:"message"`
	Path     string                 `json:"path"`
	Line     int                    `json:"line"`
	Column   int                    `json:"column"`
	Severity string                 `json:"severity"` // error, warning, info
	Rule     string                 `json:"rule"`
	Context  map[string]interface{} `json:"context"`
}

// SchemaValidationWarning represents a validation warning
type SchemaValidationWarning struct {
	Code       string `json:"code"`
	Message    string `json:"message"`
	Path       string `json:"path"`
	Line       int    `json:"line"`
	Column     int    `json:"column"`
	Rule       string `json:"rule"`
	Suggestion string `json:"suggestion"`
}

// ValidationSuggestion represents a validation suggestion
type ValidationSuggestion struct {
	Type     string `json:"type"` // improvement, optimization, best_practice
	Message  string `json:"message"`
	Path     string `json:"path"`
	Action   string `json:"action"`
	Example  string `json:"example"`
	Priority string `json:"priority"` // high, medium, low
}

// ValidationMetrics contains validation metrics
type ValidationMetrics struct {
	TotalLines      int `json:"total_lines"`
	TotalEndpoints  int `json:"total_endpoints"`
	TotalModels     int `json:"total_models"`
	ComplexityScore int `json:"complexity_score"`
	QualityScore    int `json:"quality_score"`
	SecurityScore   int `json:"security_score"`
}

// ValidationRule represents a validation rule
type ValidationRule struct {
	ID            string                 `json:"id"`
	Name          string                 `json:"name"`
	Description   string                 `json:"description"`
	Category      string                 `json:"category"`
	Severity      string                 `json:"severity"`
	Enabled       bool                   `json:"enabled"`
	Configuration map[string]interface{} `json:"configuration"`
}

// CompatibilityResult contains the result of compatibility checking
type CompatibilityResult struct {
	IsCompatible    bool                 `json:"is_compatible"`
	Compatibility   CompatibilityLevel   `json:"compatibility"`
	Changes         []SchemaChange       `json:"changes"`
	BreakingChanges []SchemaChange       `json:"breaking_changes"`
	Summary         CompatibilitySummary `json:"summary"`
	CheckedAt       time.Time            `json:"checked_at"`
}

// CompatibilityLevel represents the level of compatibility
type CompatibilityLevel string

const (
	CompatibilityLevelFull     CompatibilityLevel = "full"
	CompatibilityLevelBackward CompatibilityLevel = "backward"
	CompatibilityLevelForward  CompatibilityLevel = "forward"
	CompatibilityLevelBreaking CompatibilityLevel = "breaking"
	CompatibilityLevelNone     CompatibilityLevel = "none"
)

// SchemaChange represents a change between schema versions
type SchemaChange struct {
	Type        string      `json:"type"`     // added, removed, modified, renamed
	Category    string      `json:"category"` // endpoint, model, property, enum
	Path        string      `json:"path"`
	OldValue    interface{} `json:"old_value"`
	NewValue    interface{} `json:"new_value"`
	IsBreaking  bool        `json:"is_breaking"`
	Impact      string      `json:"impact"`
	Description string      `json:"description"`
	Suggestion  string      `json:"suggestion"`
}

// CompatibilitySummary provides a summary of compatibility analysis
type CompatibilitySummary struct {
	TotalChanges       int `json:"total_changes"`
	AddedCount         int `json:"added_count"`
	RemovedCount       int `json:"removed_count"`
	ModifiedCount      int `json:"modified_count"`
	BreakingCount      int `json:"breaking_count"`
	CompatibilityScore int `json:"compatibility_score"`
}

// ContractValidationResult contains the result of contract validation
type ContractValidationResult struct {
	IsValid     bool                `json:"is_valid"`
	Violations  []ContractViolation `json:"violations"`
	Coverage    ContractCoverage    `json:"coverage"`
	Compliance  ContractCompliance  `json:"compliance"`
	ValidatedAt time.Time           `json:"validated_at"`
}

// ContractViolation represents a contract violation
type ContractViolation struct {
	Rule     string      `json:"rule"`
	Message  string      `json:"message"`
	Path     string      `json:"path"`
	Severity string      `json:"severity"`
	Expected interface{} `json:"expected"`
	Actual   interface{} `json:"actual"`
}

// ContractCoverage represents contract coverage metrics
type ContractCoverage struct {
	TotalRequirements   int      `json:"total_requirements"`
	CoveredRequirements int      `json:"covered_requirements"`
	CoveragePercentage  float64  `json:"coverage_percentage"`
	MissingRequirements []string `json:"missing_requirements"`
}

// ContractCompliance represents contract compliance metrics
type ContractCompliance struct {
	ComplianceScore  float64           `json:"compliance_score"`
	ComplianceLevel  string            `json:"compliance_level"` // full, partial, minimal, none
	ComplianceIssues []ComplianceIssue `json:"compliance_issues"`
}

// ComplianceIssue represents a compliance issue
type ComplianceIssue struct {
	Category   string `json:"category"`
	Issue      string `json:"issue"`
	Severity   string `json:"severity"`
	Suggestion string `json:"suggestion"`
}

// TransformationRequest contains data for schema transformation
type TransformationRequest struct {
	Content         string                `json:"content" validate:"required"`
	Format          SchemaFormat          `json:"format" validate:"required"`
	Transformations []Transformation      `json:"transformations" validate:"required"`
	Options         TransformationOptions `json:"options"`
	Context         TransformationContext `json:"context"`
}

// Transformation represents a schema transformation
type Transformation struct {
	Type       string                 `json:"type"`   // rename, add, remove, modify, extract
	Target     string                 `json:"target"` // path or pattern
	Operation  string                 `json:"operation"`
	Parameters map[string]interface{} `json:"parameters"`
	Condition  string                 `json:"condition,omitempty"`
}

// TransformationOptions contains transformation options
type TransformationOptions struct {
	PreserveComments  bool `json:"preserve_comments"`
	PreserveMetadata  bool `json:"preserve_metadata"`
	ValidateResult    bool `json:"validate_result"`
	GenerateChangelog bool `json:"generate_changelog"`
	DryRun            bool `json:"dry_run"`
}

// TransformationContext provides context for transformation
type TransformationContext struct {
	WorkspaceID uuid.UUID              `json:"workspace_id"`
	SchemaID    *uuid.UUID             `json:"schema_id,omitempty"`
	Version     string                 `json:"version"`
	Environment string                 `json:"environment"`
	Metadata    map[string]interface{} `json:"metadata"`
}

// TransformationResult contains the result of schema transformation
type TransformationResult struct {
	Success                bool                    `json:"success"`
	TransformedContent     string                  `json:"transformed_content"`
	AppliedTransformations []AppliedTransformation `json:"applied_transformations"`
	Errors                 []TransformationError   `json:"errors"`
	Warnings               []TransformationWarning `json:"warnings"`
	Changelog              string                  `json:"changelog"`
	Metadata               map[string]interface{}  `json:"metadata"`
	TransformedAt          time.Time               `json:"transformed_at"`
	Duration               time.Duration           `json:"duration"`
}

// AppliedTransformation represents an applied transformation
type AppliedTransformation struct {
	Transformation Transformation `json:"transformation"`
	Success        bool           `json:"success"`
	Changes        []string       `json:"changes"`
	Error          string         `json:"error,omitempty"`
}

// TransformationError represents a transformation error
type TransformationError struct {
	Transformation string `json:"transformation"`
	Code           string `json:"code"`
	Message        string `json:"message"`
	Path           string `json:"path"`
}

// TransformationWarning represents a transformation warning
type TransformationWarning struct {
	Transformation string `json:"transformation"`
	Message        string `json:"message"`
	Path           string `json:"path"`
	Suggestion     string `json:"suggestion"`
}

// ConversionResult contains the result of format conversion
type ConversionResult struct {
	Success          bool                `json:"success"`
	ConvertedContent string              `json:"converted_content"`
	FromFormat       SchemaFormat        `json:"from_format"`
	ToFormat         SchemaFormat        `json:"to_format"`
	Errors           []ConversionError   `json:"errors"`
	Warnings         []ConversionWarning `json:"warnings"`
	ConvertedAt      time.Time           `json:"converted_at"`
	Duration         time.Duration       `json:"duration"`
}

// ConversionError represents a conversion error
type ConversionError struct {
	Code     string `json:"code"`
	Message  string `json:"message"`
	Path     string `json:"path"`
	Severity string `json:"severity"`
}

// ConversionWarning represents a conversion warning
type ConversionWarning struct {
	Message    string `json:"message"`
	Path       string `json:"path"`
	Suggestion string `json:"suggestion"`
}

// MergeResult contains the result of schema merging
type MergeResult struct {
	Success       bool                 `json:"success"`
	MergedContent string               `json:"merged_content"`
	Strategy      MergeStrategy        `json:"strategy"`
	Conflicts     []MergeConflict      `json:"conflicts"`
	Resolutions   []ConflictResolution `json:"resolutions"`
	MergedAt      time.Time            `json:"merged_at"`
	Duration      time.Duration        `json:"duration"`
}

// MergeConflict represents a merge conflict
type MergeConflict struct {
	Path        string        `json:"path"`
	Type        string        `json:"type"` // naming, type, structure
	Description string        `json:"description"`
	Options     []MergeOption `json:"options"`
}

// MergeOption represents a merge option
type MergeOption struct {
	ID          string      `json:"id"`
	Description string      `json:"description"`
	Value       interface{} `json:"value"`
	Recommended bool        `json:"recommended"`
}

// ConflictResolution represents how a conflict was resolved
type ConflictResolution struct {
	ConflictPath string `json:"conflict_path"`
	Resolution   string `json:"resolution"`
	ChosenOption string `json:"chosen_option"`
	Reason       string `json:"reason"`
}

// ComponentsResult contains extracted components from a schema
type ComponentsResult struct {
	Success     bool                   `json:"success"`
	Components  SchemaComponents       `json:"components"`
	Metadata    map[string]interface{} `json:"metadata"`
	ExtractedAt time.Time              `json:"extracted_at"`
}

// SchemaComponents represents extracted schema components
type SchemaComponents struct {
	Models     []ComponentModel     `json:"models"`
	Endpoints  []ComponentEndpoint  `json:"endpoints"`
	Enums      []ComponentEnum      `json:"enums"`
	References []ComponentReference `json:"references"`
	Extensions []ComponentExtension `json:"extensions"`
}

// ComponentModel represents a model component
type ComponentModel struct {
	Name        string                 `json:"name"`
	Type        string                 `json:"type"`
	Properties  []ComponentProperty    `json:"properties"`
	Required    []string               `json:"required"`
	Description string                 `json:"description"`
	Example     interface{}            `json:"example"`
	Metadata    map[string]interface{} `json:"metadata"`
}

// ComponentProperty represents a model property
type ComponentProperty struct {
	Name        string              `json:"name"`
	Type        string              `json:"type"`
	Format      string              `json:"format"`
	Description string              `json:"description"`
	Required    bool                `json:"required"`
	Default     interface{}         `json:"default"`
	Example     interface{}         `json:"example"`
	Constraints PropertyConstraints `json:"constraints"`
}

// PropertyConstraints represents property constraints
type PropertyConstraints struct {
	MinLength *int     `json:"min_length,omitempty"`
	MaxLength *int     `json:"max_length,omitempty"`
	Minimum   *float64 `json:"minimum,omitempty"`
	Maximum   *float64 `json:"maximum,omitempty"`
	Pattern   string   `json:"pattern,omitempty"`
	Enum      []string `json:"enum,omitempty"`
}

// ComponentEndpoint represents an endpoint component
type ComponentEndpoint struct {
	Path        string                 `json:"path"`
	Method      string                 `json:"method"`
	OperationID string                 `json:"operation_id"`
	Summary     string                 `json:"summary"`
	Description string                 `json:"description"`
	Parameters  []ComponentParameter   `json:"parameters"`
	RequestBody *ComponentRequestBody  `json:"request_body,omitempty"`
	Responses   []ComponentResponse    `json:"responses"`
	Tags        []string               `json:"tags"`
	Security    []ComponentSecurity    `json:"security"`
	Metadata    map[string]interface{} `json:"metadata"`
}

// ComponentParameter represents an endpoint parameter
type ComponentParameter struct {
	Name        string      `json:"name"`
	In          string      `json:"in"` // query, header, path, cookie
	Type        string      `json:"type"`
	Required    bool        `json:"required"`
	Description string      `json:"description"`
	Example     interface{} `json:"example"`
	Schema      interface{} `json:"schema"`
}

// ComponentRequestBody represents a request body
type ComponentRequestBody struct {
	Description string                    `json:"description"`
	Required    bool                      `json:"required"`
	Content     map[string]ComponentMedia `json:"content"`
}

// ComponentMedia represents media type content
type ComponentMedia struct {
	Schema   interface{}            `json:"schema"`
	Example  interface{}            `json:"example"`
	Examples map[string]interface{} `json:"examples"`
}

// ComponentResponse represents an endpoint response
type ComponentResponse struct {
	Code        string                     `json:"code"`
	Description string                     `json:"description"`
	Headers     map[string]ComponentHeader `json:"headers"`
	Content     map[string]ComponentMedia  `json:"content"`
}

// ComponentHeader represents a response header
type ComponentHeader struct {
	Type        string      `json:"type"`
	Description string      `json:"description"`
	Required    bool        `json:"required"`
	Example     interface{} `json:"example"`
}

// ComponentSecurity represents security requirements
type ComponentSecurity struct {
	Type   string   `json:"type"`
	Name   string   `json:"name"`
	Scopes []string `json:"scopes"`
}

// ComponentEnum represents an enum component
type ComponentEnum struct {
	Name        string   `json:"name"`
	Type        string   `json:"type"`
	Values      []string `json:"values"`
	Description string   `json:"description"`
}

// ComponentReference represents a reference component
type ComponentReference struct {
	Name        string `json:"name"`
	Type        string `json:"type"`
	Target      string `json:"target"`
	Description string `json:"description"`
}

// ComponentExtension represents an extension component
type ComponentExtension struct {
	Name        string      `json:"name"`
	Value       interface{} `json:"value"`
	Description string      `json:"description"`
}

// DocumentationRequest contains data for documentation generation
type DocumentationRequest struct {
	SchemaID   uuid.UUID              `json:"schema_id" validate:"required"`
	Version    string                 `json:"version"`
	Format     DocumentationFormat    `json:"format" validate:"required"`
	Theme      string                 `json:"theme"`
	Options    DocumentationOptions   `json:"options"`
	OutputPath string                 `json:"output_path"`
	Metadata   map[string]interface{} `json:"metadata"`
}

// DocumentationFormat represents documentation formats
type DocumentationFormat string

const (
	DocumentationFormatHTML     DocumentationFormat = "html"
	DocumentationFormatMarkdown DocumentationFormat = "markdown"
	DocumentationFormatPDF      DocumentationFormat = "pdf"
	DocumentationFormatOpenAPI  DocumentationFormat = "openapi_ui"
	DocumentationFormatRedoc    DocumentationFormat = "redoc"
	DocumentationFormatSlate    DocumentationFormat = "slate"
)

// DocumentationOptions contains documentation generation options
type DocumentationOptions struct {
	IncludeExamples bool        `json:"include_examples"`
	IncludeSchemas  bool        `json:"include_schemas"`
	IncludeHeaders  bool        `json:"include_headers"`
	IncludeTOC      bool        `json:"include_toc"`
	GroupByTags     bool        `json:"group_by_tags"`
	ShowDeprecated  bool        `json:"show_deprecated"`
	CustomCSS       string      `json:"custom_css"`
	Logo            string      `json:"logo"`
	Title           string      `json:"title"`
	Description     string      `json:"description"`
	Version         string      `json:"version"`
	ContactInfo     ContactInfo `json:"contact_info"`
	LicenseInfo     LicenseInfo `json:"license_info"`
}

// ContactInfo represents contact information
type ContactInfo struct {
	Name  string `json:"name"`
	Email string `json:"email"`
	URL   string `json:"url"`
}

// LicenseInfo represents license information
type LicenseInfo struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

// DocumentationResult contains the result of documentation generation
type DocumentationResult struct {
	Success          bool                    `json:"success"`
	DocumentationURL string                  `json:"documentation_url"`
	Artifacts        []DocumentationArtifact `json:"artifacts"`
	Errors           []DocumentationError    `json:"errors"`
	Warnings         []DocumentationWarning  `json:"warnings"`
	GeneratedAt      time.Time               `json:"generated_at"`
	Duration         time.Duration           `json:"duration"`
}

// DocumentationArtifact represents a documentation artifact
type DocumentationArtifact struct {
	Type        string `json:"type"` // html, css, js, image, pdf
	Path        string `json:"path"`
	URL         string `json:"url"`
	Size        int64  `json:"size"`
	ContentType string `json:"content_type"`
}

// DocumentationError represents a documentation error
type DocumentationError struct {
	Code     string `json:"code"`
	Message  string `json:"message"`
	Path     string `json:"path"`
	Severity string `json:"severity"`
}

// DocumentationWarning represents a documentation warning
type DocumentationWarning struct {
	Message    string `json:"message"`
	Path       string `json:"path"`
	Suggestion string `json:"suggestion"`
}

// ChangelogResult contains the result of changelog generation
type ChangelogResult struct {
	Success     bool           `json:"success"`
	Changelog   string         `json:"changelog"`
	Format      string         `json:"format"` // markdown, html, json
	Changes     []SchemaChange `json:"changes"`
	Summary     ChangeSummary  `json:"summary"`
	GeneratedAt time.Time      `json:"generated_at"`
}

// ChangeSummary provides a summary of changes
type ChangeSummary struct {
	TotalChanges    int `json:"total_changes"`
	BreakingChanges int `json:"breaking_changes"`
	NewFeatures     int `json:"new_features"`
	Improvements    int `json:"improvements"`
	BugFixes        int `json:"bug_fixes"`
	Deprecations    int `json:"deprecations"`
}

// SDKGenerationRequest contains data for SDK generation
type SDKGenerationRequest struct {
	SchemaID    uuid.UUID              `json:"schema_id" validate:"required"`
	Version     string                 `json:"version"`
	Language    string                 `json:"language" validate:"required"`
	Framework   string                 `json:"framework"`
	PackageName string                 `json:"package_name"`
	Options     SDKOptions             `json:"options"`
	OutputPath  string                 `json:"output_path"`
	Metadata    map[string]interface{} `json:"metadata"`
}

// SDKOptions contains SDK generation options
type SDKOptions struct {
	IncludeTests    bool              `json:"include_tests"`
	IncludeDocs     bool              `json:"include_docs"`
	IncludeExamples bool              `json:"include_examples"`
	AsyncSupport    bool              `json:"async_support"`
	RetryLogic      bool              `json:"retry_logic"`
	Validation      bool              `json:"validation"`
	Serialization   string            `json:"serialization"`  // json, xml, protobuf
	Authentication  []string          `json:"authentication"` // bearer, basic, api_key
	CustomTemplates map[string]string `json:"custom_templates"`
}

// SDKResult contains the result of SDK generation
type SDKResult struct {
	Success     bool          `json:"success"`
	Language    string        `json:"language"`
	Framework   string        `json:"framework"`
	PackageName string        `json:"package_name"`
	Files       []SDKFile     `json:"files"`
	Errors      []SDKError    `json:"errors"`
	Warnings    []SDKWarning  `json:"warnings"`
	GeneratedAt time.Time     `json:"generated_at"`
	Duration    time.Duration `json:"duration"`
}

// SDKFile represents an SDK file
type SDKFile struct {
	Path     string `json:"path"`
	Content  string `json:"content"`
	Type     string `json:"type"` // source, test, doc, example
	Size     int64  `json:"size"`
	Language string `json:"language"`
}

// SDKError represents an SDK generation error
type SDKError struct {
	Code     string `json:"code"`
	Message  string `json:"message"`
	File     string `json:"file"`
	Line     int    `json:"line"`
	Severity string `json:"severity"`
}

// SDKWarning represents an SDK generation warning
type SDKWarning struct {
	Message    string `json:"message"`
	File       string `json:"file"`
	Line       int    `json:"line"`
	Suggestion string `json:"suggestion"`
}

// PreviewResult contains the result of documentation preview
type PreviewResult struct {
	Success     bool           `json:"success"`
	PreviewURL  string         `json:"preview_url"`
	Content     string         `json:"content"`
	Assets      []PreviewAsset `json:"assets"`
	ExpiresAt   time.Time      `json:"expires_at"`
	GeneratedAt time.Time      `json:"generated_at"`
}

// PreviewAsset represents a preview asset
type PreviewAsset struct {
	Type string `json:"type"`
	URL  string `json:"url"`
	Path string `json:"path"`
}

// SchemaDependency represents a dependency between schemas
type SchemaDependency struct {
	ID             uuid.UUID              `json:"id"`
	SchemaID       uuid.UUID              `json:"schema_id"`
	DependsOnID    uuid.UUID              `json:"depends_on_id"`
	DependencyType string                 `json:"dependency_type"` // references, extends, imports
	Version        string                 `json:"version"`
	Path           string                 `json:"path"`
	IsRequired     bool                   `json:"is_required"`
	Description    string                 `json:"description"`
	Metadata       map[string]interface{} `json:"metadata"`
	CreatedAt      time.Time              `json:"created_at"`
	UpdatedAt      time.Time              `json:"updated_at"`
}

// SchemaStats contains statistics about a schema
type SchemaStats struct {
	TotalVersions     int        `json:"total_versions"`
	PublishedVersions int        `json:"published_versions"`
	DraftVersions     int        `json:"draft_versions"`
	Dependencies      int        `json:"dependencies"`
	Dependents        int        `json:"dependents"`
	LastPublished     *time.Time `json:"last_published"`
	LastModified      *time.Time `json:"last_modified"`
	UsageCount        int        `json:"usage_count"`
	DownloadCount     int        `json:"download_count"`
	ValidationScore   int        `json:"validation_score"`
	QualityScore      int        `json:"quality_score"`
	PopularityScore   int        `json:"popularity_score"`
}

// WorkspaceSchemaStats contains workspace-level schema statistics
type WorkspaceSchemaStats struct {
	TotalSchemas      int                     `json:"total_schemas"`
	SchemasByFormat   map[SchemaFormat]int    `json:"schemas_by_format"`
	SchemasByStatus   map[SchemaStatus]int    `json:"schemas_by_status"`
	TotalVersions     int                     `json:"total_versions"`
	PublishedVersions int                     `json:"published_versions"`
	RecentActivity    []SchemaActivity        `json:"recent_activity"`
	TopContributors   []SchemaContributor     `json:"top_contributors"`
	QualityMetrics    WorkspaceQualityMetrics `json:"quality_metrics"`
}

// SchemaActivity represents recent schema activity
type SchemaActivity struct {
	SchemaID   uuid.UUID `json:"schema_id"`
	SchemaName string    `json:"schema_name"`
	Action     string    `json:"action"` // created, updated, published, deprecated
	Version    string    `json:"version"`
	UserID     uuid.UUID `json:"user_id"`
	Username   string    `json:"username"`
	Timestamp  time.Time `json:"timestamp"`
}

// SchemaContributor represents a schema contributor
type SchemaContributor struct {
	UserID          uuid.UUID `json:"user_id"`
	Username        string    `json:"username"`
	SchemasCreated  int       `json:"schemas_created"`
	VersionsCreated int       `json:"versions_created"`
	LastActivity    time.Time `json:"last_activity"`
}

// WorkspaceQualityMetrics represents workspace quality metrics
type WorkspaceQualityMetrics struct {
	AverageQualityScore    float64 `json:"average_quality_score"`
	AverageValidationScore float64 `json:"average_validation_score"`
	SchemasWithIssues      int     `json:"schemas_with_issues"`
	SchemasNeedingReview   int     `json:"schemas_needing_review"`
	ComplianceScore        float64 `json:"compliance_score"`
}

// SchemaService implements business logic for API schema operations
type SchemaService struct {
	schemaRepo     APISchemaRepository
	repositoryRepo RepositoryRepository
	workspaceRepo  WorkspaceRepository
	userRepo       UserRepository
	validator      SchemaValidator
	transformer    SchemaTransformer
	docGenerator   DocumentationGenerator
	eventPub       EventPublisher
	cache          CacheManager
	logger         *slog.Logger
}

// NewSchemaService creates a new schema service instance
func NewSchemaService(
	schemaRepo APISchemaRepository,
	repositoryRepo RepositoryRepository,
	workspaceRepo WorkspaceRepository,
	userRepo UserRepository,
	validator SchemaValidator,
	transformer SchemaTransformer,
	docGenerator DocumentationGenerator,
	eventPub EventPublisher,
	cache CacheManager,
	logger *slog.Logger,
) *SchemaService {
	return &SchemaService{
		schemaRepo:     schemaRepo,
		repositoryRepo: repositoryRepo,
		workspaceRepo:  workspaceRepo,
		userRepo:       userRepo,
		validator:      validator,
		transformer:    transformer,
		docGenerator:   docGenerator,
		eventPub:       eventPub,
		cache:          cache,
		logger:         logger.With("service", "schema"),
	}
}

// CreateSchema creates a new API schema with validation
func (s *SchemaService) CreateSchema(ctx context.Context, req CreateSchemaRequest) (*domain.APISchema, error) {
	s.logger.InfoContext(ctx, "Creating API schema",
		"name", req.Name, "format", req.Format, "workspace_id", req.WorkspaceID, "created_by", req.CreatedBy)

	// Validate the request
	if err := s.validateCreateSchemaRequest(ctx, req); err != nil {
		return nil, fmt.Errorf("validation failed: %w", err)
	}

	// Check workspace exists and user has permission
	workspace, err := s.workspaceRepo.GetByID(ctx, req.WorkspaceID)
	if err != nil {
		return nil, fmt.Errorf("failed to get workspace: %w", err)
	}

	if !s.canUserCreateSchema(ctx, workspace, req.CreatedBy) {
		return nil, domain.ErrInsufficientPermission
	}

	// Check schema name/slug availability
	if exists, err := s.checkSchemaExists(ctx, req.WorkspaceID, req.Name, req.Slug); err != nil {
		return nil, fmt.Errorf("failed to check schema existence: %w", err)
	} else if exists {
		return nil, ErrSchemaExists
	}

	// Validate schema content
	validationResult, err := s.validator.ValidateSchema(ctx, req.Content, req.Format)
	if err != nil {
		return nil, fmt.Errorf("failed to validate schema content: %w", err)
	}

	if !validationResult.IsValid {
		return nil, fmt.Errorf("schema content validation failed: %v", validationResult.Errors)
	}

	// Create the schema domain object
	now := time.Now()
	schema := &domain.APISchema{
		ID:          uuid.New(),
		WorkspaceID: req.WorkspaceID,
		Name:        req.Name,
		Slug:        req.Slug,
		Description: req.Description,
		Format:      string(req.Format),
		Status:      string(req.Status),
		Visibility:  string(req.Visibility),
		Tags:        req.Tags,
		Categories:  req.Categories,
		CreatedAt:   now,
		UpdatedAt:   now,
		CreatedBy:   req.CreatedBy,
		UpdatedBy:   req.CreatedBy,
	}

	// Set default values if not provided
	if schema.Status == "" {
		schema.Status = string(SchemaStatusDraft)
	}
	if schema.Visibility == "" {
		schema.Visibility = string(SchemaVisibilityInternal)
	}

	// Create initial version
	initialVersion := &domain.APISchemaVersion{
		ID:              uuid.New(),
		SchemaID:        schema.ID,
		Version:         req.Version,
		Content:         req.Content,
		ContentHash:     s.calculateContentHash(req.Content),
		ChangeNotes:     "Initial version",
		IsPublished:     false,
		IsDraft:         schema.Status == string(SchemaStatusDraft),
		ValidationScore: validationResult.Metrics.QualityScore,
		QualityScore:    validationResult.Metrics.QualityScore,
		SecurityScore:   validationResult.Metrics.SecurityScore,
		ComplexityScore: validationResult.Metrics.ComplexityScore,
		CreatedAt:       now,
		UpdatedAt:       now,
		CreatedBy:       req.CreatedBy,
	}

	// Persist the schema
	if err := s.schemaRepo.Create(ctx, schema); err != nil {
		return nil, fmt.Errorf("failed to create schema: %w", err)
	}

	// Persist the initial version
	if err := s.schemaRepo.CreateVersion(ctx, initialVersion); err != nil {
		return nil, fmt.Errorf("failed to create initial version: %w", err)
	}

	// Update schema with current version info
	schema.CurrentVersion = req.Version
	schema.LatestVersionID = &initialVersion.ID
	if err := s.schemaRepo.Update(ctx, schema); err != nil {
		s.logger.WarnContext(ctx, "Failed to update schema with version info", "error", err)
	}

	// Clear relevant caches
	s.clearSchemaListCaches(ctx, req.WorkspaceID)

	// TODO: Publish schema created event when EventPublisher is updated

	s.logger.InfoContext(ctx, "API schema created successfully",
		"schema_id", schema.ID, "name", schema.Name, "version", req.Version)

	return schema, nil
}

// GetSchema retrieves an API schema by ID with permission checking
func (s *SchemaService) GetSchema(ctx context.Context, id uuid.UUID, userID uuid.UUID) (*domain.APISchema, error) {
	s.logger.DebugContext(ctx, "Getting API schema", "schema_id", id, "user_id", userID)

	// Check cache first
	cacheKey := fmt.Sprintf("api_schema:id:%s", id.String())
	if cached, err := s.cache.Get(ctx, cacheKey); err == nil {
		if schema, ok := cached.(*domain.APISchema); ok {
			if s.canUserAccessSchema(ctx, schema, userID) {
				return schema, nil
			}
			return nil, domain.ErrInsufficientPermission
		}
	}

	// Get from repository
	schema, err := s.schemaRepo.GetByID(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("failed to get schema: %w", err)
	}

	// Check access permissions
	if !s.canUserAccessSchema(ctx, schema, userID) {
		return nil, domain.ErrInsufficientPermission
	}

	// Cache the result
	s.cache.Set(ctx, cacheKey, schema, 15*time.Minute)

	return schema, nil
}

// CreateSchemaVersion creates a new version of an existing schema
func (s *SchemaService) CreateSchemaVersion(ctx context.Context, req CreateVersionRequest) (*domain.APISchemaVersion, error) {
	s.logger.InfoContext(ctx, "Creating schema version",
		"schema_id", req.SchemaID, "version", req.Version, "created_by", req.CreatedBy)

	// Get the schema
	schema, err := s.schemaRepo.GetByID(ctx, req.SchemaID)
	if err != nil {
		return nil, fmt.Errorf("failed to get schema: %w", err)
	}

	// Check permissions
	if !s.canUserModifySchema(ctx, schema, req.CreatedBy) {
		return nil, domain.ErrInsufficientPermission
	}

	// Validate schema content
	validationResult, err := s.validator.ValidateSchema(ctx, req.Content, SchemaFormat(schema.Format))
	if err != nil {
		return nil, fmt.Errorf("failed to validate schema content: %w", err)
	}

	if !validationResult.IsValid {
		return nil, fmt.Errorf("schema content validation failed: %v", validationResult.Errors)
	}

	// Check for compatibility with previous version if not a draft
	if !req.IsDraft {
		latestVersion, err := s.schemaRepo.GetLatestVersion(ctx, req.SchemaID)
		if err == nil && latestVersion != nil {
			compatibility, err := s.validator.ValidateCompatibility(ctx, latestVersion.Content, req.Content, SchemaFormat(schema.Format))
			if err != nil {
				s.logger.WarnContext(ctx, "Failed to check compatibility", "error", err)
			} else {
				if compatibility.Compatibility == CompatibilityLevelBreaking && !req.IsBreaking {
					return nil, ErrBreakingChangesNotAllowed
				}
			}
		}
	}

	// Create the version
	now := time.Now()
	version := &domain.APISchemaVersion{
		ID:              uuid.New(),
		SchemaID:        req.SchemaID,
		Version:         req.Version,
		Content:         req.Content,
		ContentHash:     s.calculateContentHash(req.Content),
		ChangeNotes:     req.ChangeNotes,
		IsPublished:     false,
		IsDraft:         req.IsDraft,
		IsBreaking:      req.IsBreaking,
		ValidationScore: validationResult.Metrics.QualityScore,
		QualityScore:    validationResult.Metrics.QualityScore,
		SecurityScore:   validationResult.Metrics.SecurityScore,
		ComplexityScore: validationResult.Metrics.ComplexityScore,
		CreatedAt:       now,
		UpdatedAt:       now,
		CreatedBy:       req.CreatedBy,
	}

	// Persist the version
	if err := s.schemaRepo.CreateVersion(ctx, version); err != nil {
		return nil, fmt.Errorf("failed to create schema version: %w", err)
	}

	// Update schema with new version info
	schema.CurrentVersion = req.Version
	schema.LatestVersionID = &version.ID
	schema.UpdatedAt = now
	schema.UpdatedBy = req.CreatedBy
	if err := s.schemaRepo.Update(ctx, schema); err != nil {
		s.logger.WarnContext(ctx, "Failed to update schema with new version", "error", err)
	}

	// Clear caches
	s.clearSchemaCaches(ctx, schema)

	// TODO: Publish schema version created event when EventPublisher is updated

	s.logger.InfoContext(ctx, "Schema version created successfully",
		"version_id", version.ID, "schema_id", req.SchemaID, "version", req.Version)

	return version, nil
}

// ValidateSchema validates a schema without creating it
func (s *SchemaService) ValidateSchema(ctx context.Context, req ValidationRequest) (*ValidationResult, error) {
	s.logger.DebugContext(ctx, "Validating schema", "format", req.Format)

	// Validate schema content
	result, err := s.validator.ValidateSchema(ctx, req.Content, req.Format)
	if err != nil {
		return nil, fmt.Errorf("failed to validate schema: %w", err)
	}

	return result, nil
}

// TransformSchema transforms a schema using specified transformations
func (s *SchemaService) TransformSchema(ctx context.Context, req TransformationRequest) (*TransformationResult, error) {
	s.logger.InfoContext(ctx, "Transforming schema", "format", req.Format, "transformations", len(req.Transformations))

	// Check workspace permissions if context provided
	if req.Context.WorkspaceID != uuid.Nil {
		workspace, err := s.workspaceRepo.GetByID(ctx, req.Context.WorkspaceID)
		if err != nil {
			return nil, fmt.Errorf("failed to get workspace: %w", err)
		}

		// Get user ID from context (simplified - in production, extract from JWT/session)
		userID := uuid.New() // This would come from authentication context
		if !s.canUserModifySchemas(ctx, workspace, userID) {
			return nil, domain.ErrInsufficientPermission
		}
	}

	// Perform transformation
	result, err := s.transformer.TransformSchema(ctx, &req)
	if err != nil {
		return nil, fmt.Errorf("failed to transform schema: %w", err)
	}

	return result, nil
}

// GenerateDocumentation generates documentation for a schema
func (s *SchemaService) GenerateDocumentation(ctx context.Context, req DocumentationRequest) (*DocumentationResult, error) {
	s.logger.InfoContext(ctx, "Generating documentation", "schema_id", req.SchemaID, "format", req.Format)

	// Get the schema
	schema, err := s.schemaRepo.GetByID(ctx, req.SchemaID)
	if err != nil {
		return nil, fmt.Errorf("failed to get schema: %w", err)
	}

	// Check permissions (simplified - get user ID from context)
	userID := uuid.New() // This would come from authentication context
	if !s.canUserAccessSchema(ctx, schema, userID) {
		return nil, domain.ErrInsufficientPermission
	}

	// Generate documentation
	result, err := s.docGenerator.GenerateDocumentation(ctx, &req)
	if err != nil {
		return nil, fmt.Errorf("failed to generate documentation: %w", err)
	}

	return result, nil
}

// Helper methods

// validateCreateSchemaRequest validates a create schema request
func (s *SchemaService) validateCreateSchemaRequest(ctx context.Context, req CreateSchemaRequest) error {
	if req.Name == "" {
		return ErrInvalidSchemaName
	}

	if req.Slug == "" {
		return ErrInvalidSchemaSlug
	}

	if req.WorkspaceID == uuid.Nil {
		return ErrInvalidWorkspaceID
	}

	if req.CreatedBy == uuid.Nil {
		return ErrInvalidUserID
	}

	if req.Format == "" {
		return ErrInvalidSchemaFormat
	}

	if req.Content == "" {
		return ErrInvalidSchemaContent
	}

	if req.Version == "" {
		return ErrInvalidSchemaVersion
	}

	// Validate format
	validFormats := []SchemaFormat{
		SchemaFormatOpenAPI, SchemaFormatGraphQL, SchemaFormatGRPC,
		SchemaFormatJSONSchema, SchemaFormatAvro, SchemaFormatThrift,
	}
	isValidFormat := false
	for _, validFormat := range validFormats {
		if req.Format == validFormat {
			isValidFormat = true
			break
		}
	}
	if !isValidFormat {
		return ErrInvalidSchemaFormat
	}

	return nil
}

// checkSchemaExists checks if a schema with the same name or slug exists
func (s *SchemaService) checkSchemaExists(ctx context.Context, workspaceID uuid.UUID, name, slug string) (bool, error) {
	if existing, err := s.schemaRepo.GetByName(ctx, workspaceID, name); err == nil && existing != nil {
		return true, nil
	}

	if existing, err := s.schemaRepo.GetBySlug(ctx, workspaceID, slug); err == nil && existing != nil {
		return true, nil
	}

	return false, nil
}

// calculateContentHash calculates a hash of the schema content
func (s *SchemaService) calculateContentHash(content string) string {
	// Simplified hash calculation - use SHA256 in production
	return fmt.Sprintf("sha256-%x", len(content))
}

// Permission checking methods

func (s *SchemaService) canUserCreateSchema(ctx context.Context, workspace *domain.Workspace, userID uuid.UUID) bool {
	member := workspace.GetMember(userID)
	if member == nil {
		return false
	}

	return member.Role == domain.WorkspaceRoleOwner ||
		member.Role == domain.WorkspaceRoleAdmin ||
		member.Role == domain.WorkspaceRoleDeveloper
}

func (s *SchemaService) canUserAccessSchema(ctx context.Context, schema *domain.APISchema, userID uuid.UUID) bool {
	// Schema creator can always access
	if schema.CreatedBy == userID {
		return true
	}

	// Check workspace access
	workspace, err := s.workspaceRepo.GetByID(ctx, schema.WorkspaceID)
	if err != nil {
		return false
	}

	// Check visibility and workspace membership
	switch SchemaVisibility(schema.Visibility) {
	case SchemaVisibilityPublic:
		return workspace.HasMember(userID)
	case SchemaVisibilityInternal:
		return workspace.HasMember(userID)
	case SchemaVisibilityPrivate:
		return schema.CreatedBy == userID
	default:
		return false
	}
}

func (s *SchemaService) canUserModifySchema(ctx context.Context, schema *domain.APISchema, userID uuid.UUID) bool {
	// Schema creator can modify
	if schema.CreatedBy == userID {
		return true
	}

	// Check workspace permissions
	workspace, err := s.workspaceRepo.GetByID(ctx, schema.WorkspaceID)
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

func (s *SchemaService) canUserModifySchemas(ctx context.Context, workspace *domain.Workspace, userID uuid.UUID) bool {
	member := workspace.GetMember(userID)
	if member == nil {
		return false
	}

	return member.Role == domain.WorkspaceRoleOwner ||
		member.Role == domain.WorkspaceRoleAdmin ||
		member.Role == domain.WorkspaceRoleDeveloper
}

// Cache management

func (s *SchemaService) clearSchemaCaches(ctx context.Context, schema *domain.APISchema) {
	patterns := []string{
		fmt.Sprintf("api_schema:id:%s", schema.ID.String()),
		fmt.Sprintf("api_schema:name:%s:%s", schema.WorkspaceID.String(), schema.Name),
		fmt.Sprintf("api_schema:slug:%s:%s", schema.WorkspaceID.String(), schema.Slug),
		fmt.Sprintf("workspace:schemas:%s", schema.WorkspaceID.String()),
	}

	for _, pattern := range patterns {
		if err := s.cache.Delete(ctx, pattern); err != nil {
			s.logger.WarnContext(ctx, "Failed to clear cache", "pattern", pattern, "error", err)
		}
	}
}

func (s *SchemaService) clearSchemaListCaches(ctx context.Context, workspaceID uuid.UUID) {
	patterns := []string{
		fmt.Sprintf("workspace:schemas:%s", workspaceID.String()),
		"schemas:list:*",
		"schema_stats:*",
	}

	for _, pattern := range patterns {
		if err := s.cache.DeleteByPattern(ctx, pattern); err != nil {
			s.logger.WarnContext(ctx, "Failed to clear cache", "pattern", pattern, "error", err)
		}
	}
}

// Service-specific errors
var (
	ErrInvalidSchemaName             = domain.NewDomainError("INVALID_SCHEMA_NAME", "Schema name is invalid")
	ErrInvalidSchemaSlug             = domain.NewDomainError("INVALID_SCHEMA_SLUG", "Schema slug is invalid")
	ErrInvalidSchemaFormat           = domain.NewDomainError("INVALID_SCHEMA_FORMAT", "Schema format is invalid")
	ErrInvalidSchemaContent          = domain.NewDomainError("INVALID_SCHEMA_CONTENT", "Schema content is invalid")
	ErrInvalidSchemaVersion          = domain.NewDomainError("INVALID_SCHEMA_VERSION", "Schema version is invalid")
	ErrSchemaExists                  = domain.NewDomainError("SCHEMA_EXISTS", "Schema already exists")
	ErrSchemaNotFound                = domain.NewDomainError("SCHEMA_NOT_FOUND", "Schema not found")
	ErrSchemaVersionExists           = domain.NewDomainError("SCHEMA_VERSION_EXISTS", "Schema version already exists")
	ErrSchemaVersionNotFound         = domain.NewDomainError("SCHEMA_VERSION_NOT_FOUND", "Schema version not found")
	ErrBreakingChangesNotAllowed     = domain.NewDomainError("BREAKING_CHANGES_NOT_ALLOWED", "Breaking changes not allowed")
	ErrSchemaValidationFailed        = domain.NewDomainError("SCHEMA_VALIDATION_FAILED", "Schema validation failed")
	ErrSchemaTransformationFailed    = domain.NewDomainError("SCHEMA_TRANSFORMATION_FAILED", "Schema transformation failed")
	ErrDocumentationGenerationFailed = domain.NewDomainError("DOCUMENTATION_GENERATION_FAILED", "Documentation generation failed")
	ErrIncompatibleSchemaVersion     = domain.NewDomainError("INCOMPATIBLE_SCHEMA_VERSION", "Incompatible schema version")
)
