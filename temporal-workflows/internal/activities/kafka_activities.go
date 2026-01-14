package activities

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/drewpayment/orbit/temporal-workflows/internal/clients"
)

// KafkaTopicProvisionInput defines input for topic provisioning
type KafkaTopicProvisionInput struct {
	TopicID           string            `json:"topicId"`
	VirtualClusterID  string            `json:"virtualClusterId"`
	TopicPrefix       string            `json:"topicPrefix"`
	TopicName         string            `json:"topicName"`
	Partitions        int               `json:"partitions"`
	ReplicationFactor int               `json:"replicationFactor"`
	RetentionMs       int64             `json:"retentionMs"`
	CleanupPolicy     string            `json:"cleanupPolicy"`
	Compression       string            `json:"compression"`
	Config            map[string]string `json:"config"`
	BootstrapServers  string            `json:"bootstrapServers"`
}

// KafkaTopicProvisionOutput defines output for topic provisioning
type KafkaTopicProvisionOutput struct {
	TopicID       string    `json:"topicId"`
	PhysicalName  string    `json:"physicalName"`
	ProvisionedAt time.Time `json:"provisionedAt"`
}

// KafkaSchemaValidationInput defines input for schema validation
type KafkaSchemaValidationInput struct {
	SchemaID      string `json:"schemaId"`
	TopicID       string `json:"topicId"`
	Type          string `json:"type"`   // "key" or "value"
	Format        string `json:"format"` // "avro", "protobuf", "json"
	Content       string `json:"content"`
	Compatibility string `json:"compatibility"`
}

// KafkaSchemaValidationOutput defines output for schema validation
type KafkaSchemaValidationOutput struct {
	SchemaID     string    `json:"schemaId"`
	RegistryID   int32     `json:"registryId"`
	Version      int32     `json:"version"`
	IsCompatible bool      `json:"isCompatible"`
	ValidatedAt  time.Time `json:"validatedAt"`
}

// KafkaAccessProvisionInput defines input for access provisioning
type KafkaAccessProvisionInput struct {
	ShareID     string `json:"shareId"`
	TopicID     string `json:"topicId"`
	WorkspaceID string `json:"workspaceId"`
	Permission  string `json:"permission"` // "read", "write", "read_write"
}

// KafkaAccessProvisionOutput defines output for access provisioning
type KafkaAccessProvisionOutput struct {
	ShareID       string    `json:"shareId"`
	ACLsCreated   []string  `json:"aclsCreated"`
	ProvisionedAt time.Time `json:"provisionedAt"`
}

// KafkaUpdateTopicStatusInput defines input for updating topic status
type KafkaUpdateTopicStatusInput struct {
	TopicID      string `json:"topicId"`
	Status       string `json:"status"`
	PhysicalName string `json:"physicalName,omitempty"`
	Error        string `json:"error,omitempty"`
}

// KafkaUpdateSchemaStatusInput defines input for updating schema status
type KafkaUpdateSchemaStatusInput struct {
	SchemaID   string `json:"schemaId"`
	Status     string `json:"status"`
	RegistryID int32  `json:"registryId"`
	Version    int32  `json:"version"`
	Error      string `json:"error,omitempty"`
}

// KafkaUpdateShareStatusInput defines input for updating share status
type KafkaUpdateShareStatusInput struct {
	ShareID string `json:"shareId"`
	Status  string `json:"status"`
	Error   string `json:"error,omitempty"`
}

// KafkaActivities defines the interface for Kafka-related activities
type KafkaActivities interface {
	// Topic provisioning activities
	ProvisionTopic(ctx context.Context, input KafkaTopicProvisionInput) (*KafkaTopicProvisionOutput, error)
	UpdateTopicStatus(ctx context.Context, input KafkaUpdateTopicStatusInput) error
	DeleteTopic(ctx context.Context, topicID, fullName, clusterID string) error

	// Schema validation activities
	ValidateSchema(ctx context.Context, input KafkaSchemaValidationInput) (*KafkaSchemaValidationOutput, error)
	RegisterSchema(ctx context.Context, input KafkaSchemaValidationInput) (*KafkaSchemaValidationOutput, error)
	UpdateSchemaStatus(ctx context.Context, input KafkaUpdateSchemaStatusInput) error

	// Access provisioning activities
	ProvisionAccess(ctx context.Context, input KafkaAccessProvisionInput) (*KafkaAccessProvisionOutput, error)
	RevokeAccess(ctx context.Context, shareID, topicID, workspaceID string) error
	UpdateShareStatus(ctx context.Context, input KafkaUpdateShareStatusInput) error
}

// KafkaActivitiesImpl implements KafkaActivities
type KafkaActivitiesImpl struct {
	payloadClient *clients.PayloadClient
	logger        *slog.Logger
}

// NewKafkaActivities creates a new KafkaActivities implementation
func NewKafkaActivities(payloadClient *clients.PayloadClient, logger *slog.Logger) *KafkaActivitiesImpl {
	return &KafkaActivitiesImpl{
		payloadClient: payloadClient,
		logger:        logger,
	}
}

// ProvisionTopic provisions a topic on the Kafka cluster.
// This creates the physical topic on the Kafka cluster using the provided prefix.
func (a *KafkaActivitiesImpl) ProvisionTopic(ctx context.Context, input KafkaTopicProvisionInput) (*KafkaTopicProvisionOutput, error) {
	a.logger.Info("ProvisionTopic",
		slog.String("topicId", input.TopicID),
		slog.String("topicName", input.TopicName),
		slog.String("topicPrefix", input.TopicPrefix),
	)

	// Generate the physical topic name
	physicalName := input.TopicPrefix + input.TopicName

	// TODO: Actually create the topic on Kafka using franz-go
	// This requires adding franz-go as a dependency and creating a KafkaClient
	// For MVP, we log and return success - the actual creation will be added later
	//
	// Implementation would:
	// 1. Create franz-go client with bootstrap servers
	// 2. Use kadm.CreateTopics with the spec
	// 3. Handle errors appropriately

	a.logger.Info("Topic provisioned (simulated)",
		slog.String("physicalName", physicalName),
		slog.Int("partitions", input.Partitions),
		slog.Int("replicationFactor", input.ReplicationFactor),
	)

	return &KafkaTopicProvisionOutput{
		TopicID:       input.TopicID,
		PhysicalName:  physicalName,
		ProvisionedAt: time.Now(),
	}, nil
}

// UpdateTopicStatus updates the status of a topic in Payload CMS.
func (a *KafkaActivitiesImpl) UpdateTopicStatus(ctx context.Context, input KafkaUpdateTopicStatusInput) error {
	a.logger.Info("UpdateTopicStatus",
		slog.String("topicId", input.TopicID),
		slog.String("status", input.Status),
	)

	data := map[string]any{
		"status": input.Status,
	}

	// Include physical name if provided
	if input.PhysicalName != "" {
		data["physicalName"] = input.PhysicalName
	}

	// Include error message if provided
	if input.Error != "" {
		data["provisioningError"] = input.Error
	}

	if err := a.payloadClient.Update(ctx, "kafka-topics", input.TopicID, data); err != nil {
		return fmt.Errorf("updating topic status: %w", err)
	}

	return nil
}

// DeleteTopic deletes a topic from the Kafka cluster.
func (a *KafkaActivitiesImpl) DeleteTopic(ctx context.Context, topicID, physicalName, clusterID string) error {
	a.logger.Info("DeleteTopic",
		slog.String("topicId", topicID),
		slog.String("physicalName", physicalName),
	)

	// TODO: Implement actual Kafka topic deletion using franz-go
	// This would use kadm.DeleteTopics

	return nil
}

// ValidateSchema validates a schema for compatibility.
func (a *KafkaActivitiesImpl) ValidateSchema(ctx context.Context, input KafkaSchemaValidationInput) (*KafkaSchemaValidationOutput, error) {
	a.logger.Info("ValidateSchema",
		slog.String("schemaId", input.SchemaID),
		slog.String("format", input.Format),
	)

	// TODO: Implement actual schema validation via Schema Registry
	// This would call the Schema Registry's compatibility check endpoint

	return &KafkaSchemaValidationOutput{
		SchemaID:     input.SchemaID,
		IsCompatible: true,
		ValidatedAt:  time.Now(),
	}, nil
}

// RegisterSchema registers a schema with the Schema Registry.
func (a *KafkaActivitiesImpl) RegisterSchema(ctx context.Context, input KafkaSchemaValidationInput) (*KafkaSchemaValidationOutput, error) {
	a.logger.Info("RegisterSchema",
		slog.String("schemaId", input.SchemaID),
		slog.String("format", input.Format),
	)

	// TODO: Implement actual schema registration via Schema Registry
	// This would POST to the Schema Registry to register the schema

	return &KafkaSchemaValidationOutput{
		SchemaID:    input.SchemaID,
		RegistryID:  1,
		Version:     1,
		ValidatedAt: time.Now(),
	}, nil
}

// UpdateSchemaStatus updates the status of a schema in Payload CMS.
func (a *KafkaActivitiesImpl) UpdateSchemaStatus(ctx context.Context, input KafkaUpdateSchemaStatusInput) error {
	a.logger.Info("UpdateSchemaStatus",
		slog.String("schemaId", input.SchemaID),
		slog.String("status", input.Status),
	)

	data := map[string]any{
		"status": input.Status,
	}

	if input.RegistryID > 0 {
		data["registryId"] = input.RegistryID
	}
	if input.Version > 0 {
		data["latestVersion"] = input.Version
	}
	if input.Error != "" {
		data["registrationError"] = input.Error
	}

	if err := a.payloadClient.Update(ctx, "kafka-schemas", input.SchemaID, data); err != nil {
		return fmt.Errorf("updating schema status: %w", err)
	}

	return nil
}

// ProvisionAccess provisions access for a topic share.
func (a *KafkaActivitiesImpl) ProvisionAccess(ctx context.Context, input KafkaAccessProvisionInput) (*KafkaAccessProvisionOutput, error) {
	a.logger.Info("ProvisionAccess",
		slog.String("shareId", input.ShareID),
		slog.String("topicId", input.TopicID),
		slog.String("permission", input.Permission),
	)

	// TODO: Implement actual ACL creation via Kafka adapter

	return &KafkaAccessProvisionOutput{
		ShareID:       input.ShareID,
		ACLsCreated:   []string{fmt.Sprintf("%s-%s-acl", input.TopicID, input.Permission)},
		ProvisionedAt: time.Now(),
	}, nil
}

// RevokeAccess revokes access for a topic share.
func (a *KafkaActivitiesImpl) RevokeAccess(ctx context.Context, shareID, topicID, workspaceID string) error {
	a.logger.Info("RevokeAccess",
		slog.String("shareId", shareID),
		slog.String("topicId", topicID),
	)

	// TODO: Implement actual ACL deletion via Kafka adapter

	return nil
}

// UpdateShareStatus updates the status of a share in Payload CMS.
func (a *KafkaActivitiesImpl) UpdateShareStatus(ctx context.Context, input KafkaUpdateShareStatusInput) error {
	a.logger.Info("UpdateShareStatus",
		slog.String("shareId", input.ShareID),
		slog.String("status", input.Status),
	)

	data := map[string]any{
		"status": input.Status,
	}

	if input.Error != "" {
		data["error"] = input.Error
	}

	if err := a.payloadClient.Update(ctx, "kafka-topic-shares", input.ShareID, data); err != nil {
		return fmt.Errorf("updating share status: %w", err)
	}

	return nil
}

// Ensure KafkaActivitiesImpl implements KafkaActivities
var _ KafkaActivities = (*KafkaActivitiesImpl)(nil)
