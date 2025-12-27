package domain

import (
	"time"

	"github.com/google/uuid"
)

// SharePermission represents the access level granted
type SharePermission string

const (
	SharePermissionRead      SharePermission = "read"
	SharePermissionWrite     SharePermission = "write"
	SharePermissionReadWrite SharePermission = "read-write"
)

// ShareStatus represents the share request state
type ShareStatus string

const (
	ShareStatusPendingRequest ShareStatus = "pending-request"
	ShareStatusApproved       ShareStatus = "approved"
	ShareStatusRejected       ShareStatus = "rejected"
	ShareStatusRevoked        ShareStatus = "revoked"
)

// ShareWithType represents what entity the topic is shared with
type ShareWithType string

const (
	ShareWithTypeWorkspace ShareWithType = "workspace"
	ShareWithTypeUser      ShareWithType = "user"
)

// KafkaTopicShare represents a cross-workspace access grant
type KafkaTopicShare struct {
	ID                    uuid.UUID       `json:"id"`
	TopicID               uuid.UUID       `json:"topicId"`
	SharedWithType        ShareWithType   `json:"sharedWithType"`
	SharedWithWorkspaceID *uuid.UUID      `json:"sharedWithWorkspaceId"`
	SharedWithUserID      *uuid.UUID      `json:"sharedWithUserId"`
	Permission            SharePermission `json:"permission"`
	Status                ShareStatus     `json:"status"`
	RequestedBy           uuid.UUID       `json:"requestedBy"`
	RequestedAt           time.Time       `json:"requestedAt"`
	Justification         string          `json:"justification"`
	ApprovedBy            *uuid.UUID      `json:"approvedBy"`
	ApprovedAt            *time.Time      `json:"approvedAt"`
	ExpiresAt             *time.Time      `json:"expiresAt"`
	CreatedAt             time.Time       `json:"createdAt"`
	UpdatedAt             time.Time       `json:"updatedAt"`
}

// NewTopicShareRequest creates a new share request for a workspace
func NewTopicShareRequest(topicID, requestingWorkspaceID, requestedBy uuid.UUID, permission SharePermission, justification string) *KafkaTopicShare {
	now := time.Now()
	return &KafkaTopicShare{
		ID:                    uuid.New(),
		TopicID:               topicID,
		SharedWithType:        ShareWithTypeWorkspace,
		SharedWithWorkspaceID: &requestingWorkspaceID,
		Permission:            permission,
		Status:                ShareStatusPendingRequest,
		RequestedBy:           requestedBy,
		RequestedAt:           now,
		Justification:         justification,
		CreatedAt:             now,
		UpdatedAt:             now,
	}
}

// Approve approves the share request
func (s *KafkaTopicShare) Approve(approvedBy uuid.UUID, expiresAt *time.Time) {
	now := time.Now()
	s.Status = ShareStatusApproved
	s.ApprovedBy = &approvedBy
	s.ApprovedAt = &now
	s.ExpiresAt = expiresAt
	s.UpdatedAt = now
}

// Reject rejects the share request
func (s *KafkaTopicShare) Reject(rejectedBy uuid.UUID) {
	now := time.Now()
	s.Status = ShareStatusRejected
	s.ApprovedBy = &rejectedBy // Using ApprovedBy to track who rejected
	s.ApprovedAt = &now
	s.UpdatedAt = now
}

// Revoke revokes an approved share
func (s *KafkaTopicShare) Revoke() {
	s.Status = ShareStatusRevoked
	s.UpdatedAt = time.Now()
}

// IsActive returns true if the share is active and not expired
func (s *KafkaTopicShare) IsActive() bool {
	if s.Status != ShareStatusApproved {
		return false
	}
	if s.ExpiresAt != nil && time.Now().After(*s.ExpiresAt) {
		return false
	}
	return true
}

// CanRead returns true if the share grants read access
func (s *KafkaTopicShare) CanRead() bool {
	return s.IsActive() && (s.Permission == SharePermissionRead || s.Permission == SharePermissionReadWrite)
}

// CanWrite returns true if the share grants write access
func (s *KafkaTopicShare) CanWrite() bool {
	return s.IsActive() && (s.Permission == SharePermissionWrite || s.Permission == SharePermissionReadWrite)
}
