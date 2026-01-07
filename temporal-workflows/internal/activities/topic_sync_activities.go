// temporal-workflows/internal/activities/topic_sync_activities.go
package activities

import (
	"context"
	"log/slog"
)

// CreateTopicRecordInput is the input for creating a topic record in Orbit
type CreateTopicRecordInput struct {
	VirtualClusterID      string            `json:"virtualClusterId"`
	VirtualName           string            `json:"virtualName"`
	PhysicalName          string            `json:"physicalName"`
	Partitions            int               `json:"partitions"`
	ReplicationFactor     int               `json:"replicationFactor"`
	Config                map[string]string `json:"config"`
	CreatedByCredentialID string            `json:"createdByCredentialId"`
}

// CreateTopicRecordOutput is the output of creating a topic record
type CreateTopicRecordOutput struct {
	TopicID string `json:"topicId"`
	Status  string `json:"status"`
}

// MarkTopicDeletedInput is the input for marking a topic as deleted
type MarkTopicDeletedInput struct {
	VirtualClusterID      string `json:"virtualClusterId"`
	VirtualName           string `json:"virtualName"`
	PhysicalName          string `json:"physicalName"`
	DeletedByCredentialID string `json:"deletedByCredentialId"`
}

// UpdateTopicConfigInput is the input for updating topic configuration
type UpdateTopicConfigInput struct {
	VirtualClusterID      string            `json:"virtualClusterId"`
	VirtualName           string            `json:"virtualName"`
	Config                map[string]string `json:"config"`
	UpdatedByCredentialID string            `json:"updatedByCredentialId"`
}

// TopicSyncActivities defines the interface for topic sync activities
type TopicSyncActivities interface {
	// CreateTopicRecord creates a topic record in Orbit for a topic created via gateway passthrough
	CreateTopicRecord(ctx context.Context, input CreateTopicRecordInput) (*CreateTopicRecordOutput, error)

	// MarkTopicDeleted marks a topic as deleted in Orbit for a topic deleted via gateway passthrough
	MarkTopicDeleted(ctx context.Context, input MarkTopicDeletedInput) error

	// UpdateTopicConfig updates topic configuration in Orbit for a topic modified via gateway passthrough
	UpdateTopicConfig(ctx context.Context, input UpdateTopicConfigInput) error
}

// TopicSyncActivitiesImpl implements TopicSyncActivities
type TopicSyncActivitiesImpl struct {
	payloadURL string
	logger     *slog.Logger
}

// NewTopicSyncActivities creates a new TopicSyncActivities implementation
func NewTopicSyncActivities(payloadURL string, logger *slog.Logger) *TopicSyncActivitiesImpl {
	return &TopicSyncActivitiesImpl{
		payloadURL: payloadURL,
		logger:     logger,
	}
}

// CreateTopicRecord creates a topic record in Orbit via Payload CMS API
func (a *TopicSyncActivitiesImpl) CreateTopicRecord(ctx context.Context, input CreateTopicRecordInput) (*CreateTopicRecordOutput, error) {
	a.logger.Info("CreateTopicRecord",
		"virtualClusterId", input.VirtualClusterID,
		"virtualName", input.VirtualName,
		"physicalName", input.PhysicalName,
		"partitions", input.Partitions,
		"replicationFactor", input.ReplicationFactor,
		"createdByCredentialId", input.CreatedByCredentialID)

	// TODO: Call Payload CMS API to create topic record
	// POST /api/kafka-topics
	// {
	//   "virtualClusterId": input.VirtualClusterID,
	//   "virtualName": input.VirtualName,
	//   "physicalName": input.PhysicalName,
	//   "partitions": input.Partitions,
	//   "replicationFactor": input.ReplicationFactor,
	//   "config": input.Config,
	//   "createdByCredentialId": input.CreatedByCredentialID,
	//   "status": "active",
	//   "source": "gateway_passthrough"
	// }

	return &CreateTopicRecordOutput{
		TopicID: "placeholder-topic-id",
		Status:  "active",
	}, nil
}

// MarkTopicDeleted marks a topic as deleted in Orbit via Payload CMS API
func (a *TopicSyncActivitiesImpl) MarkTopicDeleted(ctx context.Context, input MarkTopicDeletedInput) error {
	a.logger.Info("MarkTopicDeleted",
		"virtualClusterId", input.VirtualClusterID,
		"virtualName", input.VirtualName,
		"physicalName", input.PhysicalName,
		"deletedByCredentialId", input.DeletedByCredentialID)

	// TODO: Call Payload CMS API to mark topic as deleted
	// First, find the topic by virtualClusterId and virtualName
	// GET /api/kafka-topics?where[virtualClusterId][equals]=...&where[virtualName][equals]=...
	// Then, update the topic status to deleted
	// PATCH /api/kafka-topics/:id
	// {
	//   "status": "deleted",
	//   "deletedAt": now,
	//   "deletedByCredentialId": input.DeletedByCredentialID
	// }

	return nil
}

// UpdateTopicConfig updates topic configuration in Orbit via Payload CMS API
func (a *TopicSyncActivitiesImpl) UpdateTopicConfig(ctx context.Context, input UpdateTopicConfigInput) error {
	a.logger.Info("UpdateTopicConfig",
		"virtualClusterId", input.VirtualClusterID,
		"virtualName", input.VirtualName,
		"config", input.Config,
		"updatedByCredentialId", input.UpdatedByCredentialID)

	// TODO: Call Payload CMS API to update topic config
	// First, find the topic by virtualClusterId and virtualName
	// GET /api/kafka-topics?where[virtualClusterId][equals]=...&where[virtualName][equals]=...
	// Then, update the topic config
	// PATCH /api/kafka-topics/:id
	// {
	//   "config": input.Config,
	//   "updatedAt": now,
	//   "updatedByCredentialId": input.UpdatedByCredentialID
	// }

	return nil
}
