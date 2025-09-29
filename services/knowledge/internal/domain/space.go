/**
 * T033 - Data Model: KnowledgeSpace with Hierarchy
 *
 * This model defines the knowledge space structure with hierarchical organization,
 * access control, and comprehensive content management for the Internal Developer Portal.
 *
 * Constitutional Requirements:
 * - Hierarchical knowledge organization with nested spaces
 * - Multi-tenant workspace isolation
 * - Content lifecycle management
 * - Search and discovery capabilities
 * - Permission-based access control
 * - Integration with repository documentation
 */

package domain

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
)

// SpaceType defines the type of knowledge space
type SpaceType string

const (
	SpaceTypeRoot       SpaceType = "root"       // Top-level workspace root space
	SpaceTypeCategory   SpaceType = "category"   // Organizational category
	SpaceTypeProject    SpaceType = "project"    // Project-specific space
	SpaceTypeTeam       SpaceType = "team"       // Team-specific space
	SpaceTypeRepository SpaceType = "repository" // Auto-generated from repository docs
	SpaceTypePersonal   SpaceType = "personal"   // Personal user space
	SpaceTypeTemplate   SpaceType = "template"   // Template space for reuse
)

// SpaceStatus represents the lifecycle status of a space
type SpaceStatus string

const (
	SpaceStatusActive   SpaceStatus = "active"   // Active and accessible
	SpaceStatusDraft    SpaceStatus = "draft"    // Being set up
	SpaceStatusArchived SpaceStatus = "archived" // Archived but accessible
	SpaceStatusDisabled SpaceStatus = "disabled" // Disabled and hidden
)

// SpaceVisibility controls who can see and access the space
type SpaceVisibility string

const (
	VisibilityPublic   SpaceVisibility = "public"   // Everyone in workspace
	VisibilityInternal SpaceVisibility = "internal" // Workspace members only
	VisibilityTeam     SpaceVisibility = "team"     // Team members only
	VisibilityPrivate  SpaceVisibility = "private"  // Owner and collaborators only
)

// SpacePermission defines permission levels within a space
type SpacePermission string

const (
	PermissionNone     SpacePermission = "none"     // No access
	PermissionRead     SpacePermission = "read"     // Read-only access
	PermissionComment  SpacePermission = "comment"  // Read and comment
	PermissionWrite    SpacePermission = "write"    // Create/edit pages
	PermissionMaintain SpacePermission = "maintain" // Manage pages and settings
	PermissionAdmin    SpacePermission = "admin"    // Full administrative access
)

// ContentSource indicates where content originates from
type ContentSource string

const (
	SourceManual     ContentSource = "manual"     // Manually created
	SourceRepository ContentSource = "repository" // Auto-synced from repository
	SourceExternal   ContentSource = "external"   // External system import
	SourceTemplate   ContentSource = "template"   // Created from template
	SourceGenerated  ContentSource = "generated"  // AI/tool generated
)

// SpaceSettings contains configurable space behavior
type SpaceSettings struct {
	// Content management
	AllowComments    bool `json:"allow_comments" db:"allow_comments"`
	EnableVersioning bool `json:"enable_versioning" db:"enable_versioning"`
	RequireReview    bool `json:"require_review" db:"require_review"`
	AutoPublish      bool `json:"auto_publish" db:"auto_publish"`

	// Repository integration
	SyncFromRepository bool   `json:"sync_from_repository" db:"sync_from_repository"`
	RepositoryPath     string `json:"repository_path" db:"repository_path"`
	AutoSyncEnabled    bool   `json:"auto_sync_enabled" db:"auto_sync_enabled"`
	SyncSchedule       string `json:"sync_schedule" db:"sync_schedule"` // Cron expression

	// Navigation and organization
	DefaultPageTemplate string           `json:"default_page_template" db:"default_page_template"`
	ShowPageTree        bool             `json:"show_page_tree" db:"show_page_tree"`
	EnableSearch        bool             `json:"enable_search" db:"enable_search"`
	CustomNavigation    []NavigationItem `json:"custom_navigation" db:"custom_navigation"`

	// Notifications
	NotifyOnUpdate       bool     `json:"notify_on_update" db:"notify_on_update"`
	NotificationChannels []string `json:"notification_channels" db:"notification_channels"`

	// AI and automation
	EnableAIAssistant     bool `json:"enable_ai_assistant" db:"enable_ai_assistant"`
	AutoGenerateSummary   bool `json:"auto_generate_summary" db:"auto_generate_summary"`
	EnableAutoTranslation bool `json:"enable_auto_translation" db:"enable_auto_translation"`

	// Custom metadata
	CustomFields map[string]interface{} `json:"custom_fields" db:"custom_fields"`
}

// NavigationItem represents a custom navigation item
type NavigationItem struct {
	ID         uuid.UUID  `json:"id" db:"id"`
	Title      string     `json:"title" db:"title"`
	URL        string     `json:"url" db:"url"`
	Icon       string     `json:"icon" db:"icon"`
	Order      int        `json:"order" db:"order"`
	IsExternal bool       `json:"is_external" db:"is_external"`
	PageID     *uuid.UUID `json:"page_id" db:"page_id"`
}

// SpaceCollaborator represents a user with specific permissions in a space
type SpaceCollaborator struct {
	ID         uuid.UUID       `json:"id" db:"id"`
	SpaceID    uuid.UUID       `json:"space_id" db:"space_id"`
	UserID     uuid.UUID       `json:"user_id" db:"user_id"`
	Permission SpacePermission `json:"permission" db:"permission"`

	// Invitation details
	InvitedBy uuid.UUID `json:"invited_by" db:"invited_by"`
	InvitedAt time.Time `json:"invited_at" db:"invited_at"`

	// Access tracking
	LastAccessAt *time.Time `json:"last_access_at" db:"last_access_at"`
	AccessCount  int        `json:"access_count" db:"access_count"`

	// Status
	IsActive bool `json:"is_active" db:"is_active"`

	// Audit fields
	CreatedAt time.Time `json:"created_at" db:"created_at"`
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
}

// SpaceTemplate represents a template for creating new spaces
type SpaceTemplate struct {
	ID          uuid.UUID `json:"id" db:"id"`
	Name        string    `json:"name" db:"name"`
	Description string    `json:"description" db:"description"`
	Icon        string    `json:"icon" db:"icon"`

	// Template structure
	DefaultSettings     SpaceSettings        `json:"default_settings" db:"default_settings"`
	PageTemplates       []PageTemplate       `json:"page_templates" db:"page_templates"`
	NavigationStructure []NavigationTemplate `json:"navigation_structure" db:"navigation_structure"`

	// Usage tracking
	UsageCount int `json:"usage_count" db:"usage_count"`

	// Metadata
	Category string   `json:"category" db:"category"`
	Tags     []string `json:"tags" db:"tags"`

	// Audit fields
	CreatedAt time.Time `json:"created_at" db:"created_at"`
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
	CreatedBy uuid.UUID `json:"created_by" db:"created_by"`
}

// PageTemplate represents a template for creating pages within a space
type PageTemplate struct {
	ID          uuid.UUID `json:"id" db:"id"`
	Name        string    `json:"name" db:"name"`
	Title       string    `json:"title" db:"title"`
	Content     string    `json:"content" db:"content"`
	ContentType string    `json:"content_type" db:"content_type"` // markdown, html, etc.
	IsRequired  bool      `json:"is_required" db:"is_required"`
	Order       int       `json:"order" db:"order"`
	Variables   []string  `json:"variables" db:"variables"` // Template variables
}

// NavigationTemplate represents navigation structure in a template
type NavigationTemplate struct {
	Title        string               `json:"title" db:"title"`
	PageTemplate string               `json:"page_template" db:"page_template"`
	Children     []NavigationTemplate `json:"children" db:"children"`
	Order        int                  `json:"order" db:"order"`
}

// SpaceAnalytics contains space usage and performance metrics
type SpaceAnalytics struct {
	SpaceID uuid.UUID `json:"space_id" db:"space_id"`

	// Content metrics
	TotalPages     int `json:"total_pages" db:"total_pages"`
	PublishedPages int `json:"published_pages" db:"published_pages"`
	DraftPages     int `json:"draft_pages" db:"draft_pages"`

	// Usage metrics
	UniqueVisitors     int      `json:"unique_visitors" db:"unique_visitors"`
	PageViews          int      `json:"page_views" db:"page_views"`
	AvgSessionDuration float64  `json:"avg_session_duration" db:"avg_session_duration"`
	TopPages           []string `json:"top_pages" db:"top_pages"`

	// Collaboration metrics
	ActiveCollaborators int `json:"active_collaborators" db:"active_collaborators"`
	ContributionCount   int `json:"contribution_count" db:"contribution_count"`
	CommentCount        int `json:"comment_count" db:"comment_count"`

	// Search and discovery
	SearchQueries  int      `json:"search_queries" db:"search_queries"`
	TopSearchTerms []string `json:"top_search_terms" db:"top_search_terms"`

	// Content freshness
	LastContentUpdate time.Time `json:"last_content_update" db:"last_content_update"`
	StalePageCount    int       `json:"stale_page_count" db:"stale_page_count"` // Not updated in 90 days

	// Time period
	AnalyticsPeriod string    `json:"analytics_period" db:"analytics_period"` // daily, weekly, monthly
	RecordedAt      time.Time `json:"recorded_at" db:"recorded_at"`
}

// KnowledgeSpace represents a hierarchical knowledge organization unit
type KnowledgeSpace struct {
	// Core identity fields
	ID          uuid.UUID `json:"id" db:"id"`
	WorkspaceID uuid.UUID `json:"workspace_id" db:"workspace_id"`

	// Hierarchy
	ParentSpaceID *uuid.UUID `json:"parent_space_id" db:"parent_space_id"`
	RootSpaceID   *uuid.UUID `json:"root_space_id" db:"root_space_id"` // Top-level space
	Level         int        `json:"level" db:"level"`                 // Depth in hierarchy (0 = root)
	Path          string     `json:"path" db:"path"`                   // Full hierarchical path

	// Basic information
	Name        string `json:"name" db:"name"`
	Slug        string `json:"slug" db:"slug"`
	Title       string `json:"title" db:"title"`
	Description string `json:"description" db:"description"`

	// Classification
	SpaceType SpaceType `json:"space_type" db:"space_type"`

	// Repository integration (for repository-synced spaces)
	RepositoryID  *uuid.UUID    `json:"repository_id" db:"repository_id"`
	ContentSource ContentSource `json:"content_source" db:"content_source"`
	SourcePath    string        `json:"source_path" db:"source_path"`

	// Visual and branding
	Icon       string `json:"icon" db:"icon"`
	Color      string `json:"color" db:"color"`
	CoverImage string `json:"cover_image" db:"cover_image"`

	// Organization
	Order    int      `json:"order" db:"order"`
	Tags     []string `json:"tags" db:"tags"`
	Category string   `json:"category" db:"category"`

	// Lifecycle and access control
	Status     SpaceStatus     `json:"status" db:"status"`
	Visibility SpaceVisibility `json:"visibility" db:"visibility"`

	// Configuration
	Settings SpaceSettings `json:"settings" db:"settings"`

	// Relationships (loaded separately)
	ParentSpace   *KnowledgeSpace     `json:"parent_space" db:"-"`
	ChildSpaces   []KnowledgeSpace    `json:"child_spaces" db:"-"`
	Pages         []KnowledgePage     `json:"pages" db:"-"` // Will be defined in T034
	Collaborators []SpaceCollaborator `json:"collaborators" db:"-"`

	// Content statistics (calculated)
	PageCount          int `json:"page_count" db:"page_count"`
	PublishedPageCount int `json:"published_page_count" db:"published_page_count"`

	// Usage tracking
	ViewCount         int        `json:"view_count" db:"view_count"`
	LastViewedAt      *time.Time `json:"last_viewed_at" db:"last_viewed_at"`
	LastContentUpdate *time.Time `json:"last_content_update" db:"last_content_update"`

	// Template information (if created from template)
	TemplateID      *uuid.UUID `json:"template_id" db:"template_id"`
	TemplateVersion string     `json:"template_version" db:"template_version"`

	// Analytics (loaded separately when needed)
	Analytics *SpaceAnalytics `json:"analytics" db:"-"`

	// Audit trail fields
	CreatedAt time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt time.Time  `json:"updated_at" db:"updated_at"`
	CreatedBy uuid.UUID  `json:"created_by" db:"created_by"`
	UpdatedBy uuid.UUID  `json:"updated_by" db:"updated_by"`
	DeletedAt *time.Time `json:"deleted_at" db:"deleted_at"` // Soft delete
}

// NewKnowledgeSpace creates a new knowledge space with required fields and defaults
func NewKnowledgeSpace(workspaceID uuid.UUID, parentSpaceID *uuid.UUID, name, slug, title, description string, spaceType SpaceType, createdBy uuid.UUID) *KnowledgeSpace {
	now := time.Now()
	id := uuid.New()

	// Calculate level and root space
	level := 0
	var rootSpaceID *uuid.UUID
	if parentSpaceID != nil {
		level = 1                   // Will be updated when parent is loaded
		rootSpaceID = parentSpaceID // Will be updated when parent hierarchy is calculated
	}

	// Generate path
	path := slug
	if parentSpaceID != nil {
		path = "parent/" + slug // Will be updated when parent is loaded
	}

	return &KnowledgeSpace{
		ID:                 id,
		WorkspaceID:        workspaceID,
		ParentSpaceID:      parentSpaceID,
		RootSpaceID:        rootSpaceID,
		Level:              level,
		Path:               path,
		Name:               name,
		Slug:               slug,
		Title:              title,
		Description:        description,
		SpaceType:          spaceType,
		ContentSource:      SourceManual,
		Icon:               "📁",       // Default icon
		Color:              "#6B7280", // Default gray color
		Order:              0,
		Tags:               []string{},
		Status:             SpaceStatusDraft,
		Visibility:         VisibilityInternal, // Default to internal visibility
		Settings:           getDefaultSpaceSettings(),
		ChildSpaces:        []KnowledgeSpace{},
		Pages:              []KnowledgePage{},
		Collaborators:      []SpaceCollaborator{},
		PageCount:          0,
		PublishedPageCount: 0,
		ViewCount:          0,
		CreatedAt:          now,
		UpdatedAt:          now,
		CreatedBy:          createdBy,
		UpdatedBy:          createdBy,
	}
}

// getDefaultSpaceSettings returns default settings for a new space
func getDefaultSpaceSettings() SpaceSettings {
	return SpaceSettings{
		AllowComments:         true,
		EnableVersioning:      true,
		RequireReview:         false,
		AutoPublish:           true,
		SyncFromRepository:    false,
		AutoSyncEnabled:       false,
		ShowPageTree:          true,
		EnableSearch:          true,
		NotifyOnUpdate:        false,
		EnableAIAssistant:     true,
		AutoGenerateSummary:   false,
		EnableAutoTranslation: false,
		CustomFields:          make(map[string]interface{}),
		CustomNavigation:      []NavigationItem{},
		NotificationChannels:  []string{},
	}
}

// IsActive returns true if the space is not soft-deleted and is active
func (s *KnowledgeSpace) IsActive() bool {
	return s.DeletedAt == nil && s.Status != SpaceStatusDisabled
}

// IsPublic returns true if the space is publicly visible
func (s *KnowledgeSpace) IsPublic() bool {
	return s.Visibility == VisibilityPublic && s.IsActive()
}

// IsRoot returns true if this is a root-level space
func (s *KnowledgeSpace) IsRoot() bool {
	return s.ParentSpaceID == nil || s.Level == 0
}

// HasChildren returns true if this space has child spaces
func (s *KnowledgeSpace) HasChildren() bool {
	return len(s.ChildSpaces) > 0
}

// GetFullPath returns the complete hierarchical path
func (s *KnowledgeSpace) GetFullPath() string {
	if s.Path == "" {
		return s.Slug
	}
	return s.Path
}

// CanUserAccess checks if a user has access to this space
func (s *KnowledgeSpace) CanUserAccess(userID uuid.UUID, workspaceMember bool, userRole string) bool {
	// Check if space is active
	if !s.IsActive() {
		return false
	}

	// Check visibility rules
	switch s.Visibility {
	case VisibilityPublic:
		return workspaceMember // Public to all workspace members
	case VisibilityInternal:
		return workspaceMember
	case VisibilityTeam:
		// Check if user is team member (would need team membership check)
		return s.IsCollaborator(userID) || s.CreatedBy == userID
	case VisibilityPrivate:
		// Only collaborators and creator
		return s.IsCollaborator(userID) || s.CreatedBy == userID
	default:
		return false
	}
}

// GetUserPermission returns the user's permission level for this space
func (s *KnowledgeSpace) GetUserPermission(userID uuid.UUID) SpacePermission {
	// Creator has admin permission
	if s.CreatedBy == userID {
		return PermissionAdmin
	}

	// Check collaborator permissions
	for _, collab := range s.Collaborators {
		if collab.UserID == userID && collab.IsActive {
			return collab.Permission
		}
	}

	// Check if user has workspace access
	if s.Visibility == VisibilityPublic {
		return PermissionRead // Default public access
	}

	return PermissionNone
}

// CanUserEdit checks if user can edit content in this space
func (s *KnowledgeSpace) CanUserEdit(userID uuid.UUID) bool {
	permission := s.GetUserPermission(userID)
	return permission == PermissionWrite || permission == PermissionMaintain || permission == PermissionAdmin
}

// CanUserAdmin checks if user can administer this space
func (s *KnowledgeSpace) CanUserAdmin(userID uuid.UUID) bool {
	permission := s.GetUserPermission(userID)
	return permission == PermissionAdmin
}

// IsCollaborator checks if a user is a collaborator
func (s *KnowledgeSpace) IsCollaborator(userID uuid.UUID) bool {
	for _, collab := range s.Collaborators {
		if collab.UserID == userID && collab.IsActive {
			return true
		}
	}
	return false
}

// AddCollaborator adds a new collaborator to the space
func (s *KnowledgeSpace) AddCollaborator(userID, invitedBy uuid.UUID, permission SpacePermission) *SpaceCollaborator {
	// Check if user is already a collaborator
	for i, collab := range s.Collaborators {
		if collab.UserID == userID {
			// Update existing collaborator
			s.Collaborators[i].Permission = permission
			s.Collaborators[i].IsActive = true
			s.Collaborators[i].UpdatedAt = time.Now()
			return &s.Collaborators[i]
		}
	}

	now := time.Now()
	collaborator := SpaceCollaborator{
		ID:          uuid.New(),
		SpaceID:     s.ID,
		UserID:      userID,
		Permission:  permission,
		InvitedBy:   invitedBy,
		InvitedAt:   now,
		AccessCount: 0,
		IsActive:    true,
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	s.Collaborators = append(s.Collaborators, collaborator)
	s.UpdatedAt = now

	return &collaborator
}

// RemoveCollaborator removes or deactivates a collaborator
func (s *KnowledgeSpace) RemoveCollaborator(userID uuid.UUID) bool {
	for i, collab := range s.Collaborators {
		if collab.UserID == userID {
			s.Collaborators[i].IsActive = false
			s.Collaborators[i].UpdatedAt = time.Now()
			s.UpdatedAt = time.Now()
			return true
		}
	}
	return false
}

// UpdateCollaboratorPermission updates a collaborator's permission level
func (s *KnowledgeSpace) UpdateCollaboratorPermission(userID uuid.UUID, permission SpacePermission) bool {
	for i, collab := range s.Collaborators {
		if collab.UserID == userID && collab.IsActive {
			s.Collaborators[i].Permission = permission
			s.Collaborators[i].UpdatedAt = time.Now()
			s.UpdatedAt = time.Now()
			return true
		}
	}
	return false
}

// GetActiveCollaborators returns all active collaborators
func (s *KnowledgeSpace) GetActiveCollaborators() []SpaceCollaborator {
	var active []SpaceCollaborator
	for _, collab := range s.Collaborators {
		if collab.IsActive {
			active = append(active, collab)
		}
	}
	return active
}

// GetCollaboratorsByPermission returns collaborators with specific permission level
func (s *KnowledgeSpace) GetCollaboratorsByPermission(permission SpacePermission) []SpaceCollaborator {
	var filtered []SpaceCollaborator
	for _, collab := range s.Collaborators {
		if collab.IsActive && collab.Permission == permission {
			filtered = append(filtered, collab)
		}
	}
	return filtered
}

// UpdateHierarchy updates the space hierarchy information when parent changes
func (s *KnowledgeSpace) UpdateHierarchy(parentSpace *KnowledgeSpace) {
	if parentSpace == nil {
		// Root space
		s.Level = 0
		s.Path = s.Slug
		s.RootSpaceID = nil
	} else {
		// Child space
		s.Level = parentSpace.Level + 1
		s.Path = parentSpace.Path + "/" + s.Slug
		if parentSpace.RootSpaceID != nil {
			s.RootSpaceID = parentSpace.RootSpaceID
		} else {
			s.RootSpaceID = &parentSpace.ID // Parent is root
		}
	}
	s.UpdatedAt = time.Now()
}

// GetAncestors returns all parent spaces up to the root
func (s *KnowledgeSpace) GetAncestors() []KnowledgeSpace {
	var ancestors []KnowledgeSpace
	current := s.ParentSpace

	for current != nil {
		ancestors = append([]KnowledgeSpace{*current}, ancestors...) // Prepend
		current = current.ParentSpace
	}

	return ancestors
}

// GetBreadcrumbs returns breadcrumb navigation items
func (s *KnowledgeSpace) GetBreadcrumbs() []map[string]interface{} {
	ancestors := s.GetAncestors()
	breadcrumbs := make([]map[string]interface{}, 0, len(ancestors)+1)

	// Add all ancestors
	for _, ancestor := range ancestors {
		breadcrumbs = append(breadcrumbs, map[string]interface{}{
			"id":    ancestor.ID,
			"name":  ancestor.Name,
			"title": ancestor.Title,
			"slug":  ancestor.Slug,
			"path":  ancestor.Path,
		})
	}

	// Add current space
	breadcrumbs = append(breadcrumbs, map[string]interface{}{
		"id":    s.ID,
		"name":  s.Name,
		"title": s.Title,
		"slug":  s.Slug,
		"path":  s.Path,
	})

	return breadcrumbs
}

// SortChildrenByOrder sorts child spaces by their order field
func (s *KnowledgeSpace) SortChildrenByOrder() {
	sort.Slice(s.ChildSpaces, func(i, j int) bool {
		return s.ChildSpaces[i].Order < s.ChildSpaces[j].Order
	})
}

// AddChildSpace adds a child space
func (s *KnowledgeSpace) AddChildSpace(child *KnowledgeSpace) {
	child.ParentSpaceID = &s.ID
	child.UpdateHierarchy(s)
	s.ChildSpaces = append(s.ChildSpaces, *child)
	s.SortChildrenByOrder()
}

// UpdatePageCount updates the page count statistics
func (s *KnowledgeSpace) UpdatePageCount(total, published int) {
	s.PageCount = total
	s.PublishedPageCount = published
	s.UpdatedAt = time.Now()
}

// IncrementViewCount increments the view counter
func (s *KnowledgeSpace) IncrementViewCount() {
	s.ViewCount++
	now := time.Now()
	s.LastViewedAt = &now
	s.UpdatedAt = now
}

// UpdateLastContentUpdate marks when content was last updated
func (s *KnowledgeSpace) UpdateLastContentUpdate() {
	now := time.Now()
	s.LastContentUpdate = &now
	s.UpdatedAt = now
}

// IsStale returns true if content hasn't been updated in 90 days
func (s *KnowledgeSpace) IsStale() bool {
	if s.LastContentUpdate == nil {
		return time.Since(s.CreatedAt) > 90*24*time.Hour
	}
	return time.Since(*s.LastContentUpdate) > 90*24*time.Hour
}

// GetNavigationTree returns the navigation structure for this space
func (s *KnowledgeSpace) GetNavigationTree() []NavigationItem {
	if len(s.Settings.CustomNavigation) > 0 {
		// Return custom navigation if configured
		nav := make([]NavigationItem, len(s.Settings.CustomNavigation))
		copy(nav, s.Settings.CustomNavigation)

		// Sort by order
		sort.Slice(nav, func(i, j int) bool {
			return nav[i].Order < nav[j].Order
		})

		return nav
	}

	// Generate default navigation from pages and child spaces
	var navigation []NavigationItem
	order := 0

	// Add child spaces
	for _, child := range s.ChildSpaces {
		if child.IsActive() {
			navigation = append(navigation, NavigationItem{
				ID:         uuid.New(),
				Title:      child.Title,
				URL:        fmt.Sprintf("/spaces/%s", child.Slug),
				Icon:       child.Icon,
				Order:      order,
				IsExternal: false,
			})
			order++
		}
	}

	// Add published pages (would need pages loaded)
	// This would be implemented after T034

	return navigation
}

// Archive archives the space and all its content
func (s *KnowledgeSpace) Archive(archivedBy uuid.UUID) {
	s.Status = SpaceStatusArchived
	s.UpdatedAt = time.Now()
	s.UpdatedBy = archivedBy
}

// Activate activates an archived or draft space
func (s *KnowledgeSpace) Activate(activatedBy uuid.UUID) {
	s.Status = SpaceStatusActive
	s.UpdatedAt = time.Now()
	s.UpdatedBy = activatedBy
}

// UpdateSettings updates the space settings
func (s *KnowledgeSpace) UpdateSettings(settings SpaceSettings, updatedBy uuid.UUID) {
	s.Settings = settings
	s.UpdatedAt = time.Now()
	s.UpdatedBy = updatedBy
}

// Validate performs business logic validation on the space
func (s *KnowledgeSpace) Validate() error {
	if s.Name == "" {
		return ErrInvalidSpaceName
	}

	if s.Slug == "" {
		return ErrInvalidSpaceSlug
	}

	if s.WorkspaceID == uuid.Nil {
		return ErrInvalidWorkspaceID
	}

	// Validate slug format (alphanumeric, hyphens, underscores)
	if !isValidSlug(s.Slug) {
		return ErrInvalidSpaceSlug
	}

	// Validate hierarchy constraints
	if s.Level < 0 {
		return ErrInvalidSpaceLevel
	}

	if s.Level > 10 { // Prevent too deep hierarchies
		return ErrSpaceHierarchyTooDeep
	}

	// Validate space type
	switch s.SpaceType {
	case SpaceTypeRoot, SpaceTypeCategory, SpaceTypeProject, SpaceTypeTeam, SpaceTypeRepository, SpaceTypePersonal, SpaceTypeTemplate:
		// Valid types
	default:
		return ErrInvalidSpaceType
	}

	return nil
}

// ToPublicProfile returns a space profile safe for public consumption
func (s *KnowledgeSpace) ToPublicProfile() map[string]interface{} {
	profile := map[string]interface{}{
		"id":          s.ID,
		"name":        s.Name,
		"slug":        s.Slug,
		"title":       s.Title,
		"description": s.Description,
		"space_type":  s.SpaceType,
		"icon":        s.Icon,
		"color":       s.Color,
		"status":      s.Status,
		"visibility":  s.Visibility,
		"level":       s.Level,
		"path":        s.Path,
		"page_count":  s.PageCount,
		"view_count":  s.ViewCount,
		"created_at":  s.CreatedAt,
		"updated_at":  s.UpdatedAt,
	}

	// Add tags if present
	if len(s.Tags) > 0 {
		profile["tags"] = s.Tags
	}

	// Add category if set
	if s.Category != "" {
		profile["category"] = s.Category
	}

	return profile
}

// ToTreeNode returns a tree node representation for navigation
func (s *KnowledgeSpace) ToTreeNode() map[string]interface{} {
	node := map[string]interface{}{
		"id":       s.ID,
		"name":     s.Name,
		"title":    s.Title,
		"slug":     s.Slug,
		"icon":     s.Icon,
		"level":    s.Level,
		"order":    s.Order,
		"children": []map[string]interface{}{},
	}

	// Add child spaces
	if len(s.ChildSpaces) > 0 {
		children := make([]map[string]interface{}, 0, len(s.ChildSpaces))
		for _, child := range s.ChildSpaces {
			if child.IsActive() {
				children = append(children, child.ToTreeNode())
			}
		}
		node["children"] = children
	}

	return node
}

// isValidSlug validates slug format
func isValidSlug(slug string) bool {
	if len(slug) == 0 || len(slug) > 100 {
		return false
	}

	// Basic validation - alphanumeric, hyphens, underscores
	for _, char := range slug {
		if !((char >= 'a' && char <= 'z') ||
			(char >= 'A' && char <= 'Z') ||
			(char >= '0' && char <= '9') ||
			char == '-' || char == '_') {
			return false
		}
	}

	// Must not start or end with hyphen/underscore
	if strings.HasPrefix(slug, "-") || strings.HasPrefix(slug, "_") ||
		strings.HasSuffix(slug, "-") || strings.HasSuffix(slug, "_") {
		return false
	}

	return true
}

// Domain errors for knowledge space operations
var (
	ErrInvalidSpaceName      = NewDomainError("INVALID_SPACE_NAME", "Space name is required and must be valid")
	ErrInvalidSpaceSlug      = NewDomainError("INVALID_SPACE_SLUG", "Space slug is required and must be valid")
	ErrInvalidSpaceType      = NewDomainError("INVALID_SPACE_TYPE", "Space type is invalid")
	ErrInvalidSpaceLevel     = NewDomainError("INVALID_SPACE_LEVEL", "Space level must be non-negative")
	ErrInvalidWorkspaceID    = NewDomainError("INVALID_WORKSPACE_ID", "Workspace ID is required")
	ErrSpaceNotFound         = NewDomainError("SPACE_NOT_FOUND", "Knowledge space not found")
	ErrSpaceExists           = NewDomainError("SPACE_EXISTS", "Knowledge space already exists")
	ErrSpaceHierarchyTooDeep = NewDomainError("SPACE_HIERARCHY_TOO_DEEP", "Space hierarchy is too deep (max 10 levels)")
	ErrSpaceAccessDenied     = NewDomainError("SPACE_ACCESS_DENIED", "Access to knowledge space denied")
	ErrSpaceArchived         = NewDomainError("SPACE_ARCHIVED", "Knowledge space is archived")
	ErrInvalidPermission     = NewDomainError("INVALID_PERMISSION", "Invalid space permission level")
	ErrCollaboratorNotFound  = NewDomainError("COLLABORATOR_NOT_FOUND", "Space collaborator not found")
	ErrCollaboratorExists    = NewDomainError("COLLABORATOR_EXISTS", "Space collaborator already exists")
	ErrCannotDeleteRootSpace = NewDomainError("CANNOT_DELETE_ROOT_SPACE", "Cannot delete root space")
	ErrSpaceHasChildren      = NewDomainError("SPACE_HAS_CHILDREN", "Cannot delete space with child spaces")
)

// DomainError represents a business logic error (reuse from previous models)
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
