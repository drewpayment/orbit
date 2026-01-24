# Bifrost Admin UI Integration Design

**Date:** 2026-01-24
**Status:** Draft
**Author:** Claude + Drew

## Overview

Integrate the Bifrost admin API into the Orbit Kafka Platform UI, enabling platform admins to manage virtual clusters, credentials, and gateway status from a unified interface.

## Goals

- Expose full Bifrost admin control plane to platform admins
- Provide management of virtual clusters (tenant isolation boundaries)
- Enable credential provisioning and revocation for service accounts
- Display gateway health and configuration status

## Architecture

### Navigation Structure

The integration adds a **Gateway tab** to the existing Kafka Platform page (`/platform/kafka/`):

```
/platform/kafka/
├── Clusters (existing) - Physical Kafka infrastructure
├── Mappings (existing) - Environment routing
├── Providers (existing) - Provider configurations
└── Gateway (new)
    ├── Virtual Clusters - Tenant isolation boundaries
    ├── Credentials - Service account management
    └── Status - Gateway health and configuration
```

### Communication Flow

```
Browser → Next.js API Routes → gRPC → Bifrost Admin Service
                ↓
        (auth check via Payload CMS requireAdmin())
```

### Data Ownership

| Data | Owner | Storage |
|------|-------|---------|
| Physical clusters, mappings, providers | Orbit | Payload CMS |
| Virtual clusters, credentials, policies | Bifrost | Bifrost in-memory stores |

**Bifrost is the source of truth** for all gateway-related data. The UI always fetches live state from Bifrost. No synchronization or dual-persistence needed.

### Key Design Decisions

1. **Virtual clusters are infrastructure abstractions** - They exist independently of workspaces/applications and can serve multiple applications
2. **Parallel concepts** - Physical clusters represent registered Kafka infrastructure; virtual clusters represent tenant isolation boundaries routed through Bifrost
3. **Flexible credential model** - Admins can create credentials dedicated to specific apps or shared across a virtual cluster
4. **Direct gRPC calls** - Next.js API routes call Bifrost directly using generated TypeScript clients (no Go proxy layer)
5. **Orbit-only auth** - Bifrost admin API is internal/trusted; Orbit enforces authorization before making calls

---

## Virtual Clusters Sub-tab

### List View

Table displaying all virtual clusters from `ListVirtualClusters()` RPC:

| Column | Source |
|--------|--------|
| ID | `VirtualClusterConfig.id` |
| Workspace | `VirtualClusterConfig.workspace_slug` |
| Environment | `VirtualClusterConfig.environment` |
| Topic Prefix | `VirtualClusterConfig.topic_prefix` |
| Bootstrap Servers | `VirtualClusterConfig.physical_bootstrap_servers` |
| Read-Only | `VirtualClusterConfig.read_only` |

**Actions:** Create, Edit, Delete, Toggle Read-Only
**Filtering:** By environment, by workspace

### Create/Edit Form

| Field | Proto Field | Description |
|-------|-------------|-------------|
| ID | `id` | Unique identifier (auto-generated or admin-specified) |
| Workspace Slug | `workspace_slug` | Which workspace this virtual cluster serves |
| Environment | `environment` | dev/staging/prod dropdown |
| Topic Prefix | `topic_prefix` | Namespace for topics |
| Group Prefix | `group_prefix` | Consumer group namespace |
| Transaction ID Prefix | `transaction_id_prefix` | For exactly-once semantics |
| Physical Bootstrap Servers | `physical_bootstrap_servers` | Actual Kafka brokers (dropdown of registered physical clusters) |
| Advertised Host | `advertised_host` | What clients see as connection host |
| Advertised Port | `advertised_port` | What clients see as connection port |
| Read-Only | `read_only` | Toggle to block writes |

### Delete Flow

- Confirmation modal warning that credentials associated with this virtual cluster will become orphaned
- Calls `DeleteVirtualCluster()` RPC

---

## Credentials Sub-tab

### List View

Table displaying credentials from `ListCredentials()` RPC:

| Column | Source |
|--------|--------|
| Username | `CredentialConfig.username` |
| Virtual Cluster | `CredentialConfig.virtual_cluster_id` |
| Permission Template | `CredentialConfig.template` |
| Created Date | (if available from Bifrost) |

**Actions:** Create, Revoke
**Filtering:** By virtual cluster

### Create Form

| Field | Proto Field | Description |
|-------|-------------|-------------|
| Virtual Cluster | `virtual_cluster_id` | Dropdown of available virtual clusters |
| Username | `username` | Service account identifier |
| Password | (plaintext, hashed before send) | Generated or admin-specified |
| Permission Template | `template` | Producer / Consumer / Admin / Custom |
| Custom Permissions | `custom_permissions` | When Custom selected: resource type, name pattern, operations |

**Permission Templates:**
- **Producer** - Write access to prefixed topics
- **Consumer** - Read access to prefixed topics
- **Admin** - Full access including topic management
- **Custom** - Enables custom permissions editor

**Security:** Passwords are only displayed at creation time. The UI cannot retrieve existing passwords (Bifrost stores `password_hash`, not plaintext).

### Revoke Flow

- Confirmation modal warning that revoking will immediately disconnect clients using this credential
- Calls `RevokeCredential()` RPC

---

## Status Sub-tab

### Health Overview Panel

Data from `GetStatus()` RPC:

| Metric | Description |
|--------|-------------|
| Gateway Status | Healthy / Degraded / Unhealthy indicator |
| Active Connections | Current client connection count |
| Version Info | Bifrost version running |

### Configuration Panel

Data from `GetFullConfig()` RPC:

**Summary Cards:**
- Total Virtual Clusters count
- Total Credentials count
- Total Policies count (placeholder for future)
- Total Topic ACLs count (placeholder for future)

**Raw Configuration:** Expandable JSON view for debugging/verification

### Refresh Behavior

- Manual refresh button to re-fetch status
- Optional auto-refresh toggle (every 30s) for monitoring

---

## Implementation Components

### New API Routes

```
orbit-www/src/app/api/kafka/admin/gateway/
├── virtual-clusters/
│   ├── route.ts          # GET (list), POST (create)
│   └── [id]/
│       ├── route.ts      # DELETE
│       └── read-only/
│           └── route.ts  # PATCH (toggle)
├── credentials/
│   ├── route.ts          # GET (list), POST (create)
│   └── [id]/
│       └── route.ts      # DELETE (revoke)
└── status/
    └── route.ts          # GET (status + full config)
```

### New Server Actions

`orbit-www/src/app/actions/bifrost-admin.ts`:

```typescript
// Virtual Cluster Management
listVirtualClusters(): Promise<VirtualClusterConfig[]>
createVirtualCluster(data: CreateVirtualClusterInput): Promise<VirtualClusterConfig>
deleteVirtualCluster(id: string): Promise<void>
setVirtualClusterReadOnly(id: string, readOnly: boolean): Promise<void>

// Credential Management
listCredentials(virtualClusterId?: string): Promise<CredentialConfig[]>
createCredential(data: CreateCredentialInput): Promise<{ username: string; password: string }>
revokeCredential(id: string): Promise<void>

// Status & Configuration
getGatewayStatus(): Promise<GatewayStatus>
getFullConfig(): Promise<FullConfig>
```

### New UI Components

```
orbit-www/src/app/(frontend)/platform/kafka/
├── GatewayTab.tsx              # Container with sub-tab navigation
├── VirtualClustersTab.tsx      # List and management
├── VirtualClusterForm.tsx      # Create/edit modal or drawer
├── VirtualClusterDetail.tsx    # Detail view (optional)
├── CredentialsTab.tsx          # List and management
├── CredentialForm.tsx          # Create modal
└── GatewayStatusTab.tsx        # Health and config display
```

### gRPC Client Setup

```
orbit-www/src/lib/bifrost-client.ts
```

Uses generated TypeScript client from `orbit-www/src/lib/proto/` (generated from `proto/idp/gateway/v1/gateway.proto`).

---

## Error Handling

### Connection Failures

- Gateway tab shows connection error banner with retry button if Bifrost unreachable
- Individual operations show toast errors with failure reason
- Status tab prominently displays "Gateway Unreachable" state

### Validation

**Virtual cluster creation:**
- ID uniqueness (server-side, Bifrost returns error if duplicate)
- Required fields (workspace slug, environment, bootstrap servers)
- Valid prefix formats (no special characters breaking Kafka naming)

**Credential creation:**
- Username uniqueness within virtual cluster
- Password complexity requirements (if any)
- At least one permission for Custom template

### Concurrent Modifications

- Bifrost is source of truth, no optimistic locking needed
- UI refreshes list after any mutation
- "Item no longer exists" error if deleted by another admin mid-edit

### Authorization

- All API routes call `requireAdmin()` before any Bifrost operation
- Unauthorized access returns 403

---

## Dependencies

- Bifrost admin gRPC API (`proto/idp/gateway/v1/gateway.proto`)
- Generated TypeScript client (`make proto-gen`)
- Existing Kafka Platform UI infrastructure
- Payload CMS auth (`requireAdmin()`)

## Future Considerations

- **Policy management** - `UpsertPolicy`, `DeletePolicy`, `ListPolicies` RPCs exist but are not yet implemented in Bifrost
- **Topic ACL management** - `UpsertTopicACL`, `RevokeTopicACL`, `ListTopicACLs` RPCs exist but are not yet implemented
- **Audit logging** - Could add Orbit-side logging of admin actions for compliance
- **mTLS** - Could add mutual TLS between Orbit and Bifrost for defense-in-depth
