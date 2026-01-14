# Orbit Project TODO

This document tracks planned features, incomplete implementations, and technical debt across the Orbit codebase.

**Last Updated:** 2026-01-13

---

## Bifrost (Kafka Self-Service) - Primary Focus

### Completed Components

The following are fully implemented and functional:

- [x] **Payload CMS Collections** - All 22 Kafka collections defined and registered
  - KafkaProviders, KafkaClusters, KafkaEnvironmentMappings
  - KafkaApplications, KafkaVirtualClusters, KafkaTopics
  - KafkaSchemas, KafkaSchemaVersions, KafkaServiceAccounts, KafkaConsumerGroups
  - KafkaConsumerGroupLagHistory (Phase 7)
  - KafkaTopicShares, KafkaTopicSharePolicies, KafkaTopicPolicies
  - KafkaApplicationQuotas, KafkaApplicationRequests
  - KafkaChargebackRates, KafkaUsageMetrics, KafkaClientActivity
  - KafkaLineageEdge, KafkaLineageSnapshot, KafkaOffsetCheckpoints

- [x] **Phase 7 Collections** (Schema Registry & Consumer Groups)
  - KafkaSchemaVersions - Historical versions of schemas
  - KafkaConsumerGroupLagHistory - Time-series lag data for charting
  - KafkaSchemas extended with: `latestVersion`, `versionCount`, `firstRegisteredAt`, `lastRegisteredAt`, `stale` status
  - KafkaConsumerGroups extended with: `subscribedTopics`, `coordinatorBroker`, `assignmentStrategy`, `status`

- [x] **Frontend UI Pages** - All workspace and platform Kafka pages
  - Platform admin, billing, pending approvals
  - Workspace topics, applications, catalog, shares
  - Application detail, lineage, recovery pages

- [x] **Go Kafka Service** (`services/kafka/`)
  - Domain models, gRPC handlers, service layer
  - Contract tests (1,293 lines)
  - Schema Registry adapter (full HTTP client)
  - Apache Kafka adapter: ValidateConnection, CreateTopic, DeleteTopic, ListTopics

- [x] **Bifrost Gateway** (`gateway/bifrost/`)
  - All filters: Auth, Policy, TopicRewrite, GroupRewrite, TopicACL, ActivityTracking
  - All stores: VirtualCluster, Credential, Policy, ACL
  - Admin service with gRPC API
  - Metrics collection and Prometheus endpoint
  - Activity accumulator and emitter

- [x] **Temporal Workflows** - Orchestration logic exists
  - TopicProvisioningWorkflow, TopicDeletionWorkflow
  - SchemaValidationWorkflow, AccessProvisioningWorkflow
  - ApplicationDecommissioningWorkflow, ApplicationCleanupWorkflow
  - OffsetCheckpointWorkflow, OffsetRestoreWorkflow

- [x] **Server Actions (CRUD)** - Payload CMS operations work
  - `kafka-admin.ts` - providers, clusters, mappings
  - `kafka-applications.ts` - application CRUD
  - `kafka-quotas.ts` - quota management
  - `kafka-lineage.ts` - lineage queries

---

### High Priority - Temporal Activity Implementation

**Status:** Topic Provisioning Path implemented, other activities stubbed
**Location:** `temporal-workflows/internal/activities/`

#### Shared Infrastructure (COMPLETED)
- [x] `PayloadClient` - Generic HTTP client for Payload CMS REST API (`internal/clients/payload_client.go`)
- [x] `BifrostClient` - gRPC client for Bifrost Admin Service (`internal/clients/bifrost_client.go`)

#### virtual_cluster_activities.go (COMPLETED - Topic Provisioning Path)
- [x] `GetEnvironmentMapping` - Queries kafka-environment-mappings for default cluster
- [x] `CreateVirtualCluster` - Creates virtual cluster record in Payload CMS
- [x] `PushToBifrost` - Calls BifrostClient.UpsertVirtualCluster via gRPC
- [x] `UpdateVirtualClusterStatus` - Updates status field in Payload CMS

#### kafka_activities.go (MVP COMPLETED - Status updates work)
- [x] `ProvisionTopic` - Generates physical topic name (actual Kafka creation TODO)
- [x] `UpdateTopicStatus` - Updates topic status in Payload CMS
- [x] `UpdateSchemaStatus` - Updates schema status in Payload CMS
- [x] `UpdateShareStatus` - Updates share status in Payload CMS
- [ ] `DeleteTopic` - Needs actual Kafka topic deletion via franz-go
- [ ] `ValidateSchema` - Needs Schema Registry API call
- [ ] `RegisterSchema` - Needs Schema Registry API call
- [ ] `ProvisionAccess` - Needs ACL creation via Kafka adapter
- [ ] `RevokeAccess` - Needs ACL deletion via Kafka adapter

#### topic_sync_activities.go (COMPLETED)
- [x] `CreateTopicRecord` - Creates topic in Payload CMS (for gateway passthrough)
- [x] `MarkTopicDeleted` - Updates topic status to deleted in Payload CMS
- [x] `UpdateTopicConfig` - Updates topic config in Payload CMS

#### credential_activities.go (Service Account Sync)
- [ ] `SyncCredentialToBifrost` - Needs Bifrost gRPC call
- [ ] `RevokeCredentialFromBifrost` - Needs Bifrost gRPC call

#### lineage_activities.go (Data Lineage)
- [ ] `ProcessClientActivityBatch` - Needs Payload CMS API calls
- [ ] `ResetStale24hMetrics` - Needs Payload CMS API call
- [ ] `MarkInactiveEdges` - Needs Payload CMS API call
- [ ] `CreateDailySnapshots` - Needs Payload CMS API calls

#### decommissioning_activities.go (Lifecycle Management)
- [ ] `SetVirtualClustersReadOnly` - Returns mock success
- [ ] `CheckpointConsumerOffsets` - Returns mock success
- [ ] `NotifyWorkspaceAdmins` - Returns mock success
- [ ] `ArchiveApplicationData` - Returns mock success
- [ ] `CleanupServiceAccounts` - Returns mock success
- [ ] `RevokeAllCredentials` - Returns mock success
- [ ] `DeletePhysicalTopics` - Returns mock success
- [ ] `RemoveFromBifrost` - Returns mock success
- [ ] `CreateAuditRecord` - Returns mock success
- [ ] `RestoreConsumerOffsets` - Returns mock success

---

### High Priority - Apache Kafka Adapter Gaps

**Status:** Several methods return `ErrNotConfigured`
**Location:** `services/kafka/internal/adapters/apache/client.go`

- [ ] `DescribeTopic` - Returns ErrNotConfigured (line 251)
- [ ] `UpdateTopicConfig` - Returns ErrNotConfigured (line 258)
- [ ] `CreateACL` - Returns ErrNotConfigured (line 292)
- [ ] `DeleteACL` - Returns ErrNotConfigured (line 299)
- [ ] `ListACLs` - Returns ErrNotConfigured (line 306)
- [ ] `GetTopicMetrics` - Returns ErrNotConfigured (line 313)
- [ ] `GetConsumerGroupLag` - Returns ErrNotConfigured (line 319)
- [ ] `ListConsumerGroups` - Returns ErrNotConfigured (line 326)
- [ ] SASL/TLS configuration - TODO at lines 69-72

---

### High Priority - Bifrost Callback Client

**Status:** gRPC client not initialized, only logs
**Location:** `gateway/bifrost/src/main/kotlin/io/orbit/bifrost/callback/BifrostCallbackClient.kt`

- [ ] Initialize gRPC channel and stub (line 49-51)
- [ ] Implement `emitClientActivity` RPC call (line 60-79)
- [ ] Add shutdown logic for gRPC channel (line 94)
- [ ] Define `EmitClientActivityRequest` proto message

---

### Medium Priority - Server Action Temporal Integration

**Status:** Temporal workflow triggers are placeholders
**Location:** `orbit-www/src/app/actions/`

- [ ] `kafka-topics.ts` - Temporal client calls (lines 518, 539)
- [ ] `kafka-topic-shares.ts` - `triggerShareApprovedWorkflow`, `triggerShareRevokedWorkflow` (lines 131-166)
- [ ] `kafka-topic-catalog.ts` - `triggerShareApprovedWorkflow`, `sendShareRequestNotification` (lines 128-143)
- [ ] `kafka-service-accounts.ts` - Temporal workflow triggers (lines 140, 202, 242)
- [ ] `kafka-offset-recovery.ts` - `executeOffsetRestore` returns placeholder (line 373)
- [ ] `kafka-application-lifecycle.ts` - Temporal workflow triggers (lines 236, 353, 487-488)

---

### Medium Priority - Integration Tests

**Status:** All marked as `it.todo`
**Location:** `orbit-www/src/app/actions/kafka-topic-catalog.integration.test.ts`

- [ ] 27 integration test cases need implementation (lines 18-96)

---

### Low Priority - Go Service Persistence

**Status:** In-memory repositories
**Location:** `services/kafka/cmd/server/main.go`

All repository implementations are in-memory stubs. Consider connecting to Payload CMS:
- [ ] `inMemoryClusterRepository`
- [ ] `inMemoryProviderRepository`
- [ ] `inMemoryMappingRepository`
- [ ] `inMemoryTopicRepository`
- [ ] `inMemoryPolicyRepository`
- [ ] `inMemorySchemaRepository`
- [ ] `inMemoryRegistryRepository`
- [ ] `inMemoryShareRepository`
- [ ] `inMemorySharePolicyRepository`
- [ ] `inMemoryServiceAccountRepository`

---

## Other High Priority Items

### GitOps Manifest Sync (`.orbit.yaml`)
**Status:** Schema exists, no implementation
**Location:** `orbit-www/src/collections/Apps.ts`

- [ ] Parse `.orbit.yaml` manifests from repositories
- [ ] Implement `orbit-primary` mode: UI changes auto-commit to repo
- [ ] Implement `manifest-primary` mode: GitHub webhook detects manifest changes
- [ ] Conflict resolution when DB and manifest diverge
- [ ] Manifest validation against schema

---

### Secret Encryption
**Status:** Values stored as plaintext
**Priority:** Security

- [ ] Implement encryption for secret values in Payload CMS
- [ ] Key rotation support
- [ ] Audit logging for secret access

---

### Temporal Worker Dependencies
**Status:** Nil placeholders
**Location:** `temporal-workflows/cmd/worker/main.go:137-142`

- [ ] `PayloadClient` - Payload CMS API communication
- [ ] `EncryptionService` - Secret encryption/decryption
- [ ] `GitHubClient` - GitHub API interactions

---

## Medium Priority

### GitHub Token Refresh Workflow
**Location:** `orbit-www/src/collections/GitHubInstallations.ts:253`

- [ ] Start GitHubTokenRefreshWorkflow automatically
- [ ] Handle token expiration gracefully
- [ ] Implement refresh retry logic

---

### Build Service (Railpack)
**Location:** `docs/plans/2025-12-04-railpack-build-service.md`

- [ ] Railpack analysis implementation
- [ ] Railpack build implementation
- [ ] Parse digest from Railpack output
- [ ] Multi-package manager support

---

### Template Activity Implementation
**Location:** `temporal-workflows/internal/activities/template_activities.go:385-387`

- [ ] Record template usage in database
- [ ] Send notification to user on instantiation
- [ ] Update template usage statistics

---

## Low Priority

### Admin Role Verification
- [ ] Implement proper RBAC in `orbit-www/src/access/isAdmin.ts`
- [ ] Platform admin verification for `/api/kafka/admin/*` routes

---

### Knowledge Space Navigation
**Location:** `docs/plans/2025-11-23-knowledge-space-navigation-implementation.md`

- [ ] KnowledgeTreeSidebar component
- [ ] KnowledgeBreadcrumbs component

---

## Planned Features (Not Started)

### Container Registry Enhancements
- [ ] GHCR PAT integration
- [ ] Deployment pull credentials
- [ ] Registry quota management (Phase 2)
- [ ] Orbit-hosted registry implementation

### Environment Variables Management
- [ ] Secure environment variable storage
- [ ] Environment variable inheritance
- [ ] Secret injection at deploy time

### Deployment Generators
- [ ] Terraform generator implementation
- [ ] Helm generator implementation
- [ ] Docker Compose generator implementation
- [ ] Custom generator support

---

## Contributing

When completing items from this list:
1. Remove the checkbox item once fully implemented
2. Update "Last Updated" date at top
3. Add any new discovered TODOs
4. Reference the PR/commit that completed the work
