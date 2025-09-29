/**
 * T030 - Data Model: Workspace with Settings
 *
 * This model defines the core Workspace entity with settings, member management,
 * and multi-tenant isolation for the Internal Developer Portal.
 *
 * Constitutional Requirements:
 * - Multi-tenant isolation and data segregation
 * - Configurable workspace settings and policies
 * - Member role management with RBAC
 * - Git provider integration configuration
 * - Audit trails for workspace operations
 */

package domain

import (
	"time"

	"github.com/google/uuid"
)

// WorkspaceVisibility defines who can see and access the workspace
type WorkspaceVisibility string

const (
	WorkspaceVisibilityPrivate  WorkspaceVisibility = "private"  // Only members
	WorkspaceVisibilityInternal WorkspaceVisibility = "internal" // Anyone in organization
	WorkspaceVisibilityPublic   WorkspaceVisibility = "public"   // Anyone with link
)

// GitProvider represents supported Git providers
type GitProvider string

const (
	GitProviderGitHub      GitProvider = "github"
	GitProviderGitLab      GitProvider = "gitlab"
	GitProviderBitbucket   GitProvider = "bitbucket"
	GitProviderAzureDevOps GitProvider = "azure_devops"
)

// CICDProvider represents supported CI/CD providers
type CICDProvider string

const (
	CICDProviderGitHubActions  CICDProvider = "github_actions"
	CICDProviderGitLabCI       CICDProvider = "gitlab_ci"
	CICDProviderJenkins        CICDProvider = "jenkins"
	CICDProviderAzurePipelines CICDProvider = "azure_pipelines"
)

// GitProviderConfig contains configuration for Git provider integration
type GitProviderConfig struct {
	Provider         GitProvider `json:"provider" db:"provider"`
	BaseURL          string      `json:"base_url" db:"base_url"`
	OrganizationName string      `json:"organization_name" db:"organization_name"`

	// Authentication
	AccessToken   string `json:"-" db:"access_token"`   // Never serialize
	RefreshToken  string `json:"-" db:"refresh_token"`  // Never serialize
	WebhookSecret string `json:"-" db:"webhook_secret"` // Never serialize

	// Configuration
	DefaultBranch     string              `json:"default_branch" db:"default_branch"`
	AutoCreateRepos   bool                `json:"auto_create_repos" db:"auto_create_repos"`
	DefaultVisibility WorkspaceVisibility `json:"default_visibility" db:"default_visibility"`
	EnableWebhooks    bool                `json:"enable_webhooks" db:"enable_webhooks"`

	// Metadata
	Enabled   bool      `json:"enabled" db:"enabled"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
}

// CICDProviderConfig contains configuration for CI/CD provider integration
type CICDProviderConfig struct {
	Provider CICDProvider `json:"provider" db:"provider"`
	BaseURL  string       `json:"base_url" db:"base_url"`

	// Authentication
	AccessToken   string `json:"-" db:"access_token"`   // Never serialize
	WebhookSecret string `json:"-" db:"webhook_secret"` // Never serialize

	// Configuration
	DefaultPipeline   string `json:"default_pipeline" db:"default_pipeline"`
	AutoTriggerBuilds bool   `json:"auto_trigger_builds" db:"auto_trigger_builds"`
	EnableDeployments bool   `json:"enable_deployments" db:"enable_deployments"`

	// Metadata
	Enabled   bool      `json:"enabled" db:"enabled"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
}

// WorkspaceSettings contains configurable workspace policies and preferences
type WorkspaceSettings struct {
	// Default behaviors
	DefaultVisibility       WorkspaceVisibility `json:"default_visibility" db:"default_visibility"`
	RequireApprovalForRepos bool                `json:"require_approval_for_repos" db:"require_approval_for_repos"`
	EnableCodeGeneration    bool                `json:"enable_code_generation" db:"enable_code_generation"`

	// Template restrictions
	AllowedTemplateTypes []string `json:"allowed_template_types" db:"allowed_template_types"`
	RestrictedLanguages  []string `json:"restricted_languages" db:"restricted_languages"`

	// Integration settings
	GitProviders  []GitProviderConfig  `json:"-" db:"-"` // Stored separately
	CICDProviders []CICDProviderConfig `json:"-" db:"-"` // Stored separately

	// Security policies
	EnforceCodeReview       bool `json:"enforce_code_review" db:"enforce_code_review"`
	RequireBranchProtection bool `json:"require_branch_protection" db:"require_branch_protection"`
	EnableSecurityScanning  bool `json:"enable_security_scanning" db:"enable_security_scanning"`
	MaxRepositoriesPerUser  int  `json:"max_repositories_per_user" db:"max_repositories_per_user"`

	// Resource limits
	MaxConcurrentBuilds int `json:"max_concurrent_builds" db:"max_concurrent_builds"`
	MaxStorageGB        int `json:"max_storage_gb" db:"max_storage_gb"`
	MaxMembersCount     int `json:"max_members_count" db:"max_members_count"`

	// Feature flags
	EnableAPIGeneration     bool `json:"enable_api_generation" db:"enable_api_generation"`
	EnableKnowledgeBase     bool `json:"enable_knowledge_base" db:"enable_knowledge_base"`
	EnableTemporalWorkflows bool `json:"enable_temporal_workflows" db:"enable_temporal_workflows"`
	EnableAuditLogs         bool `json:"enable_audit_logs" db:"enable_audit_logs"`

	// Custom configuration (JSONB field for extensibility)
	CustomConfig map[string]interface{} `json:"custom_config" db:"custom_config"`

	// Timestamps
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
	UpdatedBy uuid.UUID `json:"updated_by" db:"updated_by"`
}

// WorkspaceMember represents a user's membership in a workspace with role and permissions
type WorkspaceMember struct {
	ID          uuid.UUID     `json:"id" db:"id"`
	WorkspaceID uuid.UUID     `json:"workspace_id" db:"workspace_id"`
	UserID      uuid.UUID     `json:"user_id" db:"user_id"`
	Role        WorkspaceRole `json:"role" db:"role"`

	// Membership details
	JoinedAt  time.Time `json:"joined_at" db:"joined_at"`
	InvitedBy uuid.UUID `json:"invited_by" db:"invited_by"`
	InvitedAt time.Time `json:"invited_at" db:"invited_at"`
	IsActive  bool      `json:"is_active" db:"is_active"`

	// Custom permissions (can override role defaults)
	CustomPermissions []string `json:"custom_permissions" db:"custom_permissions"`

	// Invitation tracking
	InvitationToken    string     `json:"-" db:"invitation_token"` // Never serialize
	InvitationExpires  *time.Time `json:"invitation_expires" db:"invitation_expires"`
	InvitationAccepted bool       `json:"invitation_accepted" db:"invitation_accepted"`

	// Activity tracking
	LastActiveAt *time.Time `json:"last_active_at" db:"last_active_at"`

	// Audit fields
	CreatedAt time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt time.Time  `json:"updated_at" db:"updated_at"`
	UpdatedBy uuid.UUID  `json:"updated_by" db:"updated_by"`
	DeletedAt *time.Time `json:"deleted_at" db:"deleted_at"` // Soft delete
}

// WorkspaceInvitation represents a pending invitation to join a workspace
type WorkspaceInvitation struct {
	ID          uuid.UUID     `json:"id" db:"id"`
	WorkspaceID uuid.UUID     `json:"workspace_id" db:"workspace_id"`
	Email       string        `json:"email" db:"email"`
	Role        WorkspaceRole `json:"role" db:"role"`

	// Invitation details
	Token      string     `json:"-" db:"token"` // Never serialize
	ExpiresAt  time.Time  `json:"expires_at" db:"expires_at"`
	AcceptedAt *time.Time `json:"accepted_at" db:"accepted_at"`
	AcceptedBy *uuid.UUID `json:"accepted_by" db:"accepted_by"`

	// Invitation metadata
	InvitedBy uuid.UUID `json:"invited_by" db:"invited_by"`
	InvitedAt time.Time `json:"invited_at" db:"invited_at"`
	Message   string    `json:"message" db:"message"`

	// Status tracking
	Status    string     `json:"status" db:"status"` // pending, accepted, expired, revoked
	RevokedAt *time.Time `json:"revoked_at" db:"revoked_at"`
	RevokedBy *uuid.UUID `json:"revoked_by" db:"revoked_by"`

	// Audit fields
	CreatedAt time.Time `json:"created_at" db:"created_at"`
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
}

// WorkspaceStats contains workspace usage statistics
type WorkspaceStats struct {
	WorkspaceID uuid.UUID `json:"workspace_id" db:"workspace_id"`

	// Resource counts
	RepositoryCount    int `json:"repository_count" db:"repository_count"`
	ActiveMembersCount int `json:"active_members_count" db:"active_members_count"`
	APISchemaCount     int `json:"api_schema_count" db:"api_schema_count"`
	KnowledgePageCount int `json:"knowledge_page_count" db:"knowledge_page_count"`

	// Activity metrics
	LastActivityAt     *time.Time `json:"last_activity_at" db:"last_activity_at"`
	MonthlyActiveUsers int        `json:"monthly_active_users" db:"monthly_active_users"`
	WeeklyCodeGenJobs  int        `json:"weekly_codegen_jobs" db:"weekly_codegen_jobs"`

	// Storage usage
	StorageUsedGB  float64 `json:"storage_used_gb" db:"storage_used_gb"`
	StorageLimitGB int     `json:"storage_limit_gb" db:"storage_limit_gb"`

	// Workflow metrics
	RunningWorkflows   int `json:"running_workflows" db:"running_workflows"`
	CompletedWorkflows int `json:"completed_workflows" db:"completed_workflows"`
	FailedWorkflows    int `json:"failed_workflows" db:"failed_workflows"`

	// Calculated at query time
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
}

// Workspace represents a workspace in the Internal Developer Portal
type Workspace struct {
	// Core identity fields
	ID          uuid.UUID `json:"id" db:"id"`
	Name        string    `json:"name" db:"name"`
	Slug        string    `json:"slug" db:"slug"`
	Description string    `json:"description" db:"description"`

	// Visual branding
	Icon  string `json:"icon" db:"icon"`   // Emoji or icon identifier
	Color string `json:"color" db:"color"` // Hex color code

	// Access control
	Visibility WorkspaceVisibility `json:"visibility" db:"visibility"`

	// Configuration
	Settings WorkspaceSettings `json:"settings" db:"-"` // Stored separately

	// Workspace relationships
	Members []WorkspaceMember `json:"members" db:"-"` // Loaded separately
	Stats   *WorkspaceStats   `json:"stats" db:"-"`   // Loaded separately

	// Organization context
	OrganizationID *uuid.UUID `json:"organization_id" db:"organization_id"`

	// Audit trail fields
	CreatedAt time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt time.Time  `json:"updated_at" db:"updated_at"`
	CreatedBy uuid.UUID  `json:"created_by" db:"created_by"`
	UpdatedBy uuid.UUID  `json:"updated_by" db:"updated_by"`
	DeletedAt *time.Time `json:"deleted_at" db:"deleted_at"` // Soft delete
}

// NewWorkspace creates a new workspace with required fields and sensible defaults
func NewWorkspace(name, slug, description string, createdBy uuid.UUID) *Workspace {
	now := time.Now()

	return &Workspace{
		ID:          uuid.New(),
		Name:        name,
		Slug:        slug,
		Description: description,
		Visibility:  WorkspaceVisibilityPrivate, // Default to private
		Icon:        "🏢",                        // Default workspace icon
		Color:       "#6366F1",                  // Default indigo color
		Settings: WorkspaceSettings{
			DefaultVisibility:       WorkspaceVisibilityInternal,
			RequireApprovalForRepos: false,
			EnableCodeGeneration:    true,
			AllowedTemplateTypes:    []string{"service", "library", "frontend", "documentation"},
			RestrictedLanguages:     []string{},
			EnforceCodeReview:       true,
			RequireBranchProtection: true,
			EnableSecurityScanning:  true,
			MaxRepositoriesPerUser:  50,
			MaxConcurrentBuilds:     10,
			MaxStorageGB:            100,
			MaxMembersCount:         100,
			EnableAPIGeneration:     true,
			EnableKnowledgeBase:     true,
			EnableTemporalWorkflows: true,
			EnableAuditLogs:         true,
			CustomConfig:            make(map[string]interface{}),
			UpdatedAt:               now,
			UpdatedBy:               createdBy,
		},
		CreatedAt: now,
		UpdatedAt: now,
		CreatedBy: createdBy,
		UpdatedBy: createdBy,
	}
}

// IsActive returns true if the workspace is not soft-deleted
func (w *Workspace) IsActive() bool {
	return w.DeletedAt == nil
}

// CanUserAccess checks if a user has access to this workspace based on visibility
func (w *Workspace) CanUserAccess(userID uuid.UUID, userRole UserRole) bool {
	// Check if user is a member
	if w.HasMember(userID) {
		return true
	}

	// Check visibility rules
	switch w.Visibility {
	case WorkspaceVisibilityPublic:
		return true
	case WorkspaceVisibilityInternal:
		// Internal visibility allows any authenticated user
		return userRole != RoleGuest
	case WorkspaceVisibilityPrivate:
		// Private workspaces require explicit membership
		return false
	default:
		return false
	}
}

// HasMember checks if a user is a member of this workspace
func (w *Workspace) HasMember(userID uuid.UUID) bool {
	for _, member := range w.Members {
		if member.UserID == userID && member.IsActive {
			return true
		}
	}
	return false
}

// GetMember returns the workspace member record for a user
func (w *Workspace) GetMember(userID uuid.UUID) *WorkspaceMember {
	for _, member := range w.Members {
		if member.UserID == userID && member.IsActive {
			return &member
		}
	}
	return nil
}

// GetMemberRole returns the user's role in this workspace
func (w *Workspace) GetMemberRole(userID uuid.UUID) *WorkspaceRole {
	member := w.GetMember(userID)
	if member != nil {
		return &member.Role
	}
	return nil
}

// HasPermission checks if a user has a specific permission in this workspace
func (w *Workspace) HasPermission(userID uuid.UUID, permission string) bool {
	member := w.GetMember(userID)
	if member == nil {
		return false
	}

	// Check custom permissions first
	for _, customPerm := range member.CustomPermissions {
		if customPerm == permission {
			return true
		}
	}

	// Check role-based permissions
	return member.Role.HasPermission(permission)
}

// AddMember adds a new member to the workspace
func (w *Workspace) AddMember(userID, invitedBy uuid.UUID, role WorkspaceRole) *WorkspaceMember {
	now := time.Now()

	member := &WorkspaceMember{
		ID:                 uuid.New(),
		WorkspaceID:        w.ID,
		UserID:             userID,
		Role:               role,
		JoinedAt:           now,
		InvitedBy:          invitedBy,
		InvitedAt:          now,
		IsActive:           true,
		CustomPermissions:  []string{},
		InvitationAccepted: true,
		CreatedAt:          now,
		UpdatedAt:          now,
		UpdatedBy:          invitedBy,
	}

	w.Members = append(w.Members, *member)
	return member
}

// RemoveMember removes a member from the workspace (soft delete)
func (w *Workspace) RemoveMember(userID, removedBy uuid.UUID) bool {
	for i, member := range w.Members {
		if member.UserID == userID {
			now := time.Now()
			w.Members[i].IsActive = false
			w.Members[i].UpdatedAt = now
			w.Members[i].UpdatedBy = removedBy
			w.Members[i].DeletedAt = &now
			return true
		}
	}
	return false
}

// UpdateMemberRole updates a member's role in the workspace
func (w *Workspace) UpdateMemberRole(userID, updatedBy uuid.UUID, newRole WorkspaceRole) bool {
	for i, member := range w.Members {
		if member.UserID == userID && member.IsActive {
			w.Members[i].Role = newRole
			w.Members[i].UpdatedAt = time.Now()
			w.Members[i].UpdatedBy = updatedBy
			return true
		}
	}
	return false
}

// GetOwners returns all workspace owners
func (w *Workspace) GetOwners() []WorkspaceMember {
	var owners []WorkspaceMember
	for _, member := range w.Members {
		if member.Role == WorkspaceRoleOwner && member.IsActive {
			owners = append(owners, member)
		}
	}
	return owners
}

// CanDelete checks if the workspace can be deleted (at least one owner exists)
func (w *Workspace) CanDelete(requestedBy uuid.UUID) bool {
	// Only owners can delete workspaces
	member := w.GetMember(requestedBy)
	if member == nil || member.Role != WorkspaceRoleOwner {
		return false
	}

	// Must have at least one owner
	owners := w.GetOwners()
	return len(owners) >= 1
}

// IsAtMemberLimit checks if workspace has reached member limit
func (w *Workspace) IsAtMemberLimit() bool {
	activeMembers := 0
	for _, member := range w.Members {
		if member.IsActive {
			activeMembers++
		}
	}
	return activeMembers >= w.Settings.MaxMembersCount
}

// IsAtStorageLimit checks if workspace has reached storage limit
func (w *Workspace) IsAtStorageLimit() bool {
	if w.Stats == nil {
		return false
	}
	return w.Stats.StorageUsedGB >= float64(w.Settings.MaxStorageGB)
}

// HasGitProvider checks if a specific Git provider is configured
func (w *Workspace) HasGitProvider(provider GitProvider) bool {
	for _, gitProvider := range w.Settings.GitProviders {
		if gitProvider.Provider == provider && gitProvider.Enabled {
			return true
		}
	}
	return false
}

// GetPrimaryGitProvider returns the primary Git provider configuration
func (w *Workspace) GetPrimaryGitProvider() *GitProviderConfig {
	for _, gitProvider := range w.Settings.GitProviders {
		if gitProvider.Enabled {
			return &gitProvider
		}
	}
	return nil
}

// Validate performs business logic validation on the workspace
func (w *Workspace) Validate() error {
	if w.Name == "" {
		return ErrInvalidWorkspaceName
	}

	if w.Slug == "" {
		return ErrInvalidWorkspaceSlug
	}

	if w.Settings.MaxMembersCount <= 0 {
		return ErrInvalidMemberLimit
	}

	if w.Settings.MaxStorageGB <= 0 {
		return ErrInvalidStorageLimit
	}

	// Validate members have valid roles
	for _, member := range w.Members {
		if member.IsActive {
			if err := member.Role.Validate(); err != nil {
				return err
			}
		}
	}

	return nil
}

// ToPublicProfile returns a workspace profile safe for public consumption
func (w *Workspace) ToPublicProfile() map[string]interface{} {
	profile := map[string]interface{}{
		"id":          w.ID,
		"name":        w.Name,
		"slug":        w.Slug,
		"description": w.Description,
		"icon":        w.Icon,
		"color":       w.Color,
		"created_at":  w.CreatedAt,
	}

	// Add stats if available
	if w.Stats != nil {
		profile["repository_count"] = w.Stats.RepositoryCount
		profile["member_count"] = w.Stats.ActiveMembersCount
	}

	// Only include visibility if workspace is not private
	if w.Visibility != WorkspaceVisibilityPrivate {
		profile["visibility"] = w.Visibility
	}

	return profile
}

// HasPermission checks if a workspace role has a specific permission
func (wr WorkspaceRole) HasPermission(permission string) bool {
	// Define permission matrix for workspace roles
	rolePermissions := map[WorkspaceRole][]string{
		WorkspaceRoleOwner: {
			"workspace.*", "member.*", "repository.*", "schema.*", "knowledge.*",
		},
		WorkspaceRoleAdmin: {
			"workspace.read", "workspace.update",
			"member.read", "member.invite", "member.remove",
			"repository.*", "schema.*", "knowledge.*",
		},
		WorkspaceRoleDeveloper: {
			"workspace.read",
			"member.read",
			"repository.create", "repository.read", "repository.update",
			"schema.create", "schema.read", "schema.update",
			"knowledge.create", "knowledge.read", "knowledge.update",
		},
		WorkspaceRoleCollaborator: {
			"workspace.read",
			"member.read",
			"repository.read", "repository.create",
			"schema.read", "schema.create",
			"knowledge.read", "knowledge.create",
		},
		WorkspaceRoleViewer: {
			"workspace.read",
			"member.read",
			"repository.read",
			"schema.read",
			"knowledge.read",
		},
	}

	permissions, exists := rolePermissions[wr]
	if !exists {
		return false
	}

	// Check for exact permission match or wildcard
	for _, rolePermission := range permissions {
		if rolePermission == permission {
			return true
		}

		// Check wildcard permissions
		if rolePermission[len(rolePermission)-1] == '*' {
			prefix := rolePermission[:len(rolePermission)-1]
			if len(permission) >= len(prefix) && permission[:len(prefix)] == prefix {
				return true
			}
		}
	}

	return false
}

// Validate validates a workspace role
func (wr WorkspaceRole) Validate() error {
	switch wr {
	case WorkspaceRoleOwner, WorkspaceRoleAdmin, WorkspaceRoleDeveloper,
		WorkspaceRoleCollaborator, WorkspaceRoleViewer:
		return nil
	default:
		return ErrInvalidWorkspaceRole
	}
}

// Domain errors for workspace operations
var (
	ErrInvalidWorkspaceName   = NewDomainError("INVALID_WORKSPACE_NAME", "Workspace name is required and must be valid")
	ErrInvalidWorkspaceSlug   = NewDomainError("INVALID_WORKSPACE_SLUG", "Workspace slug is required and must be valid")
	ErrInvalidWorkspaceRole   = NewDomainError("INVALID_WORKSPACE_ROLE", "Workspace role is invalid")
	ErrInvalidMemberLimit     = NewDomainError("INVALID_MEMBER_LIMIT", "Member limit must be greater than 0")
	ErrInvalidStorageLimit    = NewDomainError("INVALID_STORAGE_LIMIT", "Storage limit must be greater than 0")
	ErrWorkspaceNotFound      = NewDomainError("WORKSPACE_NOT_FOUND", "Workspace not found")
	ErrWorkspaceExists        = NewDomainError("WORKSPACE_EXISTS", "Workspace already exists")
	ErrMemberNotFound         = NewDomainError("MEMBER_NOT_FOUND", "Workspace member not found")
	ErrMemberExists           = NewDomainError("MEMBER_EXISTS", "User is already a member of this workspace")
	ErrInsufficientPermission = NewDomainError("INSUFFICIENT_PERMISSION", "Insufficient permission for this operation")
	ErrMemberLimitExceeded    = NewDomainError("MEMBER_LIMIT_EXCEEDED", "Workspace member limit exceeded")
	ErrStorageLimitExceeded   = NewDomainError("STORAGE_LIMIT_EXCEEDED", "Workspace storage limit exceeded")
	ErrCannotRemoveLastOwner  = NewDomainError("CANNOT_REMOVE_LAST_OWNER", "Cannot remove the last owner of a workspace")
	ErrInvitationExpired      = NewDomainError("INVITATION_EXPIRED", "Workspace invitation has expired")
	ErrInvitationNotFound     = NewDomainError("INVITATION_NOT_FOUND", "Workspace invitation not found")
)
