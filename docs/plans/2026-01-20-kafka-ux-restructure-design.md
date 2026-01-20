# Kafka UX Restructure Design

**Status:** DRAFT
**Date:** 2026-01-20
**Authors:** Platform Engineering

## 1. Overview

This document defines the UX restructuring for Kafka management in Orbit. The goal is to clarify the information architecture, eliminate naming collisions, and establish a clear mental model for developers interacting with Kafka resources.

### Problem Statement

The current Kafka UX has several issues:

1. **Naming collision**: "Applications" in Orbit refers to software delivery units (repos, images, pipelines), while "Kafka Applications" refers to tenant isolation boundaries. This creates confusion.

2. **Disconnected views**: The "Kafka Topics" view shows a flat list of topics that appears disconnected from the application-centric model in the Bifrost design.

3. **Auto-magic provisioning**: Current design auto-creates dev/stage/prod virtual clusters, removing user control and flexibility.

4. **Unclear hierarchy**: The relationship between workspaces, applications, virtual clusters, and topics is not obvious in the UI.

### Solution Summary

- Rename "Kafka Application" to "Virtual Cluster" (top-level, user-created)
- Remove automatic dev/stage/prod provisioning - users explicitly create each virtual cluster
- Restructure navigation: Virtual Clusters | Topic Catalog | Incoming Shares | My Requests
- Update workspace dashboard card to show Kafka Overview summary instead of topic list

---

## 2. Naming Changes

### Before → After

| Old Term | New Term | Rationale |
|----------|----------|-----------|
| Kafka Application | Virtual Cluster | Avoids collision with Orbit "Applications" (repos/pipelines) |
| Application → Virtual Cluster (auto 3) | Virtual Cluster (explicit) | Users create each cluster explicitly with chosen environment |

### Virtual Cluster Definition

A **Virtual Cluster** is an isolated Kafka tenant boundary that:
- Has a user-defined name
- Is explicitly assigned to an environment (dev, staging, prod, qa, etc.)
- Gets a unique endpoint: `{name}.{env}.kafka.orbit.io`
- Contains: topics, schemas, consumer groups, service accounts
- Is provisioned through Bifrost proxy

---

## 3. Information Architecture

### Workspace Kafka Model

```
Workspace: Digital
└── Virtual Clusters (flat list):
    ├── payments-dev      → payments-dev.dev.kafka.orbit.io
    ├── payments-prod     → payments-prod.prod.kafka.orbit.io
    ├── orders-dev        → orders-dev.dev.kafka.orbit.io
    └── analytics-staging → analytics-staging.staging.kafka.orbit.io
```

Each virtual cluster is a first-class entity. Teams can have 1, 3, or 10 clusters depending on their needs. There is no enforced 1:1:1 mapping to environments.

### Navigation Structure

#### Kafka Section (`/workspaces/{slug}/kafka`)

| Tab | Purpose | Route |
|-----|---------|-------|
| **Virtual Clusters** | Create/manage your clusters, view health status | `/workspaces/{slug}/kafka` |
| **Topic Catalog** | Discover shareable topics org-wide, request access | `/workspaces/{slug}/kafka/catalog` |
| **Incoming Shares** | Topics shared with you (approved) | `/workspaces/{slug}/kafka/shared/incoming` |
| **My Requests** | Your pending access requests | `/workspaces/{slug}/kafka/shared/outgoing` |

#### Virtual Cluster Detail (`/workspaces/{slug}/kafka/clusters/{clusterId}`)

| Tab | Purpose |
|-----|---------|
| **Topics** | Create/manage topics within this cluster |
| **Schemas** | View/manage schemas for this cluster's topics |
| **Consumer Groups** | Monitor consumer groups and lag |
| **Service Accounts** | Manage credentials (producer/consumer/admin) |
| **Settings** | Cluster config, decommission, etc. |

---

## 4. Workspace Dashboard Changes

### Current State

The workspace detail view (`/workspaces/{slug}`) has a "Kafka Topics" card that:
- Shows a flat list of topics
- Has a "Create Topic" button
- Is disconnected from the application/cluster model

### New State: "Kafka Overview" Card

Replace the "Kafka Topics" card with a summary card:

```
┌─────────────────────────────────────────────┐
│  Kafka Overview                  [Manage →] │
├─────────────────────────────────────────────┤
│  3 virtual clusters                         │
│  15 topics                                  │
│  2 pending share requests                   │
│                                             │
│  [View Virtual Clusters]                    │
└─────────────────────────────────────────────┘
```

**Key changes:**
- No topic list on the dashboard
- No "Create Topic" button here (creation happens inside a virtual cluster)
- Summary metrics provide at-a-glance status
- Clear CTAs to drill into the full Kafka section

---

## 5. Component & File Changes

### Files to Modify

#### Navigation (`KafkaNavigation.tsx`)

**Current:**
```typescript
const navItems = [
  { href: `/workspaces/${slug}/kafka`, label: 'Topics', exact: true },
  { href: `/workspaces/${slug}/kafka/catalog`, label: 'Topic Catalog' },
  { href: `/workspaces/${slug}/kafka/shared/incoming`, label: 'Incoming Shares' },
  { href: `/workspaces/${slug}/kafka/shared/outgoing`, label: 'My Requests' },
]
```

**New:**
```typescript
const navItems = [
  { href: `/workspaces/${slug}/kafka`, label: 'Virtual Clusters', exact: true },
  { href: `/workspaces/${slug}/kafka/catalog`, label: 'Topic Catalog' },
  { href: `/workspaces/${slug}/kafka/shared/incoming`, label: 'Incoming Shares' },
  { href: `/workspaces/${slug}/kafka/shared/outgoing`, label: 'My Requests' },
]
```

#### Workspace Dashboard Card (`WorkspaceKafkaTopicsCard.tsx`)

**Rename to:** `WorkspaceKafkaOverviewCard.tsx`

**New interface:**
```typescript
interface WorkspaceKafkaOverviewCardProps {
  workspaceSlug: string
  virtualClusterCount: number
  topicCount: number
  pendingShareCount: number
}
```

**New behavior:**
- Display summary metrics
- Link to `/workspaces/{slug}/kafka` (Virtual Clusters tab)
- Remove topic list and "Create Topic" button

#### Main Kafka Page (`/workspaces/[slug]/kafka/page.tsx`)

**Current:** Shows flat topic list with "Topics" header

**New:** Shows virtual clusters list with:
- Cluster name
- Environment badge
- Health status
- Topic count
- "Create Virtual Cluster" button

#### New Route: Virtual Cluster Detail

**Path:** `/workspaces/[slug]/kafka/clusters/[clusterId]/page.tsx`

**Content:** Tabbed interface with Topics, Schemas, Consumer Groups, Service Accounts, Settings

### Files to Create

| File | Purpose |
|------|---------|
| `orbit-www/src/app/(frontend)/workspaces/[slug]/kafka/clusters/[clusterId]/page.tsx` | Virtual cluster detail page |
| `orbit-www/src/app/(frontend)/workspaces/[slug]/kafka/clusters/[clusterId]/cluster-detail-client.tsx` | Client component for cluster detail |
| `orbit-www/src/components/features/kafka/VirtualClustersList.tsx` | List component for virtual clusters |
| `orbit-www/src/components/features/kafka/CreateVirtualClusterDialog.tsx` | Create virtual cluster form |
| `orbit-www/src/components/features/workspace/WorkspaceKafkaOverviewCard.tsx` | New dashboard summary card |

### Files to Deprecate/Remove

| File | Action |
|------|--------|
| `WorkspaceKafkaTopicsCard.tsx` | Replace with `WorkspaceKafkaOverviewCard.tsx` |
| `CreateApplicationDialog.tsx` | Rename/refactor to `CreateVirtualClusterDialog.tsx` |

### Existing Files to Reuse

These components remain largely unchanged but will be used in new contexts:

| Component | Current Use | New Use |
|-----------|-------------|---------|
| `TopicsPanel.tsx` | Topics list | Topics tab within virtual cluster detail |
| `ServiceAccountsPanel.tsx` | Service accounts | Service Accounts tab within virtual cluster detail |
| `CreateTopicDialog.tsx` | Create topic | Still used, but only accessible from within a cluster |
| `TopicCatalog.tsx` | Catalog view | Unchanged |
| `SharedTopicsList.tsx` | Shared topics | Unchanged |
| `ConnectionDetailsPanel.tsx` | Connection info | Used in virtual cluster detail |
| `CodeSnippetsDialog.tsx` | Code snippets | Used in virtual cluster detail |

---

## 6. Data Model Changes

### Collection: `KafkaVirtualClusters`

**Current fields to keep:**
- `id`, `name`, `slug`
- `workspace` (relationship)
- `environment` (string - user-selected)
- `topicPrefix`, `groupPrefix`, `transactionIdPrefix`
- `advertisedHost`, `advertisedPort`
- `physicalCluster` (relationship via environment mapping)
- `status` ('provisioning' | 'active' | 'read_only' | 'deleting')

**Remove/deprecate:**
- `application` relationship (no longer needed - virtual clusters are top-level)

### Collection: `KafkaApplications`

**Decision:** Deprecate or repurpose

Options:
1. **Deprecate entirely** - Virtual clusters become the top-level entity
2. **Keep as optional grouping** - Soft relationship for organizational purposes only

**Recommendation:** Option 1 - deprecate. Keep the collection for migration purposes but stop creating new records. Virtual clusters reference workspace directly.

### Collection: `KafkaTopics`

**Field changes:**
- Remove: `application` relationship
- Keep: `virtualCluster` relationship (already exists)

### Collection: `KafkaServiceAccounts`

**Field changes:**
- Remove: `application` relationship
- Keep: `virtualCluster` relationship (already exists)

---

## 7. Server Action Changes

### Actions to Modify

| Action File | Changes |
|-------------|---------|
| `kafka-applications.ts` | Rename to `kafka-virtual-clusters.ts`, update terminology |
| `kafka-application-lifecycle.ts` | Rename to `kafka-virtual-cluster-lifecycle.ts` |
| `kafka-topics.ts` | Remove application references, ensure virtualCluster is primary |

### Actions to Keep Unchanged

- `kafka-topic-catalog.ts` - Topic catalog operations
- `kafka-topic-shares.ts` - Sharing operations
- `kafka-service-accounts.ts` - Service account management
- `kafka-lineage.ts` - Lineage operations
- `kafka-offset-recovery.ts` - Recovery operations

---

## 8. API Route Changes

### Routes to Update

| Current Route | New Route | Notes |
|---------------|-----------|-------|
| `/api/internal/kafka-applications/*` | `/api/internal/kafka-virtual-clusters/*` | Rename and update logic |
| `/api/kafka/topics/*` | Keep | Update to use virtualCluster as primary relation |

### Routes to Keep

- `/api/kafka/shares/*` - Sharing API
- `/api/kafka/service-accounts/*` - Service accounts API
- `/api/kafka/schemas/*` - Schemas API
- `/api/kafka/discover/*` - Discovery API

---

## 9. Migration Strategy

### Phase 1: Terminology Update (Non-breaking)

1. Update UI labels: "Applications" → "Virtual Clusters"
2. Update navigation tabs
3. Update dashboard card
4. Keep backend collections unchanged initially

### Phase 2: Route & Component Restructure

1. Create new virtual cluster detail route structure
2. Move topic management into virtual cluster context
3. Update workspace dashboard card to overview format
4. Deprecate old topic list view

### Phase 3: Data Model Cleanup

1. Add migration to remove `application` field from new records
2. Keep `KafkaApplications` collection for backward compatibility
3. Update queries to use `virtualCluster` directly

### Phase 4: Remove Deprecated Code

1. Remove `KafkaApplications` collection (after migration period)
2. Remove application-related UI components
3. Clean up unused API routes

---

## 10. User Journey Examples

### Journey 1: Create a New Virtual Cluster

1. Navigate to workspace → Kafka section
2. Click "Create Virtual Cluster"
3. Enter name: "payments-api"
4. Select environment: "dev"
5. System provisions cluster → `payments-api.dev.kafka.orbit.io`
6. Redirected to cluster detail page

### Journey 2: Create a Topic

1. Navigate to workspace → Kafka → Virtual Clusters
2. Click on "payments-api-dev" cluster
3. In Topics tab, click "Create Topic"
4. Enter topic name: "order-events"
5. Configure partitions, retention, etc.
6. Topic created via Bifrost proxy

### Journey 3: Discover and Request Access to Shared Topic

1. Navigate to workspace → Kafka → Topic Catalog
2. Search for "inventory"
3. Find "inventory-events" shared by Warehouse team
4. Click "Request Access"
5. Select access type: Consumer
6. Submit request
7. Track in "My Requests" tab

### Journey 4: View Kafka Overview on Dashboard

1. Navigate to workspace detail page
2. See "Kafka Overview" card showing:
   - 3 virtual clusters
   - 15 topics
   - 2 pending shares
3. Click "View Virtual Clusters" to drill in

---

## 11. Implementation Tasks

### Task 1: Update Navigation & Terminology
- [ ] Update `KafkaNavigation.tsx` - change "Topics" to "Virtual Clusters"
- [ ] Update page titles and headers throughout Kafka section
- [ ] Update empty states and help text

### Task 2: Create Virtual Clusters List View
- [ ] Create `VirtualClustersList.tsx` component
- [ ] Update `/workspaces/[slug]/kafka/page.tsx` to show clusters
- [ ] Create `CreateVirtualClusterDialog.tsx` (adapt from `CreateApplicationDialog.tsx`)

### Task 3: Create Virtual Cluster Detail Page
- [ ] Create route `/workspaces/[slug]/kafka/clusters/[clusterId]/page.tsx`
- [ ] Create tabbed layout with Topics, Schemas, Consumer Groups, Service Accounts, Settings
- [ ] Integrate existing panels (`TopicsPanel`, `ServiceAccountsPanel`, etc.)

### Task 4: Update Workspace Dashboard
- [ ] Create `WorkspaceKafkaOverviewCard.tsx`
- [ ] Update workspace detail page to use new card
- [ ] Remove topic list from dashboard

### Task 5: Update Server Actions
- [ ] Rename/refactor application actions to virtual cluster actions
- [ ] Remove auto-provisioning of dev/stage/prod
- [ ] Update topic creation to require explicit virtual cluster selection

### Task 6: Update API Routes
- [ ] Rename application routes to virtual cluster routes
- [ ] Update internal APIs
- [ ] Maintain backward compatibility where needed

### Task 7: Update Collections
- [ ] Remove `application` field from new KafkaTopics
- [ ] Remove `application` field from new KafkaServiceAccounts
- [ ] Document deprecation of KafkaApplications collection

### Task 8: Testing & Verification
- [ ] Update existing tests to use new terminology
- [ ] Add tests for new virtual cluster flows
- [ ] E2E test: create cluster → create topic → verify in Bifrost

---

## 12. Open Questions

1. **Quota model**: Should quotas apply at the virtual cluster level instead of application level?
   - **Recommendation**: Yes, quotas should be per-workspace with a limit on virtual cluster count

2. **Existing data migration**: How do we handle existing KafkaApplications with auto-provisioned virtual clusters?
   - **Recommendation**: Keep them as-is, display as "legacy" groupings, allow users to "ungroup" into standalone clusters

3. **Naming validation**: Should virtual cluster names be unique across the workspace or globally?
   - **Recommendation**: Unique per workspace, with environment suffix making the full endpoint globally unique

---

## 13. Success Metrics

- Reduced user confusion about "Applications" terminology (qualitative feedback)
- Cleaner navigation with Virtual Clusters as primary entity
- Faster time-to-first-topic for new users
- Clear separation between "my clusters" and "shared topics"
