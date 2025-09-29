/**
 * API Schema Domain Models for Repository Service
 *
 * This file contains domain models for API schemas including:
 * - APISchema: Core schema entity with metadata and versioning
 * - APISchemaVersion: Individual schema versions with content and metrics
 *
 * Constitutional Requirements:
 * - Rich domain models with business logic
 * - Multi-format schema support (OpenAPI, GraphQL, gRPC, JSON Schema)
 * - Version management and compatibility tracking
 * - Multi-tenant workspace isolation
 * - Comprehensive metadata and audit trails
 */

package domain

import (
	"time"

	"github.com/google/uuid"
)

// APISchema represents an API schema entity in the system
type APISchema struct {
	ID                uuid.UUID  `json:"id" db:"id"`
	WorkspaceID       uuid.UUID  `json:"workspace_id" db:"workspace_id"`
	Name              string     `json:"name" db:"name"`
	Slug              string     `json:"slug" db:"slug"`
	Description       string     `json:"description" db:"description"`
	Format            string     `json:"format" db:"format"`         // openapi, graphql, grpc, json_schema, avro, thrift
	Status            string     `json:"status" db:"status"`         // draft, review, approved, published, deprecated, archived
	Visibility        string     `json:"visibility" db:"visibility"` // private, internal, public
	Tags              []string   `json:"tags" db:"tags"`
	Categories        []string   `json:"categories" db:"categories"`
	CurrentVersion    string     `json:"current_version" db:"current_version"`
	LatestVersionID   *uuid.UUID `json:"latest_version_id" db:"latest_version_id"`
	VersionCount      int        `json:"version_count" db:"version_count"`
	PublishedVersions int        `json:"published_versions" db:"published_versions"`
	DependencyCount   int        `json:"dependency_count" db:"dependency_count"`
	DependentCount    int        `json:"dependent_count" db:"dependent_count"`
	UsageCount        int        `json:"usage_count" db:"usage_count"`
	DownloadCount     int        `json:"download_count" db:"download_count"`
	ValidationScore   int        `json:"validation_score" db:"validation_score"`
	QualityScore      int        `json:"quality_score" db:"quality_score"`
	SecurityScore     int        `json:"security_score" db:"security_score"`
	PopularityScore   int        `json:"popularity_score" db:"popularity_score"`
	LastPublishedAt   *time.Time `json:"last_published_at" db:"last_published_at"`
	LastValidatedAt   *time.Time `json:"last_validated_at" db:"last_validated_at"`
	CreatedAt         time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at" db:"updated_at"`
	CreatedBy         uuid.UUID  `json:"created_by" db:"created_by"`
	UpdatedBy         uuid.UUID  `json:"updated_by" db:"updated_by"`

	// Computed/loaded fields
	LatestVersion *APISchemaVersion   `json:"latest_version,omitempty" db:"-"`
	Versions      []*APISchemaVersion `json:"versions,omitempty" db:"-"`
	Dependencies  []*SchemaDependency `json:"dependencies,omitempty" db:"-"`
	Dependents    []*SchemaDependency `json:"dependents,omitempty" db:"-"`
	Workspace     *Workspace          `json:"workspace,omitempty" db:"-"`
	Creator       *User               `json:"creator,omitempty" db:"-"`
	Updater       *User               `json:"updater,omitempty" db:"-"`
}

// APISchemaVersion represents a version of an API schema
type APISchemaVersion struct {
	ID                 uuid.UUID  `json:"id" db:"id"`
	SchemaID           uuid.UUID  `json:"schema_id" db:"schema_id"`
	Version            string     `json:"version" db:"version"`
	Content            string     `json:"content" db:"content"`
	ContentHash        string     `json:"content_hash" db:"content_hash"`
	ContentSize        int64      `json:"content_size" db:"content_size"`
	ChangeNotes        string     `json:"change_notes" db:"change_notes"`
	IsPublished        bool       `json:"is_published" db:"is_published"`
	IsDraft            bool       `json:"is_draft" db:"is_draft"`
	IsBreaking         bool       `json:"is_breaking" db:"is_breaking"`
	IsDeprecated       bool       `json:"is_deprecated" db:"is_deprecated"`
	ValidationStatus   string     `json:"validation_status" db:"validation_status"` // valid, invalid, pending, error
	ValidationScore    int        `json:"validation_score" db:"validation_score"`
	QualityScore       int        `json:"quality_score" db:"quality_score"`
	SecurityScore      int        `json:"security_score" db:"security_score"`
	ComplexityScore    int        `json:"complexity_score" db:"complexity_score"`
	CompatibilityScore int        `json:"compatibility_score" db:"compatibility_score"`
	TotalEndpoints     int        `json:"total_endpoints" db:"total_endpoints"`
	TotalModels        int        `json:"total_models" db:"total_models"`
	TotalLines         int        `json:"total_lines" db:"total_lines"`
	DownloadCount      int        `json:"download_count" db:"download_count"`
	UsageCount         int        `json:"usage_count" db:"usage_count"`
	PublishedAt        *time.Time `json:"published_at" db:"published_at"`
	DeprecatedAt       *time.Time `json:"deprecated_at" db:"deprecated_at"`
	ValidatedAt        *time.Time `json:"validated_at" db:"validated_at"`
	CreatedAt          time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt          time.Time  `json:"updated_at" db:"updated_at"`
	CreatedBy          uuid.UUID  `json:"created_by" db:"created_by"`

	// Computed/loaded fields
	Schema           *APISchema             `json:"schema,omitempty" db:"-"`
	Creator          *User                  `json:"creator,omitempty" db:"-"`
	ChangesSummary   *VersionChangesSummary `json:"changes_summary,omitempty" db:"-"`
	ValidationErrors []ValidationError      `json:"validation_errors,omitempty" db:"-"`
	Dependencies     []*SchemaDependency    `json:"dependencies,omitempty" db:"-"`
}

// SchemaDependency represents a dependency relationship between schemas
type SchemaDependency struct {
	ID             uuid.UUID `json:"id" db:"id"`
	SchemaID       uuid.UUID `json:"schema_id" db:"schema_id"`
	DependsOnID    uuid.UUID `json:"depends_on_id" db:"depends_on_id"`
	VersionRange   string    `json:"version_range" db:"version_range"`
	DependencyType string    `json:"dependency_type" db:"dependency_type"` // references, extends, imports, includes
	Path           string    `json:"path" db:"path"`
	IsRequired     bool      `json:"is_required" db:"is_required"`
	IsResolved     bool      `json:"is_resolved" db:"is_resolved"`
	Resolution     string    `json:"resolution" db:"resolution"`
	Description    string    `json:"description" db:"description"`
	CreatedAt      time.Time `json:"created_at" db:"created_at"`
	UpdatedAt      time.Time `json:"updated_at" db:"updated_at"`
	CreatedBy      uuid.UUID `json:"created_by" db:"created_by"`

	// Computed/loaded fields
	Schema    *APISchema `json:"schema,omitempty" db:"-"`
	DependsOn *APISchema `json:"depends_on,omitempty" db:"-"`
}

// VersionChangesSummary provides a summary of changes between versions
type VersionChangesSummary struct {
	TotalChanges       int            `json:"total_changes"`
	BreakingChanges    int            `json:"breaking_changes"`
	AddedCount         int            `json:"added_count"`
	RemovedCount       int            `json:"removed_count"`
	ModifiedCount      int            `json:"modified_count"`
	DeprecatedCount    int            `json:"deprecated_count"`
	Changes            []SchemaChange `json:"changes"`
	CompatibilityLevel string         `json:"compatibility_level"`
	ImpactAssessment   string         `json:"impact_assessment"`
}

// SchemaChange represents a single change between schema versions
type SchemaChange struct {
	Type        string                 `json:"type"`     // added, removed, modified, renamed, deprecated
	Category    string                 `json:"category"` // endpoint, model, property, enum, parameter
	Path        string                 `json:"path"`
	Name        string                 `json:"name"`
	OldValue    interface{}            `json:"old_value"`
	NewValue    interface{}            `json:"new_value"`
	IsBreaking  bool                   `json:"is_breaking"`
	Impact      string                 `json:"impact"` // low, medium, high, critical
	Description string                 `json:"description"`
	Suggestion  string                 `json:"suggestion"`
	Metadata    map[string]interface{} `json:"metadata"`
}

// ValidationError represents a schema validation error
type ValidationError struct {
	ID         uuid.UUID              `json:"id" db:"id"`
	VersionID  uuid.UUID              `json:"version_id" db:"version_id"`
	Code       string                 `json:"code" db:"code"`
	Message    string                 `json:"message" db:"message"`
	Path       string                 `json:"path" db:"path"`
	Line       int                    `json:"line" db:"line"`
	Column     int                    `json:"column" db:"column"`
	Severity   string                 `json:"severity" db:"severity"` // error, warning, info
	Rule       string                 `json:"rule" db:"rule"`
	Category   string                 `json:"category" db:"category"`
	Context    map[string]interface{} `json:"context" db:"context"`
	Suggestion string                 `json:"suggestion" db:"suggestion"`
	CreatedAt  time.Time              `json:"created_at" db:"created_at"`
}

// Business Logic Methods for APISchema

// IsPublished returns true if the schema has published versions
func (s *APISchema) IsPublished() bool {
	return s.PublishedVersions > 0
}

// IsDraft returns true if the schema is in draft status
func (s *APISchema) IsDraft() bool {
	return s.Status == "draft"
}

// IsDeprecated returns true if the schema is deprecated
func (s *APISchema) IsDeprecated() bool {
	return s.Status == "deprecated"
}

// IsArchived returns true if the schema is archived
func (s *APISchema) IsArchived() bool {
	return s.Status == "archived"
}

// IsPublic returns true if the schema has public visibility
func (s *APISchema) IsPublic() bool {
	return s.Visibility == "public"
}

// IsInternal returns true if the schema has internal visibility
func (s *APISchema) IsInternal() bool {
	return s.Visibility == "internal"
}

// IsPrivate returns true if the schema has private visibility
func (s *APISchema) IsPrivate() bool {
	return s.Visibility == "private"
}

// GetQualityLevel returns a human-readable quality level based on quality score
func (s *APISchema) GetQualityLevel() string {
	switch {
	case s.QualityScore >= 90:
		return "excellent"
	case s.QualityScore >= 80:
		return "good"
	case s.QualityScore >= 70:
		return "fair"
	case s.QualityScore >= 60:
		return "poor"
	default:
		return "very_poor"
	}
}

// GetSecurityLevel returns a human-readable security level based on security score
func (s *APISchema) GetSecurityLevel() string {
	switch {
	case s.SecurityScore >= 90:
		return "high"
	case s.SecurityScore >= 70:
		return "medium"
	case s.SecurityScore >= 50:
		return "low"
	default:
		return "very_low"
	}
}

// GetComplexityLevel returns a human-readable complexity level
func (s *APISchema) GetComplexityLevel() string {
	switch {
	case s.QualityScore <= 20:
		return "simple"
	case s.QualityScore <= 50:
		return "moderate"
	case s.QualityScore <= 80:
		return "complex"
	default:
		return "very_complex"
	}
}

// HasTag returns true if the schema has the specified tag
func (s *APISchema) HasTag(tag string) bool {
	for _, t := range s.Tags {
		if t == tag {
			return true
		}
	}
	return false
}

// HasCategory returns true if the schema has the specified category
func (s *APISchema) HasCategory(category string) bool {
	for _, c := range s.Categories {
		if c == category {
			return true
		}
	}
	return false
}

// AddTag adds a tag if it doesn't already exist
func (s *APISchema) AddTag(tag string) {
	if !s.HasTag(tag) {
		s.Tags = append(s.Tags, tag)
	}
}

// RemoveTag removes a tag if it exists
func (s *APISchema) RemoveTag(tag string) {
	for i, t := range s.Tags {
		if t == tag {
			s.Tags = append(s.Tags[:i], s.Tags[i+1:]...)
			break
		}
	}
}

// AddCategory adds a category if it doesn't already exist
func (s *APISchema) AddCategory(category string) {
	if !s.HasCategory(category) {
		s.Categories = append(s.Categories, category)
	}
}

// RemoveCategory removes a category if it exists
func (s *APISchema) RemoveCategory(category string) {
	for i, c := range s.Categories {
		if c == category {
			s.Categories = append(s.Categories[:i], s.Categories[i+1:]...)
			break
		}
	}
}

// CanBeModifiedBy returns true if the user can modify this schema
func (s *APISchema) CanBeModifiedBy(userID uuid.UUID, workspace *Workspace) bool {
	// Schema creator can modify
	if s.CreatedBy == userID {
		return true
	}

	// Check workspace permissions
	if workspace == nil {
		return false
	}

	member := workspace.GetMember(userID)
	if member == nil {
		return false
	}

	return member.Role == WorkspaceRoleOwner ||
		member.Role == WorkspaceRoleAdmin
}

// CanBeAccessedBy returns true if the user can access this schema
func (s *APISchema) CanBeAccessedBy(userID uuid.UUID, workspace *Workspace) bool {
	// Schema creator can access
	if s.CreatedBy == userID {
		return true
	}

	// Check visibility and workspace membership
	if workspace == nil {
		return false
	}

	switch s.Visibility {
	case "public":
		return workspace.HasMember(userID)
	case "internal":
		return workspace.HasMember(userID)
	case "private":
		return s.CreatedBy == userID
	default:
		return false
	}
}

// Business Logic Methods for APISchemaVersion

// IsCurrentVersion returns true if this is the current version of the schema
func (v *APISchemaVersion) IsCurrentVersion() bool {
	return v.Schema != nil && v.Schema.CurrentVersion == v.Version
}

// IsLatestVersion returns true if this is the latest version of the schema
func (v *APISchemaVersion) IsLatestVersion() bool {
	return v.Schema != nil && v.Schema.LatestVersionID != nil && *v.Schema.LatestVersionID == v.ID
}

// GetQualityLevel returns a human-readable quality level
func (v *APISchemaVersion) GetQualityLevel() string {
	switch {
	case v.QualityScore >= 90:
		return "excellent"
	case v.QualityScore >= 80:
		return "good"
	case v.QualityScore >= 70:
		return "fair"
	case v.QualityScore >= 60:
		return "poor"
	default:
		return "very_poor"
	}
}

// GetSecurityLevel returns a human-readable security level
func (v *APISchemaVersion) GetSecurityLevel() string {
	switch {
	case v.SecurityScore >= 90:
		return "high"
	case v.SecurityScore >= 70:
		return "medium"
	case v.SecurityScore >= 50:
		return "low"
	default:
		return "very_low"
	}
}

// GetComplexityLevel returns a human-readable complexity level
func (v *APISchemaVersion) GetComplexityLevel() string {
	switch {
	case v.ComplexityScore <= 20:
		return "simple"
	case v.ComplexityScore <= 50:
		return "moderate"
	case v.ComplexityScore <= 80:
		return "complex"
	default:
		return "very_complex"
	}
}

// GetCompatibilityLevel returns a human-readable compatibility level
func (v *APISchemaVersion) GetCompatibilityLevel() string {
	switch {
	case v.CompatibilityScore >= 90:
		return "fully_compatible"
	case v.CompatibilityScore >= 70:
		return "backward_compatible"
	case v.CompatibilityScore >= 50:
		return "partially_compatible"
	default:
		return "incompatible"
	}
}

// IsValid returns true if the version passed validation
func (v *APISchemaVersion) IsValid() bool {
	return v.ValidationStatus == "valid"
}

// HasValidationErrors returns true if the version has validation errors
func (v *APISchemaVersion) HasValidationErrors() bool {
	return len(v.ValidationErrors) > 0
}

// GetValidationErrorsByType returns validation errors filtered by severity
func (v *APISchemaVersion) GetValidationErrorsByType(severity string) []ValidationError {
	var errors []ValidationError
	for _, err := range v.ValidationErrors {
		if err.Severity == severity {
			errors = append(errors, err)
		}
	}
	return errors
}

// CanBePublished returns true if the version can be published
func (v *APISchemaVersion) CanBePublished() bool {
	return !v.IsPublished && !v.IsDraft && v.IsValid()
}

// CanBeDeprecated returns true if the version can be deprecated
func (v *APISchemaVersion) CanBeDeprecated() bool {
	return v.IsPublished && !v.IsDeprecated
}

// Business Logic Methods for SchemaDependency

// HasRequiredDependency returns true if this is a required dependency
func (d *SchemaDependency) HasRequiredDependency() bool {
	return d.IsRequired
}

// HasOptionalDependency returns true if this is an optional dependency
func (d *SchemaDependency) HasOptionalDependency() bool {
	return !d.IsRequired
}

// IsCircular returns true if this creates a circular dependency
// Note: This would require additional logic to traverse the dependency graph
func (d *SchemaDependency) IsCircular() bool {
	// Simplified implementation - in production, this would traverse the full graph
	return d.SchemaID == d.DependsOnID
}
