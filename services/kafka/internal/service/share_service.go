package service

import (
	"context"
	"time"

	"github.com/drewpayment/orbit/services/kafka/internal/domain"
	"github.com/google/uuid"
)

// ShareRepository defines persistence operations for topic shares
type ShareRepository interface {
	Create(ctx context.Context, share *domain.KafkaTopicShare) error
	GetByID(ctx context.Context, id uuid.UUID) (*domain.KafkaTopicShare, error)
	List(ctx context.Context, filter ShareFilter) ([]*domain.KafkaTopicShare, error)
	Update(ctx context.Context, share *domain.KafkaTopicShare) error
	Delete(ctx context.Context, id uuid.UUID) error
	GetExisting(ctx context.Context, topicID, workspaceID uuid.UUID) (*domain.KafkaTopicShare, error)
}

// SharePolicyRepository defines persistence for share policies
type SharePolicyRepository interface {
	GetEffectivePolicy(ctx context.Context, workspaceID uuid.UUID, topicID uuid.UUID) (*domain.KafkaTopicSharePolicy, error)
}

// ServiceAccountRepository defines persistence for service accounts
type ServiceAccountRepository interface {
	Create(ctx context.Context, account *domain.KafkaServiceAccount) error
	GetByID(ctx context.Context, id uuid.UUID) (*domain.KafkaServiceAccount, error)
	List(ctx context.Context, workspaceID uuid.UUID) ([]*domain.KafkaServiceAccount, error)
	Update(ctx context.Context, account *domain.KafkaServiceAccount) error
}

// ShareService handles topic sharing operations
type ShareService struct {
	shareRepo          ShareRepository
	policyRepo         SharePolicyRepository
	serviceAccountRepo ServiceAccountRepository
	topicService       *TopicService
}

// NewShareService creates a new ShareService
func NewShareService(
	shareRepo ShareRepository,
	policyRepo SharePolicyRepository,
	serviceAccountRepo ServiceAccountRepository,
	topicService *TopicService,
) *ShareService {
	return &ShareService{
		shareRepo:          shareRepo,
		policyRepo:         policyRepo,
		serviceAccountRepo: serviceAccountRepo,
		topicService:       topicService,
	}
}

// RequestTopicAccess requests access to a topic from another workspace
func (s *ShareService) RequestTopicAccess(ctx context.Context, req RequestAccessRequest) (*domain.KafkaTopicShare, error) {
	// Get topic to validate it exists
	topic, err := s.topicService.GetTopic(ctx, req.TopicID)
	if err != nil {
		return nil, err
	}

	// Cannot share with self
	if topic.WorkspaceID == req.TargetWorkspaceID {
		return nil, domain.ErrShareSelfShare
	}

	// Check for existing share
	existing, err := s.shareRepo.GetExisting(ctx, req.TopicID, req.TargetWorkspaceID)
	if err != nil && err != domain.ErrShareNotFound {
		return nil, err
	}
	if existing != nil {
		return nil, domain.ErrShareAlreadyExists
	}

	// Get share policy
	policy, err := s.policyRepo.GetEffectivePolicy(ctx, topic.WorkspaceID, req.TopicID)
	if err != nil && err != domain.ErrPolicyNotFound {
		return nil, err
	}

	// Create share using domain constructor
	share := domain.NewTopicShareRequest(req.TopicID, req.TargetWorkspaceID, req.RequestedBy, req.Permission, req.Reason)

	// Calculate expiration if specified
	var expiresAt *time.Time
	if req.ExpiresInDays > 0 {
		expires := time.Now().AddDate(0, 0, req.ExpiresInDays)
		expiresAt = &expires
	}

	// Check if auto-approval applies
	if policy != nil && policy.ShouldAutoApprove(topic.WorkspaceID, req.TargetWorkspaceID.String(), req.Permission) {
		share.Approve(req.RequestedBy, expiresAt)
	}

	if err := s.shareRepo.Create(ctx, share); err != nil {
		return nil, err
	}

	return share, nil
}

// ApproveTopicAccess approves a pending share request
func (s *ShareService) ApproveTopicAccess(ctx context.Context, shareID uuid.UUID, approverID uuid.UUID) (*domain.KafkaTopicShare, error) {
	share, err := s.shareRepo.GetByID(ctx, shareID)
	if err != nil {
		return nil, err
	}
	if share == nil {
		return nil, domain.ErrShareNotFound
	}

	if share.Status != domain.ShareStatusPendingRequest {
		return nil, domain.ErrShareNotPending
	}

	share.Approve(approverID, nil)

	if err := s.shareRepo.Update(ctx, share); err != nil {
		return nil, err
	}

	return share, nil
}

// RejectTopicAccess rejects a pending share request
func (s *ShareService) RejectTopicAccess(ctx context.Context, shareID uuid.UUID, rejecterID uuid.UUID, reason string) (*domain.KafkaTopicShare, error) {
	share, err := s.shareRepo.GetByID(ctx, shareID)
	if err != nil {
		return nil, err
	}
	if share == nil {
		return nil, domain.ErrShareNotFound
	}

	if share.Status != domain.ShareStatusPendingRequest {
		return nil, domain.ErrShareNotPending
	}

	share.Reject(rejecterID)

	if err := s.shareRepo.Update(ctx, share); err != nil {
		return nil, err
	}

	return share, nil
}

// RevokeTopicAccess revokes an approved share
func (s *ShareService) RevokeTopicAccess(ctx context.Context, shareID uuid.UUID) (*domain.KafkaTopicShare, error) {
	share, err := s.shareRepo.GetByID(ctx, shareID)
	if err != nil {
		return nil, err
	}
	if share == nil {
		return nil, domain.ErrShareNotFound
	}

	if share.Status != domain.ShareStatusApproved {
		return nil, domain.ErrShareNotApproved
	}

	share.Revoke()

	if err := s.shareRepo.Update(ctx, share); err != nil {
		return nil, err
	}

	return share, nil
}

// ListTopicShares returns topic shares based on filter
func (s *ShareService) ListTopicShares(ctx context.Context, filter ShareFilter) ([]*domain.KafkaTopicShare, error) {
	return s.shareRepo.List(ctx, filter)
}

// CreateServiceAccount creates a new service account
func (s *ShareService) CreateServiceAccount(ctx context.Context, req CreateServiceAccountRequest) (*domain.KafkaServiceAccount, error) {
	account := &domain.KafkaServiceAccount{
		ID:          uuid.New(),
		WorkspaceID: req.WorkspaceID,
		Name:        req.Name,
		Type:        req.Type,
		Status:      domain.ServiceAccountStatusActive,
		CreatedBy:   req.CreatedBy,
	}

	if err := account.Validate(); err != nil {
		return nil, err
	}

	if err := s.serviceAccountRepo.Create(ctx, account); err != nil {
		return nil, err
	}

	return account, nil
}

// ListServiceAccounts returns service accounts for a workspace
func (s *ShareService) ListServiceAccounts(ctx context.Context, workspaceID uuid.UUID) ([]*domain.KafkaServiceAccount, error) {
	return s.serviceAccountRepo.List(ctx, workspaceID)
}

// RevokeServiceAccount revokes a service account
func (s *ShareService) RevokeServiceAccount(ctx context.Context, accountID uuid.UUID) (*domain.KafkaServiceAccount, error) {
	account, err := s.serviceAccountRepo.GetByID(ctx, accountID)
	if err != nil {
		return nil, err
	}
	if account == nil {
		return nil, domain.ErrServiceAccountNotFound
	}

	account.Revoke()

	if err := s.serviceAccountRepo.Update(ctx, account); err != nil {
		return nil, err
	}

	return account, nil
}

// DiscoverTopics returns topics that are discoverable/shareable
func (s *ShareService) DiscoverTopics(ctx context.Context, req DiscoverTopicsRequest) ([]*domain.KafkaTopic, error) {
	// This would query topics with appropriate visibility settings
	// Implementation depends on policy evaluation
	return nil, nil // Placeholder
}

// ShareFilter defines filtering options for share queries
type ShareFilter struct {
	TopicID     *uuid.UUID
	WorkspaceID *uuid.UUID
	Status      *domain.ShareStatus
}

// RequestAccessRequest contains parameters for access request
type RequestAccessRequest struct {
	TopicID           uuid.UUID
	TargetWorkspaceID uuid.UUID
	Permission        domain.SharePermission
	RequestedBy       uuid.UUID
	Reason            string
	ExpiresInDays     int
}

// CreateServiceAccountRequest contains parameters for service account creation
type CreateServiceAccountRequest struct {
	WorkspaceID uuid.UUID
	Name        string
	Type        domain.ServiceAccountType
	CreatedBy   uuid.UUID
}

// DiscoverTopicsRequest contains parameters for topic discovery
type DiscoverTopicsRequest struct {
	WorkspaceID uuid.UUID
	Environment string
	SearchQuery string
}
