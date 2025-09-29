/**
 * T029 - Data Model: User with Authentication Fields
 *
 * This model defines the core User entity with authentication, authorization,
 * and workspace relationship fields for the Internal Developer Portal.
 *
 * Constitutional Requirements:
 * - Multi-tenant workspace isolation
 * - RBAC with role hierarchy
 * - Secure authentication field storage
 * - Audit trails for user actions
 */

package domain

import (
	"time"

	"github.com/google/uuid"
)

// UserRole represents the hierarchical role system
type UserRole string

const (
	// System-level roles (highest privilege)
	RoleSuperAdmin UserRole = "super_admin" // Level 100 - Full system access
	RoleAdmin      UserRole = "admin"       // Level 80  - User/workspace management

	// Standard user roles
	RoleDeveloper UserRole = "developer" // Level 60  - Create/modify resources
	RoleViewer    UserRole = "viewer"    // Level 20  - Read-only access
	RoleGuest     UserRole = "guest"     // Level 10  - Limited schema access
)

// GetRoleLevel returns the hierarchical level for role-based comparisons
func (r UserRole) GetLevel() int {
	switch r {
	case RoleSuperAdmin:
		return 100
	case RoleAdmin:
		return 80
	case RoleDeveloper:
		return 60
	case RoleViewer:
		return 20
	case RoleGuest:
		return 10
	default:
		return 0
	}
}

// UserStatus represents the current state of a user account
type UserStatus string

const (
	UserStatusActive    UserStatus = "active"    // Normal active user
	UserStatusInactive  UserStatus = "inactive"  // Temporarily disabled
	UserStatusLocked    UserStatus = "locked"    // Locked due to security (brute force, etc.)
	UserStatusPending   UserStatus = "pending"   // Awaiting email verification
	UserStatusSuspended UserStatus = "suspended" // Administrative suspension
)

// WorkspaceRole represents user's role within a specific workspace
type WorkspaceRole string

const (
	WorkspaceRoleOwner        WorkspaceRole = "owner"        // Level 100 - Full workspace control
	WorkspaceRoleAdmin        WorkspaceRole = "admin"        // Level 90  - Manage workspace settings
	WorkspaceRoleDeveloper    WorkspaceRole = "developer"    // Level 70  - Create/modify resources
	WorkspaceRoleCollaborator WorkspaceRole = "collaborator" // Level 50  - Limited modification
	WorkspaceRoleViewer       WorkspaceRole = "viewer"       // Level 30  - Read-only access
)

// GetLevel returns the hierarchical level for workspace role comparisons
func (wr WorkspaceRole) GetLevel() int {
	switch wr {
	case WorkspaceRoleOwner:
		return 100
	case WorkspaceRoleAdmin:
		return 90
	case WorkspaceRoleDeveloper:
		return 70
	case WorkspaceRoleCollaborator:
		return 50
	case WorkspaceRoleViewer:
		return 30
	default:
		return 0
	}
}

// UserWorkspaceMembership represents a user's membership in a workspace
type UserWorkspaceMembership struct {
	UserID      uuid.UUID     `json:"user_id" db:"user_id"`
	WorkspaceID uuid.UUID     `json:"workspace_id" db:"workspace_id"`
	Role        WorkspaceRole `json:"role" db:"role"`
	JoinedAt    time.Time     `json:"joined_at" db:"joined_at"`
	InvitedBy   uuid.UUID     `json:"invited_by" db:"invited_by"`
	IsActive    bool          `json:"is_active" db:"is_active"`

	// Permissions can be customized per membership
	CustomPermissions []string `json:"custom_permissions" db:"custom_permissions"`
}

// AuthMethod represents different authentication methods
type AuthMethod string

const (
	AuthMethodPassword AuthMethod = "password" // Local username/password
	AuthMethodOAuth    AuthMethod = "oauth"    // OAuth 2.0 providers
	AuthMethodSAML     AuthMethod = "saml"     // SAML SSO
	AuthMethodLDAP     AuthMethod = "ldap"     // LDAP/Active Directory
	AuthMethodAPIKey   AuthMethod = "api_key"  // API key authentication
)

// OAuthProvider represents supported OAuth providers
type OAuthProvider string

const (
	OAuthProviderGitHub    OAuthProvider = "github"
	OAuthProviderGoogle    OAuthProvider = "google"
	OAuthProviderMicrosoft OAuthProvider = "microsoft"
	OAuthProviderGitLab    OAuthProvider = "gitlab"
)

// UserAuthDetails stores authentication-related information
type UserAuthDetails struct {
	ID         uuid.UUID  `json:"id" db:"id"`
	UserID     uuid.UUID  `json:"user_id" db:"user_id"`
	AuthMethod AuthMethod `json:"auth_method" db:"auth_method"`

	// Password authentication fields
	PasswordHash         string     `json:"-" db:"password_hash"` // Never serialize
	PasswordSalt         string     `json:"-" db:"password_salt"` // Never serialize
	PasswordLastChanged  *time.Time `json:"password_last_changed" db:"password_last_changed"`
	PasswordResetToken   string     `json:"-" db:"password_reset_token"` // Never serialize
	PasswordResetExpires *time.Time `json:"password_reset_expires" db:"password_reset_expires"`

	// OAuth authentication fields
	OAuthProvider     OAuthProvider `json:"oauth_provider" db:"oauth_provider"`
	OAuthProviderID   string        `json:"oauth_provider_id" db:"oauth_provider_id"`
	OAuthAccessToken  string        `json:"-" db:"oauth_access_token"`  // Never serialize
	OAuthRefreshToken string        `json:"-" db:"oauth_refresh_token"` // Never serialize
	OAuthTokenExpires *time.Time    `json:"oauth_token_expires" db:"oauth_token_expires"`

	// Security fields
	TwoFactorEnabled    bool       `json:"two_factor_enabled" db:"two_factor_enabled"`
	TwoFactorSecret     string     `json:"-" db:"two_factor_secret"` // Never serialize
	BackupCodes         []string   `json:"-" db:"backup_codes"`      // Never serialize
	LastLoginAt         *time.Time `json:"last_login_at" db:"last_login_at"`
	LastLoginIP         string     `json:"last_login_ip" db:"last_login_ip"`
	FailedLoginAttempts int        `json:"failed_login_attempts" db:"failed_login_attempts"`
	LastFailedLoginAt   *time.Time `json:"last_failed_login_at" db:"last_failed_login_at"`
	AccountLockedUntil  *time.Time `json:"account_locked_until" db:"account_locked_until"`

	// Audit fields
	CreatedAt time.Time `json:"created_at" db:"created_at"`
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
}

// UserSession represents an active user session
type UserSession struct {
	ID           uuid.UUID `json:"id" db:"id"`
	UserID       uuid.UUID `json:"user_id" db:"user_id"`
	SessionToken string    `json:"-" db:"session_token"`  // Never serialize
	RefreshToken string    `json:"-" db:"refresh_token"`  // Never serialize
	JWTTokenHash string    `json:"-" db:"jwt_token_hash"` // Never serialize

	// Session metadata
	DeviceID   string `json:"device_id" db:"device_id"`
	DeviceInfo string `json:"device_info" db:"device_info"`
	IPAddress  string `json:"ip_address" db:"ip_address"`
	UserAgent  string `json:"user_agent" db:"user_agent"`
	Location   string `json:"location" db:"location"`

	// Session lifecycle
	CreatedAt      time.Time  `json:"created_at" db:"created_at"`
	ExpiresAt      time.Time  `json:"expires_at" db:"expires_at"`
	LastAccessedAt time.Time  `json:"last_accessed_at" db:"last_accessed_at"`
	IsActive       bool       `json:"is_active" db:"is_active"`
	LoggedOutAt    *time.Time `json:"logged_out_at" db:"logged_out_at"`
}

// User represents a user in the Internal Developer Portal
type User struct {
	// Core identity fields
	ID          uuid.UUID `json:"id" db:"id"`
	Username    string    `json:"username" db:"username"`
	Email       string    `json:"email" db:"email"`
	DisplayName string    `json:"display_name" db:"display_name"`
	AvatarURL   string    `json:"avatar_url" db:"avatar_url"`

	// System role and status
	Role   UserRole   `json:"role" db:"role"`
	Status UserStatus `json:"status" db:"status"`

	// Profile information
	FirstName  string `json:"first_name" db:"first_name"`
	LastName   string `json:"last_name" db:"last_name"`
	Company    string `json:"company" db:"company"`
	Department string `json:"department" db:"department"`
	JobTitle   string `json:"job_title" db:"job_title"`
	Bio        string `json:"bio" db:"bio"`

	// Contact information
	PhoneNumber string `json:"phone_number" db:"phone_number"`
	TimeZone    string `json:"timezone" db:"timezone"`
	Locale      string `json:"locale" db:"locale"`

	// Verification status
	EmailVerified      bool       `json:"email_verified" db:"email_verified"`
	EmailVerifyToken   string     `json:"-" db:"email_verify_token"` // Never serialize
	EmailVerifyExpires *time.Time `json:"email_verify_expires" db:"email_verify_expires"`
	PhoneVerified      bool       `json:"phone_verified" db:"phone_verified"`

	// Workspace relationships
	WorkspaceMemberships []UserWorkspaceMembership `json:"workspace_memberships" db:"-"`
	DefaultWorkspaceID   *uuid.UUID                `json:"default_workspace_id" db:"default_workspace_id"`

	// User preferences
	Preferences map[string]interface{} `json:"preferences" db:"preferences"` // JSONB field

	// Security and audit
	AuthDetails []UserAuthDetails `json:"-" db:"-"` // Never serialize, fetch separately
	Sessions    []UserSession     `json:"-" db:"-"` // Never serialize, fetch separately

	// Audit trail fields
	CreatedAt time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt time.Time  `json:"updated_at" db:"updated_at"`
	CreatedBy uuid.UUID  `json:"created_by" db:"created_by"`
	UpdatedBy uuid.UUID  `json:"updated_by" db:"updated_by"`
	DeletedAt *time.Time `json:"deleted_at" db:"deleted_at"` // Soft delete
}

// NewUser creates a new user with required fields and sensible defaults
func NewUser(username, email, displayName string, createdBy uuid.UUID) *User {
	now := time.Now()

	return &User{
		ID:          uuid.New(),
		Username:    username,
		Email:       email,
		DisplayName: displayName,
		Role:        RoleDeveloper,     // Default role
		Status:      UserStatusPending, // Requires email verification
		Locale:      "en-US",
		TimeZone:    "UTC",
		Preferences: make(map[string]interface{}),
		CreatedAt:   now,
		UpdatedAt:   now,
		CreatedBy:   createdBy,
		UpdatedBy:   createdBy,
	}
}

// IsActive returns true if the user is in an active state
func (u *User) IsActive() bool {
	return u.Status == UserStatusActive
}

// CanAccessWorkspace checks if user has access to a specific workspace
func (u *User) CanAccessWorkspace(workspaceID uuid.UUID) bool {
	// Super admins have access to all workspaces
	if u.Role == RoleSuperAdmin {
		return true
	}

	// Check workspace memberships
	for _, membership := range u.WorkspaceMemberships {
		if membership.WorkspaceID == workspaceID && membership.IsActive {
			return true
		}
	}

	return false
}

// GetWorkspaceRole returns the user's role in a specific workspace
func (u *User) GetWorkspaceRole(workspaceID uuid.UUID) *WorkspaceRole {
	for _, membership := range u.WorkspaceMemberships {
		if membership.WorkspaceID == workspaceID && membership.IsActive {
			return &membership.Role
		}
	}
	return nil
}

// HasPermission checks if user has a specific permission based on their role
func (u *User) HasPermission(permission string) bool {
	// Define permission matrix based on roles
	rolePermissions := map[UserRole][]string{
		RoleSuperAdmin: {
			"workspace.*", "user.*", "role.*", "schema.*", "system.*", "audit.*",
		},
		RoleAdmin: {
			"workspace.create", "workspace.read", "workspace.update", "workspace.delete",
			"user.create", "user.read", "user.update",
			"schema.create", "schema.read", "schema.update", "schema.delete",
		},
		RoleDeveloper: {
			"workspace.read", "workspace.update",
			"schema.create", "schema.read", "schema.update",
			"repository.create", "repository.read", "repository.update",
			"codegen.execute",
		},
		RoleViewer: {
			"workspace.read", "schema.read", "repository.read",
		},
		RoleGuest: {
			"schema.read",
		},
	}

	permissions, exists := rolePermissions[u.Role]
	if !exists {
		return false
	}

	// Check for exact permission match or wildcard
	for _, rolePermission := range permissions {
		if rolePermission == permission {
			return true
		}

		// Check wildcard permissions (e.g., "workspace.*" matches "workspace.read")
		if rolePermission[len(rolePermission)-1] == '*' {
			prefix := rolePermission[:len(rolePermission)-1]
			if len(permission) >= len(prefix) && permission[:len(prefix)] == prefix {
				return true
			}
		}
	}

	return false
}

// HasWorkspacePermission checks if user has a specific permission in a workspace
func (u *User) HasWorkspacePermission(workspaceID uuid.UUID, permission string) bool {
	// Super admins have all permissions
	if u.Role == RoleSuperAdmin {
		return true
	}

	// Get workspace role
	workspaceRole := u.GetWorkspaceRole(workspaceID)
	if workspaceRole == nil {
		return false
	}

	// Define workspace role permissions
	workspacePermissions := map[WorkspaceRole][]string{
		WorkspaceRoleOwner: {
			"workspace.*", "schema.*", "repository.*", "member.*",
		},
		WorkspaceRoleAdmin: {
			"workspace.read", "workspace.update",
			"schema.*", "repository.*",
			"member.read", "member.invite", "member.remove",
		},
		WorkspaceRoleDeveloper: {
			"workspace.read",
			"schema.create", "schema.read", "schema.update",
			"repository.create", "repository.read", "repository.update",
		},
		WorkspaceRoleCollaborator: {
			"workspace.read",
			"schema.read", "schema.create",
			"repository.read", "repository.create",
		},
		WorkspaceRoleViewer: {
			"workspace.read", "schema.read", "repository.read",
		},
	}

	permissions, exists := workspacePermissions[*workspaceRole]
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

// IsLocked returns true if the account is currently locked
func (u *User) IsLocked() bool {
	return u.Status == UserStatusLocked
}

// GetFullName returns the user's full name or display name as fallback
func (u *User) GetFullName() string {
	if u.FirstName != "" && u.LastName != "" {
		return u.FirstName + " " + u.LastName
	}
	if u.DisplayName != "" {
		return u.DisplayName
	}
	return u.Username
}

// ToPublicProfile returns a user profile safe for public consumption
func (u *User) ToPublicProfile() map[string]interface{} {
	return map[string]interface{}{
		"id":           u.ID,
		"username":     u.Username,
		"display_name": u.DisplayName,
		"avatar_url":   u.AvatarURL,
		"company":      u.Company,
		"job_title":    u.JobTitle,
		"bio":          u.Bio,
		"created_at":   u.CreatedAt,
	}
}

// Validate performs business logic validation on the user
func (u *User) Validate() error {
	if u.Username == "" {
		return ErrInvalidUsername
	}

	if u.Email == "" {
		return ErrInvalidEmail
	}

	if u.DisplayName == "" {
		return ErrInvalidDisplayName
	}

	// Additional validation rules can be added here
	return nil
}

// Domain errors
var (
	ErrInvalidUsername    = NewDomainError("INVALID_USERNAME", "Username is required and must be valid")
	ErrInvalidEmail       = NewDomainError("INVALID_EMAIL", "Email is required and must be valid")
	ErrInvalidDisplayName = NewDomainError("INVALID_DISPLAY_NAME", "Display name is required")
	ErrUserNotFound       = NewDomainError("USER_NOT_FOUND", "User not found")
	ErrUserAlreadyExists  = NewDomainError("USER_ALREADY_EXISTS", "User already exists")
	ErrInvalidCredentials = NewDomainError("INVALID_CREDENTIALS", "Invalid credentials")
	ErrAccountLocked      = NewDomainError("ACCOUNT_LOCKED", "Account is locked")
	ErrAccountInactive    = NewDomainError("ACCOUNT_INACTIVE", "Account is inactive")
)

// DomainError represents a business logic error
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
