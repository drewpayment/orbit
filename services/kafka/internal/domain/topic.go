package domain

import (
	"time"

	"github.com/google/uuid"
)

// TopicStatus represents the lifecycle state of a topic
type TopicStatus string

const (
	TopicStatusPendingApproval TopicStatus = "pending-approval"
	TopicStatusProvisioning    TopicStatus = "provisioning"
	TopicStatusActive          TopicStatus = "active"
	TopicStatusFailed          TopicStatus = "failed"
	TopicStatusDeleting        TopicStatus = "deleting"
)

// CleanupPolicy represents Kafka topic cleanup policy
type CleanupPolicy string

const (
	CleanupPolicyDelete  CleanupPolicy = "delete"
	CleanupPolicyCompact CleanupPolicy = "compact"
	CleanupPolicyBoth    CleanupPolicy = "compact,delete"
)

// CompressionType represents Kafka topic compression
type CompressionType string

const (
	CompressionNone   CompressionType = "none"
	CompressionGzip   CompressionType = "gzip"
	CompressionSnappy CompressionType = "snappy"
	CompressionLz4    CompressionType = "lz4"
	CompressionZstd   CompressionType = "zstd"
)

// KafkaTopic represents a Kafka topic owned by a workspace
type KafkaTopic struct {
	ID                uuid.UUID         `json:"id"`
	WorkspaceID       uuid.UUID         `json:"workspaceId"`
	Name              string            `json:"name"`
	Description       string            `json:"description"`
	Environment       string            `json:"environment"`
	ClusterID         uuid.UUID         `json:"clusterId"`
	Partitions        int               `json:"partitions"`
	ReplicationFactor int               `json:"replicationFactor"`
	RetentionMs       int64             `json:"retentionMs"`
	CleanupPolicy     CleanupPolicy     `json:"cleanupPolicy"`
	Compression       CompressionType   `json:"compression"`
	Config            map[string]string `json:"config"`
	Status            TopicStatus       `json:"status"`
	WorkflowID        string            `json:"workflowId"`
	ApprovalRequired  bool              `json:"approvalRequired"`
	ApprovedBy        *uuid.UUID        `json:"approvedBy"`
	ApprovedAt        *time.Time        `json:"approvedAt"`
	CreatedAt         time.Time         `json:"createdAt"`
	UpdatedAt         time.Time         `json:"updatedAt"`
}

// NewKafkaTopic creates a new topic with defaults
func NewKafkaTopic(workspaceID uuid.UUID, name, environment string) *KafkaTopic {
	now := time.Now()
	return &KafkaTopic{
		ID:                uuid.New(),
		WorkspaceID:       workspaceID,
		Name:              name,
		Environment:       environment,
		Partitions:        3,
		ReplicationFactor: 3,
		RetentionMs:       604800000, // 7 days
		CleanupPolicy:     CleanupPolicyDelete,
		Compression:       CompressionNone,
		Config:            make(map[string]string),
		Status:            TopicStatusPendingApproval,
		CreatedAt:         now,
		UpdatedAt:         now,
	}
}

// Validate checks topic invariants
func (t *KafkaTopic) Validate() error {
	if t.Name == "" {
		return ErrTopicNameRequired
	}
	if t.WorkspaceID == uuid.Nil {
		return ErrTopicWorkspaceRequired
	}
	if t.Environment == "" {
		return ErrTopicEnvironmentRequired
	}
	if t.Partitions < 1 {
		return ErrTopicPartitionsInvalid
	}
	if t.ReplicationFactor < 1 {
		return ErrTopicReplicationInvalid
	}
	return nil
}

// Approve marks the topic as approved
func (t *KafkaTopic) Approve(approvedBy uuid.UUID) {
	now := time.Now()
	t.ApprovedBy = &approvedBy
	t.ApprovedAt = &now
	t.Status = TopicStatusProvisioning
	t.UpdatedAt = now
}

// MarkActive marks the topic as successfully provisioned
func (t *KafkaTopic) MarkActive() {
	t.Status = TopicStatusActive
	t.UpdatedAt = time.Now()
}

// MarkFailed marks the topic as failed
func (t *KafkaTopic) MarkFailed() {
	t.Status = TopicStatusFailed
	t.UpdatedAt = time.Now()
}

// CanBeDeleted checks if topic can be deleted
func (t *KafkaTopic) CanBeDeleted() bool {
	return t.Status == TopicStatusActive || t.Status == TopicStatusFailed
}
