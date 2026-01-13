# Orbit Project TODO

This document tracks planned features, incomplete implementations, and technical debt across the Orbit codebase.

**Last Updated:** 2026-01-12

---

## High Priority

### 1. GitOps Manifest Sync (`.orbit.yaml`)
**Status:** Schema exists, no implementation
**Location:** `orbit-www/src/collections/Apps.ts`

The Apps collection has `syncMode` and `manifestSha` fields, but the actual sync functionality was never implemented.

**Missing:**
- [ ] Parse `.orbit.yaml` manifests from repositories
- [ ] Implement `orbit-primary` mode: UI changes auto-commit to repo
- [ ] Implement `manifest-primary` mode: GitHub webhook detects manifest changes, syncs to DB
- [ ] Conflict resolution when DB and manifest diverge
- [ ] Manifest validation against schema

**Design doc:** `docs/plans/2025-11-28-application-lifecycle-catalog-design.md`

---

### 2. Temporal Workflow Client Services
**Status:** Stub implementations only
**Location:** `temporal-workflows/cmd/worker/main.go:137-142`

Critical services are nil placeholders:
- [ ] `PayloadClient` - Payload CMS API communication
- [ ] `EncryptionService` - Secret encryption/decryption
- [ ] `GitHubClient` - GitHub API interactions

---

### 3. Secret Encryption
**Status:** Values stored as plaintext
**Priority:** Security

- [ ] Implement encryption for secret values in Payload CMS
- [ ] Key rotation support
- [ ] Audit logging for secret access

---

## Bifrost (Kafka Self-Service)

### What's Working
- [x] Topic Create/Delete via Go Kafka service (franz-go)
- [x] Cluster connection validation
- [x] Environment mapping lookup from Payload
- [x] Payload CMS collections for topics, clusters, providers
- [x] gRPC client connection (Connect-ES to localhost:50055)
- [x] Apache Kafka adapter with franz-go

### Temporal Activities (Stubs)
**Location:** `temporal-workflows/internal/activities/`

All Temporal activities return mock/placeholder data and need real implementations:

- [ ] `kafka_activities.go` - ProvisionTopic, DeleteTopic, ValidateSchema, RegisterSchema, ProvisionAccess, RevokeAccess
- [ ] `credential_activities.go` - SyncCredentialToBifrost, RevokeCredentialFromBifrost
- [ ] `topic_sync_activities.go` - CreateTopicRecord, MarkTopicDeleted, UpdateTopicConfig
- [ ] `virtual_cluster_activities.go` - GetEnvironmentMapping, CreateVirtualCluster, PushToBifrost, UpdateVirtualClusterStatus
- [ ] `decommissioning_activities.go` - SetVirtualClustersReadOnly, DeletePhysicalTopics, RevokeAllCredentials, etc.

### Schema Registry
**Status:** Stub - returns "Not implemented" or `ErrNotConfigured`

- [ ] Schema Registry adapter implementation (`services/kafka/internal/adapters/schema/`)
- [ ] Frontend actions: registerSchema, listSchemas, getSchema, checkSchemaCompatibility

### ACL / Topic Sharing
**Status:** Stub - returns `ErrNotConfigured`

- [ ] ACL management in Apache adapter (CreateACL, DeleteACL, ListACLs)
- [ ] Frontend actions: approveTopicAccess, listTopicShares, discoverTopics

### Service Accounts
**Status:** Stub - returns "Not implemented"

- [ ] Frontend actions: createServiceAccount, listServiceAccounts, revokeServiceAccount
- [ ] Bifrost credential sync

### Metrics & Lineage
**Status:** Stub - returns empty arrays

- [ ] GetTopicMetrics, GetConsumerGroupLag, ListConsumerGroups in adapter
- [ ] Frontend actions: getTopicMetrics, getTopicLineage

### Bifrost Gateway Integration
**Status:** Not implemented

- [ ] Bifrost gRPC Admin API calls from Temporal activities
- [ ] Virtual cluster provisioning to gateway
- [ ] Credential sync to gateway

### Go Service Persistence
**Status:** In-memory repositories

- [ ] Connect Go Kafka service repositories to Payload CMS instead of in-memory

---

## Medium Priority

### GitHub Token Refresh Workflow
**Status:** TODO in code
**Location:** `orbit-www/src/collections/GitHubInstallations.ts:253`

- [ ] Start GitHubTokenRefreshWorkflow automatically
- [ ] Handle token expiration gracefully
- [ ] Implement refresh retry logic

---

### Build Service (Railpack)
**Status:** Partially implemented
**Location:** `docs/plans/2025-12-04-railpack-build-service.md`

- [ ] Railpack analysis implementation
- [ ] Railpack build implementation
- [ ] Parse digest from Railpack output
- [ ] Multi-package manager support

---

### Template Activity Implementation
**Status:** TODO stubs
**Location:** `temporal-workflows/internal/activities/template_activities.go:385-387`

- [ ] Record template usage in database
- [ ] Send notification to user on instantiation
- [ ] Update template usage statistics

---

## Low Priority

### Admin Role Verification
**Status:** Placeholder checks

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
**Design docs:** `docs/plans/2025-12-20-*.md`

- [ ] GHCR PAT integration
- [ ] Deployment pull credentials
- [ ] Registry quota management (Phase 2)
- [ ] Orbit-hosted registry implementation

---

### Environment Variables Management
**Design docs:** `docs/plans/2025-12-17-environment-variables-*.md`

- [ ] Secure environment variable storage
- [ ] Environment variable inheritance
- [ ] Secret injection at deploy time

---

### Deployment Generators
**Design docs:** `docs/plans/2025-12-01-deployment-*.md`

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
