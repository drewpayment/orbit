package domain

import (
	"time"

	"github.com/google/uuid"
)

// ClusterValidationStatus represents the validation state of a cluster
type ClusterValidationStatus string

const (
	ClusterValidationStatusPending ClusterValidationStatus = "pending"
	ClusterValidationStatusValid   ClusterValidationStatus = "valid"
	ClusterValidationStatusInvalid ClusterValidationStatus = "invalid"
)

// KafkaCluster represents a registered Kafka cluster
type KafkaCluster struct {
	ID               uuid.UUID               `json:"id"`
	Name             string                  `json:"name"`
	ProviderID       string                  `json:"providerId"`
	ConnectionConfig map[string]string       `json:"connectionConfig"`
	ValidationStatus ClusterValidationStatus `json:"validationStatus"`
	LastValidatedAt  *time.Time              `json:"lastValidatedAt"`
	CreatedAt        time.Time               `json:"createdAt"`
	UpdatedAt        time.Time               `json:"updatedAt"`
}

// NewKafkaCluster creates a new cluster with defaults
func NewKafkaCluster(name, providerID string, config map[string]string) *KafkaCluster {
	now := time.Now()
	return &KafkaCluster{
		ID:               uuid.New(),
		Name:             name,
		ProviderID:       providerID,
		ConnectionConfig: config,
		ValidationStatus: ClusterValidationStatusPending,
		CreatedAt:        now,
		UpdatedAt:        now,
	}
}

// Validate checks cluster invariants
func (c *KafkaCluster) Validate() error {
	if c.Name == "" {
		return ErrClusterNameRequired
	}
	if c.ProviderID == "" {
		return ErrClusterProviderRequired
	}
	return nil
}

// MarkValid updates the cluster status to valid
func (c *KafkaCluster) MarkValid() {
	now := time.Now()
	c.ValidationStatus = ClusterValidationStatusValid
	c.LastValidatedAt = &now
	c.UpdatedAt = now
}

// MarkInvalid updates the cluster status to invalid
func (c *KafkaCluster) MarkInvalid() {
	now := time.Now()
	c.ValidationStatus = ClusterValidationStatusInvalid
	c.LastValidatedAt = &now
	c.UpdatedAt = now
}

// KafkaEnvironmentMapping maps an environment to a cluster
type KafkaEnvironmentMapping struct {
	ID          uuid.UUID         `json:"id"`
	Environment string            `json:"environment"`
	ClusterID   uuid.UUID         `json:"clusterId"`
	RoutingRule map[string]string `json:"routingRule"`
	Priority    int               `json:"priority"`
	IsDefault   bool              `json:"isDefault"`
	CreatedAt   time.Time         `json:"createdAt"`
}

// NewEnvironmentMapping creates a new mapping
func NewEnvironmentMapping(env string, clusterID uuid.UUID, isDefault bool) *KafkaEnvironmentMapping {
	return &KafkaEnvironmentMapping{
		ID:          uuid.New(),
		Environment: env,
		ClusterID:   clusterID,
		RoutingRule: make(map[string]string),
		Priority:    0,
		IsDefault:   isDefault,
		CreatedAt:   time.Now(),
	}
}

// Validate checks mapping invariants
func (m *KafkaEnvironmentMapping) Validate() error {
	if m.Environment == "" {
		return ErrTopicEnvironmentRequired
	}
	return nil
}
