// temporal-workflows/internal/activities/topic_sync_activities.go
package activities

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/drewpayment/orbit/temporal-workflows/internal/clients"
)

// CreateTopicRecordInput is the input for creating a topic record in Orbit
type CreateTopicRecordInput struct {
	VirtualClusterID      string            `json:"virtualClusterId"`
	VirtualName           string            `json:"virtualName"`
	PhysicalName          string            `json:"physicalName"`
	Partitions            int               `json:"partitions"`
	ReplicationFactor     int               `json:"replicationFactor"`
	Config                map[string]string `json:"config"`
	CreatedByCredentialID string            `json:"createdByCredentialId,omitempty"`
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
	DeletedByCredentialID string `json:"deletedByCredentialId,omitempty"`
}

// UpdateTopicConfigInput is the input for updating topic configuration
type UpdateTopicConfigInput struct {
	VirtualClusterID      string            `json:"virtualClusterId"`
	VirtualName           string            `json:"virtualName"`
	Config                map[string]string `json:"config"`
	UpdatedByCredentialID string            `json:"updatedByCredentialId,omitempty"`
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
	payloadClient *clients.PayloadClient
	logger        *slog.Logger
}

// NewTopicSyncActivities creates a new TopicSyncActivities implementation
func NewTopicSyncActivities(payloadClient *clients.PayloadClient, logger *slog.Logger) *TopicSyncActivitiesImpl {
	return &TopicSyncActivitiesImpl{
		payloadClient: payloadClient,
		logger:        logger,
	}
}

// CreateTopicRecord creates a topic record in Orbit via Payload CMS API.
// This is called when a topic is created through the Bifrost gateway passthrough,
// so we need to sync the topic metadata back to Orbit.
func (a *TopicSyncActivitiesImpl) CreateTopicRecord(ctx context.Context, input CreateTopicRecordInput) (*CreateTopicRecordOutput, error) {
	a.logger.Info("CreateTopicRecord",
		slog.String("virtualClusterId", input.VirtualClusterID),
		slog.String("virtualName", input.VirtualName),
		slog.String("physicalName", input.PhysicalName),
	)

	// Check if topic already exists
	existingQuery := clients.NewQueryBuilder().
		WhereEquals("virtualCluster", input.VirtualClusterID).
		WhereEquals("name", input.VirtualName).
		Limit(1).
		Build()

	existingDocs, err := a.payloadClient.Find(ctx, "kafka-topics", existingQuery)
	if err != nil {
		return nil, fmt.Errorf("checking existing topic: %w", err)
	}

	if len(existingDocs) > 0 {
		// Topic already exists, return it
		existing := existingDocs[0]
		topicID, _ := existing["id"].(string)
		status, _ := existing["status"].(string)

		return &CreateTopicRecordOutput{
			TopicID: topicID,
			Status:  status,
		}, nil
	}

	// Convert config map to JSON-compatible format
	var configJSON any
	if input.Config != nil {
		configJSON = input.Config
	}

	// Create new topic record
	data := map[string]any{
		"virtualCluster":    input.VirtualClusterID,
		"name":              input.VirtualName,
		"physicalName":      input.PhysicalName,
		"partitions":        input.Partitions,
		"replicationFactor": input.ReplicationFactor,
		"config":            configJSON,
		"status":            "active",
		"source":            "gateway_passthrough",
	}

	if input.CreatedByCredentialID != "" {
		data["createdByCredential"] = input.CreatedByCredentialID
	}

	result, err := a.payloadClient.Create(ctx, "kafka-topics", data)
	if err != nil {
		return nil, fmt.Errorf("creating topic record: %w", err)
	}

	topicID, _ := result["id"].(string)

	return &CreateTopicRecordOutput{
		TopicID: topicID,
		Status:  "active",
	}, nil
}

// MarkTopicDeleted marks a topic as deleted in Orbit via Payload CMS API.
// This is called when a topic is deleted through the Bifrost gateway passthrough.
func (a *TopicSyncActivitiesImpl) MarkTopicDeleted(ctx context.Context, input MarkTopicDeletedInput) error {
	a.logger.Info("MarkTopicDeleted",
		slog.String("virtualClusterId", input.VirtualClusterID),
		slog.String("virtualName", input.VirtualName),
	)

	// Find the topic by virtualClusterId and virtualName
	query := clients.NewQueryBuilder().
		WhereEquals("virtualCluster", input.VirtualClusterID).
		WhereEquals("name", input.VirtualName).
		Limit(1).
		Build()

	docs, err := a.payloadClient.Find(ctx, "kafka-topics", query)
	if err != nil {
		return fmt.Errorf("finding topic: %w", err)
	}

	if len(docs) == 0 {
		// Topic not found in Orbit - this is okay, it may have been created
		// outside of Orbit's management
		a.logger.Warn("Topic not found in Orbit, skipping delete sync",
			slog.String("virtualName", input.VirtualName),
		)
		return nil
	}

	topicID, _ := docs[0]["id"].(string)

	// Update the topic status to deleted
	data := map[string]any{
		"status":    "deleted",
		"deletedAt": time.Now().Format(time.RFC3339),
	}

	if input.DeletedByCredentialID != "" {
		data["deletedByCredential"] = input.DeletedByCredentialID
	}

	if err := a.payloadClient.Update(ctx, "kafka-topics", topicID, data); err != nil {
		return fmt.Errorf("marking topic as deleted: %w", err)
	}

	return nil
}

// UpdateTopicConfig updates topic configuration in Orbit via Payload CMS API.
// This is called when topic config is changed through the Bifrost gateway passthrough.
func (a *TopicSyncActivitiesImpl) UpdateTopicConfig(ctx context.Context, input UpdateTopicConfigInput) error {
	a.logger.Info("UpdateTopicConfig",
		slog.String("virtualClusterId", input.VirtualClusterID),
		slog.String("virtualName", input.VirtualName),
	)

	// Find the topic by virtualClusterId and virtualName
	query := clients.NewQueryBuilder().
		WhereEquals("virtualCluster", input.VirtualClusterID).
		WhereEquals("name", input.VirtualName).
		Limit(1).
		Build()

	docs, err := a.payloadClient.Find(ctx, "kafka-topics", query)
	if err != nil {
		return fmt.Errorf("finding topic: %w", err)
	}

	if len(docs) == 0 {
		// Topic not found in Orbit
		a.logger.Warn("Topic not found in Orbit, skipping config sync",
			slog.String("virtualName", input.VirtualName),
		)
		return nil
	}

	topicID, _ := docs[0]["id"].(string)

	// Update the topic config
	data := map[string]any{
		"config":    input.Config,
		"updatedAt": time.Now().Format(time.RFC3339),
	}

	if input.UpdatedByCredentialID != "" {
		data["updatedByCredential"] = input.UpdatedByCredentialID
	}

	if err := a.payloadClient.Update(ctx, "kafka-topics", topicID, data); err != nil {
		return fmt.Errorf("updating topic config: %w", err)
	}

	return nil
}

// Ensure TopicSyncActivitiesImpl implements TopicSyncActivities
var _ TopicSyncActivities = (*TopicSyncActivitiesImpl)(nil)
