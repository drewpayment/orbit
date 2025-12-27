package domain

import (
	"time"

	"github.com/google/uuid"
)

// ServiceAccountType represents the access type
type ServiceAccountType string

const (
	ServiceAccountTypeProducer         ServiceAccountType = "producer"
	ServiceAccountTypeConsumer         ServiceAccountType = "consumer"
	ServiceAccountTypeProducerConsumer ServiceAccountType = "producer-consumer"
	ServiceAccountTypeAdmin            ServiceAccountType = "admin"
)

// ServiceAccountStatus represents the account state
type ServiceAccountStatus string

const (
	ServiceAccountStatusActive  ServiceAccountStatus = "active"
	ServiceAccountStatusRevoked ServiceAccountStatus = "revoked"
)

// KafkaServiceAccount represents a service account for Kafka access
type KafkaServiceAccount struct {
	ID          uuid.UUID            `json:"id"`
	WorkspaceID uuid.UUID            `json:"workspaceId"`
	Name        string               `json:"name"`
	Type        ServiceAccountType   `json:"type"`
	Status      ServiceAccountStatus `json:"status"`
	CreatedBy   uuid.UUID            `json:"createdBy"`
	CreatedAt   time.Time            `json:"createdAt"`
	UpdatedAt   time.Time            `json:"updatedAt"`
}

// NewKafkaServiceAccount creates a new service account
func NewKafkaServiceAccount(workspaceID uuid.UUID, name string, accountType ServiceAccountType, createdBy uuid.UUID) *KafkaServiceAccount {
	now := time.Now()
	return &KafkaServiceAccount{
		ID:          uuid.New(),
		WorkspaceID: workspaceID,
		Name:        name,
		Type:        accountType,
		Status:      ServiceAccountStatusActive,
		CreatedBy:   createdBy,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
}

// Validate checks service account invariants
func (s *KafkaServiceAccount) Validate() error {
	if s.Name == "" {
		return ErrServiceAccountNameRequired
	}
	if s.WorkspaceID == uuid.Nil {
		return ErrServiceAccountWorkspaceRequired
	}
	return nil
}

// Revoke marks the service account as revoked
func (s *KafkaServiceAccount) Revoke() {
	s.Status = ServiceAccountStatusRevoked
	s.UpdatedAt = time.Now()
}

// IsActive returns true if the account is active
func (s *KafkaServiceAccount) IsActive() bool {
	return s.Status == ServiceAccountStatusActive
}

// CanProduce returns true if the account can produce messages
func (s *KafkaServiceAccount) CanProduce() bool {
	return s.IsActive() && (s.Type == ServiceAccountTypeProducer ||
		s.Type == ServiceAccountTypeProducerConsumer ||
		s.Type == ServiceAccountTypeAdmin)
}

// CanConsume returns true if the account can consume messages
func (s *KafkaServiceAccount) CanConsume() bool {
	return s.IsActive() && (s.Type == ServiceAccountTypeConsumer ||
		s.Type == ServiceAccountTypeProducerConsumer ||
		s.Type == ServiceAccountTypeAdmin)
}
