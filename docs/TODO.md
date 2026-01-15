# Orbit Project TODO

This document tracks planned features, incomplete implementations, and technical debt across the Orbit codebase.

**Last Updated:** 2026-01-15

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

#### kafka_activities.go (COMPLETED - Topic Provisioning Working)
- [x] `ProvisionTopic` - Generates physical topic name, workflow runs successfully (see 2026-01-14 workflow run)
- [x] `UpdateTopicStatus` - Updates topic status in Payload CMS via internal API
- [x] `UpdateSchemaStatus` - Updates schema status in Payload CMS
- [x] `UpdateShareStatus` - Updates share status in Payload CMS
- [x] `DeleteTopic` - Implemented (marks topic deleted)
- [x] `ValidateSchema` - Stubbed (returns compatible=true)
- [x] `RegisterSchema` - Stubbed (returns mock IDs)
- [x] `ProvisionAccess` - Stubbed (returns mock ACLs)
- [x] `RevokeAccess` - Stubbed (returns nil)

**Future enhancements (when needed for production Kafka clusters):**
- [ ] `ValidateSchema` - Add Schema Registry compatibility check
- [ ] `RegisterSchema` - Add Schema Registry POST call
- [ ] `ProvisionAccess` - Add Kafka ACL creation
- [ ] `RevokeAccess` - Add Kafka ACL deletion

#### topic_sync_activities.go (COMPLETED)
- [x] `CreateTopicRecord` - Creates topic in Payload CMS (for gateway passthrough)
- [x] `MarkTopicDeleted` - Updates topic status to deleted in Payload CMS
- [x] `UpdateTopicConfig` - Updates topic config in Payload CMS

#### credential_activities.go (COMPLETED - Service Account Sync)
- [x] `SyncCredentialToBifrost` - Calls BifrostClient.UpsertCredential with template mapping
- [x] `RevokeCredentialFromBifrost` - Calls BifrostClient.RevokeCredential

#### lineage_activities.go (COMPLETED - Data Lineage)
- [x] `ProcessActivityBatch` - Full PayloadClient implementation with edge creation/update
- [x] `ResetStale24hMetrics` - Resets 24h rolling metrics for all edges
- [x] `MarkInactiveEdges` - Marks edges as inactive if not seen within threshold
- [x] `CreateDailySnapshots` - Creates daily lineage snapshots for all active topics

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

### High Priority - Bifrost Callback Client (COMPLETED)

**Status:** GrpcBifrostCallbackClient fully implemented
**Location:** `gateway/bifrost/src/main/kotlin/io/orbit/bifrost/callback/BifrostCallbackClient.kt`

- [x] Initialize gRPC channel and stub with proper lifecycle management
- [x] Implement `emitClientActivity` RPC call mapping ActivityRecord to proto
- [x] Add shutdown logic for gRPC channel (only closes owned channels)
- [x] Unit tests with in-process gRPC server

**Note:** Requires Java to build Bifrost and generate proto stubs. Run `./gradlew build` in `gateway/bifrost/`.

---

### High Priority - Bifrost Lineage End-to-End Integration Test

**Status:** Not started
**Location:** TBD (likely `gateway/bifrost/src/test/kotlin/` or `temporal-workflows/tests/`)

End-to-end integration test to validate the complete lineage data flow:

**Prerequisites:**
- Assumes Redpanda/Kafka cluster is running (via docker-compose)
- Assumes Payload CMS is running with collections initialized
- Assumes Temporal worker is running
- Assumes bifrost-callback gRPC service is running

**Test Flow:**
- [ ] Set up test fixtures: workspace, application, virtual cluster, topic in Payload CMS
- [ ] Configure Bifrost with test virtual cluster credentials
- [ ] Produce messages through Bifrost gateway to a test topic
- [ ] Consume messages through Bifrost gateway from the test topic
- [ ] Verify Bifrost ActivityTrackingFilter accumulates produce/consume activity
- [ ] Verify GrpcBifrostCallbackClient emits activity batch to bifrost-callback service
- [ ] Verify Temporal LineageWorkflow is triggered with activity data
- [ ] Verify `ProcessActivityBatch` activity creates/updates KafkaLineageEdge records
- [ ] Query Payload CMS and assert lineage edges exist with correct metrics
- [ ] Verify UI lineage components display the data (optional: Playwright E2E)

**Cleanup:**
- [ ] Delete test topic, application, virtual cluster, workspace

**Notes:**
- Could be implemented as Kotlin test (Testcontainers) or Go integration test
- May need mock/stub for components not under test
- Consider CI/CD implications (requires full stack running)

---

### Medium Priority - Server Action Temporal Integration

**Status:** Topic provisioning/deletion implemented, others are placeholders
**Location:** `orbit-www/src/app/actions/`

- [x] `kafka-topics.ts` - `triggerTopicProvisioningWorkflow`, `triggerTopicDeletionWorkflow` implemented
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
**Status:** PayloadClient and BifrostClient implemented
**Location:** `temporal-workflows/cmd/worker/main.go`

- [x] `PayloadClient` - Payload CMS API communication (implemented in `internal/clients/payload_client.go`)
- [x] `BifrostClient` - Bifrost gateway gRPC client (implemented in `internal/clients/bifrost_client.go`)
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
