# Kafka Admin UI Design

## Overview

A platform admin interface for managing Kafka infrastructure in Orbit. Allows admins to configure providers, register clusters, and map environments to clusters with priority-based routing rules.

## URL Structure

**Main Route:** `/admin/kafka`

Single page with client-side state management for panel navigation. No sub-routes for panel content.

## Navigation & Layout

### Tab Structure

```
Clusters | Environment Mappings | Providers
```

**Default tab logic:**
- If clusters exist → default to **Clusters** tab
- If no clusters exist → default to **Providers** tab (guides setup flow)

### Interaction Pattern

- Main page renders a slide-over panel with tabs
- Clicking cards (providers or clusters) replaces panel content with detail view
- Back navigation returns to list view within panel
- All panel content loaded via API calls (server actions)

### Panel State Management

```typescript
type PanelState =
  | { view: 'list'; tab: 'clusters' }
  | { view: 'list'; tab: 'mappings' }
  | { view: 'list'; tab: 'providers' }
  | { view: 'provider-detail'; providerId: string }
  | { view: 'cluster-detail'; clusterId: string | null } // null = new cluster
  | { view: 'mapping-edit'; mappingId: string | null }   // null = new mapping
```

---

## Providers Tab

### Layout
Card grid (2-3 columns depending on viewport)

### Provider Card (unconfigured)
- Provider logo
- Provider name
- "Not configured" badge (muted)
- "Configure" button

### Provider Card (configured)
- Provider logo
- Provider name
- "Configured" badge (green) or "Error" badge (red)
- "Edit" and "Disable" buttons

### Provider Detail View (replaces panel content)
- Back arrow + "Back to Providers"
- Provider logo + name (header)
- **Credentials section:** API keys, secrets (encrypted field inputs)
- **Feature toggles:** Enable/disable this provider for the platform
- **Default settings:** Default security protocol, replication factor, etc.
- Save / Cancel buttons

### Supported Providers (initial)
- Apache Kafka (self-hosted)
- Confluent Cloud
- Amazon MSK
- Redpanda

---

## Clusters Tab

### Layout
Card grid (2-3 columns)

### Cluster Card
- Cluster name (header)
- Provider logo + name (small)
- Status badge: Connected (green) / Error (red) / Validating (yellow spinner)
- Environment badges: `dev` `staging` `prod` (based on active mappings)
- "Validate" quick action button

### Empty State
- "No clusters registered"
- "Register your first cluster to start managing Kafka topics"
- "Add Cluster" button

### Add Cluster Button
Top right of tab, opens detail view for new cluster

### Cluster Detail View (replaces panel content)
- Back arrow + "Back to Clusters"
- Cluster name (editable)
- Provider (dropdown, read-only if editing existing)
- Status badge + "Validate Now" button
- **Connection section:**
  - Bootstrap Servers
  - Region (if applicable)
- **Configuration section:** Provider-specific fields
- **Credentials section:** Encrypted inputs
- **Info section (read-only, only for existing clusters):**
  - Topics count
  - Created date
  - Last validated timestamp
- **Actions:** Save / Cancel / Delete (with confirmation)

---

## Environment Mappings Tab

### Layout
Collapsible sections grouped by environment

### Section Headers
- Production (expanded by default)
- Staging (collapsed)
- Development (collapsed)

### Mapping Rule Row (within each section)
```
[Workspace or "All workspaces"] → [Cluster name] | Priority: [n] | [Edit] [Delete]
```

Example for Production section:
```
All workspaces → prod-confluent-us | Priority: 1 | [Edit] [Delete]
Team Alpha → alpha-dedicated | Priority: 10 | [Edit] [Delete]
```

### Empty State (per section)
- "No mappings for [environment]"
- "Add Mapping" link

### Add Mapping Button
Top right of tab, opens form view

### Mapping Form (replaces panel content)
- Back arrow + "Back to Mappings"
- **Environment** (dropdown: development, staging, production) - required
- **Workspace** (dropdown: "All workspaces" + list of workspaces) - optional
- **Cluster** (dropdown: list of registered clusters) - required
- **Priority** (number input, default: 1) - required
- **Description** (textarea) - optional
- **Enabled** (toggle, default: on)
- Save / Cancel buttons
- Delete button (if editing existing)

### Priority Logic
Higher priority = more specific, takes precedence. When resolving which cluster to use:
1. Find all matching rules for environment + workspace
2. Select rule with highest priority
3. If workspace-specific rule exists with higher priority, it wins over "All workspaces"

---

## Access Control

- Only platform admins can access `/admin/kafka`
- Check user roles on page load (consistent with `/admin/workspaces` pattern)
- Non-admins redirected to dashboard or shown "Access Denied"

---

## Error Handling

### Provider Configuration
- Validate credentials on save (async call to provider API)
- Show inline errors if credentials invalid

### Cluster Registration
- "Validate" button tests connectivity before saving
- Show connection error details (timeout, auth failed, unreachable)
- Allow saving cluster even if validation fails (for pre-provisioning)

### Environment Mappings
- Prevent orphaned mappings: warn if deleting a cluster with active mappings
- Prevent duplicate rules: same environment + workspace combo

### Loading States
- Skeleton cards while loading providers/clusters
- Spinner on "Validate" button during connectivity check
- Disable form buttons during save operations

---

## Data Flow & API Integration

### Server Actions

Location: `orbit-www/src/app/actions/kafka-admin.ts`

**Providers:**
- `getProviders()` - List all providers with config status
- `getProviderConfig(providerId)` - Get provider configuration
- `saveProviderConfig(providerId, config)` - Save credentials, defaults, toggles
- `disableProvider(providerId)` - Disable a provider

**Clusters:**
- `listClusters()` - List all registered clusters
- `getCluster(clusterId)` - Get cluster details
- `createCluster(data)` - Register new cluster
- `updateCluster(clusterId, data)` - Update cluster config
- `deleteCluster(clusterId)` - Remove cluster
- `validateCluster(clusterId)` - Test connectivity

**Mappings:**
- `listMappings()` - List all environment mappings
- `createMapping(data)` - Create mapping rule
- `updateMapping(mappingId, data)` - Update mapping rule
- `deleteMapping(mappingId)` - Remove mapping rule

### Backend Integration

Server actions call the existing Kafka gRPC service on port 50055. Most methods already implemented:
- `ListProviders`, `RegisterCluster`, `ValidateCluster`, `ListClusters`, `DeleteCluster`
- `CreateEnvironmentMapping`, `ListEnvironmentMappings`

May need to extend:
- Provider configuration storage (credentials, defaults, toggles)
- Provider disable functionality

---

## File Structure

```
orbit-www/src/app/(frontend)/admin/kafka/
├── page.tsx                      # Main admin page
├── kafka-admin-client.tsx        # Client component with panel state
├── components/
│   ├── ProvidersTab.tsx          # Providers card grid
│   ├── ProviderCard.tsx          # Individual provider card
│   ├── ProviderDetail.tsx        # Provider config form
│   ├── ClustersTab.tsx           # Clusters card grid
│   ├── ClusterCard.tsx           # Individual cluster card
│   ├── ClusterDetail.tsx         # Cluster detail/edit form
│   ├── MappingsTab.tsx           # Environment mappings grouped list
│   ├── MappingRow.tsx            # Individual mapping rule row
│   └── MappingForm.tsx           # Create/edit mapping form

orbit-www/src/app/actions/
└── kafka-admin.ts                # Server actions for admin operations
```

---

## Future Considerations (Out of Scope)

- Activity/audit log for admin actions
- Bulk import/export of cluster configurations
- Cluster health monitoring dashboard
- Schema registry management per cluster
- Quota management per cluster
