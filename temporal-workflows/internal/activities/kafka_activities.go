package activities

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/drewpayment/orbit/services/kafka/pkg/adapters"
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
	payloadClient  *clients.PayloadClient
	adapterFactory *clients.KafkaAdapterFactory
	logger         *slog.Logger
}

// NewKafkaActivities creates a new KafkaActivities implementation
func NewKafkaActivities(payloadClient *clients.PayloadClient, adapterFactory *clients.KafkaAdapterFactory, logger *slog.Logger) *KafkaActivitiesImpl {
	return &KafkaActivitiesImpl{
		payloadClient:  payloadClient,
		adapterFactory: adapterFactory,
		logger:         logger,
	}
}

// getClusterConfigForTopic fetches the cluster connection config for a topic
func (a *KafkaActivitiesImpl) getClusterConfigForTopic(ctx context.Context, topicID string) (map[string]any, map[string]string, error) {
	// 1. Get the topic to find its virtual cluster
	topic, err := a.payloadClient.Get(ctx, "kafka-topics", topicID)
	if err != nil {
		return nil, nil, fmt.Errorf("fetching topic: %w", err)
	}

	// 2. Get virtual cluster ID
	vcID, ok := topic["virtualCluster"].(string)
	if !ok {
		// Try nested object
		if vc, ok := topic["virtualCluster"].(map[string]any); ok {
			vcID, _ = vc["id"].(string)
		}
	}
	if vcID == "" {
		return nil, nil, fmt.Errorf("topic has no virtual cluster")
	}

	// 3. Get virtual cluster to find physical cluster
	vc, err := a.payloadClient.Get(ctx, "kafka-virtual-clusters", vcID)
	if err != nil {
		return nil, nil, fmt.Errorf("fetching virtual cluster: %w", err)
	}

	// 4. Get physical cluster ID
	clusterID, ok := vc["cluster"].(string)
	if !ok {
		if cluster, ok := vc["cluster"].(map[string]any); ok {
			clusterID, _ = cluster["id"].(string)
		}
	}
	if clusterID == "" {
		return nil, nil, fmt.Errorf("virtual cluster has no physical cluster")
	}

	// 5. Get physical cluster config
	cluster, err := a.payloadClient.Get(ctx, "kafka-clusters", clusterID)
	if err != nil {
		return nil, nil, fmt.Errorf("fetching cluster: %w", err)
	}

	// 6. Extract connection config
	connectionConfig, ok := cluster["connectionConfig"].(map[string]any)
	if !ok {
		return nil, nil, fmt.Errorf("cluster has no connection config")
	}

	// 7. Extract credentials (if any)
	credentials := make(map[string]string)
	if creds, ok := cluster["credentials"].(map[string]any); ok {
		if u, ok := creds["username"].(string); ok {
			credentials["username"] = u
		}
		if p, ok := creds["password"].(string); ok {
			credentials["password"] = p
		}
	}

	return connectionConfig, credentials, nil
}

// getSchemaRegistryURL fetches the schema registry URL for a topic's cluster
func (a *KafkaActivitiesImpl) getSchemaRegistryURL(ctx context.Context, topicID string) (string, string, string, error) {
	// Get topic -> virtual cluster -> cluster -> schema registry
	topic, err := a.payloadClient.Get(ctx, "kafka-topics", topicID)
	if err != nil {
		return "", "", "", fmt.Errorf("fetching topic: %w", err)
	}

	vcID, ok := topic["virtualCluster"].(string)
	if !ok {
		if vc, ok := topic["virtualCluster"].(map[string]any); ok {
			vcID, _ = vc["id"].(string)
		}
	}
	if vcID == "" {
		return "", "", "", fmt.Errorf("topic has no virtual cluster")
	}

	vc, err := a.payloadClient.Get(ctx, "kafka-virtual-clusters", vcID)
	if err != nil {
		return "", "", "", fmt.Errorf("fetching virtual cluster: %w", err)
	}

	clusterID, ok := vc["cluster"].(string)
	if !ok {
		if cluster, ok := vc["cluster"].(map[string]any); ok {
			clusterID, _ = cluster["id"].(string)
		}
	}

	cluster, err := a.payloadClient.Get(ctx, "kafka-clusters", clusterID)
	if err != nil {
		return "", "", "", fmt.Errorf("fetching cluster: %w", err)
	}

	// Get schema registry URL from cluster
	schemaRegistryURL, _ := cluster["schemaRegistryUrl"].(string)
	if schemaRegistryURL == "" {
		return "", "", "", fmt.Errorf("cluster has no schema registry URL configured")
	}

	// Get credentials if configured
	var username, password string
	if creds, ok := cluster["schemaRegistryCredentials"].(map[string]any); ok {
		username, _ = creds["username"].(string)
		password, _ = creds["password"].(string)
	}

	return schemaRegistryURL, username, password, nil
}

// ProvisionTopic provisions a topic on the Kafka cluster.
func (a *KafkaActivitiesImpl) ProvisionTopic(ctx context.Context, input KafkaTopicProvisionInput) (*KafkaTopicProvisionOutput, error) {
	a.logger.Info("ProvisionTopic",
		slog.String("topicId", input.TopicID),
		slog.String("topicName", input.TopicName),
		slog.String("topicPrefix", input.TopicPrefix),
		slog.String("bootstrapServers", input.BootstrapServers),
	)

	// Generate the physical topic name
	physicalName := input.TopicPrefix + input.TopicName

	var connectionConfig map[string]any
	var credentials map[string]string

	// If bootstrap servers provided directly, use them; otherwise look up from topic's cluster
	if input.BootstrapServers != "" {
		connectionConfig = map[string]any{"bootstrapServers": input.BootstrapServers}
		credentials = map[string]string{}
	} else {
		// Look up cluster config from topic
		var err error
		connectionConfig, credentials, err = a.getClusterConfigForTopic(ctx, input.TopicID)
		if err != nil {
			return nil, fmt.Errorf("getting cluster config: %w", err)
		}
	}

	adapter, err := a.adapterFactory.CreateKafkaAdapterFromConfig(connectionConfig, credentials)
	if err != nil {
		return nil, fmt.Errorf("creating kafka adapter: %w", err)
	}
	defer adapter.Close()

	// Build topic config
	config := make(map[string]string)
	if input.RetentionMs > 0 {
		config["retention.ms"] = fmt.Sprintf("%d", input.RetentionMs)
	}
	if input.CleanupPolicy != "" {
		config["cleanup.policy"] = input.CleanupPolicy
	}
	if input.Compression != "" {
		config["compression.type"] = input.Compression
	}
	// Merge any additional config
	for k, v := range input.Config {
		config[k] = v
	}

	// Create topic spec
	spec := adapters.TopicSpec{
		Name:              physicalName,
		Partitions:        input.Partitions,
		ReplicationFactor: input.ReplicationFactor,
		Config:            config,
	}

	// Create the topic
	if err := adapter.CreateTopic(ctx, spec); err != nil {
		return nil, fmt.Errorf("creating topic: %w", err)
	}

	a.logger.Info("Topic provisioned successfully",
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
		slog.String("clusterId", clusterID),
	)

	// Get cluster config
	connectionConfig, credentials, err := a.getClusterConfigForTopic(ctx, topicID)
	if err != nil {
		return fmt.Errorf("getting cluster config: %w", err)
	}

	// Create adapter
	adapter, err := a.adapterFactory.CreateKafkaAdapterFromConfig(connectionConfig, credentials)
	if err != nil {
		return fmt.Errorf("creating kafka adapter: %w", err)
	}
	defer adapter.Close()

	// Delete the topic
	if err := adapter.DeleteTopic(ctx, physicalName); err != nil {
		return fmt.Errorf("deleting topic: %w", err)
	}

	a.logger.Info("Topic deleted successfully", slog.String("physicalName", physicalName))

	return nil
}

// ValidateSchema validates a schema for compatibility.
func (a *KafkaActivitiesImpl) ValidateSchema(ctx context.Context, input KafkaSchemaValidationInput) (*KafkaSchemaValidationOutput, error) {
	a.logger.Info("ValidateSchema",
		slog.String("schemaId", input.SchemaID),
		slog.String("topicId", input.TopicID),
		slog.String("format", input.Format),
	)

	// Get schema registry URL from cluster config
	registryURL, username, password, err := a.getSchemaRegistryURL(ctx, input.TopicID)
	if err != nil {
		return nil, fmt.Errorf("getting schema registry URL: %w", err)
	}

	// Create schema registry adapter
	adapter, err := a.adapterFactory.CreateSchemaRegistryAdapterFromURL(registryURL, username, password)
	if err != nil {
		return nil, fmt.Errorf("creating schema registry adapter: %w", err)
	}

	// Get topic name for subject
	topic, err := a.payloadClient.Get(ctx, "kafka-topics", input.TopicID)
	if err != nil {
		return nil, fmt.Errorf("fetching topic: %w", err)
	}

	topicName, _ := topic["name"].(string)
	if topicName == "" {
		return nil, fmt.Errorf("topic has no name")
	}

	subject := fmt.Sprintf("%s-%s", topicName, input.Type) // e.g., "my-topic-value"

	// Check compatibility
	schemaSpec := adapters.SchemaSpec{
		Schema:     input.Content,
		SchemaType: mapSchemaFormat(input.Format),
	}

	compatible, err := adapter.CheckCompatibility(ctx, subject, schemaSpec)
	if err != nil {
		return nil, fmt.Errorf("checking compatibility: %w", err)
	}

	a.logger.Info("Schema validation completed",
		slog.String("subject", subject),
		slog.Bool("compatible", compatible),
	)

	return &KafkaSchemaValidationOutput{
		SchemaID:     input.SchemaID,
		IsCompatible: compatible,
		ValidatedAt:  time.Now(),
	}, nil
}

// mapSchemaFormat maps our format strings to Schema Registry format
func mapSchemaFormat(format string) string {
	switch format {
	case "avro":
		return "AVRO"
	case "protobuf":
		return "PROTOBUF"
	case "json":
		return "JSON"
	default:
		return "AVRO"
	}
}

// RegisterSchema registers a schema with the Schema Registry.
func (a *KafkaActivitiesImpl) RegisterSchema(ctx context.Context, input KafkaSchemaValidationInput) (*KafkaSchemaValidationOutput, error) {
	a.logger.Info("RegisterSchema",
		slog.String("schemaId", input.SchemaID),
		slog.String("topicId", input.TopicID),
		slog.String("format", input.Format),
	)

	// Get schema registry URL from cluster config
	registryURL, username, password, err := a.getSchemaRegistryURL(ctx, input.TopicID)
	if err != nil {
		return nil, fmt.Errorf("getting schema registry URL: %w", err)
	}

	// Create schema registry adapter
	adapter, err := a.adapterFactory.CreateSchemaRegistryAdapterFromURL(registryURL, username, password)
	if err != nil {
		return nil, fmt.Errorf("creating schema registry adapter: %w", err)
	}

	// Get topic name for subject
	topic, err := a.payloadClient.Get(ctx, "kafka-topics", input.TopicID)
	if err != nil {
		return nil, fmt.Errorf("fetching topic: %w", err)
	}

	topicName, _ := topic["name"].(string)
	if topicName == "" {
		return nil, fmt.Errorf("topic has no name")
	}

	subject := fmt.Sprintf("%s-%s", topicName, input.Type)

	// Register schema
	schemaSpec := adapters.SchemaSpec{
		Schema:     input.Content,
		SchemaType: mapSchemaFormat(input.Format),
	}

	result, err := adapter.RegisterSchema(ctx, subject, schemaSpec)
	if err != nil {
		return nil, fmt.Errorf("registering schema: %w", err)
	}

	a.logger.Info("Schema registered successfully",
		slog.String("subject", subject),
		slog.Int("registryId", result.ID),
		slog.Int("version", result.Version),
	)

	return &KafkaSchemaValidationOutput{
		SchemaID:    input.SchemaID,
		RegistryID:  int32(result.ID),
		Version:     int32(result.Version),
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

	// Get cluster config from topic
	connectionConfig, credentials, err := a.getClusterConfigForTopic(ctx, input.TopicID)
	if err != nil {
		return nil, fmt.Errorf("getting cluster config: %w", err)
	}

	// Create adapter
	adapter, err := a.adapterFactory.CreateKafkaAdapterFromConfig(connectionConfig, credentials)
	if err != nil {
		return nil, fmt.Errorf("creating kafka adapter: %w", err)
	}
	defer adapter.Close()

	// Get topic details for physical name
	topic, err := a.payloadClient.Get(ctx, "kafka-topics", input.TopicID)
	if err != nil {
		return nil, fmt.Errorf("fetching topic: %w", err)
	}

	physicalName, _ := topic["physicalName"].(string)
	if physicalName == "" {
		// Fallback to name with prefix
		name, _ := topic["name"].(string)
		prefix, _ := topic["prefix"].(string)
		physicalName = prefix + name
	}

	// Get workspace to find service account principal
	workspace, err := a.payloadClient.Get(ctx, "workspaces", input.WorkspaceID)
	if err != nil {
		return nil, fmt.Errorf("fetching workspace: %w", err)
	}

	// Get service account name from workspace's Kafka config
	var principal string
	if kafkaConfig, ok := workspace["kafkaConfig"].(map[string]any); ok {
		if sa, ok := kafkaConfig["serviceAccountName"].(string); ok {
			principal = "User:" + sa
		}
	}
	if principal == "" {
		// Fallback to workspace slug
		if slug, ok := workspace["slug"].(string); ok {
			principal = "User:" + slug
		} else {
			return nil, fmt.Errorf("workspace has no service account configured")
		}
	}

	// Build ACLs based on permission level
	acls := buildACLsForPermission(principal, physicalName, input.Permission)

	// Create each ACL
	var created []string
	for _, acl := range acls {
		if err := adapter.CreateACL(ctx, acl); err != nil {
			return nil, fmt.Errorf("creating ACL for %s: %w", acl.Operation, err)
		}
		created = append(created, fmt.Sprintf("%s-%s-%s", acl.ResourceName, acl.Principal, acl.Operation))
	}

	a.logger.Info("Access provisioned successfully",
		slog.Int("aclCount", len(created)),
	)

	return &KafkaAccessProvisionOutput{
		ShareID:       input.ShareID,
		ACLsCreated:   created,
		ProvisionedAt: time.Now(),
	}, nil
}

// buildACLsForPermission creates ACL specs for a given permission level
func buildACLsForPermission(principal, topicName, permission string) []adapters.ACLSpec {
	var acls []adapters.ACLSpec

	// Always add DESCRIBE
	acls = append(acls, adapters.ACLSpec{
		ResourceType:   adapters.ResourceTypeTopic,
		ResourceName:   topicName,
		PatternType:    adapters.PatternTypeLiteral,
		Principal:      principal,
		Host:           "*",
		Operation:      adapters.ACLOperationDescribe,
		PermissionType: adapters.ACLPermissionAllow,
	})

	if permission == "read" || permission == "read_write" {
		acls = append(acls, adapters.ACLSpec{
			ResourceType:   adapters.ResourceTypeTopic,
			ResourceName:   topicName,
			PatternType:    adapters.PatternTypeLiteral,
			Principal:      principal,
			Host:           "*",
			Operation:      adapters.ACLOperationRead,
			PermissionType: adapters.ACLPermissionAllow,
		})
	}

	if permission == "write" || permission == "read_write" {
		acls = append(acls, adapters.ACLSpec{
			ResourceType:   adapters.ResourceTypeTopic,
			ResourceName:   topicName,
			PatternType:    adapters.PatternTypeLiteral,
			Principal:      principal,
			Host:           "*",
			Operation:      adapters.ACLOperationWrite,
			PermissionType: adapters.ACLPermissionAllow,
		})
	}

	return acls
}

// RevokeAccess revokes access for a topic share.
func (a *KafkaActivitiesImpl) RevokeAccess(ctx context.Context, shareID, topicID, workspaceID string) error {
	a.logger.Info("RevokeAccess",
		slog.String("shareId", shareID),
		slog.String("topicId", topicID),
		slog.String("workspaceId", workspaceID),
	)

	// Get cluster config from topic
	connectionConfig, credentials, err := a.getClusterConfigForTopic(ctx, topicID)
	if err != nil {
		return fmt.Errorf("getting cluster config: %w", err)
	}

	// Create adapter
	adapter, err := a.adapterFactory.CreateKafkaAdapterFromConfig(connectionConfig, credentials)
	if err != nil {
		return fmt.Errorf("creating kafka adapter: %w", err)
	}
	defer adapter.Close()

	// Get topic details
	topic, err := a.payloadClient.Get(ctx, "kafka-topics", topicID)
	if err != nil {
		return fmt.Errorf("fetching topic: %w", err)
	}

	physicalName, _ := topic["physicalName"].(string)
	if physicalName == "" {
		name, _ := topic["name"].(string)
		prefix, _ := topic["prefix"].(string)
		physicalName = prefix + name
	}

	// Get workspace service account
	workspace, err := a.payloadClient.Get(ctx, "workspaces", workspaceID)
	if err != nil {
		return fmt.Errorf("fetching workspace: %w", err)
	}

	var principal string
	if kafkaConfig, ok := workspace["kafkaConfig"].(map[string]any); ok {
		if sa, ok := kafkaConfig["serviceAccountName"].(string); ok {
			principal = "User:" + sa
		}
	}
	if principal == "" {
		if slug, ok := workspace["slug"].(string); ok {
			principal = "User:" + slug
		} else {
			return fmt.Errorf("workspace has no service account configured")
		}
	}

	// Delete all ACLs for this principal on this topic
	operations := []adapters.ACLOperation{
		adapters.ACLOperationDescribe,
		adapters.ACLOperationRead,
		adapters.ACLOperationWrite,
	}

	for _, op := range operations {
		acl := adapters.ACLSpec{
			ResourceType:   adapters.ResourceTypeTopic,
			ResourceName:   physicalName,
			PatternType:    adapters.PatternTypeLiteral,
			Principal:      principal,
			Host:           "*",
			Operation:      op,
			PermissionType: adapters.ACLPermissionAllow,
		}

		if err := adapter.DeleteACL(ctx, acl); err != nil {
			// Log but continue - ACL might not exist
			a.logger.Warn("Failed to delete ACL (may not exist)",
				slog.String("operation", string(op)),
				slog.Any("error", err),
			)
		}
	}

	a.logger.Info("Access revoked successfully", slog.String("topicId", topicID))

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
