# Temporal Activities Phase 2: Kafka Adapter Integration - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire real Kafka and Schema Registry adapters into Temporal activities (ProvisionTopic, DeleteTopic, ValidateSchema, RegisterSchema, ProvisionAccess, RevokeAccess)

**Architecture:** Activities use an adapter factory to create Kafka/Schema Registry adapters on-demand from cluster config looked up via PayloadClient. The `services/kafka` module is imported directly via Go module replace directive.

**Tech Stack:** Go 1.21+, franz-go (Kafka), Temporal SDK, Payload CMS REST API

---

## Design Review Notes

**Issues with original design document fixed in this plan:**

1. **Connection info source**: Schema/ACL activities don't receive `BootstrapServers` or `SchemaRegistryURL` in workflow input. Activities must look up cluster config from the topic via PayloadClient.

2. **Simplified factory**: Instead of the factory pattern proposed in the design, we use a simpler approach where activities fetch cluster config and create adapters directly.

3. **Input types**: Keep existing input types unchanged. Activities internally resolve cluster connection details from TopicID.

---

## Task 1: Add services/kafka Module Dependency

**Files:**
- Modify: `temporal-workflows/go.mod`

**Step 1: Add replace directive and dependency**

```bash
cd temporal-workflows && go mod edit -replace github.com/drewpayment/orbit/services/kafka=../services/kafka
```

**Step 2: Add the require**

```bash
cd temporal-workflows && go get github.com/drewpayment/orbit/services/kafka
```

**Step 3: Tidy modules**

Run: `cd temporal-workflows && go mod tidy`
Expected: No errors, go.mod updated with services/kafka dependency

**Step 4: Verify build**

Run: `cd temporal-workflows && go build ./...`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add temporal-workflows/go.mod temporal-workflows/go.sum
git commit -m "chore(temporal): add services/kafka module dependency"
```

---

## Task 2: Create Adapter Factory

**Files:**
- Create: `temporal-workflows/internal/clients/kafka_adapter_factory.go`
- Test: `temporal-workflows/internal/clients/kafka_adapter_factory_test.go`

**Step 1: Write the failing test**

```go
// temporal-workflows/internal/clients/kafka_adapter_factory_test.go
package clients

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestKafkaAdapterFactory_CreateKafkaAdapterFromConfig(t *testing.T) {
	factory := NewKafkaAdapterFactory(nil) // nil PayloadClient for unit test

	config := map[string]any{
		"bootstrapServers": "localhost:9092",
		"securityProtocol": "PLAINTEXT",
	}
	credentials := map[string]string{}

	adapter, err := factory.CreateKafkaAdapterFromConfig(config, credentials)
	require.NoError(t, err)
	assert.NotNil(t, adapter)
}

func TestKafkaAdapterFactory_CreateSchemaRegistryAdapterFromURL(t *testing.T) {
	factory := NewKafkaAdapterFactory(nil)

	adapter, err := factory.CreateSchemaRegistryAdapterFromURL("http://localhost:8081", "", "")
	require.NoError(t, err)
	assert.NotNil(t, adapter)
}

func TestKafkaAdapterFactory_CreateKafkaAdapterFromConfig_MissingBootstrap(t *testing.T) {
	factory := NewKafkaAdapterFactory(nil)

	config := map[string]any{
		"securityProtocol": "PLAINTEXT",
	}
	credentials := map[string]string{}

	_, err := factory.CreateKafkaAdapterFromConfig(config, credentials)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "bootstrapServers")
}
```

**Step 2: Run test to verify it fails**

Run: `cd temporal-workflows && go test -v ./internal/clients/ -run TestKafkaAdapterFactory`
Expected: FAIL - file/package doesn't exist yet

**Step 3: Write minimal implementation**

```go
// temporal-workflows/internal/clients/kafka_adapter_factory.go
package clients

import (
	"fmt"

	"github.com/drewpayment/orbit/services/kafka/internal/adapters"
	"github.com/drewpayment/orbit/services/kafka/internal/adapters/apache"
	"github.com/drewpayment/orbit/services/kafka/internal/adapters/schema"
)

// KafkaAdapterFactory creates Kafka and Schema Registry adapters
type KafkaAdapterFactory struct {
	payloadClient *PayloadClient
}

// NewKafkaAdapterFactory creates a new adapter factory
func NewKafkaAdapterFactory(payloadClient *PayloadClient) *KafkaAdapterFactory {
	return &KafkaAdapterFactory{payloadClient: payloadClient}
}

// CreateKafkaAdapterFromConfig creates a Kafka adapter from connection config
func (f *KafkaAdapterFactory) CreateKafkaAdapterFromConfig(config map[string]any, credentials map[string]string) (adapters.KafkaAdapter, error) {
	// Extract bootstrap servers
	bootstrapServers, ok := config["bootstrapServers"].(string)
	if !ok || bootstrapServers == "" {
		// Try alternate key
		if bs, ok := config["bootstrap.servers"].(string); ok {
			bootstrapServers = bs
		}
	}
	if bootstrapServers == "" {
		return nil, fmt.Errorf("bootstrapServers or bootstrap.servers required in connection config")
	}

	// Extract optional config
	securityProtocol, _ := config["securityProtocol"].(string)
	saslMechanism, _ := config["saslMechanism"].(string)

	// Build connection config map for adapter
	connConfig := map[string]string{
		"bootstrapServers": bootstrapServers,
		"securityProtocol": securityProtocol,
		"saslMechanism":    saslMechanism,
	}

	return apache.NewClientFromCluster(connConfig, credentials)
}

// CreateSchemaRegistryAdapterFromURL creates a Schema Registry adapter from URL
func (f *KafkaAdapterFactory) CreateSchemaRegistryAdapterFromURL(url, username, password string) (adapters.SchemaRegistryAdapter, error) {
	return schema.NewClient(schema.Config{
		URL:      url,
		Username: username,
		Password: password,
	})
}
```

**Step 4: Run test to verify it passes**

Run: `cd temporal-workflows && go test -v ./internal/clients/ -run TestKafkaAdapterFactory`
Expected: PASS

**Step 5: Commit**

```bash
git add temporal-workflows/internal/clients/kafka_adapter_factory.go temporal-workflows/internal/clients/kafka_adapter_factory_test.go
git commit -m "feat(temporal): add KafkaAdapterFactory for adapter creation"
```

---

## Task 3: Add Cluster Config Lookup to KafkaActivitiesImpl

**Files:**
- Modify: `temporal-workflows/internal/activities/kafka_activities.go`
- Test: `temporal-workflows/internal/activities/kafka_activities_test.go`

**Step 1: Write the failing test for cluster config lookup**

```go
// Add to kafka_activities_test.go
func TestKafkaActivities_getClusterConfig(t *testing.T) {
	// This test verifies the helper method extracts cluster config from topic
	// Will be implemented with mock PayloadClient
}
```

**Step 2: Update KafkaActivitiesImpl struct**

Add the adapter factory to the struct:

```go
// temporal-workflows/internal/activities/kafka_activities.go

// Update imports
import (
	// ... existing imports ...
	"github.com/drewpayment/orbit/services/kafka/internal/adapters"
)

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
```

**Step 3: Add helper method for cluster lookup**

```go
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
```

**Step 4: Run tests**

Run: `cd temporal-workflows && go test -v ./internal/activities/...`
Expected: PASS (or skip if mocking needed)

**Step 5: Commit**

```bash
git add temporal-workflows/internal/activities/kafka_activities.go
git commit -m "feat(temporal): add cluster config lookup helpers to KafkaActivities"
```

---

## Task 4: Implement ProvisionTopic with Real Adapter

**Files:**
- Modify: `temporal-workflows/internal/activities/kafka_activities.go`

**Step 1: Update ProvisionTopic implementation**

Replace the stubbed implementation:

```go
// ProvisionTopic provisions a topic on the Kafka cluster.
func (a *KafkaActivitiesImpl) ProvisionTopic(ctx context.Context, input KafkaTopicProvisionInput) (*KafkaTopicProvisionOutput, error) {
	a.logger.Info("ProvisionTopic",
		slog.String("topicId", input.TopicID),
		slog.String("topicName", input.TopicName),
		slog.String("topicPrefix", input.TopicPrefix),
	)

	// Generate the physical topic name
	physicalName := input.TopicPrefix + input.TopicName

	// Create adapter from bootstrap servers in input
	if input.BootstrapServers == "" {
		return nil, fmt.Errorf("bootstrap servers required")
	}

	adapter, err := a.adapterFactory.CreateKafkaAdapterFromConfig(
		map[string]any{"bootstrapServers": input.BootstrapServers},
		map[string]string{},
	)
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
```

**Step 2: Run build to verify compilation**

Run: `cd temporal-workflows && go build ./...`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add temporal-workflows/internal/activities/kafka_activities.go
git commit -m "feat(temporal): implement ProvisionTopic with real Kafka adapter"
```

---

## Task 5: Implement DeleteTopic with Real Adapter

**Files:**
- Modify: `temporal-workflows/internal/activities/kafka_activities.go`

**Step 1: Update DeleteTopic implementation**

```go
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
```

**Step 2: Run build**

Run: `cd temporal-workflows && go build ./...`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add temporal-workflows/internal/activities/kafka_activities.go
git commit -m "feat(temporal): implement DeleteTopic with real Kafka adapter"
```

---

## Task 6: Implement ValidateSchema with Real Adapter

**Files:**
- Modify: `temporal-workflows/internal/activities/kafka_activities.go`

**Step 1: Update ValidateSchema implementation**

```go
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

	// Generate subject name (convention: topicName-key or topicName-value)
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
```

**Step 2: Run build**

Run: `cd temporal-workflows && go build ./...`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add temporal-workflows/internal/activities/kafka_activities.go
git commit -m "feat(temporal): implement ValidateSchema with real Schema Registry adapter"
```

---

## Task 7: Implement RegisterSchema with Real Adapter

**Files:**
- Modify: `temporal-workflows/internal/activities/kafka_activities.go`

**Step 1: Update RegisterSchema implementation**

```go
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
```

**Step 2: Run build**

Run: `cd temporal-workflows && go build ./...`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add temporal-workflows/internal/activities/kafka_activities.go
git commit -m "feat(temporal): implement RegisterSchema with real Schema Registry adapter"
```

---

## Task 8: Implement ProvisionAccess with Real Adapter

**Files:**
- Modify: `temporal-workflows/internal/activities/kafka_activities.go`

**Step 1: Add import for adapters package**

Ensure this import is present:

```go
import (
	"github.com/drewpayment/orbit/services/kafka/internal/adapters"
)
```

**Step 2: Update ProvisionAccess implementation**

```go
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

	// Get topic details for physical name and workspace service account
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
```

**Step 3: Run build**

Run: `cd temporal-workflows && go build ./...`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add temporal-workflows/internal/activities/kafka_activities.go
git commit -m "feat(temporal): implement ProvisionAccess with real Kafka adapter"
```

---

## Task 9: Implement RevokeAccess with Real Adapter

**Files:**
- Modify: `temporal-workflows/internal/activities/kafka_activities.go`

**Step 1: Update RevokeAccess implementation**

```go
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
	// We delete all operations (DESCRIBE, READ, WRITE) regardless of what was granted
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
```

**Step 2: Run build**

Run: `cd temporal-workflows && go build ./...`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add temporal-workflows/internal/activities/kafka_activities.go
git commit -m "feat(temporal): implement RevokeAccess with real Kafka adapter"
```

---

## Task 10: Update Worker Main to Use Adapter Factory

**Files:**
- Modify: `temporal-workflows/cmd/worker/main.go`

**Step 1: Update KafkaActivities initialization**

Find the section that creates KafkaActivities and update it:

```go
// Create adapter factory for Kafka activities
kafkaAdapterFactory := internalClients.NewKafkaAdapterFactory(kafkaPayloadClient)

// Create and register Kafka activities (with adapter factory)
kafkaActivities := activities.NewKafkaActivities(kafkaPayloadClient, kafkaAdapterFactory, logger)
```

**Step 2: Run build**

Run: `cd temporal-workflows && go build ./cmd/worker`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add temporal-workflows/cmd/worker/main.go
git commit -m "feat(temporal): wire adapter factory into worker initialization"
```

---

## Task 11: Add Unit Tests for Activity Implementations

**Files:**
- Create/Modify: `temporal-workflows/internal/activities/kafka_activities_test.go`

**Step 1: Create mock interfaces**

```go
// temporal-workflows/internal/activities/kafka_activities_test.go
package activities

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"

	"github.com/drewpayment/orbit/services/kafka/internal/adapters"
)

// MockKafkaAdapter mocks the KafkaAdapter interface
type MockKafkaAdapter struct {
	mock.Mock
}

func (m *MockKafkaAdapter) ValidateConnection(ctx context.Context) error {
	args := m.Called(ctx)
	return args.Error(0)
}

func (m *MockKafkaAdapter) Close() error {
	args := m.Called()
	return args.Error(0)
}

func (m *MockKafkaAdapter) CreateTopic(ctx context.Context, spec adapters.TopicSpec) error {
	args := m.Called(ctx, spec)
	return args.Error(0)
}

func (m *MockKafkaAdapter) DeleteTopic(ctx context.Context, topicName string) error {
	args := m.Called(ctx, topicName)
	return args.Error(0)
}

func (m *MockKafkaAdapter) DescribeTopic(ctx context.Context, topicName string) (*adapters.TopicInfo, error) {
	args := m.Called(ctx, topicName)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*adapters.TopicInfo), args.Error(1)
}

func (m *MockKafkaAdapter) UpdateTopicConfig(ctx context.Context, topicName string, config map[string]string) error {
	args := m.Called(ctx, topicName, config)
	return args.Error(0)
}

func (m *MockKafkaAdapter) ListTopics(ctx context.Context) ([]string, error) {
	args := m.Called(ctx)
	return args.Get(0).([]string), args.Error(1)
}

func (m *MockKafkaAdapter) CreateACL(ctx context.Context, acl adapters.ACLSpec) error {
	args := m.Called(ctx, acl)
	return args.Error(0)
}

func (m *MockKafkaAdapter) DeleteACL(ctx context.Context, acl adapters.ACLSpec) error {
	args := m.Called(ctx, acl)
	return args.Error(0)
}

func (m *MockKafkaAdapter) ListACLs(ctx context.Context) ([]adapters.ACLInfo, error) {
	args := m.Called(ctx)
	return args.Get(0).([]adapters.ACLInfo), args.Error(1)
}

func (m *MockKafkaAdapter) GetTopicMetrics(ctx context.Context, topicName string) (*adapters.TopicMetrics, error) {
	args := m.Called(ctx, topicName)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*adapters.TopicMetrics), args.Error(1)
}

func (m *MockKafkaAdapter) GetConsumerGroupLag(ctx context.Context, groupID string) (*adapters.ConsumerGroupLag, error) {
	args := m.Called(ctx, groupID)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*adapters.ConsumerGroupLag), args.Error(1)
}

func (m *MockKafkaAdapter) ListConsumerGroups(ctx context.Context) ([]adapters.ConsumerGroupInfo, error) {
	args := m.Called(ctx)
	return args.Get(0).([]adapters.ConsumerGroupInfo), args.Error(1)
}

// Test buildACLsForPermission helper
func TestBuildACLsForPermission(t *testing.T) {
	tests := []struct {
		name       string
		principal  string
		topicName  string
		permission string
		wantCount  int
		wantOps    []adapters.ACLOperation
	}{
		{
			name:       "read permission",
			principal:  "User:test-user",
			topicName:  "test-topic",
			permission: "read",
			wantCount:  2, // DESCRIBE + READ
			wantOps:    []adapters.ACLOperation{adapters.ACLOperationDescribe, adapters.ACLOperationRead},
		},
		{
			name:       "write permission",
			principal:  "User:test-user",
			topicName:  "test-topic",
			permission: "write",
			wantCount:  2, // DESCRIBE + WRITE
			wantOps:    []adapters.ACLOperation{adapters.ACLOperationDescribe, adapters.ACLOperationWrite},
		},
		{
			name:       "read_write permission",
			principal:  "User:test-user",
			topicName:  "test-topic",
			permission: "read_write",
			wantCount:  3, // DESCRIBE + READ + WRITE
			wantOps:    []adapters.ACLOperation{adapters.ACLOperationDescribe, adapters.ACLOperationRead, adapters.ACLOperationWrite},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			acls := buildACLsForPermission(tt.principal, tt.topicName, tt.permission)

			assert.Len(t, acls, tt.wantCount)

			// Verify each expected operation is present
			gotOps := make(map[adapters.ACLOperation]bool)
			for _, acl := range acls {
				gotOps[acl.Operation] = true
				assert.Equal(t, tt.principal, acl.Principal)
				assert.Equal(t, tt.topicName, acl.ResourceName)
				assert.Equal(t, adapters.ResourceTypeTopic, acl.ResourceType)
				assert.Equal(t, adapters.PatternTypeLiteral, acl.PatternType)
				assert.Equal(t, adapters.ACLPermissionAllow, acl.PermissionType)
			}

			for _, op := range tt.wantOps {
				assert.True(t, gotOps[op], "expected operation %s not found", op)
			}
		})
	}
}

func TestMapSchemaFormat(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"avro", "AVRO"},
		{"protobuf", "PROTOBUF"},
		{"json", "JSON"},
		{"unknown", "AVRO"}, // default
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			assert.Equal(t, tt.expected, mapSchemaFormat(tt.input))
		})
	}
}
```

**Step 2: Run tests**

Run: `cd temporal-workflows && go test -v ./internal/activities/ -run Test`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add temporal-workflows/internal/activities/kafka_activities_test.go
git commit -m "test(temporal): add unit tests for Kafka activity helpers"
```

---

## Task 12: Verify Full Build and Run Tests

**Files:** None (verification only)

**Step 1: Run full build**

Run: `cd temporal-workflows && go build ./...`
Expected: Build succeeds with no errors

**Step 2: Run all tests**

Run: `cd temporal-workflows && go test -v -race ./...`
Expected: All tests PASS

**Step 3: Run linter**

Run: `cd temporal-workflows && golangci-lint run`
Expected: No errors or warnings

**Step 4: Final commit with all changes**

```bash
git add -A
git status
# Verify only expected files are staged
git commit -m "feat(temporal): complete Phase 2 Kafka adapter integration

Wire real Kafka and Schema Registry adapters into Temporal activities:
- ProvisionTopic: Creates topics via franz-go
- DeleteTopic: Deletes topics via franz-go
- ValidateSchema: Validates schemas via Schema Registry API
- RegisterSchema: Registers schemas via Schema Registry API
- ProvisionAccess: Creates ACLs via franz-go
- RevokeAccess: Deletes ACLs via franz-go

Includes:
- KafkaAdapterFactory for creating adapters from config
- Cluster config lookup helpers via PayloadClient
- Unit tests for ACL building and format mapping

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Out of Scope

- Integration tests against real Redpanda (tested manually)
- TopicShareActivities (uses Bifrost, not direct Kafka)
- DecommissioningActivities (separate phase)
- Schema Registry authentication configuration in Payload CMS

---

## Next Steps After Completion

1. Test the workflows end-to-end with a running Redpanda cluster
2. Add Payload CMS fields for schema registry URL and credentials on kafka-clusters collection
3. Consider adding consumer group ACLs for read permissions
4. Add metrics/observability for adapter operations
