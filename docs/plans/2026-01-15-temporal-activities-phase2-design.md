# Temporal Activities Phase 2: Kafka & Schema Registry Integration

**Status:** DRAFT
**Date:** 2026-01-15
**Scope:** Wire real Kafka and Schema Registry adapters into Temporal activities

## 1. Overview

Phase 1 implemented the Topic Provisioning Path with simulated/stubbed Kafka operations. Phase 2 connects the real adapters to enable:

1. **Schema validation and registration** via Schema Registry
2. **ACL provisioning** via Kafka Admin API (for direct cluster access, not Bifrost gateway)
3. **Topic operations** via Kafka Admin API (currently simulated)

### Architecture Clarification

There are **two ACL paths** in the system:

| Path | Use Case | Implementation |
|------|----------|----------------|
| **Bifrost Gateway ACLs** | Cross-application topic sharing | `TopicShareActivities` → `BifrostClient.UpsertTopicACL()` |
| **Direct Kafka ACLs** | Service account provisioning | `KafkaActivities` → `KafkaAdapter.CreateACL()` |

This design focuses on **KafkaActivities** which needs direct cluster access.

## 2. Current State

### 2.1 Existing Adapters (in `services/kafka`)

| Adapter | Location | Status |
|---------|----------|--------|
| `KafkaAdapter` | `services/kafka/internal/adapters/apache/client.go` | ✅ Complete |
| `SchemaRegistryAdapter` | `services/kafka/internal/adapters/schema/client.go` | ✅ Complete |

### 2.2 Current Activity Dependencies

```go
// temporal-workflows/internal/activities/kafka_activities.go
type KafkaActivitiesImpl struct {
    payloadClient *clients.PayloadClient  // ✅ Implemented
    logger        *slog.Logger            // ✅ Implemented
    // Missing: KafkaAdapter, SchemaRegistryAdapter
}
```

### 2.3 Stubbed Methods Requiring Real Implementation

| Method | Current Behavior | Needs |
|--------|-----------------|-------|
| `ProvisionTopic` | Returns simulated success | KafkaAdapter.CreateTopic |
| `DeleteTopic` | No-op | KafkaAdapter.DeleteTopic |
| `ValidateSchema` | Returns `compatible=true` | SchemaRegistryAdapter.CheckCompatibility |
| `RegisterSchema` | Returns mock IDs | SchemaRegistryAdapter.RegisterSchema |
| `ProvisionAccess` | Returns mock ACL names | KafkaAdapter.CreateACL |
| `RevokeAccess` | No-op | KafkaAdapter.DeleteACL |

## 3. Design Decision: Adapter Integration

### Option Analysis

| Option | Pros | Cons |
|--------|------|------|
| **A: Import services/kafka** | Simple, reuses existing code | Cross-module dependency |
| **B: gRPC to kafka-service** | Clean separation | Network hop, service must run |
| **C: Copy adapter code** | No dependencies | Code duplication |
| **D: Shared module** | Cleanest architecture | Requires module restructuring |

### Decision: Option A (Import services/kafka)

**Rationale:**
- The adapters are stateless client wrappers with no business logic
- Both modules are in the same monorepo
- Phase 1 design already specified `apache.Client` as a dependency
- Go module replace directives handle cross-module imports cleanly

**Implementation:**
```go
// temporal-workflows/go.mod
replace github.com/drewpayment/orbit/services/kafka => ../services/kafka
```

## 4. Detailed Design

### 4.1 New Input Types

The activities need cluster connection info. Rather than hardcoding, we'll look up cluster config from Payload CMS.

```go
// Extended input types for activities that need cluster access
type KafkaTopicProvisionInput struct {
    // Existing fields...
    ClusterID string `json:"clusterId"` // Added: to look up connection config
}

type KafkaSchemaValidationInput struct {
    // Existing fields...
    SchemaRegistryURL string `json:"schemaRegistryUrl"` // Added: direct URL or cluster lookup
}

type KafkaAccessProvisionInput struct {
    // Existing fields...
    ClusterID       string `json:"clusterId"`       // Added: for Kafka connection
    TopicName       string `json:"topicName"`       // Added: physical topic name
    ServiceAccount  string `json:"serviceAccount"`  // Added: principal for ACL
}
```

### 4.2 Adapter Factory Pattern

Create adapters on-demand using cluster config from Payload CMS:

```go
// temporal-workflows/internal/clients/kafka_adapter_factory.go
package clients

import (
    "context"
    "github.com/drewpayment/orbit/services/kafka/internal/adapters"
    "github.com/drewpayment/orbit/services/kafka/internal/adapters/apache"
    "github.com/drewpayment/orbit/services/kafka/internal/adapters/schema"
)

type KafkaAdapterFactory struct {
    payloadClient *PayloadClient
}

func NewKafkaAdapterFactory(payloadClient *PayloadClient) *KafkaAdapterFactory {
    return &KafkaAdapterFactory{payloadClient: payloadClient}
}

// CreateKafkaAdapter creates a Kafka adapter for a specific cluster
func (f *KafkaAdapterFactory) CreateKafkaAdapter(ctx context.Context, clusterID string) (adapters.KafkaAdapter, error) {
    // 1. Fetch cluster config from Payload CMS
    cluster, err := f.payloadClient.Get(ctx, "kafka-clusters", clusterID)
    if err != nil {
        return nil, fmt.Errorf("fetching cluster config: %w", err)
    }

    // 2. Extract connection config
    connectionConfig := cluster["connectionConfig"].(map[string]any)

    // 3. Fetch credentials (from provider or cluster)
    credentials, err := f.fetchCredentials(ctx, cluster)
    if err != nil {
        return nil, fmt.Errorf("fetching credentials: %w", err)
    }

    // 4. Create adapter
    return apache.NewClientFromCluster(
        mapToStringMap(connectionConfig),
        credentials,
    )
}

// CreateSchemaRegistryAdapter creates a Schema Registry adapter
func (f *KafkaAdapterFactory) CreateSchemaRegistryAdapter(ctx context.Context, registryURL string) (adapters.SchemaRegistryAdapter, error) {
    // For MVP, use URL directly without auth
    // Future: look up registry config from cluster
    return schema.NewClient(schema.Config{
        URL: registryURL,
    })
}
```

### 4.3 Updated KafkaActivitiesImpl

```go
// temporal-workflows/internal/activities/kafka_activities.go
type KafkaActivitiesImpl struct {
    payloadClient  *clients.PayloadClient
    adapterFactory *clients.KafkaAdapterFactory
    logger         *slog.Logger
}

func NewKafkaActivities(
    payloadClient *clients.PayloadClient,
    adapterFactory *clients.KafkaAdapterFactory,
    logger *slog.Logger,
) *KafkaActivitiesImpl {
    return &KafkaActivitiesImpl{
        payloadClient:  payloadClient,
        adapterFactory: adapterFactory,
        logger:         logger,
    }
}
```

### 4.4 Activity Implementations

#### ProvisionTopic
```go
func (a *KafkaActivitiesImpl) ProvisionTopic(ctx context.Context, input KafkaTopicProvisionInput) (*KafkaTopicProvisionOutput, error) {
    // 1. Create adapter for target cluster
    adapter, err := a.adapterFactory.CreateKafkaAdapter(ctx, input.ClusterID)
    if err != nil {
        return nil, fmt.Errorf("creating kafka adapter: %w", err)
    }
    defer adapter.Close()

    // 2. Generate physical topic name
    physicalName := input.TopicPrefix + input.TopicName

    // 3. Create topic spec
    spec := adapters.TopicSpec{
        Name:              physicalName,
        Partitions:        input.Partitions,
        ReplicationFactor: input.ReplicationFactor,
        Config:            input.Config,
    }

    // 4. Create topic
    if err := adapter.CreateTopic(ctx, spec); err != nil {
        return nil, fmt.Errorf("creating topic: %w", err)
    }

    return &KafkaTopicProvisionOutput{
        TopicID:       input.TopicID,
        PhysicalName:  physicalName,
        ProvisionedAt: time.Now(),
    }, nil
}
```

#### ValidateSchema
```go
func (a *KafkaActivitiesImpl) ValidateSchema(ctx context.Context, input KafkaSchemaValidationInput) (*KafkaSchemaValidationOutput, error) {
    // 1. Create schema registry adapter
    adapter, err := a.adapterFactory.CreateSchemaRegistryAdapter(ctx, input.SchemaRegistryURL)
    if err != nil {
        return nil, fmt.Errorf("creating schema registry adapter: %w", err)
    }

    // 2. Generate subject name
    subject := schema.GenerateSubject(input.Environment, input.Workspace, input.TopicName, input.Type)

    // 3. Check compatibility
    compatible, err := adapter.CheckCompatibility(ctx, subject, adapters.SchemaSpec{
        Schema:     input.Content,
        SchemaType: input.Format,
    })
    if err != nil {
        return nil, fmt.Errorf("checking compatibility: %w", err)
    }

    return &KafkaSchemaValidationOutput{
        SchemaID:     input.SchemaID,
        IsCompatible: compatible,
        ValidatedAt:  time.Now(),
    }, nil
}
```

#### ProvisionAccess
```go
func (a *KafkaActivitiesImpl) ProvisionAccess(ctx context.Context, input KafkaAccessProvisionInput) (*KafkaAccessProvisionOutput, error) {
    // 1. Create adapter
    adapter, err := a.adapterFactory.CreateKafkaAdapter(ctx, input.ClusterID)
    if err != nil {
        return nil, fmt.Errorf("creating kafka adapter: %w", err)
    }
    defer adapter.Close()

    // 2. Build ACLs based on permission level
    acls := buildACLsForPermission(input.ServiceAccount, input.TopicName, input.Permission)

    // 3. Create each ACL
    var created []string
    for _, acl := range acls {
        if err := adapter.CreateACL(ctx, acl); err != nil {
            return nil, fmt.Errorf("creating ACL: %w", err)
        }
        created = append(created, fmt.Sprintf("%s-%s-%s", acl.ResourceName, acl.Principal, acl.Operation))
    }

    return &KafkaAccessProvisionOutput{
        ShareID:       input.ShareID,
        ACLsCreated:   created,
        ProvisionedAt: time.Now(),
    }, nil
}

func buildACLsForPermission(principal, topicName, permission string) []adapters.ACLSpec {
    var acls []adapters.ACLSpec

    // Always add DESCRIBE
    acls = append(acls, adapters.ACLSpec{
        ResourceType:   adapters.ResourceTypeTopic,
        ResourceName:   topicName,
        PatternType:    adapters.PatternTypeLiteral,
        Principal:      "User:" + principal,
        Host:           "*",
        Operation:      adapters.ACLOperationDescribe,
        PermissionType: adapters.ACLPermissionAllow,
    })

    if permission == "read" || permission == "read_write" {
        acls = append(acls, adapters.ACLSpec{
            ResourceType:   adapters.ResourceTypeTopic,
            ResourceName:   topicName,
            PatternType:    adapters.PatternTypeLiteral,
            Principal:      "User:" + principal,
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
            Principal:      "User:" + principal,
            Host:           "*",
            Operation:      adapters.ACLOperationWrite,
            PermissionType: adapters.ACLPermissionAllow,
        })
    }

    return acls
}
```

## 5. Worker Integration Changes

```go
// temporal-workflows/cmd/worker/main.go

// Add import
import (
    "github.com/drewpayment/orbit/services/kafka/internal/adapters/apache"
    "github.com/drewpayment/orbit/services/kafka/internal/adapters/schema"
)

// In main():
// Create adapter factory
adapterFactory := clients.NewKafkaAdapterFactory(payloadClient)

// Update KafkaActivities creation
kafkaActivities := activities.NewKafkaActivities(payloadClient, adapterFactory, logger)
```

## 6. Go Module Configuration

```go
// temporal-workflows/go.mod
module github.com/drewpayment/orbit/temporal-workflows

require (
    github.com/drewpayment/orbit/services/kafka v0.0.0
    // ... existing deps
)

replace github.com/drewpayment/orbit/services/kafka => ../services/kafka
```

## 7. Testing Strategy

### Unit Tests
- Mock `KafkaAdapterFactory` to return mock adapters
- Test each activity method in isolation
- Verify correct adapter method calls

### Integration Tests
- Run against local Redpanda (already validated in adapter tests)
- Test full workflow: create topic → validate schema → register → create ACL
- Verify cleanup on failure

## 8. Implementation Tasks

| Task | Description | Files |
|------|-------------|-------|
| 1 | Add go.mod replace directive | `temporal-workflows/go.mod` |
| 2 | Create KafkaAdapterFactory | `temporal-workflows/internal/clients/kafka_adapter_factory.go` |
| 3 | Update KafkaActivitiesImpl struct | `kafka_activities.go` |
| 4 | Implement ProvisionTopic | `kafka_activities.go` |
| 5 | Implement DeleteTopic | `kafka_activities.go` |
| 6 | Implement ValidateSchema | `kafka_activities.go` |
| 7 | Implement RegisterSchema | `kafka_activities.go` |
| 8 | Implement ProvisionAccess | `kafka_activities.go` |
| 9 | Implement RevokeAccess | `kafka_activities.go` |
| 10 | Update worker main.go | `cmd/worker/main.go` |
| 11 | Add unit tests | `kafka_activities_test.go` |
| 12 | Integration test | `tests/integration/` |

## 9. Out of Scope

- TopicShareActivities (uses Bifrost, not direct Kafka)
- DecommissioningActivities (separate phase)
- LineageActivities (already implemented)
- Email notifications
