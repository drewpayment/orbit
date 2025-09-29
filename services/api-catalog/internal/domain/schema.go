/**
 * T032 - Data Model: APISchema with Versioning
 *
 * This model defines the core APISchema entity with versioning, validation,
 * and code generation support for the Internal Developer Portal.
 *
 * Constitutional Requirements:
 * - Multi-format schema support (OpenAPI, GraphQL, Protobuf, Avro)
 * - Semantic versioning with backward compatibility tracking
 * - Schema validation and linting
 * - Code generation artifact tracking
 * - Consumer tracking and impact analysis
 * - Multi-tenant workspace isolation
 */

package domain

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

// SchemaType defines the supported schema formats
type SchemaType string

const (
	SchemaTypeOpenAPI    SchemaType = "openapi"     // OpenAPI 3.x specification
	SchemaTypeGraphQL    SchemaType = "graphql"     // GraphQL schema definition
	SchemaTypeProtobuf   SchemaType = "protobuf"    // Protocol Buffers
	SchemaTypeAvro       SchemaType = "avro"        // Apache Avro schema
	SchemaTypeJSONSchema SchemaType = "json_schema" // JSON Schema
	SchemaTypeAsyncAPI   SchemaType = "asyncapi"    // AsyncAPI for event-driven APIs
)

// SchemaStatus represents the lifecycle status of a schema
type SchemaStatus string

const (
	SchemaStatusDraft      SchemaStatus = "draft"      // Work in progress
	SchemaStatusReview     SchemaStatus = "review"     // Under review
	SchemaStatusPublished  SchemaStatus = "published"  // Published and available
	SchemaStatusDeprecated SchemaStatus = "deprecated" // Deprecated but still available
	SchemaStatusArchived   SchemaStatus = "archived"   // Archived and no longer available
)

// VersionCompatibility indicates backward compatibility status
type VersionCompatibility string

const (
	CompatibilityMajor   VersionCompatibility = "major"   // Breaking changes
	CompatibilityMinor   VersionCompatibility = "minor"   // Backward compatible additions
	CompatibilityPatch   VersionCompatibility = "patch"   // Backward compatible fixes
	CompatibilityUnknown VersionCompatibility = "unknown" // Compatibility not determined
)

// ValidationSeverity indicates the severity level of validation issues
type ValidationSeverity string

const (
	SeverityError   ValidationSeverity = "error"   // Must be fixed
	SeverityWarning ValidationSeverity = "warning" // Should be fixed
	SeverityInfo    ValidationSeverity = "info"    // Informational
	SeverityHint    ValidationSeverity = "hint"    // Suggestion
)

// ConsumerType defines the type of API consumer
type ConsumerType string

const (
	ConsumerTypeRepository ConsumerType = "repository" // Internal repository
	ConsumerTypeExternal   ConsumerType = "external"   // External service
	ConsumerTypeGenerated  ConsumerType = "generated"  // Generated client library
)

// ContactInfo contains contact information for schema maintainers
type ContactInfo struct {
	Name  string `json:"name" db:"name"`
	Email string `json:"email" db:"email"`
	URL   string `json:"url" db:"url"`
}

// ValidationIssue represents a schema validation issue
type ValidationIssue struct {
	ID       uuid.UUID          `json:"id" db:"id"`
	SchemaID uuid.UUID          `json:"schema_id" db:"schema_id"`
	Severity ValidationSeverity `json:"severity" db:"severity"`
	Code     string             `json:"code" db:"code"`
	Message  string             `json:"message" db:"message"`
	Path     string             `json:"path" db:"path"`
	Line     int                `json:"line" db:"line"`
	Column   int                `json:"column" db:"column"`
	Rule     string             `json:"rule" db:"rule"`
	RuleURL  string             `json:"rule_url" db:"rule_url"`

	// Resolution tracking
	Resolved   bool       `json:"resolved" db:"resolved"`
	ResolvedAt *time.Time `json:"resolved_at" db:"resolved_at"`
	ResolvedBy *uuid.UUID `json:"resolved_by" db:"resolved_by"`
	Resolution string     `json:"resolution" db:"resolution"`

	// Metadata
	CreatedAt time.Time `json:"created_at" db:"created_at"`
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
}

// APIEndpoint represents an endpoint extracted from the schema
type APIEndpoint struct {
	ID       uuid.UUID `json:"id" db:"id"`
	SchemaID uuid.UUID `json:"schema_id" db:"schema_id"`

	// HTTP details
	Method      string `json:"method" db:"method"`
	Path        string `json:"path" db:"path"`
	OperationID string `json:"operation_id" db:"operation_id"`

	// Documentation
	Summary     string `json:"summary" db:"summary"`
	Description string `json:"description" db:"description"`

	// Parameters and schemas
	Parameters  []APIParameter  `json:"parameters" db:"parameters"`
	RequestBody *APIRequestBody `json:"request_body" db:"request_body"`
	Responses   []APIResponse   `json:"responses" db:"responses"`

	// Metadata
	Tags       []string `json:"tags" db:"tags"`
	Deprecated bool     `json:"deprecated" db:"deprecated"`

	// Security
	Security []string `json:"security" db:"security"`

	// Audit fields
	CreatedAt time.Time `json:"created_at" db:"created_at"`
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
}

// APIParameter represents a parameter for an API endpoint
type APIParameter struct {
	Name        string      `json:"name" db:"name"`
	In          string      `json:"in" db:"in"` // query, path, header, cookie
	Required    bool        `json:"required" db:"required"`
	Type        string      `json:"type" db:"type"`
	Format      string      `json:"format" db:"format"`
	Description string      `json:"description" db:"description"`
	Example     interface{} `json:"example" db:"example"`
	Schema      interface{} `json:"schema" db:"schema"`
}

// APIRequestBody represents a request body for an API endpoint
type APIRequestBody struct {
	Description string                 `json:"description" db:"description"`
	Required    bool                   `json:"required" db:"required"`
	Content     map[string]interface{} `json:"content" db:"content"`
}

// APIResponse represents a response for an API endpoint
type APIResponse struct {
	StatusCode  string                 `json:"status_code" db:"status_code"`
	Description string                 `json:"description" db:"description"`
	Headers     map[string]interface{} `json:"headers" db:"headers"`
	Content     map[string]interface{} `json:"content" db:"content"`
	Schema      interface{}            `json:"schema" db:"schema"`
}

// SchemaVersion represents a version of an API schema
type SchemaVersion struct {
	ID            uuid.UUID `json:"id" db:"id"`
	SchemaID      uuid.UUID `json:"schema_id" db:"schema_id"`
	Version       string    `json:"version" db:"version"`
	VersionNumber int       `json:"version_number" db:"version_number"` // Monotonic counter

	// Version metadata
	ReleaseNotes    string               `json:"release_notes" db:"release_notes"`
	BreakingChanges []string             `json:"breaking_changes" db:"breaking_changes"`
	Compatibility   VersionCompatibility `json:"compatibility" db:"compatibility"`

	// Schema content for this version
	SchemaContent json.RawMessage `json:"schema_content" db:"schema_content"`
	RawContent    string          `json:"raw_content" db:"raw_content"`
	ContentHash   string          `json:"content_hash" db:"content_hash"`

	// Validation results for this version
	IsValid          bool              `json:"is_valid" db:"is_valid"`
	ValidationErrors []ValidationIssue `json:"validation_errors" db:"-"` // Loaded separately

	// Lifecycle
	Status       SchemaStatus `json:"status" db:"status"`
	PublishedAt  *time.Time   `json:"published_at" db:"published_at"`
	DeprecatedAt *time.Time   `json:"deprecated_at" db:"deprecated_at"`

	// Audit fields
	CreatedAt time.Time `json:"created_at" db:"created_at"`
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
	CreatedBy uuid.UUID `json:"created_by" db:"created_by"`
}

// SchemaConsumer represents a consumer of the API schema
type SchemaConsumer struct {
	ID       uuid.UUID `json:"id" db:"id"`
	SchemaID uuid.UUID `json:"schema_id" db:"schema_id"`

	// Consumer identification
	ConsumerType ConsumerType `json:"consumer_type" db:"consumer_type"`
	RepositoryID *uuid.UUID   `json:"repository_id" db:"repository_id"`
	Name         string       `json:"name" db:"name"`
	Description  string       `json:"description" db:"description"`

	// Contact information
	ContactEmail string `json:"contact_email" db:"contact_email"`
	ContactName  string `json:"contact_name" db:"contact_name"`

	// Version constraints
	RequiredVersion string `json:"required_version" db:"required_version"`
	MinVersion      string `json:"min_version" db:"min_version"`
	MaxVersion      string `json:"max_version" db:"max_version"`

	// Usage tracking
	LastUsedVersion string     `json:"last_used_version" db:"last_used_version"`
	LastAccessedAt  *time.Time `json:"last_accessed_at" db:"last_accessed_at"`
	AccessCount     int        `json:"access_count" db:"access_count"`

	// Registration details
	RegisteredAt time.Time `json:"registered_at" db:"registered_at"`
	RegisteredBy uuid.UUID `json:"registered_by" db:"registered_by"`

	// Status
	IsActive bool `json:"is_active" db:"is_active"`

	// Audit fields
	CreatedAt time.Time `json:"created_at" db:"created_at"`
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
}

// CodeGenerationArtifact represents generated code artifact from schema
type CodeGenerationArtifact struct {
	ID              uuid.UUID `json:"id" db:"id"`
	SchemaID        uuid.UUID `json:"schema_id" db:"schema_id"`
	SchemaVersionID uuid.UUID `json:"schema_version_id" db:"schema_version_id"`

	// Generation details
	Language         string `json:"language" db:"language"`
	ArtifactType     string `json:"artifact_type" db:"artifact_type"` // client, server, docs
	GeneratorVersion string `json:"generator_version" db:"generator_version"`

	// Temporal workflow tracking
	WorkflowID string `json:"workflow_id" db:"workflow_id"`
	RunID      string `json:"run_id" db:"run_id"`

	// Storage details
	FilePath    string `json:"file_path" db:"file_path"`
	FileSize    int64  `json:"file_size" db:"file_size"`
	Checksum    string `json:"checksum" db:"checksum"`
	DownloadURL string `json:"download_url" db:"download_url"`

	// Metadata
	Version     string   `json:"version" db:"version"`
	Description string   `json:"description" db:"description"`
	Tags        []string `json:"tags" db:"tags"`

	// Lifecycle
	ExpiresAt     *time.Time `json:"expires_at" db:"expires_at"`
	DownloadCount int        `json:"download_count" db:"download_count"`

	// Generation configuration
	GenerationConfig map[string]interface{} `json:"generation_config" db:"generation_config"`

	// Audit fields
	CreatedAt time.Time `json:"created_at" db:"created_at"`
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
	CreatedBy uuid.UUID `json:"created_by" db:"created_by"`
}

// APISchema represents an API schema in the catalog
type APISchema struct {
	// Core identity fields
	ID           uuid.UUID  `json:"id" db:"id"`
	WorkspaceID  uuid.UUID  `json:"workspace_id" db:"workspace_id"`
	RepositoryID *uuid.UUID `json:"repository_id" db:"repository_id"` // Optional link to repository

	// Schema identification
	Name        string `json:"name" db:"name"`
	Slug        string `json:"slug" db:"slug"`
	Title       string `json:"title" db:"title"`
	Description string `json:"description" db:"description"`

	// Schema format and content
	SchemaType SchemaType `json:"schema_type" db:"schema_type"`

	// Current version (latest published)
	CurrentVersion   string     `json:"current_version" db:"current_version"`
	CurrentVersionID *uuid.UUID `json:"current_version_id" db:"current_version_id"`

	// All versions (loaded separately)
	Versions []SchemaVersion `json:"versions" db:"-"`

	// Current schema content (from current version)
	SchemaContent json.RawMessage `json:"schema_content" db:"schema_content"`
	RawContent    string          `json:"raw_content" db:"raw_content"`
	ContentHash   string          `json:"content_hash" db:"content_hash"`

	// API structure (extracted from schema)
	Endpoints []APIEndpoint `json:"endpoints" db:"-"` // Loaded separately

	// Validation status
	IsValid          bool              `json:"is_valid" db:"is_valid"`
	ValidationIssues []ValidationIssue `json:"validation_issues" db:"-"` // Loaded separately
	LastValidatedAt  *time.Time        `json:"last_validated_at" db:"last_validated_at"`

	// Documentation and metadata
	Tags         []string          `json:"tags" db:"tags"`
	License      string            `json:"license" db:"license"`
	ContactInfo  ContactInfo       `json:"contact_info" db:"contact_info"`
	ExternalDocs map[string]string `json:"external_docs" db:"external_docs"`

	// API metadata
	ServerURLs []string `json:"server_urls" db:"server_urls"`
	BasePath   string   `json:"base_path" db:"base_path"`

	// Lifecycle and status
	Status       SchemaStatus `json:"status" db:"status"`
	PublishedAt  *time.Time   `json:"published_at" db:"published_at"`
	DeprecatedAt *time.Time   `json:"deprecated_at" db:"deprecated_at"`

	// Usage tracking
	Consumers     []SchemaConsumer `json:"consumers" db:"-"` // Loaded separately
	ViewCount     int              `json:"view_count" db:"view_count"`
	DownloadCount int              `json:"download_count" db:"download_count"`

	// Code generation artifacts
	Artifacts []CodeGenerationArtifact `json:"artifacts" db:"-"` // Loaded separately

	// Access control
	Visibility string `json:"visibility" db:"visibility"` // private, internal, public

	// Audit trail fields
	CreatedAt time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt time.Time  `json:"updated_at" db:"updated_at"`
	CreatedBy uuid.UUID  `json:"created_by" db:"created_by"`
	UpdatedBy uuid.UUID  `json:"updated_by" db:"updated_by"`
	DeletedAt *time.Time `json:"deleted_at" db:"deleted_at"` // Soft delete
}

// NewAPISchema creates a new API schema with required fields and defaults
func NewAPISchema(workspaceID uuid.UUID, name, slug, title, description string, schemaType SchemaType, createdBy uuid.UUID) *APISchema {
	now := time.Now()

	return &APISchema{
		ID:             uuid.New(),
		WorkspaceID:    workspaceID,
		Name:           name,
		Slug:           slug,
		Title:          title,
		Description:    description,
		SchemaType:     schemaType,
		CurrentVersion: "0.1.0",
		Status:         SchemaStatusDraft,
		IsValid:        false,
		Tags:           []string{},
		ServerURLs:     []string{},
		ExternalDocs:   make(map[string]string),
		ViewCount:      0,
		DownloadCount:  0,
		Visibility:     "internal", // Default to internal visibility
		CreatedAt:      now,
		UpdatedAt:      now,
		CreatedBy:      createdBy,
		UpdatedBy:      createdBy,
	}
}

// IsActive returns true if the schema is not soft-deleted
func (s *APISchema) IsActive() bool {
	return s.DeletedAt == nil && s.Status != SchemaStatusArchived
}

// IsPublished returns true if the schema is published
func (s *APISchema) IsPublished() bool {
	return s.Status == SchemaStatusPublished
}

// IsDeprecated returns true if the schema is deprecated
func (s *APISchema) IsDeprecated() bool {
	return s.Status == SchemaStatusDeprecated
}

// CanUserAccess checks if a user has access to this schema
func (s *APISchema) CanUserAccess(userID uuid.UUID, workspaceMember bool) bool {
	switch s.Visibility {
	case "public":
		return true
	case "internal":
		return workspaceMember
	case "private":
		// Only creator and explicit consumers can access private schemas
		return s.CreatedBy == userID || s.HasConsumer(userID)
	default:
		return false
	}
}

// HasConsumer checks if a user is a registered consumer
func (s *APISchema) HasConsumer(userID uuid.UUID) bool {
	for _, consumer := range s.Consumers {
		if consumer.RegisteredBy == userID && consumer.IsActive {
			return true
		}
	}
	return false
}

// GetCurrentVersion returns the current published version
func (s *APISchema) GetCurrentVersion() *SchemaVersion {
	if s.CurrentVersionID == nil {
		return nil
	}

	for _, version := range s.Versions {
		if version.ID == *s.CurrentVersionID {
			return &version
		}
	}
	return nil
}

// GetVersion returns a specific version by version string
func (s *APISchema) GetVersion(versionStr string) *SchemaVersion {
	for _, version := range s.Versions {
		if version.Version == versionStr {
			return &version
		}
	}
	return nil
}

// AddVersion creates a new version of the schema
func (s *APISchema) AddVersion(version, releaseNotes string, content json.RawMessage, rawContent string, createdBy uuid.UUID) *SchemaVersion {
	now := time.Now()

	// Calculate version number (monotonic counter)
	maxVersionNumber := 0
	for _, v := range s.Versions {
		if v.VersionNumber > maxVersionNumber {
			maxVersionNumber = v.VersionNumber
		}
	}

	schemaVersion := &SchemaVersion{
		ID:              uuid.New(),
		SchemaID:        s.ID,
		Version:         version,
		VersionNumber:   maxVersionNumber + 1,
		ReleaseNotes:    releaseNotes,
		SchemaContent:   content,
		RawContent:      rawContent,
		ContentHash:     s.calculateContentHash(rawContent),
		IsValid:         false, // Will be validated separately
		Status:          SchemaStatusDraft,
		Compatibility:   CompatibilityUnknown,
		BreakingChanges: []string{},
		CreatedAt:       now,
		UpdatedAt:       now,
		CreatedBy:       createdBy,
	}

	s.Versions = append(s.Versions, *schemaVersion)
	return schemaVersion
}

// PublishVersion publishes a specific version and makes it current
func (s *APISchema) PublishVersion(versionID uuid.UUID, publishedBy uuid.UUID) error {
	now := time.Now()

	// Find the version to publish
	var versionToPublish *SchemaVersion
	for i, version := range s.Versions {
		if version.ID == versionID {
			versionToPublish = &s.Versions[i]
			break
		}
	}

	if versionToPublish == nil {
		return ErrVersionNotFound
	}

	if !versionToPublish.IsValid {
		return ErrInvalidSchemaVersion
	}

	// Update version status
	versionToPublish.Status = SchemaStatusPublished
	versionToPublish.PublishedAt = &now

	// Update schema current version
	s.CurrentVersion = versionToPublish.Version
	s.CurrentVersionID = &versionToPublish.ID
	s.SchemaContent = versionToPublish.SchemaContent
	s.RawContent = versionToPublish.RawContent
	s.ContentHash = versionToPublish.ContentHash
	s.Status = SchemaStatusPublished
	s.PublishedAt = &now
	s.UpdatedAt = now
	s.UpdatedBy = publishedBy

	return nil
}

// DeprecateVersion marks a version as deprecated
func (s *APISchema) DeprecateVersion(versionID uuid.UUID, deprecatedBy uuid.UUID) error {
	now := time.Now()

	for i, version := range s.Versions {
		if version.ID == versionID {
			s.Versions[i].Status = SchemaStatusDeprecated
			s.Versions[i].DeprecatedAt = &now

			// If this is the current version, update schema status
			if s.CurrentVersionID != nil && *s.CurrentVersionID == versionID {
				s.Status = SchemaStatusDeprecated
				s.DeprecatedAt = &now
				s.UpdatedBy = deprecatedBy
			}

			return nil
		}
	}

	return ErrVersionNotFound
}

// AddConsumer registers a new consumer for this schema
func (s *APISchema) AddConsumer(consumerType ConsumerType, name, description, contactEmail string, repositoryID *uuid.UUID, registeredBy uuid.UUID) *SchemaConsumer {
	now := time.Now()

	consumer := &SchemaConsumer{
		ID:              uuid.New(),
		SchemaID:        s.ID,
		ConsumerType:    consumerType,
		RepositoryID:    repositoryID,
		Name:            name,
		Description:     description,
		ContactEmail:    contactEmail,
		RequiredVersion: s.CurrentVersion,
		LastUsedVersion: s.CurrentVersion,
		AccessCount:     0,
		RegisteredAt:    now,
		RegisteredBy:    registeredBy,
		IsActive:        true,
		CreatedAt:       now,
		UpdatedAt:       now,
	}

	s.Consumers = append(s.Consumers, *consumer)
	return consumer
}

// RemoveConsumer deactivates a consumer
func (s *APISchema) RemoveConsumer(consumerID uuid.UUID) bool {
	for i, consumer := range s.Consumers {
		if consumer.ID == consumerID {
			s.Consumers[i].IsActive = false
			s.Consumers[i].UpdatedAt = time.Now()
			return true
		}
	}
	return false
}

// GetConsumersByType returns consumers filtered by type
func (s *APISchema) GetConsumersByType(consumerType ConsumerType) []SchemaConsumer {
	var filtered []SchemaConsumer
	for _, consumer := range s.Consumers {
		if consumer.ConsumerType == consumerType && consumer.IsActive {
			filtered = append(filtered, consumer)
		}
	}
	return filtered
}

// HasValidationErrors returns true if the schema has validation errors
func (s *APISchema) HasValidationErrors() bool {
	for _, issue := range s.ValidationIssues {
		if issue.Severity == SeverityError && !issue.Resolved {
			return true
		}
	}
	return false
}

// GetValidationErrorCount returns the count of unresolved validation errors
func (s *APISchema) GetValidationErrorCount() int {
	count := 0
	for _, issue := range s.ValidationIssues {
		if issue.Severity == SeverityError && !issue.Resolved {
			count++
		}
	}
	return count
}

// AddValidationIssue adds a new validation issue
func (s *APISchema) AddValidationIssue(severity ValidationSeverity, code, message, path string, line, column int, rule, ruleURL string) *ValidationIssue {
	now := time.Now()

	issue := &ValidationIssue{
		ID:        uuid.New(),
		SchemaID:  s.ID,
		Severity:  severity,
		Code:      code,
		Message:   message,
		Path:      path,
		Line:      line,
		Column:    column,
		Rule:      rule,
		RuleURL:   ruleURL,
		Resolved:  false,
		CreatedAt: now,
		UpdatedAt: now,
	}

	s.ValidationIssues = append(s.ValidationIssues, *issue)
	return issue
}

// ResolveValidationIssue marks a validation issue as resolved
func (s *APISchema) ResolveValidationIssue(issueID uuid.UUID, resolution string, resolvedBy uuid.UUID) bool {
	now := time.Now()

	for i, issue := range s.ValidationIssues {
		if issue.ID == issueID {
			s.ValidationIssues[i].Resolved = true
			s.ValidationIssues[i].ResolvedAt = &now
			s.ValidationIssues[i].ResolvedBy = &resolvedBy
			s.ValidationIssues[i].Resolution = resolution
			s.ValidationIssues[i].UpdatedAt = now
			return true
		}
	}
	return false
}

// IncrementViewCount increments the view counter
func (s *APISchema) IncrementViewCount() {
	s.ViewCount++
	s.UpdatedAt = time.Now()
}

// IncrementDownloadCount increments the download counter
func (s *APISchema) IncrementDownloadCount() {
	s.DownloadCount++
	s.UpdatedAt = time.Now()
}

// calculateContentHash calculates a hash of the schema content
func (s *APISchema) calculateContentHash(content string) string {
	// Implementation would use a proper hash function like SHA256
	return "hash_" + content[:min(20, len(content))]
}

// min helper function
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// Validate performs business logic validation on the schema
func (s *APISchema) Validate() error {
	if s.Name == "" {
		return ErrInvalidSchemaName
	}

	if s.Slug == "" {
		return ErrInvalidSchemaSlug
	}

	if s.WorkspaceID == uuid.Nil {
		return ErrInvalidWorkspaceID
	}

	// Validate schema type
	switch s.SchemaType {
	case SchemaTypeOpenAPI, SchemaTypeGraphQL, SchemaTypeProtobuf, SchemaTypeAvro, SchemaTypeJSONSchema, SchemaTypeAsyncAPI:
		// Valid types
	default:
		return ErrInvalidSchemaType
	}

	// Validate current version format
	if s.CurrentVersion == "" {
		return ErrInvalidVersion
	}

	return nil
}

// ToPublicProfile returns a schema profile safe for public consumption
func (s *APISchema) ToPublicProfile() map[string]interface{} {
	profile := map[string]interface{}{
		"id":              s.ID,
		"name":            s.Name,
		"slug":            s.Slug,
		"title":           s.Title,
		"description":     s.Description,
		"schema_type":     s.SchemaType,
		"current_version": s.CurrentVersion,
		"status":          s.Status,
		"tags":            s.Tags,
		"view_count":      s.ViewCount,
		"created_at":      s.CreatedAt,
		"updated_at":      s.UpdatedAt,
	}

	// Add public metadata
	if s.License != "" {
		profile["license"] = s.License
	}

	if len(s.ServerURLs) > 0 {
		profile["server_urls"] = s.ServerURLs
	}

	return profile
}

// Domain errors for API schema operations
var (
	ErrInvalidSchemaName    = NewDomainError("INVALID_SCHEMA_NAME", "Schema name is required and must be valid")
	ErrInvalidSchemaSlug    = NewDomainError("INVALID_SCHEMA_SLUG", "Schema slug is required and must be valid")
	ErrInvalidSchemaType    = NewDomainError("INVALID_SCHEMA_TYPE", "Schema type is invalid")
	ErrInvalidVersion       = NewDomainError("INVALID_VERSION", "Version is required and must be valid")
	ErrInvalidWorkspaceID   = NewDomainError("INVALID_WORKSPACE_ID", "Workspace ID is required")
	ErrSchemaNotFound       = NewDomainError("SCHEMA_NOT_FOUND", "API schema not found")
	ErrSchemaExists         = NewDomainError("SCHEMA_EXISTS", "API schema already exists")
	ErrVersionNotFound      = NewDomainError("VERSION_NOT_FOUND", "Schema version not found")
	ErrInvalidSchemaVersion = NewDomainError("INVALID_SCHEMA_VERSION", "Schema version is invalid and cannot be published")
	ErrSchemaHasErrors      = NewDomainError("SCHEMA_HAS_ERRORS", "Schema has validation errors that must be resolved")
	ErrConsumerNotFound     = NewDomainError("CONSUMER_NOT_FOUND", "Schema consumer not found")
	ErrConsumerExists       = NewDomainError("CONSUMER_EXISTS", "Schema consumer already exists")
	ErrSchemaDeprecated     = NewDomainError("SCHEMA_DEPRECATED", "Schema is deprecated")
	ErrInvalidSchemaContent = NewDomainError("INVALID_SCHEMA_CONTENT", "Schema content is invalid")
)

// DomainError represents a business logic error (reuse from user.go)
type DomainError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (e DomainError) Error() string {
	return e.Message
}

func NewDomainError(code, message string) DomainError {
	return DomainError{
		Code:    code,
		Message: message,
	}
}
