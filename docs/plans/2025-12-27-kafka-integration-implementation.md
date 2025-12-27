# Kafka Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a unified Kafka cluster management integration for Orbit that abstracts away provider details, enables self-service topic creation with policy-based guardrails, cross-workspace sharing, and usage tracking for billing.

**Architecture:** Go microservice (`kafka-service`) with provider adapters (Confluent, Apache, MSK), Temporal workflows for async operations, Payload CMS collections for data storage, and a Terraform provider for IaC workflows. Frontend provides workspace-scoped management and a global topic catalog.

**Tech Stack:** Go 1.21+, gRPC/Connect, Temporal, Payload CMS 3.0, Next.js 15, TypeScript, Protocol Buffers, franz-go (Kafka client), terraform-plugin-framework

---

## Phase 1: Foundation - Proto Definitions & Domain Model

### Task 1.1: Create Kafka Proto Definitions

**Files:**
- Create: `proto/idp/kafka/v1/kafka.proto`

**Step 1: Write the proto file with core message types**

```protobuf
syntax = "proto3";

package idp.kafka.v1;

option go_package = "github.com/drewpayment/orbit/proto/gen/go/idp/kafka/v1;kafkav1";

import "google/protobuf/timestamp.proto";

// ============================================================================
// Enums
// ============================================================================

enum ProviderType {
  PROVIDER_TYPE_UNSPECIFIED = 0;
  PROVIDER_TYPE_APACHE_KAFKA = 1;
  PROVIDER_TYPE_CONFLUENT_CLOUD = 2;
  PROVIDER_TYPE_AWS_MSK = 3;
  PROVIDER_TYPE_REDPANDA = 4;
  PROVIDER_TYPE_AIVEN = 5;
}

enum ClusterValidationStatus {
  CLUSTER_VALIDATION_STATUS_UNSPECIFIED = 0;
  CLUSTER_VALIDATION_STATUS_PENDING = 1;
  CLUSTER_VALIDATION_STATUS_VALID = 2;
  CLUSTER_VALIDATION_STATUS_INVALID = 3;
}

enum TopicStatus {
  TOPIC_STATUS_UNSPECIFIED = 0;
  TOPIC_STATUS_PENDING_APPROVAL = 1;
  TOPIC_STATUS_PROVISIONING = 2;
  TOPIC_STATUS_ACTIVE = 3;
  TOPIC_STATUS_FAILED = 4;
  TOPIC_STATUS_DELETING = 5;
}

enum SchemaFormat {
  SCHEMA_FORMAT_UNSPECIFIED = 0;
  SCHEMA_FORMAT_AVRO = 1;
  SCHEMA_FORMAT_PROTOBUF = 2;
  SCHEMA_FORMAT_JSON = 3;
}

enum SchemaCompatibility {
  SCHEMA_COMPATIBILITY_UNSPECIFIED = 0;
  SCHEMA_COMPATIBILITY_BACKWARD = 1;
  SCHEMA_COMPATIBILITY_FORWARD = 2;
  SCHEMA_COMPATIBILITY_FULL = 3;
  SCHEMA_COMPATIBILITY_NONE = 4;
}

enum ServiceAccountType {
  SERVICE_ACCOUNT_TYPE_UNSPECIFIED = 0;
  SERVICE_ACCOUNT_TYPE_PRODUCER = 1;
  SERVICE_ACCOUNT_TYPE_CONSUMER = 2;
  SERVICE_ACCOUNT_TYPE_PRODUCER_CONSUMER = 3;
  SERVICE_ACCOUNT_TYPE_ADMIN = 4;
}

enum ShareStatus {
  SHARE_STATUS_UNSPECIFIED = 0;
  SHARE_STATUS_PENDING_REQUEST = 1;
  SHARE_STATUS_APPROVED = 2;
  SHARE_STATUS_REJECTED = 3;
  SHARE_STATUS_REVOKED = 4;
}

enum SharePermission {
  SHARE_PERMISSION_UNSPECIFIED = 0;
  SHARE_PERMISSION_READ = 1;
  SHARE_PERMISSION_WRITE = 2;
  SHARE_PERMISSION_READ_WRITE = 3;
}

enum TopicVisibility {
  TOPIC_VISIBILITY_UNSPECIFIED = 0;
  TOPIC_VISIBILITY_PRIVATE = 1;
  TOPIC_VISIBILITY_DISCOVERABLE = 2;
  TOPIC_VISIBILITY_PUBLIC = 3;
}

enum PolicyScope {
  POLICY_SCOPE_UNSPECIFIED = 0;
  POLICY_SCOPE_PLATFORM = 1;
  POLICY_SCOPE_WORKSPACE = 2;
}

enum SharePolicyScope {
  SHARE_POLICY_SCOPE_UNSPECIFIED = 0;
  SHARE_POLICY_SCOPE_ALL_TOPICS = 1;
  SHARE_POLICY_SCOPE_TOPIC_PATTERN = 2;
  SHARE_POLICY_SCOPE_SPECIFIC_TOPIC = 3;
}

// ============================================================================
// Core Messages
// ============================================================================

message KafkaProvider {
  string id = 1;
  string name = 2;
  string display_name = 3;
  string adapter_type = 4;
  repeated string required_config_fields = 5;
  ProviderCapabilities capabilities = 6;
  string documentation_url = 7;
  string icon_url = 8;
}

message ProviderCapabilities {
  bool schema_registry = 1;
  bool transactions = 2;
  bool quotas_api = 3;
  bool metrics_api = 4;
}

message KafkaCluster {
  string id = 1;
  string name = 2;
  string provider_id = 3;
  map<string, string> connection_config = 4;
  ClusterValidationStatus validation_status = 5;
  google.protobuf.Timestamp last_validated_at = 6;
  google.protobuf.Timestamp created_at = 7;
  google.protobuf.Timestamp updated_at = 8;
}

message KafkaEnvironmentMapping {
  string id = 1;
  string environment = 2;
  string cluster_id = 3;
  map<string, string> routing_rule = 4;
  int32 priority = 5;
  bool is_default = 6;
}

message SchemaRegistry {
  string id = 1;
  string url = 2;
  string subject_naming_template = 3;
  SchemaCompatibility default_compatibility = 4;
  repeated EnvironmentCompatibilityOverride environment_overrides = 5;
}

message EnvironmentCompatibilityOverride {
  string environment = 1;
  SchemaCompatibility compatibility = 2;
}

message KafkaTopic {
  string id = 1;
  string workspace_id = 2;
  string name = 3;
  string environment = 4;
  string cluster_id = 5;
  int32 partitions = 6;
  int32 replication_factor = 7;
  int64 retention_ms = 8;
  string cleanup_policy = 9;
  string compression = 10;
  map<string, string> config = 11;
  TopicStatus status = 12;
  string workflow_id = 13;
  bool approval_required = 14;
  string approved_by = 15;
  google.protobuf.Timestamp approved_at = 16;
  google.protobuf.Timestamp created_at = 17;
  google.protobuf.Timestamp updated_at = 18;
  string description = 19;
}

message KafkaSchema {
  string id = 1;
  string workspace_id = 2;
  string topic_id = 3;
  string type = 4; // "key" or "value"
  string subject = 5;
  SchemaFormat format = 6;
  string content = 7;
  int32 version = 8;
  int32 schema_id = 9;
  SchemaCompatibility compatibility = 10;
  string status = 11;
  google.protobuf.Timestamp created_at = 12;
  google.protobuf.Timestamp updated_at = 13;
}

message KafkaServiceAccount {
  string id = 1;
  string workspace_id = 2;
  string name = 3;
  ServiceAccountType type = 4;
  string status = 5;
  string created_by = 6;
  google.protobuf.Timestamp created_at = 7;
}

message KafkaTopicShare {
  string id = 1;
  string topic_id = 2;
  string shared_with_type = 3; // "workspace" or "user"
  string shared_with_workspace_id = 4;
  string shared_with_user_id = 5;
  SharePermission permission = 6;
  ShareStatus status = 7;
  string requested_by = 8;
  google.protobuf.Timestamp requested_at = 9;
  string justification = 10;
  string approved_by = 11;
  google.protobuf.Timestamp approved_at = 12;
  google.protobuf.Timestamp expires_at = 13;
}

message KafkaTopicPolicy {
  string id = 1;
  PolicyScope scope = 2;
  string workspace_id = 3;
  string environment = 4;
  string naming_pattern = 5;
  repeated string auto_approve_patterns = 6;
  PartitionLimits partition_limits = 7;
  RetentionLimits retention_limits = 8;
  bool require_schema = 9;
  repeated string require_approval_for = 10;
}

message PartitionLimits {
  int32 min = 1;
  int32 max = 2;
}

message RetentionLimits {
  int64 min_ms = 1;
  int64 max_ms = 2;
}

message KafkaTopicSharePolicy {
  string id = 1;
  string workspace_id = 2;
  SharePolicyScope scope = 3;
  string topic_pattern = 4;
  string topic_id = 5;
  string environment = 6;
  TopicVisibility visibility = 7;
  AutoApproveConfig auto_approve = 8;
  SharePermission default_permission = 9;
  bool require_justification = 10;
  int32 access_ttl_days = 11;
}

message AutoApproveConfig {
  repeated string environments = 1;
  repeated SharePermission permissions = 2;
  repeated string workspace_whitelist = 3;
  bool same_tenant_only = 4;
}

message KafkaUsageMetrics {
  string id = 1;
  string topic_id = 2;
  string period = 3;
  string period_type = 4;
  int64 bytes_in = 5;
  int64 bytes_out = 6;
  int64 message_count_in = 7;
  int64 message_count_out = 8;
  int64 storage_bytes = 9;
  int32 partition_count = 10;
}

message KafkaConsumerGroup {
  string id = 1;
  string group_id = 2;
  string cluster_id = 3;
  repeated string topic_ids = 4;
  string service_account_id = 5;
  string workspace_id = 6;
  int64 current_lag = 7;
  google.protobuf.Timestamp last_seen = 8;
  google.protobuf.Timestamp last_updated = 9;
}

message KafkaClientActivity {
  string id = 1;
  string client_id = 2;
  string service_account_id = 3;
  string workspace_id = 4;
  string topic_id = 5;
  string direction = 6; // "produce" or "consume"
  string consumer_group_id = 7;
  int64 bytes_transferred = 8;
  google.protobuf.Timestamp last_seen = 9;
}

// ============================================================================
// Service Definition
// ============================================================================

service KafkaService {
  // Cluster Management (Platform Admin)
  rpc ListProviders(ListProvidersRequest) returns (ListProvidersResponse);
  rpc RegisterCluster(RegisterClusterRequest) returns (RegisterClusterResponse);
  rpc ValidateCluster(ValidateClusterRequest) returns (ValidateClusterResponse);
  rpc ListClusters(ListClustersRequest) returns (ListClustersResponse);
  rpc DeleteCluster(DeleteClusterRequest) returns (DeleteClusterResponse);

  // Environment Mapping (Platform Admin)
  rpc CreateEnvironmentMapping(CreateEnvironmentMappingRequest) returns (CreateEnvironmentMappingResponse);
  rpc ListEnvironmentMappings(ListEnvironmentMappingsRequest) returns (ListEnvironmentMappingsResponse);
  rpc DeleteEnvironmentMapping(DeleteEnvironmentMappingRequest) returns (DeleteEnvironmentMappingResponse);

  // Topic Management (Workspace Scoped)
  rpc CreateTopic(CreateTopicRequest) returns (CreateTopicResponse);
  rpc GetTopic(GetTopicRequest) returns (GetTopicResponse);
  rpc ListTopics(ListTopicsRequest) returns (ListTopicsResponse);
  rpc UpdateTopic(UpdateTopicRequest) returns (UpdateTopicResponse);
  rpc DeleteTopic(DeleteTopicRequest) returns (DeleteTopicResponse);
  rpc ApproveTopic(ApproveTopicRequest) returns (ApproveTopicResponse);

  // Schema Management
  rpc RegisterSchema(RegisterSchemaRequest) returns (RegisterSchemaResponse);
  rpc GetSchema(GetSchemaRequest) returns (GetSchemaResponse);
  rpc ListSchemas(ListSchemasRequest) returns (ListSchemasResponse);
  rpc CheckSchemaCompatibility(CheckSchemaCompatibilityRequest) returns (CheckSchemaCompatibilityResponse);

  // Service Account Management
  rpc CreateServiceAccount(CreateServiceAccountRequest) returns (CreateServiceAccountResponse);
  rpc ListServiceAccounts(ListServiceAccountsRequest) returns (ListServiceAccountsResponse);
  rpc RevokeServiceAccount(RevokeServiceAccountRequest) returns (RevokeServiceAccountResponse);

  // Topic Sharing
  rpc RequestTopicAccess(RequestTopicAccessRequest) returns (RequestTopicAccessResponse);
  rpc ApproveTopicAccess(ApproveTopicAccessRequest) returns (ApproveTopicAccessResponse);
  rpc RevokeTopicAccess(RevokeTopicAccessRequest) returns (RevokeTopicAccessResponse);
  rpc ListTopicShares(ListTopicSharesRequest) returns (ListTopicSharesResponse);

  // Discovery (Global Catalog)
  rpc DiscoverTopics(DiscoverTopicsRequest) returns (DiscoverTopicsResponse);

  // Metrics & Lineage
  rpc GetTopicMetrics(GetTopicMetricsRequest) returns (GetTopicMetricsResponse);
  rpc GetTopicLineage(GetTopicLineageRequest) returns (GetTopicLineageResponse);
}

// ============================================================================
// Request/Response Messages
// ============================================================================

// Cluster Management
message ListProvidersRequest {}
message ListProvidersResponse {
  repeated KafkaProvider providers = 1;
}

message RegisterClusterRequest {
  string name = 1;
  string provider_id = 2;
  map<string, string> connection_config = 3;
  map<string, string> credentials = 4;
}
message RegisterClusterResponse {
  KafkaCluster cluster = 1;
  string error = 2;
}

message ValidateClusterRequest {
  string cluster_id = 1;
}
message ValidateClusterResponse {
  bool valid = 1;
  string error = 2;
}

message ListClustersRequest {}
message ListClustersResponse {
  repeated KafkaCluster clusters = 1;
}

message DeleteClusterRequest {
  string cluster_id = 1;
}
message DeleteClusterResponse {
  bool success = 1;
  string error = 2;
}

// Environment Mapping
message CreateEnvironmentMappingRequest {
  string environment = 1;
  string cluster_id = 2;
  map<string, string> routing_rule = 3;
  int32 priority = 4;
  bool is_default = 5;
}
message CreateEnvironmentMappingResponse {
  KafkaEnvironmentMapping mapping = 1;
  string error = 2;
}

message ListEnvironmentMappingsRequest {
  string environment = 1; // optional filter
}
message ListEnvironmentMappingsResponse {
  repeated KafkaEnvironmentMapping mappings = 1;
}

message DeleteEnvironmentMappingRequest {
  string mapping_id = 1;
}
message DeleteEnvironmentMappingResponse {
  bool success = 1;
  string error = 2;
}

// Topic Management
message CreateTopicRequest {
  string workspace_id = 1;
  string name = 2;
  string environment = 3;
  int32 partitions = 4;
  int32 replication_factor = 5;
  int64 retention_ms = 6;
  string cleanup_policy = 7;
  string compression = 8;
  map<string, string> config = 9;
  string description = 10;
  KafkaSchema schema = 11; // optional schema to register
}
message CreateTopicResponse {
  KafkaTopic topic = 1;
  string workflow_id = 2;
  string error = 3;
}

message GetTopicRequest {
  string topic_id = 1;
}
message GetTopicResponse {
  KafkaTopic topic = 1;
  string error = 2;
}

message ListTopicsRequest {
  string workspace_id = 1;
  string environment = 2;
  TopicStatus status = 3;
  int32 limit = 4;
  int32 offset = 5;
}
message ListTopicsResponse {
  repeated KafkaTopic topics = 1;
  int32 total = 2;
}

message UpdateTopicRequest {
  string topic_id = 1;
  optional int32 partitions = 2;
  optional int64 retention_ms = 3;
  map<string, string> config = 4;
  optional string description = 5;
}
message UpdateTopicResponse {
  KafkaTopic topic = 1;
  string error = 2;
}

message DeleteTopicRequest {
  string topic_id = 1;
}
message DeleteTopicResponse {
  bool success = 1;
  string workflow_id = 2;
  string error = 3;
}

message ApproveTopicRequest {
  string topic_id = 1;
  string approved_by = 2;
}
message ApproveTopicResponse {
  KafkaTopic topic = 1;
  string workflow_id = 2;
  string error = 3;
}

// Schema Management
message RegisterSchemaRequest {
  string topic_id = 1;
  string type = 2; // "key" or "value"
  SchemaFormat format = 3;
  string content = 4;
  SchemaCompatibility compatibility = 5;
}
message RegisterSchemaResponse {
  KafkaSchema schema = 1;
  string error = 2;
}

message GetSchemaRequest {
  string schema_id = 1;
}
message GetSchemaResponse {
  KafkaSchema schema = 1;
  string error = 2;
}

message ListSchemasRequest {
  string topic_id = 1;
}
message ListSchemasResponse {
  repeated KafkaSchema schemas = 1;
}

message CheckSchemaCompatibilityRequest {
  string topic_id = 1;
  string type = 2;
  SchemaFormat format = 3;
  string content = 4;
}
message CheckSchemaCompatibilityResponse {
  bool compatible = 1;
  string error = 2;
}

// Service Account Management
message CreateServiceAccountRequest {
  string workspace_id = 1;
  string name = 2;
  ServiceAccountType type = 3;
}
message CreateServiceAccountResponse {
  KafkaServiceAccount service_account = 1;
  string api_key = 2;
  string api_secret = 3;
  string error = 4;
}

message ListServiceAccountsRequest {
  string workspace_id = 1;
}
message ListServiceAccountsResponse {
  repeated KafkaServiceAccount service_accounts = 1;
}

message RevokeServiceAccountRequest {
  string service_account_id = 1;
}
message RevokeServiceAccountResponse {
  bool success = 1;
  string error = 2;
}

// Topic Sharing
message RequestTopicAccessRequest {
  string topic_id = 1;
  string requesting_workspace_id = 2;
  SharePermission permission = 3;
  string justification = 4;
}
message RequestTopicAccessResponse {
  KafkaTopicShare share = 1;
  string error = 2;
}

message ApproveTopicAccessRequest {
  string share_id = 1;
  string approved_by = 2;
}
message ApproveTopicAccessResponse {
  KafkaTopicShare share = 1;
  string error = 2;
}

message RevokeTopicAccessRequest {
  string share_id = 1;
}
message RevokeTopicAccessResponse {
  bool success = 1;
  string error = 2;
}

message ListTopicSharesRequest {
  string topic_id = 1;
  string workspace_id = 2;
  ShareStatus status = 3;
}
message ListTopicSharesResponse {
  repeated KafkaTopicShare shares = 1;
}

// Discovery
message DiscoverTopicsRequest {
  string requesting_workspace_id = 1;
  string environment = 2;
  string search = 3;
  SchemaFormat schema_format = 4;
  int32 limit = 5;
  int32 offset = 6;
}
message DiscoverTopicsResponse {
  repeated DiscoverableTopic topics = 1;
  int32 total = 2;
}

message DiscoverableTopic {
  KafkaTopic topic = 1;
  string owning_workspace_name = 2;
  TopicVisibility visibility = 3;
  string access_status = 4; // "member", "has_access", "can_request", "public"
  bool has_schema = 5;
}

// Metrics & Lineage
message GetTopicMetricsRequest {
  string topic_id = 1;
  string period_type = 2; // "hourly" or "daily"
  int32 periods = 3; // number of periods to return
}
message GetTopicMetricsResponse {
  repeated KafkaUsageMetrics metrics = 1;
}

message GetTopicLineageRequest {
  string topic_id = 1;
}
message GetTopicLineageResponse {
  repeated LineageNode producers = 1;
  repeated LineageNode consumers = 2;
}

message LineageNode {
  string workspace_id = 1;
  string workspace_name = 2;
  string service_account_id = 3;
  string service_account_name = 4;
  string client_id = 5;
  int64 bytes_transferred = 6;
  google.protobuf.Timestamp last_seen = 7;
}
```

**Step 2: Generate Go and TypeScript code**

Run: `make proto-gen`

Expected: Successfully generates:
- `proto/gen/go/idp/kafka/v1/kafka.pb.go`
- `proto/gen/go/idp/kafka/v1/kafka_grpc.pb.go`
- `orbit-www/src/lib/proto/idp/kafka/v1/kafka_pb.ts`
- `orbit-www/src/lib/proto/idp/kafka/v1/kafka_connect.ts`

**Step 3: Commit**

```bash
git add proto/idp/kafka/v1/kafka.proto proto/gen/ orbit-www/src/lib/proto/
git commit -m "feat(kafka): add Kafka service proto definitions

Defines gRPC service contract for Kafka integration including:
- Provider, Cluster, EnvironmentMapping messages
- Topic, Schema, ServiceAccount messages
- TopicShare and SharePolicy for cross-workspace access
- UsageMetrics and ClientActivity for billing/lineage
- Full CRUD operations for all entities
- Discovery endpoint for global topic catalog"
```

---

### Task 1.2: Initialize kafka-service Go Module

**Files:**
- Create: `services/kafka/go.mod`
- Create: `services/kafka/go.sum`

**Step 1: Create go.mod**

```bash
cd services && mkdir -p kafka && cd kafka
go mod init github.com/drewpayment/orbit/services/kafka
```

**Step 2: Add proto module replace directive**

Edit `services/kafka/go.mod`:

```go
module github.com/drewpayment/orbit/services/kafka

go 1.21

replace github.com/drewpayment/orbit/proto => ../../proto
```

**Step 3: Add core dependencies**

```bash
cd services/kafka
go get github.com/drewpayment/orbit/proto
go get go.temporal.io/sdk@latest
go get google.golang.org/grpc@latest
go get github.com/twmb/franz-go@latest
go get github.com/twmb/franz-go/pkg/kadm@latest
```

**Step 4: Tidy and verify**

Run: `go mod tidy`

Expected: go.sum populated, no errors

**Step 5: Commit**

```bash
git add services/kafka/go.mod services/kafka/go.sum
git commit -m "feat(kafka): initialize kafka-service Go module

Sets up module with proto dependency and core libraries:
- franz-go for Kafka protocol
- Temporal SDK for workflows
- gRPC for service communication"
```

---

### Task 1.3: Create Domain Entities

**Files:**
- Create: `services/kafka/internal/domain/provider.go`
- Create: `services/kafka/internal/domain/cluster.go`
- Create: `services/kafka/internal/domain/topic.go`
- Create: `services/kafka/internal/domain/schema.go`
- Create: `services/kafka/internal/domain/service_account.go`
- Create: `services/kafka/internal/domain/share.go`
- Create: `services/kafka/internal/domain/policy.go`
- Create: `services/kafka/internal/domain/errors.go`

**Step 1: Write provider.go**

```go
package domain

// ProviderType represents supported Kafka provider types
type ProviderType string

const (
	ProviderTypeUnspecified   ProviderType = ""
	ProviderTypeApacheKafka   ProviderType = "apache-kafka"
	ProviderTypeConfluentCloud ProviderType = "confluent-cloud"
	ProviderTypeAWSMSK        ProviderType = "aws-msk"
	ProviderTypeRedpanda      ProviderType = "redpanda"
	ProviderTypeAiven         ProviderType = "aiven"
)

// ProviderCapabilities defines what features a provider supports
type ProviderCapabilities struct {
	SchemaRegistry bool `json:"schemaRegistry"`
	Transactions   bool `json:"transactions"`
	QuotasAPI      bool `json:"quotasApi"`
	MetricsAPI     bool `json:"metricsApi"`
}

// KafkaProvider represents a Kafka-compatible provider definition
type KafkaProvider struct {
	ID                   string               `json:"id"`
	Name                 string               `json:"name"`
	DisplayName          string               `json:"displayName"`
	AdapterType          string               `json:"adapterType"`
	RequiredConfigFields []string             `json:"requiredConfigFields"`
	Capabilities         ProviderCapabilities `json:"capabilities"`
	DocumentationURL     string               `json:"documentationUrl"`
	IconURL              string               `json:"iconUrl"`
}

// DefaultProviders returns the built-in provider definitions
func DefaultProviders() []KafkaProvider {
	return []KafkaProvider{
		{
			ID:          "apache-kafka",
			Name:        "apache-kafka",
			DisplayName: "Apache Kafka",
			AdapterType: "apache",
			RequiredConfigFields: []string{
				"bootstrapServers",
				"securityProtocol",
			},
			Capabilities: ProviderCapabilities{
				SchemaRegistry: true,
				Transactions:   true,
				QuotasAPI:      false,
				MetricsAPI:     false,
			},
			DocumentationURL: "https://kafka.apache.org/documentation/",
		},
		{
			ID:          "confluent-cloud",
			Name:        "confluent-cloud",
			DisplayName: "Confluent Cloud",
			AdapterType: "confluent",
			RequiredConfigFields: []string{
				"bootstrapServers",
				"apiKey",
				"apiSecret",
				"environmentId",
				"clusterId",
			},
			Capabilities: ProviderCapabilities{
				SchemaRegistry: true,
				Transactions:   true,
				QuotasAPI:      true,
				MetricsAPI:     true,
			},
			DocumentationURL: "https://docs.confluent.io/cloud/current/",
		},
		{
			ID:          "aws-msk",
			Name:        "aws-msk",
			DisplayName: "Amazon MSK",
			AdapterType: "msk",
			RequiredConfigFields: []string{
				"bootstrapServers",
				"region",
				"clusterArn",
			},
			Capabilities: ProviderCapabilities{
				SchemaRegistry: true,
				Transactions:   true,
				QuotasAPI:      false,
				MetricsAPI:     true,
			},
			DocumentationURL: "https://docs.aws.amazon.com/msk/",
		},
		{
			ID:          "redpanda",
			Name:        "redpanda",
			DisplayName: "Redpanda",
			AdapterType: "apache", // Redpanda is Kafka-compatible
			RequiredConfigFields: []string{
				"bootstrapServers",
				"securityProtocol",
			},
			Capabilities: ProviderCapabilities{
				SchemaRegistry: true,
				Transactions:   true,
				QuotasAPI:      false,
				MetricsAPI:     true,
			},
			DocumentationURL: "https://docs.redpanda.com/",
		},
	}
}
```

**Step 2: Write cluster.go**

```go
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
```

**Step 3: Write topic.go**

```go
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
```

**Step 4: Write schema.go**

```go
package domain

import (
	"time"

	"github.com/google/uuid"
)

// SchemaFormat represents the schema serialization format
type SchemaFormat string

const (
	SchemaFormatAvro     SchemaFormat = "avro"
	SchemaFormatProtobuf SchemaFormat = "protobuf"
	SchemaFormatJSON     SchemaFormat = "json"
)

// SchemaCompatibility represents schema evolution compatibility
type SchemaCompatibility string

const (
	SchemaCompatibilityBackward SchemaCompatibility = "backward"
	SchemaCompatibilityForward  SchemaCompatibility = "forward"
	SchemaCompatibilityFull     SchemaCompatibility = "full"
	SchemaCompatibilityNone     SchemaCompatibility = "none"
)

// SchemaType represents whether this is a key or value schema
type SchemaType string

const (
	SchemaTypeKey   SchemaType = "key"
	SchemaTypeValue SchemaType = "value"
)

// SchemaStatus represents the registration state
type SchemaStatus string

const (
	SchemaStatusPending    SchemaStatus = "pending"
	SchemaStatusRegistered SchemaStatus = "registered"
	SchemaStatusFailed     SchemaStatus = "failed"
)

// KafkaSchema represents a schema registered for a topic
type KafkaSchema struct {
	ID            uuid.UUID           `json:"id"`
	WorkspaceID   uuid.UUID           `json:"workspaceId"`
	TopicID       uuid.UUID           `json:"topicId"`
	Type          SchemaType          `json:"type"`
	Subject       string              `json:"subject"`
	Format        SchemaFormat        `json:"format"`
	Content       string              `json:"content"`
	Version       int                 `json:"version"`
	SchemaID      int                 `json:"schemaId"`
	Compatibility SchemaCompatibility `json:"compatibility"`
	Status        SchemaStatus        `json:"status"`
	CreatedAt     time.Time           `json:"createdAt"`
	UpdatedAt     time.Time           `json:"updatedAt"`
}

// NewKafkaSchema creates a new schema
func NewKafkaSchema(workspaceID, topicID uuid.UUID, schemaType SchemaType, format SchemaFormat, content string) *KafkaSchema {
	now := time.Now()
	return &KafkaSchema{
		ID:            uuid.New(),
		WorkspaceID:   workspaceID,
		TopicID:       topicID,
		Type:          schemaType,
		Format:        format,
		Content:       content,
		Compatibility: SchemaCompatibilityBackward,
		Status:        SchemaStatusPending,
		CreatedAt:     now,
		UpdatedAt:     now,
	}
}

// GenerateSubject creates the subject name from template
func (s *KafkaSchema) GenerateSubject(environment, workspaceName, topicName string) string {
	// Format: {env}.{workspace}.{topic}-{key|value}
	return environment + "." + workspaceName + "." + topicName + "-" + string(s.Type)
}

// MarkRegistered marks the schema as successfully registered
func (s *KafkaSchema) MarkRegistered(schemaID, version int) {
	s.SchemaID = schemaID
	s.Version = version
	s.Status = SchemaStatusRegistered
	s.UpdatedAt = time.Now()
}

// MarkFailed marks the schema registration as failed
func (s *KafkaSchema) MarkFailed() {
	s.Status = SchemaStatusFailed
	s.UpdatedAt = time.Now()
}

// SchemaRegistry represents the centralized schema registry config
type SchemaRegistry struct {
	ID                    uuid.UUID                         `json:"id"`
	URL                   string                            `json:"url"`
	SubjectNamingTemplate string                            `json:"subjectNamingTemplate"`
	DefaultCompatibility  SchemaCompatibility               `json:"defaultCompatibility"`
	EnvironmentOverrides  []EnvironmentCompatibilityOverride `json:"environmentOverrides"`
	CreatedAt             time.Time                         `json:"createdAt"`
	UpdatedAt             time.Time                         `json:"updatedAt"`
}

// EnvironmentCompatibilityOverride allows per-env compatibility settings
type EnvironmentCompatibilityOverride struct {
	Environment   string              `json:"environment"`
	Compatibility SchemaCompatibility `json:"compatibility"`
}
```

**Step 5: Write service_account.go**

```go
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
```

**Step 6: Write share.go**

```go
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
	s.ApprovedBy = &rejectedBy // reusing field for rejection
	s.ApprovedAt = &now
	s.UpdatedAt = now
}

// Revoke revokes an approved share
func (s *KafkaTopicShare) Revoke() {
	s.Status = ShareStatusRevoked
	s.UpdatedAt = time.Now()
}

// IsActive returns true if the share is currently granting access
func (s *KafkaTopicShare) IsActive() bool {
	if s.Status != ShareStatusApproved {
		return false
	}
	if s.ExpiresAt != nil && s.ExpiresAt.Before(time.Now()) {
		return false
	}
	return true
}

// CanRead returns true if this share grants read access
func (s *KafkaTopicShare) CanRead() bool {
	return s.IsActive() && (s.Permission == SharePermissionRead || s.Permission == SharePermissionReadWrite)
}

// CanWrite returns true if this share grants write access
func (s *KafkaTopicShare) CanWrite() bool {
	return s.IsActive() && (s.Permission == SharePermissionWrite || s.Permission == SharePermissionReadWrite)
}
```

**Step 7: Write policy.go**

```go
package domain

import (
	"regexp"
	"time"

	"github.com/google/uuid"
)

// PolicyScope represents whether policy is platform or workspace level
type PolicyScope string

const (
	PolicyScopePlatform  PolicyScope = "platform"
	PolicyScopeWorkspace PolicyScope = "workspace"
)

// TopicVisibility represents topic discovery visibility
type TopicVisibility string

const (
	TopicVisibilityPrivate      TopicVisibility = "private"
	TopicVisibilityDiscoverable TopicVisibility = "discoverable"
	TopicVisibilityPublic       TopicVisibility = "public"
)

// SharePolicyScope represents what topics the share policy applies to
type SharePolicyScope string

const (
	SharePolicyScopeAllTopics     SharePolicyScope = "all-topics"
	SharePolicyScopeTopicPattern  SharePolicyScope = "topic-pattern"
	SharePolicyScopeSpecificTopic SharePolicyScope = "specific-topic"
)

// KafkaTopicPolicy defines guardrails for topic creation
type KafkaTopicPolicy struct {
	ID                  uuid.UUID   `json:"id"`
	Scope               PolicyScope `json:"scope"`
	WorkspaceID         *uuid.UUID  `json:"workspaceId"`
	Environment         string      `json:"environment"`
	NamingPattern       string      `json:"namingPattern"`
	AutoApprovePatterns []string    `json:"autoApprovePatterns"`
	PartitionMin        int         `json:"partitionMin"`
	PartitionMax        int         `json:"partitionMax"`
	RetentionMinMs      int64       `json:"retentionMinMs"`
	RetentionMaxMs      int64       `json:"retentionMaxMs"`
	RequireSchema       bool        `json:"requireSchema"`
	RequireApprovalFor  []string    `json:"requireApprovalFor"`
	CreatedAt           time.Time   `json:"createdAt"`
	UpdatedAt           time.Time   `json:"updatedAt"`
}

// NewPlatformPolicy creates a new platform-level policy
func NewPlatformPolicy(environment string) *KafkaTopicPolicy {
	now := time.Now()
	return &KafkaTopicPolicy{
		ID:             uuid.New(),
		Scope:          PolicyScopePlatform,
		Environment:    environment,
		PartitionMin:   1,
		PartitionMax:   100,
		RetentionMinMs: 3600000,     // 1 hour
		RetentionMaxMs: 2592000000,  // 30 days
		CreatedAt:      now,
		UpdatedAt:      now,
	}
}

// ValidateTopicName checks if a topic name matches the naming pattern
func (p *KafkaTopicPolicy) ValidateTopicName(name string) error {
	if p.NamingPattern == "" {
		return nil
	}
	matched, err := regexp.MatchString(p.NamingPattern, name)
	if err != nil {
		return ErrPolicyInvalidPattern
	}
	if !matched {
		return ErrTopicNameViolatesPolicy
	}
	return nil
}

// ValidatePartitions checks if partition count is within limits
func (p *KafkaTopicPolicy) ValidatePartitions(partitions int) error {
	if partitions < p.PartitionMin {
		return ErrTopicPartitionsBelowMin
	}
	if partitions > p.PartitionMax {
		return ErrTopicPartitionsAboveMax
	}
	return nil
}

// ValidateRetention checks if retention is within limits
func (p *KafkaTopicPolicy) ValidateRetention(retentionMs int64) error {
	if retentionMs < p.RetentionMinMs {
		return ErrTopicRetentionBelowMin
	}
	if retentionMs > p.RetentionMaxMs {
		return ErrTopicRetentionAboveMax
	}
	return nil
}

// RequiresApproval checks if the environment requires manual approval
func (p *KafkaTopicPolicy) RequiresApproval(environment string) bool {
	for _, env := range p.RequireApprovalFor {
		if env == environment {
			return true
		}
	}
	return false
}

// AutoApproves checks if a topic name matches auto-approve patterns
func (p *KafkaTopicPolicy) AutoApproves(topicName string) bool {
	for _, pattern := range p.AutoApprovePatterns {
		matched, err := regexp.MatchString(pattern, topicName)
		if err == nil && matched {
			return true
		}
	}
	return false
}

// KafkaTopicSharePolicy defines visibility and auto-approval rules
type KafkaTopicSharePolicy struct {
	ID                   uuid.UUID         `json:"id"`
	WorkspaceID          uuid.UUID         `json:"workspaceId"`
	Scope                SharePolicyScope  `json:"scope"`
	TopicPattern         string            `json:"topicPattern"`
	TopicID              *uuid.UUID        `json:"topicId"`
	Environment          string            `json:"environment"`
	Visibility           TopicVisibility   `json:"visibility"`
	AutoApprove          AutoApproveConfig `json:"autoApprove"`
	DefaultPermission    SharePermission   `json:"defaultPermission"`
	RequireJustification bool              `json:"requireJustification"`
	AccessTTLDays        int               `json:"accessTtlDays"`
	CreatedAt            time.Time         `json:"createdAt"`
	UpdatedAt            time.Time         `json:"updatedAt"`
}

// AutoApproveConfig defines conditions for automatic approval
type AutoApproveConfig struct {
	Environments       []string          `json:"environments"`
	Permissions        []SharePermission `json:"permissions"`
	WorkspaceWhitelist []uuid.UUID       `json:"workspaceWhitelist"`
	SameTenantOnly     bool              `json:"sameTenantOnly"`
}

// ShouldAutoApprove checks if a share request should be auto-approved
func (p *KafkaTopicSharePolicy) ShouldAutoApprove(environment string, permission SharePermission, requestingWorkspaceID uuid.UUID, sameTenant bool) bool {
	// Check environment
	envMatch := false
	for _, env := range p.AutoApprove.Environments {
		if env == environment {
			envMatch = true
			break
		}
	}
	if len(p.AutoApprove.Environments) > 0 && !envMatch {
		return false
	}

	// Check permission
	permMatch := false
	for _, perm := range p.AutoApprove.Permissions {
		if perm == permission {
			permMatch = true
			break
		}
	}
	if len(p.AutoApprove.Permissions) > 0 && !permMatch {
		return false
	}

	// Check workspace whitelist
	if len(p.AutoApprove.WorkspaceWhitelist) > 0 {
		found := false
		for _, wsID := range p.AutoApprove.WorkspaceWhitelist {
			if wsID == requestingWorkspaceID {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}

	// Check tenant
	if p.AutoApprove.SameTenantOnly && !sameTenant {
		return false
	}

	return true
}

// MatchesTopic checks if this policy applies to a given topic
func (p *KafkaTopicSharePolicy) MatchesTopic(topicID uuid.UUID, topicName, topicEnvironment string) bool {
	// Check environment
	if p.Environment != "" && p.Environment != topicEnvironment {
		return false
	}

	switch p.Scope {
	case SharePolicyScopeAllTopics:
		return true
	case SharePolicyScopeSpecificTopic:
		return p.TopicID != nil && *p.TopicID == topicID
	case SharePolicyScopeTopicPattern:
		if p.TopicPattern == "" {
			return false
		}
		matched, _ := regexp.MatchString(p.TopicPattern, topicName)
		return matched
	default:
		return false
	}
}
```

**Step 8: Write errors.go**

```go
package domain

import "errors"

// Cluster errors
var (
	ErrClusterNameRequired     = errors.New("cluster name is required")
	ErrClusterProviderRequired = errors.New("cluster provider is required")
	ErrClusterNotFound         = errors.New("cluster not found")
	ErrClusterConnectionFailed = errors.New("cluster connection failed")
)

// Topic errors
var (
	ErrTopicNameRequired        = errors.New("topic name is required")
	ErrTopicWorkspaceRequired   = errors.New("topic workspace is required")
	ErrTopicEnvironmentRequired = errors.New("topic environment is required")
	ErrTopicPartitionsInvalid   = errors.New("topic partitions must be at least 1")
	ErrTopicReplicationInvalid  = errors.New("topic replication factor must be at least 1")
	ErrTopicNotFound            = errors.New("topic not found")
	ErrTopicAlreadyExists       = errors.New("topic already exists")
	ErrTopicCannotBeDeleted     = errors.New("topic cannot be deleted in current state")
)

// Policy errors
var (
	ErrPolicyInvalidPattern      = errors.New("invalid policy pattern")
	ErrTopicNameViolatesPolicy   = errors.New("topic name violates naming policy")
	ErrTopicPartitionsBelowMin   = errors.New("partitions below minimum allowed")
	ErrTopicPartitionsAboveMax   = errors.New("partitions above maximum allowed")
	ErrTopicRetentionBelowMin    = errors.New("retention below minimum allowed")
	ErrTopicRetentionAboveMax    = errors.New("retention above maximum allowed")
	ErrTopicRequiresApproval     = errors.New("topic requires approval for this environment")
	ErrTopicSchemaRequired       = errors.New("schema is required for this topic")
)

// Schema errors
var (
	ErrSchemaNotFound           = errors.New("schema not found")
	ErrSchemaIncompatible       = errors.New("schema is not compatible with existing version")
	ErrSchemaRegistrationFailed = errors.New("schema registration failed")
)

// Service account errors
var (
	ErrServiceAccountNameRequired      = errors.New("service account name is required")
	ErrServiceAccountWorkspaceRequired = errors.New("service account workspace is required")
	ErrServiceAccountNotFound          = errors.New("service account not found")
	ErrServiceAccountRevoked           = errors.New("service account is revoked")
)

// Share errors
var (
	ErrShareNotFound          = errors.New("share not found")
	ErrShareAlreadyExists     = errors.New("share already exists")
	ErrShareNotPending        = errors.New("share is not pending approval")
	ErrShareNotApproved       = errors.New("share is not approved")
	ErrShareExpired           = errors.New("share has expired")
	ErrInsufficientPermission = errors.New("insufficient permission")
)

// Environment errors
var (
	ErrEnvironmentNotFound = errors.New("environment not found")
	ErrNoClusterForEnv     = errors.New("no cluster configured for environment")
)
```

**Step 9: Verify domain package compiles**

Run: `cd services/kafka && go build ./internal/domain/...`

Expected: No errors

**Step 10: Commit**

```bash
git add services/kafka/internal/domain/
git commit -m "feat(kafka): add domain entities for Kafka service

Includes domain models for:
- KafkaProvider with capabilities
- KafkaCluster with validation status
- KafkaTopic with lifecycle management
- KafkaSchema for schema registry integration
- KafkaServiceAccount for access credentials
- KafkaTopicShare for cross-workspace access
- KafkaTopicPolicy and SharePolicy for guardrails
- Domain-specific errors"
```

---

## Phase 2: Kafka Adapters

### Task 2.1: Create Adapter Interface

**Files:**
- Create: `services/kafka/internal/adapters/adapter.go`
- Create: `services/kafka/internal/adapters/types.go`

**Step 1: Write adapter.go with interfaces**

```go
package adapters

import (
	"context"

	"github.com/drewpayment/orbit/services/kafka/internal/domain"
)

// KafkaAdapter defines the interface for Kafka cluster operations
type KafkaAdapter interface {
	// Connection
	ValidateConnection(ctx context.Context) error
	Close() error

	// Topic operations
	CreateTopic(ctx context.Context, spec TopicSpec) error
	DeleteTopic(ctx context.Context, topicName string) error
	DescribeTopic(ctx context.Context, topicName string) (*TopicInfo, error)
	UpdateTopicConfig(ctx context.Context, topicName string, config map[string]string) error
	ListTopics(ctx context.Context) ([]string, error)

	// ACL operations
	CreateACL(ctx context.Context, acl ACLSpec) error
	DeleteACL(ctx context.Context, acl ACLSpec) error
	ListACLs(ctx context.Context) ([]ACLInfo, error)

	// Metrics (optional - check capabilities first)
	GetTopicMetrics(ctx context.Context, topicName string) (*TopicMetrics, error)
	GetConsumerGroupLag(ctx context.Context, groupID string) (*ConsumerGroupLag, error)
	ListConsumerGroups(ctx context.Context) ([]ConsumerGroupInfo, error)
}

// SchemaRegistryAdapter defines the interface for schema registry operations
type SchemaRegistryAdapter interface {
	// Schema operations
	RegisterSchema(ctx context.Context, subject string, schema SchemaSpec) (SchemaResult, error)
	GetSchema(ctx context.Context, subject string, version int) (*SchemaInfo, error)
	GetLatestSchema(ctx context.Context, subject string) (*SchemaInfo, error)
	ListVersions(ctx context.Context, subject string) ([]int, error)
	CheckCompatibility(ctx context.Context, subject string, schema SchemaSpec) (bool, error)
	DeleteSubject(ctx context.Context, subject string) error
	ListSubjects(ctx context.Context) ([]string, error)

	// Configuration
	GetCompatibility(ctx context.Context, subject string) (domain.SchemaCompatibility, error)
	SetCompatibility(ctx context.Context, subject string, compatibility domain.SchemaCompatibility) error
}

// AdapterFactory creates adapters for different providers
type AdapterFactory interface {
	CreateKafkaAdapter(cluster *domain.KafkaCluster, credentials map[string]string) (KafkaAdapter, error)
	CreateSchemaRegistryAdapter(registry *domain.SchemaRegistry, credentials map[string]string) (SchemaRegistryAdapter, error)
}
```

**Step 2: Write types.go with shared types**

```go
package adapters

import (
	"time"

	"github.com/drewpayment/orbit/services/kafka/internal/domain"
)

// TopicSpec defines the specification for creating a topic
type TopicSpec struct {
	Name              string
	Partitions        int
	ReplicationFactor int
	Config            map[string]string
}

// TopicInfo contains information about an existing topic
type TopicInfo struct {
	Name              string
	Partitions        int
	ReplicationFactor int
	Config            map[string]string
	Internal          bool
}

// ACLSpec defines an ACL entry
type ACLSpec struct {
	ResourceType   ResourceType
	ResourceName   string
	PatternType    PatternType
	Principal      string
	Host           string
	Operation      ACLOperation
	PermissionType ACLPermissionType
}

// ResourceType for ACLs
type ResourceType string

const (
	ResourceTypeTopic         ResourceType = "TOPIC"
	ResourceTypeGroup         ResourceType = "GROUP"
	ResourceTypeCluster       ResourceType = "CLUSTER"
	ResourceTypeTransactional ResourceType = "TRANSACTIONAL_ID"
)

// PatternType for ACL resource patterns
type PatternType string

const (
	PatternTypeLiteral  PatternType = "LITERAL"
	PatternTypePrefixed PatternType = "PREFIXED"
)

// ACLOperation defines Kafka operations
type ACLOperation string

const (
	ACLOperationAll             ACLOperation = "ALL"
	ACLOperationRead            ACLOperation = "READ"
	ACLOperationWrite           ACLOperation = "WRITE"
	ACLOperationCreate          ACLOperation = "CREATE"
	ACLOperationDelete          ACLOperation = "DELETE"
	ACLOperationAlter           ACLOperation = "ALTER"
	ACLOperationDescribe        ACLOperation = "DESCRIBE"
	ACLOperationClusterAction   ACLOperation = "CLUSTER_ACTION"
	ACLOperationDescribeConfigs ACLOperation = "DESCRIBE_CONFIGS"
	ACLOperationAlterConfigs    ACLOperation = "ALTER_CONFIGS"
	ACLOperationIdempotentWrite ACLOperation = "IDEMPOTENT_WRITE"
)

// ACLPermissionType defines allow/deny
type ACLPermissionType string

const (
	ACLPermissionAllow ACLPermissionType = "ALLOW"
	ACLPermissionDeny  ACLPermissionType = "DENY"
)

// ACLInfo contains information about an existing ACL
type ACLInfo struct {
	ResourceType   ResourceType
	ResourceName   string
	PatternType    PatternType
	Principal      string
	Host           string
	Operation      ACLOperation
	PermissionType ACLPermissionType
}

// TopicMetrics contains usage metrics for a topic
type TopicMetrics struct {
	TopicName        string
	BytesInPerSec    float64
	BytesOutPerSec   float64
	MessagesInPerSec float64
	PartitionCount   int
	ReplicaCount     int
	LogSizeBytes     int64
}

// ConsumerGroupLag contains lag information for a consumer group
type ConsumerGroupLag struct {
	GroupID      string
	State        string
	Members      int
	TopicLags    map[string]int64 // topic -> total lag
	TotalLag     int64
	LastActivity time.Time
}

// ConsumerGroupInfo contains basic info about a consumer group
type ConsumerGroupInfo struct {
	GroupID      string
	State        string
	Protocol     string
	ProtocolType string
	Members      int
}

// SchemaSpec defines a schema to register
type SchemaSpec struct {
	Schema       string
	SchemaType   string // AVRO, PROTOBUF, JSON
	References   []SchemaReference
}

// SchemaReference for schema dependencies
type SchemaReference struct {
	Name    string
	Subject string
	Version int
}

// SchemaResult is returned after successful registration
type SchemaResult struct {
	ID      int
	Version int
}

// SchemaInfo contains information about a registered schema
type SchemaInfo struct {
	Subject    string
	Version    int
	ID         int
	SchemaType string
	Schema     string
}

// ACLsForServiceAccount generates the ACLs needed for a service account
func ACLsForServiceAccount(account *domain.KafkaServiceAccount, topicName, consumerGroup string) []ACLSpec {
	principal := "User:" + account.Name
	var acls []ACLSpec

	// Common: describe topic
	acls = append(acls, ACLSpec{
		ResourceType:   ResourceTypeTopic,
		ResourceName:   topicName,
		PatternType:    PatternTypeLiteral,
		Principal:      principal,
		Host:           "*",
		Operation:      ACLOperationDescribe,
		PermissionType: ACLPermissionAllow,
	})

	// Producer ACLs
	if account.CanProduce() {
		acls = append(acls, ACLSpec{
			ResourceType:   ResourceTypeTopic,
			ResourceName:   topicName,
			PatternType:    PatternTypeLiteral,
			Principal:      principal,
			Host:           "*",
			Operation:      ACLOperationWrite,
			PermissionType: ACLPermissionAllow,
		})
	}

	// Consumer ACLs
	if account.CanConsume() {
		acls = append(acls, ACLSpec{
			ResourceType:   ResourceTypeTopic,
			ResourceName:   topicName,
			PatternType:    PatternTypeLiteral,
			Principal:      principal,
			Host:           "*",
			Operation:      ACLOperationRead,
			PermissionType: ACLPermissionAllow,
		})

		if consumerGroup != "" {
			acls = append(acls, ACLSpec{
				ResourceType:   ResourceTypeGroup,
				ResourceName:   consumerGroup,
				PatternType:    PatternTypeLiteral,
				Principal:      principal,
				Host:           "*",
				Operation:      ACLOperationRead,
				PermissionType: ACLPermissionAllow,
			})
		}
	}

	return acls
}
```

**Step 3: Verify adapters package compiles**

Run: `cd services/kafka && go build ./internal/adapters/...`

Expected: No errors

**Step 4: Commit**

```bash
git add services/kafka/internal/adapters/
git commit -m "feat(kafka): add adapter interfaces for Kafka and Schema Registry

Defines provider-agnostic interfaces for:
- Kafka cluster operations (topics, ACLs, metrics)
- Schema Registry operations (schemas, compatibility)
- Shared types for topic specs, ACLs, metrics
- Helper function for generating service account ACLs"
```

---

### Task 2.2: Implement Apache Kafka Adapter

**Files:**
- Create: `services/kafka/internal/adapters/apache/client.go`
- Create: `services/kafka/internal/adapters/apache/client_test.go`

**Step 1: Write the failing test**

```go
package apache

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewClient_ValidConfig(t *testing.T) {
	config := Config{
		BootstrapServers: []string{"localhost:9092"},
		SecurityProtocol: "PLAINTEXT",
	}

	client, err := NewClient(config)
	require.NoError(t, err)
	assert.NotNil(t, client)

	// Close immediately - we're not actually connecting
	client.Close()
}

func TestNewClient_EmptyBootstrapServers(t *testing.T) {
	config := Config{
		BootstrapServers: []string{},
		SecurityProtocol: "PLAINTEXT",
	}

	client, err := NewClient(config)
	assert.Error(t, err)
	assert.Nil(t, client)
	assert.Contains(t, err.Error(), "bootstrap servers required")
}

func TestTopicSpec_ToKafkaConfig(t *testing.T) {
	spec := TopicSpec{
		Name:              "test-topic",
		Partitions:        3,
		ReplicationFactor: 2,
		Config: map[string]string{
			"retention.ms":  "86400000",
			"cleanup.policy": "delete",
		},
	}

	kafkaConfig := spec.ToKafkaConfig()

	assert.Equal(t, "86400000", kafkaConfig["retention.ms"])
	assert.Equal(t, "delete", kafkaConfig["cleanup.policy"])
}
```

**Step 2: Run test to verify it fails**

Run: `cd services/kafka && go test -v ./internal/adapters/apache/...`

Expected: FAIL - package/types not defined

**Step 3: Write minimal implementation**

```go
package apache

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/twmb/franz-go/pkg/kadm"
	"github.com/twmb/franz-go/pkg/kgo"
	"github.com/twmb/franz-go/pkg/sasl/plain"
	"github.com/twmb/franz-go/pkg/sasl/scram"

	"github.com/drewpayment/orbit/services/kafka/internal/adapters"
)

// Config holds the connection configuration for Apache Kafka
type Config struct {
	BootstrapServers []string
	SecurityProtocol string // PLAINTEXT, SASL_PLAINTEXT, SASL_SSL, SSL
	SASLMechanism    string // PLAIN, SCRAM-SHA-256, SCRAM-SHA-512
	SASLUsername     string
	SASLPassword     string
	TLSEnabled       bool
	TLSSkipVerify    bool
}

// TopicSpec wraps adapters.TopicSpec with conversion methods
type TopicSpec struct {
	adapters.TopicSpec
}

// ToKafkaConfig converts the topic spec config map
func (s TopicSpec) ToKafkaConfig() map[string]*string {
	result := make(map[string]*string)
	for k, v := range s.Config {
		val := v
		result[k] = &val
	}
	return result
}

// Client implements the KafkaAdapter interface for Apache Kafka
type Client struct {
	client    *kgo.Client
	adminClient *kadm.Client
	config    Config
}

// NewClient creates a new Apache Kafka client
func NewClient(config Config) (*Client, error) {
	if len(config.BootstrapServers) == 0 {
		return nil, errors.New("bootstrap servers required")
	}

	opts := []kgo.Opt{
		kgo.SeedBrokers(config.BootstrapServers...),
	}

	// Configure SASL if needed
	switch config.SASLMechanism {
	case "PLAIN":
		opts = append(opts, kgo.SASL(plain.Auth{
			User: config.SASLUsername,
			Pass: config.SASLPassword,
		}.AsMechanism()))
	case "SCRAM-SHA-256":
		opts = append(opts, kgo.SASL(scram.Auth{
			User: config.SASLUsername,
			Pass: config.SASLPassword,
		}.AsSha256Mechanism()))
	case "SCRAM-SHA-512":
		opts = append(opts, kgo.SASL(scram.Auth{
			User: config.SASLUsername,
			Pass: config.SASLPassword,
		}.AsSha512Mechanism()))
	}

	client, err := kgo.NewClient(opts...)
	if err != nil {
		return nil, fmt.Errorf("failed to create kafka client: %w", err)
	}

	adminClient := kadm.NewClient(client)

	return &Client{
		client:      client,
		adminClient: adminClient,
		config:      config,
	}, nil
}

// ValidateConnection tests the connection to the cluster
func (c *Client) ValidateConnection(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	// Try to list brokers as a health check
	brokers, err := c.adminClient.ListBrokers(ctx)
	if err != nil {
		return fmt.Errorf("failed to connect to cluster: %w", err)
	}
	if len(brokers) == 0 {
		return errors.New("no brokers available")
	}
	return nil
}

// Close closes the client connection
func (c *Client) Close() error {
	c.client.Close()
	return nil
}

// CreateTopic creates a new topic
func (c *Client) CreateTopic(ctx context.Context, spec adapters.TopicSpec) error {
	configs := make(map[string]*string)
	for k, v := range spec.Config {
		val := v
		configs[k] = &val
	}

	resp, err := c.adminClient.CreateTopics(ctx, int32(spec.Partitions), int16(spec.ReplicationFactor), configs, spec.Name)
	if err != nil {
		return fmt.Errorf("failed to create topic: %w", err)
	}

	for _, r := range resp {
		if r.Err != nil {
			return fmt.Errorf("failed to create topic %s: %w", r.Topic, r.Err)
		}
	}

	return nil
}

// DeleteTopic deletes a topic
func (c *Client) DeleteTopic(ctx context.Context, topicName string) error {
	resp, err := c.adminClient.DeleteTopics(ctx, topicName)
	if err != nil {
		return fmt.Errorf("failed to delete topic: %w", err)
	}

	for _, r := range resp {
		if r.Err != nil {
			return fmt.Errorf("failed to delete topic %s: %w", r.Topic, r.Err)
		}
	}

	return nil
}

// DescribeTopic gets information about a topic
func (c *Client) DescribeTopic(ctx context.Context, topicName string) (*adapters.TopicInfo, error) {
	topics, err := c.adminClient.ListTopics(ctx, topicName)
	if err != nil {
		return nil, fmt.Errorf("failed to describe topic: %w", err)
	}

	topic, ok := topics[topicName]
	if !ok {
		return nil, adapters.ErrTopicNotFound
	}

	// Get topic configs
	configs, err := c.adminClient.DescribeTopicConfigs(ctx, topicName)
	if err != nil {
		return nil, fmt.Errorf("failed to get topic configs: %w", err)
	}

	configMap := make(map[string]string)
	if topicConfig, ok := configs[topicName]; ok {
		for _, cfg := range topicConfig {
			if cfg.Value != nil {
				configMap[cfg.Key] = *cfg.Value
			}
		}
	}

	return &adapters.TopicInfo{
		Name:              topicName,
		Partitions:        len(topic.Partitions),
		ReplicationFactor: len(topic.Partitions[0].Replicas),
		Config:            configMap,
		Internal:          topic.IsInternal,
	}, nil
}

// UpdateTopicConfig updates topic configuration
func (c *Client) UpdateTopicConfig(ctx context.Context, topicName string, config map[string]string) error {
	configs := make(map[string]*string)
	for k, v := range config {
		val := v
		configs[k] = &val
	}

	resp, err := c.adminClient.AlterTopicConfigs(ctx, []kadm.AlterConfig{
		{
			Name:    topicName,
			Configs: configs,
		},
	})
	if err != nil {
		return fmt.Errorf("failed to update topic config: %w", err)
	}

	for _, r := range resp {
		if r.Err != nil {
			return fmt.Errorf("failed to update config for %s: %w", r.Name, r.Err)
		}
	}

	return nil
}

// ListTopics lists all topics
func (c *Client) ListTopics(ctx context.Context) ([]string, error) {
	topics, err := c.adminClient.ListTopics(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to list topics: %w", err)
	}

	var names []string
	for name, topic := range topics {
		if !topic.IsInternal {
			names = append(names, name)
		}
	}

	return names, nil
}

// CreateACL creates an ACL entry
func (c *Client) CreateACL(ctx context.Context, acl adapters.ACLSpec) error {
	aclCreate := kadm.ACLBuilder{}.
		ResourceType(kadm.ACLResourceType(c.mapResourceType(acl.ResourceType))).
		ResourceName(acl.ResourceName).
		ResourcePatternType(c.mapPatternType(acl.PatternType)).
		Principals(acl.Principal).
		Hosts(acl.Host).
		Operations(c.mapOperation(acl.Operation)).
		Permission(c.mapPermission(acl.PermissionType))

	if err := c.adminClient.CreateACLs(ctx, &aclCreate); err != nil {
		return fmt.Errorf("failed to create ACL: %w", err)
	}

	return nil
}

// DeleteACL deletes an ACL entry
func (c *Client) DeleteACL(ctx context.Context, acl adapters.ACLSpec) error {
	aclDelete := kadm.ACLBuilder{}.
		ResourceType(kadm.ACLResourceType(c.mapResourceType(acl.ResourceType))).
		ResourceName(acl.ResourceName).
		ResourcePatternType(c.mapPatternType(acl.PatternType)).
		Principals(acl.Principal).
		Hosts(acl.Host).
		Operations(c.mapOperation(acl.Operation)).
		Permission(c.mapPermission(acl.PermissionType))

	if _, err := c.adminClient.DeleteACLs(ctx, &aclDelete); err != nil {
		return fmt.Errorf("failed to delete ACL: %w", err)
	}

	return nil
}

// ListACLs lists all ACLs
func (c *Client) ListACLs(ctx context.Context) ([]adapters.ACLInfo, error) {
	acls, err := c.adminClient.DescribeACLs(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to list ACLs: %w", err)
	}

	var result []adapters.ACLInfo
	for _, acl := range acls {
		result = append(result, adapters.ACLInfo{
			ResourceType:   adapters.ResourceType(acl.ResourceType.String()),
			ResourceName:   acl.ResourceName,
			PatternType:    adapters.PatternType(acl.ResourcePatternType.String()),
			Principal:      acl.Principal,
			Host:           acl.Host,
			Operation:      adapters.ACLOperation(acl.Operation.String()),
			PermissionType: adapters.ACLPermissionType(acl.Permission.String()),
		})
	}

	return result, nil
}

// GetTopicMetrics returns metrics for a topic
func (c *Client) GetTopicMetrics(ctx context.Context, topicName string) (*adapters.TopicMetrics, error) {
	// Basic implementation - real metrics would come from JMX or monitoring
	topic, err := c.DescribeTopic(ctx, topicName)
	if err != nil {
		return nil, err
	}

	return &adapters.TopicMetrics{
		TopicName:      topicName,
		PartitionCount: topic.Partitions,
		ReplicaCount:   topic.ReplicationFactor,
	}, nil
}

// GetConsumerGroupLag returns lag info for a consumer group
func (c *Client) GetConsumerGroupLag(ctx context.Context, groupID string) (*adapters.ConsumerGroupLag, error) {
	lags, err := c.adminClient.Lag(ctx, groupID)
	if err != nil {
		return nil, fmt.Errorf("failed to get consumer group lag: %w", err)
	}

	topicLags := make(map[string]int64)
	var totalLag int64

	for topic, partitions := range lags.Lag {
		var topicTotal int64
		for _, p := range partitions {
			topicTotal += p.Lag
		}
		topicLags[topic] = topicTotal
		totalLag += topicTotal
	}

	return &adapters.ConsumerGroupLag{
		GroupID:   groupID,
		TopicLags: topicLags,
		TotalLag:  totalLag,
	}, nil
}

// ListConsumerGroups lists all consumer groups
func (c *Client) ListConsumerGroups(ctx context.Context) ([]adapters.ConsumerGroupInfo, error) {
	groups, err := c.adminClient.ListGroups(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to list consumer groups: %w", err)
	}

	var result []adapters.ConsumerGroupInfo
	for _, g := range groups {
		result = append(result, adapters.ConsumerGroupInfo{
			GroupID:      g.Group,
			State:        g.State,
			Protocol:     g.Protocol,
			ProtocolType: g.ProtocolType,
		})
	}

	return result, nil
}

// Helper methods for type mapping
func (c *Client) mapResourceType(rt adapters.ResourceType) int8 {
	switch rt {
	case adapters.ResourceTypeTopic:
		return 2
	case adapters.ResourceTypeGroup:
		return 3
	case adapters.ResourceTypeCluster:
		return 4
	case adapters.ResourceTypeTransactional:
		return 5
	default:
		return 0
	}
}

func (c *Client) mapPatternType(pt adapters.PatternType) kadm.ACLPatternType {
	switch pt {
	case adapters.PatternTypeLiteral:
		return kadm.ACLPatternLiteral
	case adapters.PatternTypePrefixed:
		return kadm.ACLPatternPrefixed
	default:
		return kadm.ACLPatternLiteral
	}
}

func (c *Client) mapOperation(op adapters.ACLOperation) kadm.ACLOperation {
	switch op {
	case adapters.ACLOperationAll:
		return kadm.OpAll
	case adapters.ACLOperationRead:
		return kadm.OpRead
	case adapters.ACLOperationWrite:
		return kadm.OpWrite
	case adapters.ACLOperationCreate:
		return kadm.OpCreate
	case adapters.ACLOperationDelete:
		return kadm.OpDelete
	case adapters.ACLOperationAlter:
		return kadm.OpAlter
	case adapters.ACLOperationDescribe:
		return kadm.OpDescribe
	default:
		return kadm.OpAll
	}
}

func (c *Client) mapPermission(pt adapters.ACLPermissionType) kadm.ACLPermission {
	switch pt {
	case adapters.ACLPermissionAllow:
		return kadm.ACLPermissionAllow
	case adapters.ACLPermissionDeny:
		return kadm.ACLPermissionDeny
	default:
		return kadm.ACLPermissionAllow
	}
}

// Ensure Client implements KafkaAdapter
var _ adapters.KafkaAdapter = (*Client)(nil)
```

Also add ErrTopicNotFound to adapters/types.go:

```go
// Add to adapters/types.go
import "errors"

var (
	ErrTopicNotFound = errors.New("topic not found")
)
```

**Step 4: Run test to verify it passes**

Run: `cd services/kafka && go test -v ./internal/adapters/apache/...`

Expected: PASS

**Step 5: Commit**

```bash
git add services/kafka/internal/adapters/
git commit -m "feat(kafka): implement Apache Kafka adapter using franz-go

Full implementation of KafkaAdapter interface including:
- Topic CRUD operations
- ACL management
- Consumer group lag monitoring
- SASL authentication support (PLAIN, SCRAM)
- Proper error handling and type mappings"
```

---

### Task 2.3: Implement Schema Registry Adapter

**Files:**
- Create: `services/kafka/internal/adapters/schema/client.go`
- Create: `services/kafka/internal/adapters/schema/client_test.go`

**Step 1: Write the failing test**

```go
package schema

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewClient_ValidConfig(t *testing.T) {
	config := Config{
		URL: "http://localhost:8081",
	}

	client, err := NewClient(config)
	require.NoError(t, err)
	assert.NotNil(t, client)
}

func TestNewClient_EmptyURL(t *testing.T) {
	config := Config{
		URL: "",
	}

	client, err := NewClient(config)
	assert.Error(t, err)
	assert.Nil(t, client)
	assert.Contains(t, err.Error(), "URL required")
}

func TestGenerateSubject(t *testing.T) {
	tests := []struct {
		env       string
		workspace string
		topic     string
		schemaType string
		expected  string
	}{
		{"dev", "payments", "orders", "value", "dev.payments.orders-value"},
		{"prod", "analytics", "events", "key", "prod.analytics.events-key"},
	}

	for _, tt := range tests {
		result := GenerateSubject(tt.env, tt.workspace, tt.topic, tt.schemaType)
		assert.Equal(t, tt.expected, result)
	}
}
```

**Step 2: Run test to verify it fails**

Run: `cd services/kafka && go test -v ./internal/adapters/schema/...`

Expected: FAIL - package not defined

**Step 3: Write minimal implementation**

```go
package schema

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"github.com/drewpayment/orbit/services/kafka/internal/adapters"
	"github.com/drewpayment/orbit/services/kafka/internal/domain"
)

// Config holds the connection configuration for Schema Registry
type Config struct {
	URL      string
	Username string
	Password string
}

// Client implements the SchemaRegistryAdapter interface
type Client struct {
	baseURL    string
	httpClient *http.Client
	username   string
	password   string
}

// NewClient creates a new Schema Registry client
func NewClient(config Config) (*Client, error) {
	if config.URL == "" {
		return nil, errors.New("URL required")
	}

	// Validate URL
	_, err := url.Parse(config.URL)
	if err != nil {
		return nil, fmt.Errorf("invalid URL: %w", err)
	}

	return &Client{
		baseURL: config.URL,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
		username: config.Username,
		password: config.Password,
	}, nil
}

// GenerateSubject creates a subject name from the naming template
func GenerateSubject(environment, workspace, topic, schemaType string) string {
	return fmt.Sprintf("%s.%s.%s-%s", environment, workspace, topic, schemaType)
}

// RegisterSchema registers a new schema
func (c *Client) RegisterSchema(ctx context.Context, subject string, schema adapters.SchemaSpec) (adapters.SchemaResult, error) {
	reqBody := map[string]interface{}{
		"schema":     schema.Schema,
		"schemaType": schema.SchemaType,
	}

	if len(schema.References) > 0 {
		refs := make([]map[string]interface{}, len(schema.References))
		for i, ref := range schema.References {
			refs[i] = map[string]interface{}{
				"name":    ref.Name,
				"subject": ref.Subject,
				"version": ref.Version,
			}
		}
		reqBody["references"] = refs
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return adapters.SchemaResult{}, fmt.Errorf("failed to marshal request: %w", err)
	}

	url := fmt.Sprintf("%s/subjects/%s/versions", c.baseURL, subject)
	resp, err := c.doRequest(ctx, "POST", url, body)
	if err != nil {
		return adapters.SchemaResult{}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return adapters.SchemaResult{}, c.parseError(resp)
	}

	var result struct {
		ID int `json:"id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return adapters.SchemaResult{}, fmt.Errorf("failed to decode response: %w", err)
	}

	// Get the version
	version, err := c.getLatestVersion(ctx, subject)
	if err != nil {
		return adapters.SchemaResult{}, err
	}

	return adapters.SchemaResult{
		ID:      result.ID,
		Version: version,
	}, nil
}

// GetSchema gets a specific schema version
func (c *Client) GetSchema(ctx context.Context, subject string, version int) (*adapters.SchemaInfo, error) {
	url := fmt.Sprintf("%s/subjects/%s/versions/%d", c.baseURL, subject, version)
	resp, err := c.doRequest(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, adapters.ErrSchemaNotFound
	}
	if resp.StatusCode != http.StatusOK {
		return nil, c.parseError(resp)
	}

	var result struct {
		Subject    string `json:"subject"`
		Version    int    `json:"version"`
		ID         int    `json:"id"`
		SchemaType string `json:"schemaType"`
		Schema     string `json:"schema"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &adapters.SchemaInfo{
		Subject:    result.Subject,
		Version:    result.Version,
		ID:         result.ID,
		SchemaType: result.SchemaType,
		Schema:     result.Schema,
	}, nil
}

// GetLatestSchema gets the latest schema version
func (c *Client) GetLatestSchema(ctx context.Context, subject string) (*adapters.SchemaInfo, error) {
	url := fmt.Sprintf("%s/subjects/%s/versions/latest", c.baseURL, subject)
	resp, err := c.doRequest(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, adapters.ErrSchemaNotFound
	}
	if resp.StatusCode != http.StatusOK {
		return nil, c.parseError(resp)
	}

	var result struct {
		Subject    string `json:"subject"`
		Version    int    `json:"version"`
		ID         int    `json:"id"`
		SchemaType string `json:"schemaType"`
		Schema     string `json:"schema"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &adapters.SchemaInfo{
		Subject:    result.Subject,
		Version:    result.Version,
		ID:         result.ID,
		SchemaType: result.SchemaType,
		Schema:     result.Schema,
	}, nil
}

// ListVersions lists all versions for a subject
func (c *Client) ListVersions(ctx context.Context, subject string) ([]int, error) {
	url := fmt.Sprintf("%s/subjects/%s/versions", c.baseURL, subject)
	resp, err := c.doRequest(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, adapters.ErrSchemaNotFound
	}
	if resp.StatusCode != http.StatusOK {
		return nil, c.parseError(resp)
	}

	var versions []int
	if err := json.NewDecoder(resp.Body).Decode(&versions); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return versions, nil
}

// CheckCompatibility checks if a schema is compatible
func (c *Client) CheckCompatibility(ctx context.Context, subject string, schema adapters.SchemaSpec) (bool, error) {
	reqBody := map[string]interface{}{
		"schema":     schema.Schema,
		"schemaType": schema.SchemaType,
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return false, fmt.Errorf("failed to marshal request: %w", err)
	}

	url := fmt.Sprintf("%s/compatibility/subjects/%s/versions/latest", c.baseURL, subject)
	resp, err := c.doRequest(ctx, "POST", url, body)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()

	// 404 means no existing schema - new schemas are always compatible
	if resp.StatusCode == http.StatusNotFound {
		return true, nil
	}
	if resp.StatusCode != http.StatusOK {
		return false, c.parseError(resp)
	}

	var result struct {
		IsCompatible bool `json:"is_compatible"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return false, fmt.Errorf("failed to decode response: %w", err)
	}

	return result.IsCompatible, nil
}

// DeleteSubject deletes a subject and all its versions
func (c *Client) DeleteSubject(ctx context.Context, subject string) error {
	url := fmt.Sprintf("%s/subjects/%s", c.baseURL, subject)
	resp, err := c.doRequest(ctx, "DELETE", url, nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil // Already deleted
	}
	if resp.StatusCode != http.StatusOK {
		return c.parseError(resp)
	}

	return nil
}

// ListSubjects lists all subjects
func (c *Client) ListSubjects(ctx context.Context) ([]string, error) {
	url := fmt.Sprintf("%s/subjects", c.baseURL)
	resp, err := c.doRequest(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, c.parseError(resp)
	}

	var subjects []string
	if err := json.NewDecoder(resp.Body).Decode(&subjects); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return subjects, nil
}

// GetCompatibility gets the compatibility level for a subject
func (c *Client) GetCompatibility(ctx context.Context, subject string) (domain.SchemaCompatibility, error) {
	url := fmt.Sprintf("%s/config/%s", c.baseURL, subject)
	resp, err := c.doRequest(ctx, "GET", url, nil)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	// 404 means using global default
	if resp.StatusCode == http.StatusNotFound {
		return c.getGlobalCompatibility(ctx)
	}
	if resp.StatusCode != http.StatusOK {
		return "", c.parseError(resp)
	}

	var result struct {
		CompatibilityLevel string `json:"compatibilityLevel"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("failed to decode response: %w", err)
	}

	return mapCompatibility(result.CompatibilityLevel), nil
}

// SetCompatibility sets the compatibility level for a subject
func (c *Client) SetCompatibility(ctx context.Context, subject string, compatibility domain.SchemaCompatibility) error {
	reqBody := map[string]string{
		"compatibility": string(compatibility),
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return fmt.Errorf("failed to marshal request: %w", err)
	}

	url := fmt.Sprintf("%s/config/%s", c.baseURL, subject)
	resp, err := c.doRequest(ctx, "PUT", url, body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return c.parseError(resp)
	}

	return nil
}

// Helper methods

func (c *Client) doRequest(ctx context.Context, method, url string, body []byte) (*http.Response, error) {
	var bodyReader io.Reader
	if body != nil {
		bodyReader = bytes.NewReader(body)
	}

	req, err := http.NewRequestWithContext(ctx, method, url, bodyReader)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/vnd.schemaregistry.v1+json")
	req.Header.Set("Accept", "application/vnd.schemaregistry.v1+json")

	if c.username != "" {
		req.SetBasicAuth(c.username, c.password)
	}

	return c.httpClient.Do(req)
}

func (c *Client) parseError(resp *http.Response) error {
	body, _ := io.ReadAll(resp.Body)
	var errResp struct {
		ErrorCode int    `json:"error_code"`
		Message   string `json:"message"`
	}
	if err := json.Unmarshal(body, &errResp); err != nil {
		return fmt.Errorf("request failed with status %d: %s", resp.StatusCode, string(body))
	}
	return fmt.Errorf("schema registry error %d: %s", errResp.ErrorCode, errResp.Message)
}

func (c *Client) getLatestVersion(ctx context.Context, subject string) (int, error) {
	versions, err := c.ListVersions(ctx, subject)
	if err != nil {
		return 0, err
	}
	if len(versions) == 0 {
		return 1, nil
	}
	return versions[len(versions)-1], nil
}

func (c *Client) getGlobalCompatibility(ctx context.Context) (domain.SchemaCompatibility, error) {
	url := fmt.Sprintf("%s/config", c.baseURL)
	resp, err := c.doRequest(ctx, "GET", url, nil)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return domain.SchemaCompatibilityBackward, nil // Default
	}

	var result struct {
		CompatibilityLevel string `json:"compatibilityLevel"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return domain.SchemaCompatibilityBackward, nil
	}

	return mapCompatibility(result.CompatibilityLevel), nil
}

func mapCompatibility(level string) domain.SchemaCompatibility {
	switch level {
	case "BACKWARD", "BACKWARD_TRANSITIVE":
		return domain.SchemaCompatibilityBackward
	case "FORWARD", "FORWARD_TRANSITIVE":
		return domain.SchemaCompatibilityForward
	case "FULL", "FULL_TRANSITIVE":
		return domain.SchemaCompatibilityFull
	case "NONE":
		return domain.SchemaCompatibilityNone
	default:
		return domain.SchemaCompatibilityBackward
	}
}

// Ensure Client implements SchemaRegistryAdapter
var _ adapters.SchemaRegistryAdapter = (*Client)(nil)
```

Also add ErrSchemaNotFound to adapters/types.go:

```go
// Add to the var block in adapters/types.go
ErrSchemaNotFound = errors.New("schema not found")
```

**Step 4: Run test to verify it passes**

Run: `cd services/kafka && go test -v ./internal/adapters/schema/...`

Expected: PASS

**Step 5: Commit**

```bash
git add services/kafka/internal/adapters/
git commit -m "feat(kafka): implement Schema Registry adapter

HTTP client for Confluent Schema Registry API including:
- Schema registration and retrieval
- Compatibility checking
- Subject management
- Basic auth support
- Subject naming convention helper"
```

---

## Phase 3: Payload CMS Collections

This phase creates the frontend collections. Due to the length of this plan, I'll outline the remaining phases with task headers and key details.

### Task 3.1: Create KafkaProviders Collection
**Files:** `orbit-www/src/collections/kafka/KafkaProviders.ts`

### Task 3.2: Create KafkaClusters Collection
**Files:** `orbit-www/src/collections/kafka/KafkaClusters.ts`

### Task 3.3: Create KafkaEnvironmentMappings Collection
**Files:** `orbit-www/src/collections/kafka/KafkaEnvironmentMappings.ts`

### Task 3.4: Create KafkaTopics Collection
**Files:** `orbit-www/src/collections/kafka/KafkaTopics.ts`

### Task 3.5: Create KafkaSchemas Collection
**Files:** `orbit-www/src/collections/kafka/KafkaSchemas.ts`

### Task 3.6: Create KafkaServiceAccounts Collection
**Files:** `orbit-www/src/collections/kafka/KafkaServiceAccounts.ts`

### Task 3.7: Create KafkaTopicShares Collection
**Files:** `orbit-www/src/collections/kafka/KafkaTopicShares.ts`

### Task 3.8: Create KafkaTopicSharePolicies Collection
**Files:** `orbit-www/src/collections/kafka/KafkaTopicSharePolicies.ts`

### Task 3.9: Create KafkaTopicPolicies Collection
**Files:** `orbit-www/src/collections/kafka/KafkaTopicPolicies.ts`

### Task 3.10: Create Usage & Lineage Collections
**Files:**
- `orbit-www/src/collections/kafka/KafkaUsageMetrics.ts`
- `orbit-www/src/collections/kafka/KafkaConsumerGroups.ts`
- `orbit-www/src/collections/kafka/KafkaClientActivity.ts`

### Task 3.11: Register Collections in Payload Config
**Files:** `orbit-www/src/payload.config.ts`

---

## Phase 4: gRPC Service Implementation

### Task 4.1: Create Service Layer
**Files:**
- `services/kafka/internal/service/cluster_service.go`
- `services/kafka/internal/service/topic_service.go`
- `services/kafka/internal/service/schema_service.go`
- `services/kafka/internal/service/share_service.go`
- `services/kafka/internal/service/policy_evaluator.go`

### Task 4.2: Create gRPC Handlers
**Files:**
- `services/kafka/internal/grpc/server.go`
- `services/kafka/internal/grpc/cluster_handler.go`
- `services/kafka/internal/grpc/topic_handler.go`
- `services/kafka/internal/grpc/schema_handler.go`
- `services/kafka/internal/grpc/share_handler.go`

### Task 4.3: Create Main Entry Point
**Files:** `services/kafka/cmd/server/main.go`

---

## Phase 5: Temporal Workflows

### Task 5.1: Create Topic Provisioning Workflow
**Files:**
- `temporal-workflows/internal/workflows/kafka_topic_provisioning.go`
- `temporal-workflows/internal/activities/kafka_activities.go`

### Task 5.2: Create ACL Sync Workflow
**Files:** `temporal-workflows/internal/workflows/kafka_acl_sync.go`

### Task 5.3: Create Metrics Collection Workflow
**Files:** `temporal-workflows/internal/workflows/kafka_metrics_collection.go`

### Task 5.4: Register Workflows in Worker
**Files:** `temporal-workflows/cmd/worker/main.go` (modify)

---

## Phase 6: Server Actions & API Routes

### Task 6.1: Create Kafka Server Actions
**Files:**
- `orbit-www/src/app/actions/kafka/topics.ts`
- `orbit-www/src/app/actions/kafka/schemas.ts`
- `orbit-www/src/app/actions/kafka/shares.ts`
- `orbit-www/src/app/actions/kafka/service-accounts.ts`

### Task 6.2: Create Internal API Routes
**Files:**
- `orbit-www/src/app/api/internal/kafka/topics/route.ts`
- `orbit-www/src/app/api/internal/kafka/clusters/route.ts`

---

## Phase 7: Frontend UI

### Task 7.1: Create Workspace Kafka Dashboard
**Files:** `orbit-www/src/app/(frontend)/workspaces/[slug]/kafka/page.tsx`

### Task 7.2: Create Topic Management Pages
**Files:**
- `orbit-www/src/app/(frontend)/workspaces/[slug]/kafka/topics/page.tsx`
- `orbit-www/src/app/(frontend)/workspaces/[slug]/kafka/topics/[id]/page.tsx`
- `orbit-www/src/app/(frontend)/workspaces/[slug]/kafka/topics/new/page.tsx`

### Task 7.3: Create Topic Discovery/Catalog Page
**Files:** `orbit-www/src/app/(frontend)/kafka/page.tsx`

### Task 7.4: Create Access Request Management
**Files:** `orbit-www/src/app/(frontend)/workspaces/[slug]/kafka/access-requests/page.tsx`

### Task 7.5: Create Platform Admin Pages
**Files:**
- `orbit-www/src/app/(frontend)/settings/kafka/clusters/page.tsx`
- `orbit-www/src/app/(frontend)/settings/kafka/environments/page.tsx`
- `orbit-www/src/app/(frontend)/settings/kafka/policies/page.tsx`

---

## Phase 8: Terraform Provider (Future)

### Task 8.1: Initialize Terraform Provider Module
**Files:** `terraform-provider-orbit/go.mod`

### Task 8.2: Implement Provider Configuration
**Files:** `terraform-provider-orbit/internal/provider/provider.go`

### Task 8.3: Implement Kafka Topic Resource
**Files:** `terraform-provider-orbit/internal/resources/kafka_topic.go`

### Task 8.4: Implement Kafka Schema Resource
**Files:** `terraform-provider-orbit/internal/resources/kafka_schema.go`

### Task 8.5: Implement Topic Share Resource
**Files:** `terraform-provider-orbit/internal/resources/kafka_topic_share.go`

---

## Phase 9: Integration Testing

### Task 9.1: Create Kafka Service Integration Tests
**Files:** `services/kafka/tests/integration_test.go`

### Task 9.2: Create Temporal Workflow Tests
**Files:** `temporal-workflows/internal/workflows/kafka_test.go`

### Task 9.3: Create E2E Tests
**Files:** `orbit-www/e2e/kafka.spec.ts`

---

## Implementation Order

1. **Phase 1** (Foundation) - Must complete first
2. **Phase 2** (Adapters) - Can start after Task 1.3
3. **Phase 3** (Collections) - Can start after Phase 1
4. **Phase 4** (gRPC Service) - Requires Phase 1, 2
5. **Phase 5** (Temporal) - Requires Phase 4
6. **Phase 6** (Server Actions) - Requires Phase 3
7. **Phase 7** (UI) - Requires Phase 3, 6
8. **Phase 8** (Terraform) - Requires Phase 4 (can defer)
9. **Phase 9** (Testing) - Continuous throughout

---

## Verification Commands

```bash
# Build kafka service
cd services/kafka && go build ./...

# Run kafka service tests
cd services/kafka && go test -v -race ./...

# Build frontend
cd orbit-www && pnpm build

# Run frontend tests
cd orbit-www && pnpm test

# Generate proto code
make proto-gen

# Run linting
make lint
```
