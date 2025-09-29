/**
 * T035 - Service Layer: WorkspaceService with CRUD and Member Management
 * 
 * This service implements business logic for workspace operations including
 * creation, member management, settings configuration, and multi-tenant operations.
 * 
 * Constitutional Requirements:
 * - Multi-tenant isolation and data segregation
 * - Transaction management and data consistency
 * - Business rule enforcement
 * - Event publishing for domain events
 * - Comprehensive error handling and logging
 * - Performance optimization with caching
 */

package service

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/drewpayment/orbit/services/repository/internal/domain"
)

// WorkspaceRepository defines the repository interface for workspace operations
type WorkspaceRepository interface {
	// Basic CRUD operations
	Create(ctx context.Context, workspace *domain.Workspace) error
	Update(ctx context.Context, workspace *domain.Workspace) error
	Delete(ctx context.Context, id uuid.UUID) error
	GetByID(ctx context.Context, id uuid.UUID) (*domain.Workspace, error)
	GetBySlug(ctx context.Context, slug string) (*domain.Workspace, error)
	
	// Listing and search
	List(ctx context.Context, filters WorkspaceFilters) ([]*domain.Workspace, error)
	ListByUser(ctx context.Context, userID uuid.UUID, role *domain.WorkspaceRole) ([]*domain.Workspace, error)
	Search(ctx context.Context, query string, filters WorkspaceFilters) ([]*domain.Workspace, error)
	
	// Member operations
	AddMember(ctx context.Context, workspaceID uuid.UUID, member *domain.WorkspaceMember) error
	UpdateMember(ctx context.Context, member *domain.WorkspaceMember) error
	RemoveMember(ctx context.Context, workspaceID, userID uuid.UUID) error
	GetMembers(ctx context.Context, workspaceID uuid.UUID) ([]*domain.WorkspaceMember, error)
	GetMemberCount(ctx context.Context, workspaceID uuid.UUID) (int, error)
	
	// Settings and configuration
	UpdateSettings(ctx context.Context, workspaceID uuid.UUID, settings domain.WorkspaceSettings) error
	
	// Statistics and analytics
	GetStats(ctx context.Context, workspaceID uuid.UUID) (*WorkspaceStats, error)
	GetUsage(ctx context.Context, workspaceID uuid.UUID) (*WorkspaceUsage, error)
	
	// Multi-tenant queries
	ExistsBySlug(ctx context.Context, slug string) (bool, error)
	GetSlugSuggestions(ctx context.Context, baseSlug string) ([]string, error)
}

// UserRepository defines the interface for user-related operations
type UserRepository interface {
	GetByID(ctx context.Context, id uuid.UUID) (*domain.User, error)
	GetByEmail(ctx context.Context, email string) (*domain.User, error)
	ExistsByID(ctx context.Context, id uuid.UUID) (bool, error)
}

// EventPublisher defines the interface for publishing domain events
type EventPublisher interface {
	PublishWorkspaceCreated(ctx context.Context, workspace *domain.Workspace) error
	PublishWorkspaceUpdated(ctx context.Context, workspace *domain.Workspace) error
	PublishWorkspaceDeleted(ctx context.Context, workspaceID uuid.UUID) error
	PublishMemberAdded(ctx context.Context, workspaceID uuid.UUID, member *domain.WorkspaceMember) error
	PublishMemberRemoved(ctx context.Context, workspaceID uuid.UUID, userID uuid.UUID) error
	PublishMemberRoleUpdated(ctx context.Context, workspaceID uuid.UUID, member *domain.WorkspaceMember) error
}

// CacheManager defines the interface for caching operations
type CacheManager interface {
	Set(ctx context.Context, key string, value interface{}, ttl time.Duration) error
	Get(ctx context.Context, key string) (interface{}, error)
	Delete(ctx context.Context, key string) error
	DeleteByPattern(ctx context.Context, pattern string) error
}

// WorkspaceFilters contains filtering options for workspace queries
type WorkspaceFilters struct {
	Visibility []domain.WorkspaceVisibility `json:"visibility"`
	Status     []string                     `json:"status"`
	CreatedBy  *uuid.UUID                   `json:"created_by"`
	CreatedAfter  *time.Time                `json:"created_after"`
	CreatedBefore *time.Time                `json:"created_before"`
	HasGitProvider *domain.GitProvider      `json:"has_git_provider"`
	Tags       []string                     `json:"tags"`
	Limit      int                          `json:"limit"`
	Offset     int                          `json:"offset"`
	SortBy     string                       `json:"sort_by"` // name, created_at, updated_at, member_count
	SortOrder  string                       `json:"sort_order"` // asc, desc
}

// CreateWorkspaceRequest contains the data needed to create a new workspace
type CreateWorkspaceRequest struct {
	Name           string                      `json:"name" validate:"required,min=1,max=100"`
	Slug           string                      `json:"slug" validate:"required,min=1,max=50,alphanum_dash"`
	Description    string                     `json:"description" validate:"max=500"`
	Visibility     domain.WorkspaceVisibility `json:"visibility" validate:"required"`
	Settings       domain.WorkspaceSettings   `json:"settings"`
	GitProviders   []domain.GitProviderConfig `json:"git_providers"`
	CreatedBy      uuid.UUID                  `json:"created_by" validate:"required"`
}

// UpdateWorkspaceRequest contains the data for updating a workspace
type UpdateWorkspaceRequest struct {
	ID          uuid.UUID                   `json:"id" validate:"required"`
	Name        *string                     `json:"name,omitempty" validate:"omitempty,min=1,max=100"`
	Description *string                     `json:"description,omitempty" validate:"omitempty,max=500"`
	Visibility  *domain.WorkspaceVisibility `json:"visibility,omitempty"`
	Settings    *domain.WorkspaceSettings   `json:"settings,omitempty"`
	UpdatedBy   uuid.UUID                   `json:"updated_by" validate:"required"`
}

// AddMemberRequest contains the data for adding a member to a workspace
type AddMemberRequest struct {
	WorkspaceID uuid.UUID             `json:"workspace_id" validate:"required"`
	UserID      uuid.UUID             `json:"user_id" validate:"required"`
	Role        domain.WorkspaceRole  `json:"role" validate:"required"`
	InvitedBy   uuid.UUID             `json:"invited_by" validate:"required"`
}

// UpdateMemberRoleRequest contains the data for updating a member's role
type UpdateMemberRoleRequest struct {
	WorkspaceID uuid.UUID            `json:"workspace_id" validate:"required"`
	UserID      uuid.UUID            `json:"user_id" validate:"required"`
	NewRole     domain.WorkspaceRole `json:"new_role" validate:"required"`
	UpdatedBy   uuid.UUID            `json:"updated_by" validate:"required"`
}

// WorkspaceStats contains statistics about a workspace
type WorkspaceStats struct {
	MemberCount      int                            `json:"member_count"`
	RepositoryCount  int                            `json:"repository_count"`
	APISchemaCount   int                            `json:"api_schema_count"`
	KnowledgeCount   int                            `json:"knowledge_count"`
	MembersByRole    map[domain.WorkspaceRole]int   `json:"members_by_role"`
	RecentActivity   []ActivityRecord               `json:"recent_activity"`
	GitProviders     []domain.GitProvider           `json:"git_providers"`
}

// WorkspaceUsage contains usage metrics for a workspace
type WorkspaceUsage struct {
	StorageUsed      int64                 `json:"storage_used"`
	StorageLimit     int64                 `json:"storage_limit"`
	MemberCount      int                   `json:"member_count"`
	MemberLimit      int                   `json:"member_limit"`
	APICallsToday    int                   `json:"api_calls_today"`
	APICallsLimit    int                   `json:"api_calls_limit"`
	BandwidthUsed    int64                 `json:"bandwidth_used"`
	BandwidthLimit   int64                 `json:"bandwidth_limit"`
	LastUpdated      time.Time             `json:"last_updated"`
}

// ActivityRecord represents a recent activity in the workspace
type ActivityRecord struct {
	ID          uuid.UUID   `json:"id"`
	Type        string      `json:"type"`
	UserID      uuid.UUID   `json:"user_id"`
	ResourceID  *uuid.UUID  `json:"resource_id"`
	Action      string      `json:"action"`
	Description string      `json:"description"`
	CreatedAt   time.Time   `json:"created_at"`
}

// WorkspaceService implements business logic for workspace operations
type WorkspaceService struct {
	workspaceRepo WorkspaceRepository
	userRepo      UserRepository
	eventPub      EventPublisher
	cache         CacheManager
	logger        *slog.Logger
}

// NewWorkspaceService creates a new workspace service instance
func NewWorkspaceService(
	workspaceRepo WorkspaceRepository,
	userRepo UserRepository,
	eventPub EventPublisher,
	cache CacheManager,
	logger *slog.Logger,
) *WorkspaceService {
	return &WorkspaceService{
		workspaceRepo: workspaceRepo,
		userRepo:      userRepo,
		eventPub:      eventPub,
		cache:         cache,
		logger:        logger.With("service", "workspace"),
	}
}

// CreateWorkspace creates a new workspace with validation and business rules
func (s *WorkspaceService) CreateWorkspace(ctx context.Context, req CreateWorkspaceRequest) (*domain.Workspace, error) {
	s.logger.InfoContext(ctx, "Creating workspace", "name", req.Name, "slug", req.Slug, "created_by", req.CreatedBy)
	
	// Validate the request
	if err := s.validateCreateRequest(ctx, req); err != nil {
		return nil, fmt.Errorf("validation failed: %w", err)
	}
	
	// Check if user exists
	_, err := s.userRepo.GetByID(ctx, req.CreatedBy)
	if err != nil {
		return nil, fmt.Errorf("failed to get creator: %w", err)
	}
	
	// Check if slug is available
	exists, err := s.workspaceRepo.ExistsBySlug(ctx, req.Slug)
	if err != nil {
		return nil, fmt.Errorf("failed to check slug availability: %w", err)
	}
	if exists {
		return nil, domain.ErrWorkspaceExists
	}
	
	// Create the workspace domain object
	workspace := domain.NewWorkspace(
		req.Name,
		req.Slug,
		req.Description,
		req.CreatedBy,
	)
	
	// Set custom visibility if provided
	workspace.Visibility = req.Visibility
	
	// Set custom settings if provided
	if !isEmptySettings(req.Settings) {
		workspace.Settings = req.Settings
	}
	
	// Validate the workspace domain object
	if err := workspace.Validate(); err != nil {
		return nil, fmt.Errorf("workspace validation failed: %w", err)
	}
	
	// Persist the workspace
	if err := s.workspaceRepo.Create(ctx, workspace); err != nil {
		return nil, fmt.Errorf("failed to create workspace: %w", err)
	}
	
	// Add the creator as an owner
	ownerMember := workspace.AddMember(req.CreatedBy, req.CreatedBy, domain.WorkspaceRoleOwner)
	if err := s.workspaceRepo.AddMember(ctx, workspace.ID, ownerMember); err != nil {
		s.logger.ErrorContext(ctx, "Failed to add creator as owner", "error", err, "workspace_id", workspace.ID)
		// Continue - the workspace is created, this is a secondary operation
	}
	
	// Publish domain event
	if err := s.eventPub.PublishWorkspaceCreated(ctx, workspace); err != nil {
		s.logger.WarnContext(ctx, "Failed to publish workspace created event", "error", err, "workspace_id", workspace.ID)
		// Don't fail the operation for event publishing failures
	}
	
	// Clear any cached workspace lists that might be affected
	s.clearWorkspaceListCaches(ctx, req.CreatedBy)
	
	s.logger.InfoContext(ctx, "Workspace created successfully", 
		"workspace_id", workspace.ID, "name", workspace.Name, "slug", workspace.Slug)
	
	return workspace, nil
}

// GetWorkspaceByID retrieves a workspace by its ID with permission checking
func (s *WorkspaceService) GetWorkspaceByID(ctx context.Context, id uuid.UUID, userID uuid.UUID) (*domain.Workspace, error) {
	s.logger.DebugContext(ctx, "Getting workspace by ID", "workspace_id", id, "user_id", userID)
	
	// Check cache first
	cacheKey := fmt.Sprintf("workspace:id:%s", id.String())
	if cached, err := s.cache.Get(ctx, cacheKey); err == nil {
		if workspace, ok := cached.(*domain.Workspace); ok {
			// Still need to check access permissions
			if s.canUserAccessWorkspace(ctx, workspace, userID) {
				return workspace, nil
			}
			return nil, domain.ErrInsufficientPermission
		}
	}
	
	// Get from repository
	workspace, err := s.workspaceRepo.GetByID(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("failed to get workspace: %w", err)
	}
	
	// Check if user can access this workspace
	if !s.canUserAccessWorkspace(ctx, workspace, userID) {
		return nil, domain.ErrInsufficientPermission
	}
	
	// Cache the result
	s.cache.Set(ctx, cacheKey, workspace, 15*time.Minute)
	
	return workspace, nil
}

// GetWorkspaceBySlug retrieves a workspace by its slug with permission checking
func (s *WorkspaceService) GetWorkspaceBySlug(ctx context.Context, slug string, userID uuid.UUID) (*domain.Workspace, error) {
	s.logger.DebugContext(ctx, "Getting workspace by slug", "slug", slug, "user_id", userID)
	
	// Check cache first
	cacheKey := fmt.Sprintf("workspace:slug:%s", slug)
	if cached, err := s.cache.Get(ctx, cacheKey); err == nil {
		if workspace, ok := cached.(*domain.Workspace); ok {
			// Still need to check access permissions
			if s.canUserAccessWorkspace(ctx, workspace, userID) {
				return workspace, nil
			}
			return nil, domain.ErrInsufficientPermission
		}
	}
	
	// Get from repository
	workspace, err := s.workspaceRepo.GetBySlug(ctx, slug)
	if err != nil {
		return nil, fmt.Errorf("failed to get workspace: %w", err)
	}
	
	// Check if user can access this workspace
	if !s.canUserAccessWorkspace(ctx, workspace, userID) {
		return nil, domain.ErrInsufficientPermission
	}
	
	// Cache the result
	s.cache.Set(ctx, cacheKey, workspace, 15*time.Minute)
	
	return workspace, nil
}

// UpdateWorkspace updates a workspace with validation and business rules
func (s *WorkspaceService) UpdateWorkspace(ctx context.Context, req UpdateWorkspaceRequest) (*domain.Workspace, error) {
	s.logger.InfoContext(ctx, "Updating workspace", "workspace_id", req.ID, "updated_by", req.UpdatedBy)
	
	// Get the existing workspace
	workspace, err := s.workspaceRepo.GetByID(ctx, req.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to get workspace: %w", err)
	}
	
	// Check if user can update this workspace
	if !s.canUserManageWorkspace(ctx, workspace, req.UpdatedBy) {
		return nil, domain.ErrInsufficientPermission
	}
	
	// Apply updates
	updated := false
	if req.Name != nil && *req.Name != workspace.Name {
		workspace.Name = *req.Name
		updated = true
	}
	
	if req.Description != nil && *req.Description != workspace.Description {
		workspace.Description = *req.Description
		updated = true
	}
	
	if req.Visibility != nil && *req.Visibility != workspace.Visibility {
		workspace.Visibility = *req.Visibility
		updated = true
	}
	
	if req.Settings != nil {
		workspace.Settings = *req.Settings
		updated = true
	}
	
	if updated {
		workspace.UpdatedAt = time.Now()
		workspace.UpdatedBy = req.UpdatedBy
		
		// Validate the updated workspace
		if err := workspace.Validate(); err != nil {
			return nil, fmt.Errorf("workspace validation failed: %w", err)
		}
		
		// Persist the changes
		if err := s.workspaceRepo.Update(ctx, workspace); err != nil {
			return nil, fmt.Errorf("failed to update workspace: %w", err)
		}
		
		// Publish domain event
		if err := s.eventPub.PublishWorkspaceUpdated(ctx, workspace); err != nil {
			s.logger.WarnContext(ctx, "Failed to publish workspace updated event", "error", err, "workspace_id", workspace.ID)
		}
		
		// Clear caches
		s.clearWorkspaceCaches(ctx, workspace)
		
		s.logger.InfoContext(ctx, "Workspace updated successfully", "workspace_id", workspace.ID)
	}
	
	return workspace, nil
}

// DeleteWorkspace deletes a workspace with validation and cleanup
func (s *WorkspaceService) DeleteWorkspace(ctx context.Context, id uuid.UUID, deletedBy uuid.UUID) error {
	s.logger.InfoContext(ctx, "Deleting workspace", "workspace_id", id, "deleted_by", deletedBy)
	
	// Get the workspace
	workspace, err := s.workspaceRepo.GetByID(ctx, id)
	if err != nil {
		return fmt.Errorf("failed to get workspace: %w", err)
	}
	
	// Check if user can delete this workspace
	if !workspace.CanDelete(deletedBy) {
		return domain.ErrInsufficientPermission
	}
	
	// Perform the deletion (soft delete)
	if err := s.workspaceRepo.Delete(ctx, id); err != nil {
		return fmt.Errorf("failed to delete workspace: %w", err)
	}
	
	// Publish domain event
	if err := s.eventPub.PublishWorkspaceDeleted(ctx, id); err != nil {
		s.logger.WarnContext(ctx, "Failed to publish workspace deleted event", "error", err, "workspace_id", id)
	}
	
	// Clear caches
	s.clearWorkspaceCaches(ctx, workspace)
	
	s.logger.InfoContext(ctx, "Workspace deleted successfully", "workspace_id", id)
	
	return nil
}

// ListWorkspaces lists workspaces with filtering and pagination
func (s *WorkspaceService) ListWorkspaces(ctx context.Context, userID uuid.UUID, filters WorkspaceFilters) ([]*domain.Workspace, error) {
	s.logger.DebugContext(ctx, "Listing workspaces", "user_id", userID, "filters", filters)
	
	// Get user to check permissions
	user, err := s.userRepo.GetByID(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to get user: %w", err)
	}
	
	// Super admins can see all workspaces, others see only accessible ones
	if user.Role != domain.RoleSuperAdmin {
		// Get workspaces where user is a member or that are public
		return s.workspaceRepo.ListByUser(ctx, userID, nil)
	}
	
	// Super admins get filtered list
	workspaces, err := s.workspaceRepo.List(ctx, filters)
	if err != nil {
		return nil, fmt.Errorf("failed to list workspaces: %w", err)
	}
	
	return workspaces, nil
}

// AddMember adds a member to a workspace with validation
func (s *WorkspaceService) AddMember(ctx context.Context, req AddMemberRequest) (*domain.WorkspaceMember, error) {
	s.logger.InfoContext(ctx, "Adding member to workspace", 
		"workspace_id", req.WorkspaceID, "user_id", req.UserID, "role", req.Role, "invited_by", req.InvitedBy)
	
	// Get the workspace
	workspace, err := s.workspaceRepo.GetByID(ctx, req.WorkspaceID)
	if err != nil {
		return nil, fmt.Errorf("failed to get workspace: %w", err)
	}
	
	// Check if inviter can manage members
	if !s.canUserManageMembers(ctx, workspace, req.InvitedBy) {
		return nil, domain.ErrInsufficientPermission
	}
	
	// Check if user exists
	if exists, err := s.userRepo.ExistsByID(ctx, req.UserID); err != nil {
		return nil, fmt.Errorf("failed to check user existence: %w", err)
	} else if !exists {
		return nil, domain.ErrUserNotFound
	}
	
	// Check if user is already a member
	if workspace.HasMember(req.UserID) {
		return nil, domain.ErrMemberExists
	}
	
	// Check member limits
	if workspace.IsAtMemberLimit() {
		return nil, domain.ErrMemberLimitExceeded
	}
	
	// Add the member
	member := workspace.AddMember(req.UserID, req.InvitedBy, req.Role)
	
	// Persist the member
	if err := s.workspaceRepo.AddMember(ctx, req.WorkspaceID, member); err != nil {
		return nil, fmt.Errorf("failed to add member: %w", err)
	}
	
	// Publish domain event
	if err := s.eventPub.PublishMemberAdded(ctx, req.WorkspaceID, member); err != nil {
		s.logger.WarnContext(ctx, "Failed to publish member added event", "error", err, "workspace_id", req.WorkspaceID)
	}
	
	// Clear member-related caches
	s.clearMemberCaches(ctx, req.WorkspaceID, req.UserID)
	
	s.logger.InfoContext(ctx, "Member added successfully", "workspace_id", req.WorkspaceID, "user_id", req.UserID)
	
	return member, nil
}

// RemoveMember removes a member from a workspace
func (s *WorkspaceService) RemoveMember(ctx context.Context, workspaceID, userID, removedBy uuid.UUID) error {
	s.logger.InfoContext(ctx, "Removing member from workspace", 
		"workspace_id", workspaceID, "user_id", userID, "removed_by", removedBy)
	
	// Get the workspace
	workspace, err := s.workspaceRepo.GetByID(ctx, workspaceID)
	if err != nil {
		return fmt.Errorf("failed to get workspace: %w", err)
	}
	
	// Check if remover can manage members
	if !s.canUserManageMembers(ctx, workspace, removedBy) {
		return domain.ErrInsufficientPermission
	}
	
	// Check if user is a member
	if !workspace.HasMember(userID) {
		return domain.ErrMemberNotFound
	}
	
	// Prevent removing the last owner
	owners := workspace.GetOwners()
	if len(owners) == 1 && owners[0].UserID == userID {
		return domain.ErrCannotRemoveLastOwner
	}
	
	// Remove the member
	if !workspace.RemoveMember(userID, removedBy) {
		return domain.ErrMemberNotFound
	}
	
	// Persist the removal
	if err := s.workspaceRepo.RemoveMember(ctx, workspaceID, userID); err != nil {
		return fmt.Errorf("failed to remove member: %w", err)
	}
	
	// Publish domain event
	if err := s.eventPub.PublishMemberRemoved(ctx, workspaceID, userID); err != nil {
		s.logger.WarnContext(ctx, "Failed to publish member removed event", "error", err, "workspace_id", workspaceID)
	}
	
	// Clear member-related caches
	s.clearMemberCaches(ctx, workspaceID, userID)
	
	s.logger.InfoContext(ctx, "Member removed successfully", "workspace_id", workspaceID, "user_id", userID)
	
	return nil
}

// UpdateMemberRole updates a member's role in a workspace
func (s *WorkspaceService) UpdateMemberRole(ctx context.Context, req UpdateMemberRoleRequest) (*domain.WorkspaceMember, error) {
	s.logger.InfoContext(ctx, "Updating member role", 
		"workspace_id", req.WorkspaceID, "user_id", req.UserID, "new_role", req.NewRole, "updated_by", req.UpdatedBy)
	
	// Get the workspace
	workspace, err := s.workspaceRepo.GetByID(ctx, req.WorkspaceID)
	if err != nil {
		return nil, fmt.Errorf("failed to get workspace: %w", err)
	}
	
	// Check if updater can manage members
	if !s.canUserManageMembers(ctx, workspace, req.UpdatedBy) {
		return nil, domain.ErrInsufficientPermission
	}
	
	// Get the current member
	member := workspace.GetMember(req.UserID)
	if member == nil {
		return nil, domain.ErrMemberNotFound
	}
	
	// Check if changing from owner role would leave no owners
	if member.Role == domain.WorkspaceRoleOwner && req.NewRole != domain.WorkspaceRoleOwner {
		owners := workspace.GetOwners()
		if len(owners) == 1 {
			return nil, domain.ErrCannotRemoveLastOwner
		}
	}
	
	// Update the role
	if !workspace.UpdateMemberRole(req.UserID, req.UpdatedBy, req.NewRole) {
		return nil, domain.ErrMemberNotFound
	}
	
	// Get the updated member
	updatedMember := workspace.GetMember(req.UserID)
	
	// Persist the change
	if err := s.workspaceRepo.UpdateMember(ctx, updatedMember); err != nil {
		return nil, fmt.Errorf("failed to update member: %w", err)
	}
	
	// Publish domain event
	if err := s.eventPub.PublishMemberRoleUpdated(ctx, req.WorkspaceID, updatedMember); err != nil {
		s.logger.WarnContext(ctx, "Failed to publish member role updated event", "error", err, "workspace_id", req.WorkspaceID)
	}
	
	// Clear member-related caches
	s.clearMemberCaches(ctx, req.WorkspaceID, req.UserID)
	
	s.logger.InfoContext(ctx, "Member role updated successfully", "workspace_id", req.WorkspaceID, "user_id", req.UserID)
	
	return updatedMember, nil
}

// GetWorkspaceMembers retrieves all members of a workspace
func (s *WorkspaceService) GetWorkspaceMembers(ctx context.Context, workspaceID, requestedBy uuid.UUID) ([]*domain.WorkspaceMember, error) {
	s.logger.DebugContext(ctx, "Getting workspace members", "workspace_id", workspaceID, "requested_by", requestedBy)
	
	// Get the workspace to check permissions
	workspace, err := s.workspaceRepo.GetByID(ctx, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("failed to get workspace: %w", err)
	}
	
	// Check if user can view members
	if !s.canUserViewMembers(ctx, workspace, requestedBy) {
		return nil, domain.ErrInsufficientPermission
	}
	
	// Check cache first
	cacheKey := fmt.Sprintf("workspace:members:%s", workspaceID.String())
	if cached, err := s.cache.Get(ctx, cacheKey); err == nil {
		if members, ok := cached.([]*domain.WorkspaceMember); ok {
			return members, nil
		}
	}
	
	// Get from repository
	members, err := s.workspaceRepo.GetMembers(ctx, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("failed to get members: %w", err)
	}
	
	// Cache the result
	s.cache.Set(ctx, cacheKey, members, 10*time.Minute)
	
	return members, nil
}

// GetWorkspaceStats retrieves statistics for a workspace
func (s *WorkspaceService) GetWorkspaceStats(ctx context.Context, workspaceID, requestedBy uuid.UUID) (*WorkspaceStats, error) {
	s.logger.DebugContext(ctx, "Getting workspace stats", "workspace_id", workspaceID, "requested_by", requestedBy)
	
	// Get the workspace to check permissions
	workspace, err := s.workspaceRepo.GetByID(ctx, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("failed to get workspace: %w", err)
	}
	
	// Check if user can view stats
	if !s.canUserViewStats(ctx, workspace, requestedBy) {
		return nil, domain.ErrInsufficientPermission
	}
	
	// Check cache first
	cacheKey := fmt.Sprintf("workspace:stats:%s", workspaceID.String())
	if cached, err := s.cache.Get(ctx, cacheKey); err == nil {
		if stats, ok := cached.(*WorkspaceStats); ok {
			return stats, nil
		}
	}
	
	// Get from repository
	stats, err := s.workspaceRepo.GetStats(ctx, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("failed to get stats: %w", err)
	}
	
	// Cache the result with shorter TTL since stats change frequently
	s.cache.Set(ctx, cacheKey, stats, 5*time.Minute)
	
	return stats, nil
}

// Helper methods

// validateCreateRequest validates a create workspace request
func (s *WorkspaceService) validateCreateRequest(ctx context.Context, req CreateWorkspaceRequest) error {
	if req.Name == "" {
		return domain.ErrInvalidWorkspaceName
	}
	
	if req.Slug == "" {
		return domain.ErrInvalidWorkspaceSlug
	}
	
	if req.CreatedBy == uuid.Nil {
		return domain.ErrUserNotFound
	}
	
	// Validate slug format (alphanumeric with hyphens)
	if !isValidSlug(req.Slug) {
		return domain.ErrInvalidWorkspaceSlug
	}
	
	return nil
}

// canUserAccessWorkspace checks if a user can access a workspace
func (s *WorkspaceService) canUserAccessWorkspace(ctx context.Context, workspace *domain.Workspace, userID uuid.UUID) bool {
	// Get user to check global role
	user, err := s.userRepo.GetByID(ctx, userID)
	if err != nil {
		return false
	}
	
	return workspace.CanUserAccess(userID, user.Role)
}

// canUserManageWorkspace checks if a user can manage workspace settings
func (s *WorkspaceService) canUserManageWorkspace(ctx context.Context, workspace *domain.Workspace, userID uuid.UUID) bool {
	member := workspace.GetMember(userID)
	if member == nil {
		return false
	}
	
	return member.Role == domain.WorkspaceRoleOwner || member.Role == domain.WorkspaceRoleAdmin
}

// canUserManageMembers checks if a user can manage workspace members
func (s *WorkspaceService) canUserManageMembers(ctx context.Context, workspace *domain.Workspace, userID uuid.UUID) bool {
	member := workspace.GetMember(userID)
	if member == nil {
		return false
	}
	
	return member.Role == domain.WorkspaceRoleOwner || member.Role == domain.WorkspaceRoleAdmin
}

// canUserViewMembers checks if a user can view workspace members
func (s *WorkspaceService) canUserViewMembers(ctx context.Context, workspace *domain.Workspace, userID uuid.UUID) bool {
	return workspace.HasMember(userID) // Any member can view the member list
}

// canUserViewStats checks if a user can view workspace statistics
func (s *WorkspaceService) canUserViewStats(ctx context.Context, workspace *domain.Workspace, userID uuid.UUID) bool {
	member := workspace.GetMember(userID)
	if member == nil {
		return false
	}
	
	// Members with elevated roles can view stats
	return member.Role == domain.WorkspaceRoleOwner || 
		   member.Role == domain.WorkspaceRoleAdmin || 
		   member.Role == domain.WorkspaceRoleAdmin
}

// Cache management helpers

// clearWorkspaceCaches clears all caches related to a workspace
func (s *WorkspaceService) clearWorkspaceCaches(ctx context.Context, workspace *domain.Workspace) {
	patterns := []string{
		fmt.Sprintf("workspace:id:%s", workspace.ID.String()),
		fmt.Sprintf("workspace:slug:%s", workspace.Slug),
		fmt.Sprintf("workspace:members:%s", workspace.ID.String()),
		fmt.Sprintf("workspace:stats:%s", workspace.ID.String()),
		"workspace:list:*", // Clear list caches
	}
	
	for _, pattern := range patterns {
		if err := s.cache.DeleteByPattern(ctx, pattern); err != nil {
			s.logger.WarnContext(ctx, "Failed to clear cache", "pattern", pattern, "error", err)
		}
	}
}

// clearMemberCaches clears member-related caches
func (s *WorkspaceService) clearMemberCaches(ctx context.Context, workspaceID, userID uuid.UUID) {
	patterns := []string{
		fmt.Sprintf("workspace:members:%s", workspaceID.String()),
		fmt.Sprintf("workspace:stats:%s", workspaceID.String()),
		fmt.Sprintf("user:workspaces:%s", userID.String()),
	}
	
	for _, pattern := range patterns {
		if err := s.cache.DeleteByPattern(ctx, pattern); err != nil {
			s.logger.WarnContext(ctx, "Failed to clear cache", "pattern", pattern, "error", err)
		}
	}
}

// clearWorkspaceListCaches clears workspace list caches for a user
func (s *WorkspaceService) clearWorkspaceListCaches(ctx context.Context, userID uuid.UUID) {
	patterns := []string{
		"workspace:list:*",
		fmt.Sprintf("user:workspaces:%s", userID.String()),
	}
	
	for _, pattern := range patterns {
		if err := s.cache.DeleteByPattern(ctx, pattern); err != nil {
			s.logger.WarnContext(ctx, "Failed to clear cache", "pattern", pattern, "error", err)
		}
	}
}

// Utility functions

// isValidSlug validates a workspace slug format
func isValidSlug(slug string) bool {
	if len(slug) == 0 || len(slug) > 50 {
		return false
	}
	
	// Basic validation - alphanumeric and hyphens
	for _, char := range slug {
		if !((char >= 'a' && char <= 'z') || 
			 (char >= 'A' && char <= 'Z') || 
			 (char >= '0' && char <= '9') || 
			 char == '-') {
			return false
		}
	}
	
	// Must not start or end with hyphen
	if strings.HasPrefix(slug, "-") || strings.HasSuffix(slug, "-") {
		return false
	}
	
	return true
}

// isEmptySettings checks if workspace settings are empty/default
func isEmptySettings(settings domain.WorkspaceSettings) bool {
	// Compare with default settings - simplified check
	return settings.MaxMembersCount == 0 && settings.MaxStorageGB == 0 && len(settings.AllowedTemplateTypes) == 0
}

// Service-specific errors
var (
	ErrUserNotFound                  = domain.NewDomainError("USER_NOT_FOUND", "User not found")
	ErrWorkspaceMemberExists         = domain.NewDomainError("WORKSPACE_MEMBER_EXISTS", "User is already a member of this workspace")
	ErrWorkspaceMemberNotFound       = domain.NewDomainError("WORKSPACE_MEMBER_NOT_FOUND", "User is not a member of this workspace")
	ErrWorkspaceMemberLimitReached   = domain.NewDomainError("WORKSPACE_MEMBER_LIMIT_REACHED", "Workspace member limit reached")
	ErrCannotRemoveLastOwner         = domain.NewDomainError("CANNOT_REMOVE_LAST_OWNER", "Cannot remove the last owner of the workspace")
)