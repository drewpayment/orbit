# Q1: Multi-Tenancy & Database Isolation Analysis

## Date: 2025-10-19

## Database Schema Analysis

### Core Catalog Tables

Based on examination of migration file: `20200702153613_entities.js`

#### `entities` Table

```sql
CREATE TABLE entities (
  id UUID PRIMARY KEY,              -- Auto-generated entity ID
  location_id UUID REFERENCES locations(id) NULLABLE,  -- Origin location
  etag STRING NOT NULL,            -- Changes on each update
  generation INTEGER UNSIGNED NOT NULL,  -- Increments when spec changes
  api_version STRING NOT NULL,     -- Backstage API version
  kind STRING NOT NULL,            -- Entity type (Component, API, etc.)
  name STRING NULLABLE,            -- metadata.name
  namespace STRING NULLABLE,       -- metadata.namespace
  metadata TEXT NOT NULL,          -- Full metadata JSON blob
  spec TEXT NULLABLE,              -- Full spec JSON blob

  UNIQUE (kind, name, namespace)   -- Global uniqueness constraint
);
```

#### `entities_search` Table

```sql
CREATE TABLE entities_search (
  entity_id UUID REFERENCES entities(id) ON DELETE CASCADE,
  key STRING NOT NULL,             -- Searchable key
  value STRING NULLABLE,           -- Searchable value

  -- Used for quick filtering
);
```

## CRITICAL FINDING: No Multi-Tenancy Support

### Missing Workspace Isolation

**The `entities` table has NO `workspace_id` or `tenant_id` column.**

**Unique Constraint:**
```sql
UNIQUE (kind, name, namespace)
```

This constraint is **global** across the entire Backstage instance, meaning:
- An entity with `kind=Component, name=my-service, namespace=default` can only exist ONCE
- No scoping to workspaces or tenants
- All entities share the same namespace

### Evidence of Single-Tenant Design

1. **No tenant columns**: None of the core tables include workspace/tenant identifiers
2. **Global uniqueness**: Entities are unique across the entire instance
3. **Shared locations**: The `locations` table (referenced by `location_id`) also has no tenant scoping
4. **No row-level security**: No database-level isolation mechanisms

## Implications for Orbit IDP

### Option 1: Separate Backstage Instances Per Workspace ✅ RECOMMENDED

**Pros:**
- Complete data isolation (separate databases)
- No data leakage risk
- Simple security model
- Each workspace can have identical entity names

**Cons:**
- Higher infrastructure cost (multiple instances)
- More complex deployment (need to manage N instances)
- Plugin configuration duplicated across instances

**Implementation:**
```
Workspace "acme-corp" → Backstage Instance A (DB: backstage_acme)
Workspace "initech"   → Backstage Instance B (DB: backstage_initech)
Workspace "globex"    → Backstage Instance C (DB: backstage_globex)
```

### Option 2: Shared Instance + Middleware Filtering ⚠️ HIGH RISK

**Pros:**
- Single Backstage instance (lower infra cost)
- Centralized plugin management

**Cons:**
- **CRITICAL RISK:** Data leakage if filter fails
- Complex middleware logic needed
- Entities must have globally unique names (can't have same name across workspaces)
- Need to modify ALL API responses to filter by workspace
- Plugin updates could break filtering

**Why Risky:**
```typescript
// If this middleware filter has a bug...
function filterByWorkspace(entities, workspaceId) {
  return entities.filter(e => e.metadata?.workspace === workspaceId);
}

// ...data from other workspaces could leak to users
```

### Option 3: Fork Backstage + Add workspace_id ❌ NOT RECOMMENDED

**Why Not:**
- Massive maintenance burden (keep fork updated with upstream)
- Need to modify all plugins to respect workspace_id
- Breaks compatibility with community plugins
- High technical debt

## Multi-Tenancy Decision Matrix

| Approach | Security | Cost | Complexity | Plugin Compat | Recommendation |
|----------|----------|------|------------|---------------|----------------|
| Separate Instances | ✅ Excellent | ⚠️ Higher | 🟡 Medium | ✅ Full | **RECOMMENDED** |
| Shared + Middleware | ❌ Risky | ✅ Lower | ❌ High | ⚠️ Partial | **NOT RECOMMENDED** |
| Fork Backstage | 🟡 Good | 🟡 Medium | ❌ Very High | ❌ Poor | **NOT RECOMMENDED** |

## Recommended Architecture for Orbit

### Multi-Instance Deployment

```
┌─────────────────────────────────────────────────────────────┐
│                    Orbit Platform                            │
│                                                              │
│  ┌────────────┐     ┌────────────┐     ┌────────────┐      │
│  │ Workspace  │     │ Workspace  │     │ Workspace  │      │
│  │  "acme"    │     │ "initech"  │     │ "globex"   │      │
│  └──────┬─────┘     └──────┬─────┘     └──────┬─────┘      │
│         │                  │                  │             │
│         ▼                  ▼                  ▼             │
│  ┌────────────┐     ┌────────────┐     ┌────────────┐      │
│  │ Backstage  │     │ Backstage  │     │ Backstage  │      │
│  │ Instance A │     │ Instance B │     │ Instance C │      │
│  └──────┬─────┘     └──────┬─────┘     └──────┬─────┘      │
│         │                  │                  │             │
│  ┌──────▼─────┐     ┌──────▼─────┐     ┌──────▼─────┐      │
│  │  Postgres  │     │  Postgres  │     │  Postgres  │      │
│  │ DB (acme)  │     │ DB (init)  │     │ DB (glob)  │      │
│  └────────────┘     └────────────┘     └────────────┘      │
│                                                              │
└─────────────────────────────────────────────────────────────┘

Orbit Go "Plugins" Service:
- Routes requests to correct Backstage instance based on workspace
- Manages instance lifecycle (create, start, stop, delete)
- Handles config sync from Payload to each instance
```

### Implementation Considerations

**Instance Management:**
1. Create new Backstage instance when workspace created
2. Store instance metadata in Orbit database:
   ```sql
   CREATE TABLE backstage_instances (
     workspace_id UUID REFERENCES workspaces(id),
     instance_url STRING,  -- http://backstage-acme.internal:7007
     database_name STRING, -- backstage_acme
     status STRING,        -- running | stopped | error
     created_at TIMESTAMP
   );
   ```

**Request Routing:**
```go
// services/plugins/internal/grpc/proxy.go
func (s *Server) ProxyPluginRequest(ctx context.Context, req *pb.ProxyPluginRequest) (*pb.ProxyPluginResponse, error) {
  // 1. Validate workspace access
  // 2. Get Backstage instance URL for this workspace
  instanceURL := s.getBackstageInstance(req.WorkspaceId)

  // 3. Forward request to workspace-specific Backstage instance
  resp, err := http.Get(instanceURL + req.EndpointPath)

  // 4. Return response
  return &pb.ProxyPluginResponse{Data: resp.Body}, nil
}
```

**Configuration Sync:**
- Each instance gets its own `app-config.yaml`
- Payload CMS stores plugin configs with `workspace_id`
- Orbit API generates workspace-specific config:
  ```typescript
  GET /api/plugins/config?workspace_id=ws-abc
  → Returns config ONLY for workspace "ws-abc"
  ```

## Conclusion

**Backstage is fundamentally single-tenant.**

For Orbit's multi-tenant requirements, we MUST use separate Backstage instances per workspace to ensure proper data isolation and security.

**Next Steps:**
1. ✅ Update feature plan with multi-instance architecture
2. ✅ Design instance lifecycle management in Go service
3. ✅ Plan database schema for instance metadata
4. ✅ Estimate infrastructure costs (N instances)
5. ✅ Make GO/NO-GO decision for Phase 1

**Confidence Level:** HIGH - This finding is definitive based on source code analysis.
