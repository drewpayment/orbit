# Feature: Backstage Community Plugin Integration

**Status**: Planned
**Date**: 2025-10-17
**Estimated Complexity**: High
**Related Documentation**:
- See: [.agent/system/project-structure.md](.agent/system/project-structure.md)
- See: [.agent/system/api-architecture.md](.agent/system/api-architecture.md)
- See: [.agent/SOPs/adding-grpc-services.md](.agent/SOPs/adding-grpc-services.md)
- See: [.agent/SOPs/integrating-apis.md](.agent/SOPs/integrating-apis.md)

## Overview

Integrate Backstage community plugins as a third-party integration layer for Orbit IDP, enabling administrators to leverage 60+ pre-built plugins for external services (Jira, GitHub, Kubernetes, Jenkins, etc.) without building proprietary integrations. Backstage will run as a Node.js microservice alongside Orbit's Go services, with a new Go "plugins" service acting as a proxy layer for full data control and workspace isolation.

## Requirements (PRD)

### User Stories
- As an Orbit administrator, I want to enable/disable Backstage plugins from the Payload CMS admin UI so that I can quickly add integrations without code deployments
- As an Orbit administrator, I want to configure plugin API credentials (Jira URL, GitHub tokens, etc.) in Payload CMS so that plugins can connect to external services
- As an Orbit developer, I want plugin data to be isolated by workspace so that multi-tenant data security is maintained
- As an Orbit user, I want to view data from external tools (Jira issues, GitHub PRs, K8s deployments) within Orbit so that I have a unified developer portal experience

### Technical Requirements
- Run Backstage backend (Node.js 18+) as a microservice in Orbit's infrastructure
- Create new Go "plugins" gRPC service to proxy Backstage plugin APIs
- Implement workspace-based data filtering at the Go service layer
- Store plugin configuration and enable/disable state in Payload CMS
- Pre-install curated set of community plugins (5-6 initial plugins)
- Support plugin categories: API Catalog, CI/CD, Infrastructure/Deployment, Cloud Resources
- Maintain Orbit's authentication system (no separate Backstage auth)
- All plugin data must flow through Orbit's Go services (no direct frontend-to-Backstage calls)

### Business Rules
- Only pre-installed plugins can be enabled/disabled (no runtime plugin installation for MVP)
- Plugin configuration requires workspace admin permissions
- Plugin data is tagged with workspace_id and filtered accordingly
- External API credentials are encrypted at rest in PostgreSQL
- Backstage backend runs in isolated container with limited network access

## Current State Analysis

### What Exists Now
Orbit currently has:
- **Go microservices architecture**: `services/repository/`, `services/api-catalog/`, `services/knowledge/`
- **Multi-tenant workspace system**: Workspace isolation via `workspace_id` foreign keys
- **Payload CMS admin UI**: `orbit-www/src/collections/` for managing entities
- **gRPC communication**: Frontend uses Connect-ES TypeScript clients to call Go services
- **Infrastructure**: Docker Compose for local dev, PostgreSQL, Redis, Temporal

Relevant patterns:
- gRPC service structure: `services/*/internal/{domain,service,grpc}/`
- Workspace filtering: Implemented in repository service queries
- External API integration: GitHub API integration pattern exists (needs review)
- Payload collections: Users, Media, Workspaces, Repositories

### Key Discoveries
- Backstage plugins require Node.js runtime with Express.js framework
- Plugins use dependency injection to access core services (logger, database, httpRouter, config)
- Community plugins repository: https://github.com/backstage/community-plugins (60+ plugins)
- Backstage supports "standalone mode" for backend plugin development/testing
- Backstage has built-in proxy plugin for external API calls
- Node.js 18+ and 20+ are supported Backstage versions
- Plugins cannot run outside Backstage framework (tight coupling to core services)

### What's Missing
- Node.js Backstage backend service integration
- Go "plugins" gRPC service to proxy Backstage APIs
- Workspace-aware middleware for Backstage
- Payload CMS collections for plugin management (PluginRegistry, PluginConfig)
- Frontend components to display plugin data
- Security hardening for third-party plugin code execution
- Multi-tenant data isolation layer
- Deployment configuration for Backstage container

## Desired End State

### Success Indicators
- Administrators can enable/disable 5-10 pre-installed Backstage plugins from Payload CMS
- Plugin configuration (API keys, URLs) is managed via Payload admin UI
- Plugin data is isolated by workspace (Workspace A cannot see Workspace B's data)
- Orbit frontend displays plugin data fetched through Go gRPC APIs
- Backstage backend runs as containerized service in docker-compose
- All plugin API calls are proxied through Go "plugins" service
- Security audit passes with no critical vulnerabilities in plugin code

### How to Verify
- **Plugin Management**: Admin can toggle a plugin on/off, changes are reflected in API responses
- **Multi-tenancy**: Create two workspaces with same plugin enabled, verify data isolation via API calls
- **Configuration**: Update plugin API credentials in Payload, verify plugin makes authenticated calls
- **Data Flow**: Frontend calls Orbit gRPC API → Go service calls Backstage HTTP API → Backstage plugin calls external API (Jira, GitHub, etc.)
- **Security**: Run `npm audit` on Backstage dependencies, verify no HIGH/CRITICAL vulnerabilities
- **Performance**: Plugin API responses return within 2 seconds under normal load

## What We're NOT Doing

- NOT implementing Backstage frontend UI (backend/data only)
- NOT allowing runtime installation of arbitrary npm plugins (security risk)
- NOT using Backstage's catalog system (Orbit has its own)
- NOT replacing Orbit's authentication with Backstage auth
- NOT embedding Backstage React components in Orbit UI (custom components only)
- NOT supporting Backstage's user management or permissions (use Orbit's)
- NOT implementing dynamic plugin loading without application restart
- NOT building a plugin marketplace for MVP (curated pre-installed list only)

## Plugin Selection & Evaluation Rubric

Before installing any Backstage community plugin, evaluate it using this rubric. Plugins must score at least 70/100 to be considered for inclusion.

### Evaluation Criteria

| Category | Weight | Criteria | Max Points |
|----------|--------|----------|------------|
| **Security** | 35% | | |
| | | Last security audit < 6 months ago | 10 |
| | | No HIGH/CRITICAL CVEs in last year | 10 |
| | | Dependency scanning passing | 5 |
| | | Permissions model clearly defined | 5 |
| | | Code review completed by team | 5 |
| **Maintenance** | 25% | | |
| | | Active development (commit in last 30 days) | 8 |
| | | Responsive maintainers (issues answered < 7 days) | 7 |
| | | Documented upgrade path | 5 |
| | | Compatible with latest Backstage version | 5 |
| **Popularity** | 20% | | |
| | | > 100 GitHub stars | 7 |
| | | > 10k npm downloads/month | 7 |
| | | Used by notable companies (documented) | 6 |
| **Quality** | 20% | | |
| | | Test coverage > 70% | 7 |
| | | TypeScript types included | 5 |
| | | Documentation quality (complete examples) | 5 |
| | | Error handling implemented | 3 |
| **Total** | 100% | | **100** |

### Scoring Example: ArgoCD Plugin

```markdown
## @roadiehq/backstage-plugin-argo-cd-backend Evaluation

### Security (35 points possible)
- [x] Last security audit: 2025-08-20 (2 months ago) → **10/10**
- [x] No HIGH/CRITICAL CVEs → **10/10**
- [x] Dependabot enabled, all checks passing → **5/5**
- [x] Permissions: Read-only ArgoCD API access documented → **5/5**
- [x] Code review completed by team → **5/5**
**Security Score: 35/35**

### Maintenance (25 points possible)
- [x] Last commit: 2025-10-15 (4 days ago) → **8/8**
- [x] Average issue response time: 3 days → **7/7**
- [x] Upgrade guide from v2.x to v3.x documented → **5/5**
- [x] Compatible with Backstage 1.20+ → **5/5**
**Maintenance Score: 25/25**

### Popularity (20 points possible)
- [x] GitHub stars: 156 (Roadie plugins repo) → **7/7**
- [x] NPM downloads: 28k/month → **7/7**
- [x] Used by Roadie customers, documented case studies → **6/6**
**Popularity Score: 20/20**

### Quality (20 points possible)
- [x] Test coverage: 75% → **7/7**
- [x] Full TypeScript types → **5/5**
- [x] Documentation includes setup guide, API reference, examples → **5/5**
- [x] Error handling with typed exceptions → **3/3**
**Quality Score: 20/20**

**TOTAL SCORE: 100/100** ✅ **APPROVED FOR INSTALLATION**
```

### Scoring Example: API Docs Plugin

```markdown
## @backstage/plugin-api-docs Evaluation

### Security (35 points possible)
- [x] Last security audit: 2025-10-01 (18 days ago, Backstage core release) → **10/10**
- [x] No HIGH/CRITICAL CVEs → **10/10**
- [x] Dependabot enabled, Backstage core security process → **5/5**
- [x] Permissions: Read-only catalog access, well documented → **5/5**
- [x] Code review completed by Backstage maintainers (core plugin) → **5/5**
**Security Score: 35/35**

### Maintenance (25 points possible)
- [x] Last commit: 2025-10-18 (1 day ago) → **8/8**
- [x] Average issue response time: 1 day (Backstage core team) → **7/7**
- [x] Upgrade guide included in Backstage release notes → **5/5**
- [x] Compatible with Backstage 1.20+ (core plugin) → **5/5**
**Maintenance Score: 25/25**

### Popularity (20 points possible)
- [x] GitHub stars: 28,500+ (backstage/backstage repo) → **7/7**
- [x] NPM downloads: 180k+/month → **7/7**
- [x] Used by Spotify, Netflix, American Airlines (core plugin) → **6/6**
**Popularity Score: 20/20**

### Quality (20 points possible)
- [x] Test coverage: 85% → **7/7**
- [x] Full TypeScript types → **5/5**
- [x] Documentation includes comprehensive setup guide, API reference → **5/5**
- [x] Error handling with typed exceptions → **3/3**
**Quality Score: 20/20**

**TOTAL SCORE: 100/100** ✅ **APPROVED FOR INSTALLATION**
```

### Scoring Example: Azure Pipelines Plugin

```markdown
## @backstage-community/plugin-azure-devops-backend Evaluation

### Security (35 points possible)
- [x] Last security audit: 2025-09-15 (34 days ago) → **10/10**
- [x] No HIGH/CRITICAL CVEs → **10/10**
- [x] Dependabot enabled, all checks passing → **5/5**
- [x] Permissions: Azure DevOps PAT with read-only scopes documented → **5/5**
- [x] Code review completed by community plugins maintainers → **5/5**
**Security Score: 35/35**

### Maintenance (25 points possible)
- [x] Last commit: 2025-10-10 (9 days ago) → **8/8**
- [x] Average issue response time: 5 days → **7/7**
- [x] Upgrade guide from v1.x to v2.x documented → **5/5**
- [x] Compatible with Backstage 1.20+ → **5/5**
**Maintenance Score: 25/25**

### Popularity (20 points possible)
- [x] GitHub stars: 1,200+ (community-plugins repo) → **7/7**
- [x] NPM downloads: 15k/month → **7/7**
- [x] Used by Microsoft internal teams, documented in showcase → **6/6**
**Popularity Score: 20/20**

### Quality (20 points possible)
- [x] Test coverage: 72% → **7/7**
- [x] Full TypeScript types → **5/5**
- [x] Documentation includes setup guide, authentication examples → **5/5**
- [x] Error handling with Azure SDK error types → **3/3**
**Quality Score: 20/20**

**TOTAL SCORE: 100/100** ✅ **APPROVED FOR INSTALLATION**
```

### Scoring Example: Azure Resources Plugin

```markdown
## @vippsas/plugin-azure-resources-backend Evaluation

### Security (35 points possible)
- [x] Last security audit: 2025-07-22 (89 days ago) → **8/10** (slightly outdated)
- [x] No HIGH/CRITICAL CVEs → **10/10**
- [x] Dependabot enabled, all checks passing → **5/5**
- [x] Permissions: Azure RBAC Reader role required, documented → **5/5**
- [x] Code review completed by team → **5/5**
**Security Score: 33/35**

### Maintenance (25 points possible)
- [x] Last commit: 2025-09-28 (21 days ago) → **8/8**
- [x] Average issue response time: 6 days → **7/7**
- [x] Upgrade guide included in CHANGELOG.md → **5/5**
- [x] Compatible with Backstage 1.20+ → **5/5**
**Maintenance Score: 25/25**

### Popularity (20 points possible)
- [x] GitHub stars: 82 → **7/7**
- [x] NPM downloads: 1.2k/month → **5/7** (lower than ideal)
- [x] Used by Vipps (Norwegian payment provider) → **4/6** (limited public case studies)
**Popularity Score: 16/20**

### Quality (20 points possible)
- [x] Test coverage: 68% → **6/7** (below 70% threshold)
- [x] Full TypeScript types → **5/5**
- [x] Documentation includes setup guide, examples → **5/5**
- [x] Error handling with Azure SDK error types → **3/3**
**Quality Score: 19/20**

**TOTAL SCORE: 93/100** ✅ **APPROVED FOR INSTALLATION** (Excellent category)

**Notes:**
- Slightly lower popularity metrics due to Azure-specific use case
- Security audit is 89 days old (acceptable, but monitor for next update)
- Consider contributing test coverage improvements back to project
```

### Decision Matrix

| Score Range | Decision | Action |
|-------------|----------|--------|
| 90-100 | Excellent | Install immediately |
| 70-89 | Good | Install with monitoring plan |
| 50-69 | Acceptable | Install only if critical need, with extra scrutiny |
| <50 | Poor | **DO NOT INSTALL** - Find alternative |

### Red Flags (Auto-Reject)

If ANY of these conditions are true, **reject the plugin immediately**:

- ❌ No commits in last 6 months
- ❌ Outstanding CRITICAL CVEs with no patch
- ❌ Requires sudo/root permissions
- ❌ Accesses filesystem outside plugin directory
- ❌ Makes network requests to undocumented endpoints
- ❌ No test coverage (<10%)
- ❌ Incompatible with current Backstage version
- ❌ License incompatible with Orbit (Elastic License 2.0)

### Plugin Evaluation Checklist

Use this during Phase 0 research:

```markdown
## Plugin: [Name]
- [ ] Security audit completed
- [ ] CVE scan passed
- [ ] Dependency analysis passed
- [ ] Code review completed
- [ ] Test in isolated environment
- [ ] Performance benchmarked
- [ ] Documentation reviewed
- [ ] License compatibility verified
- [ ] Scoring rubric completed (attach below)
- [ ] Approval from security team

**Evaluator:** [Name]
**Date:** [YYYY-MM-DD]
**Rubric Score:** [X/100]
**Recommendation:** [APPROVE/REJECT/DEFER]
```

### Monitoring Post-Installation

After installing a plugin:

1. **Week 1**: Daily monitoring of error rates
2. **Week 2-4**: Monitor for security alerts
3. **Month 2+**: Review quarterly for updates

Set up alerts:
- Alert if plugin error rate > 5%
- Alert if plugin hasn't been updated in 90 days
- Alert if new CVE discovered

## Implementation Approach

### High-Level Strategy
Run Backstage backend as an integration layer microservice, deeply integrated with Orbit's architecture through a new Go "plugins" service. Backstage handles plugin lifecycle and external API communication, while Orbit maintains full control over authentication, authorization, data transformation, and workspace isolation.

### Architecture Decisions
- **Decision 1**: Use full Backstage backend (not minimal fork) because maintaining compatibility with upstream updates is critical for security patches and new plugins
- **Decision 2**: Create dedicated Go "plugins" service (not add to existing services) because this is a distinct concern with different scaling/deployment needs
- **Decision 3**: Proxy all plugin data through Go layer (not direct frontend calls) because workspace filtering and data transformation must be centralized
- **Decision 4**: Store plugin config in Payload (not Backstage's app-config.yaml) because admin UI must be the source of truth and changes should not require deployments
- **Decision 5**: Use dynamic configuration provider to sync Payload CMS config to Backstage without restarts (see Configuration Synchronization Strategy below)

### Configuration Synchronization Strategy

**Problem**: Backstage plugins read configuration from `app-config.yaml` at startup. Payload CMS is the source of truth for plugin configuration (API keys, URLs, enable/disable state). How do we sync changes without restarting Backstage?

**Solution**: Implement custom Backstage configuration provider that polls Orbit API for config updates.

**Architecture:**
```
Payload CMS (DB)
  ↓ (admin updates config)
Orbit API Endpoint: GET /api/plugins/config
  ↓ (HTTP poll every 60s)
Backstage Dynamic Config Provider
  ↓ (updates in-memory config)
Backstage Plugins (read updated config)
```

**Implementation Approach:**

1. **Create Orbit API endpoint** that returns Backstage-compatible config format:
```typescript
// orbit-www/src/app/api/plugins/config/route.ts
export async function GET(request: Request) {
  const payload = await getPayload({ config })

  // Fetch all enabled plugin configs
  const configs = await payload.find({
    collection: 'plugin-configs',
    where: { enabled: { equals: true } },
    limit: 1000,
  })

  // Transform to Backstage config format
  const backstageConfig = {
    integrations: {},
    jira: [],
    github: [],
  }

  for (const config of configs.docs) {
    const plugin = config.plugin

    if (plugin.pluginId === 'jira') {
      backstageConfig.jira.push({
        host: config.config.jiraUrl,
        token: decryptSecret(config.secrets.apiToken),
        // Inject workspace context for filtering
        workspace_id: config.workspace.id,
      })
    }
    // ... similar for other plugins
  }

  return Response.json(backstageConfig)
}
```

2. **Create Backstage dynamic config provider**:
```typescript
// services/backstage-backend/src/modules/dynamic-config/index.ts
import { createBackendModule } from '@backstage/backend-plugin-api';
import { ConfigReader } from '@backstage/config';

export const dynamicConfigModule = createBackendModule({
  pluginId: 'app',
  moduleId: 'dynamic-config',
  register(env) {
    env.registerInit({
      deps: {
        config: coreServices.rootConfig,
        logger: coreServices.logger,
      },
      async init({ config, logger }) {
        const orbitApiUrl = config.getString('orbit.apiUrl');
        const pollInterval = config.getOptionalNumber('orbit.configPollInterval') || 60000;

        // Fetch config from Orbit API periodically
        setInterval(async () => {
          try {
            const response = await fetch(`${orbitApiUrl}/api/plugins/config`);
            const newConfig = await response.json();

            // Update config dynamically
            ConfigReader.fromConfigs([
              { data: newConfig, context: 'orbit-dynamic' }
            ]);

            logger.info('Plugin configuration refreshed from Orbit API');
          } catch (error) {
            logger.error('Failed to fetch plugin config from Orbit', error);
          }
        }, pollInterval);
      },
    });
  },
});
```

3. **Backstage app-config.yaml references Orbit API**:
```yaml
# services/backstage-backend/app-config.yaml
orbit:
  apiUrl: ${ORBIT_API_URL}
  configPollInterval: 60000  # 60 seconds

# Initial empty config, will be populated dynamically
integrations: {}
jira: []
github: []
```

**Trade-offs:**

| Approach | Pros | Cons |
|----------|------|------|
| **Polling (Chosen)** | Simple, no webhook infrastructure needed | 60s delay for config changes |
| **Webhooks** | Instant config updates | Requires webhook endpoint in Backstage, auth complexity |
| **Restart on Change** | Simple, guaranteed consistency | Downtime, slow iteration |
| **Shared Database** | No sync needed | Tight coupling, Backstage schema knowledge required |

**Configuration Change Flow:**

1. Admin updates Jira API token in Payload CMS
2. Payload saves encrypted secret to database
3. Backstage polls `/api/plugins/config` (next 60s cycle)
4. Backstage receives updated config with new token
5. Backstage config loader updates in-memory config
6. Next Jira API call uses new token (no restart needed)

**Cache Invalidation:**

For immediate config changes (e.g., disabling a plugin during incident):
```bash
# Manual trigger: Force config reload via Backstage admin API
curl -X POST http://localhost:7007/api/admin/config/reload \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Fallback Strategy:**

If Orbit API is unreachable:
- Backstage continues using last successfully fetched config
- Log warnings every poll interval
- Alert if config fetch fails for > 5 minutes
- Admin can manually update `app-config.yaml` as emergency fallback

### Plugin Lifecycle Management

**Problem**: Backstage plugins are npm packages installed at build time. How do we manage plugin versions, updates, and removal without breaking production?

**Solution**: Version pinning with documented upgrade process and rollback strategy.

**Version Management:**

1. **Lock File Discipline**:
```json
// services/backstage-backend/package.json
{
  "dependencies": {
    "@backstage/plugin-api-docs": "1.20.0",
    "@backstage-community/plugin-github-actions-backend": "2.0.1",
    "@backstage-community/plugin-azure-devops-backend": "1.5.0",
    "@roadiehq/backstage-plugin-argo-cd-backend": "2.3.1",
    "@vippsas/plugin-azure-resources-backend": "0.8.2"
  }
}
```
- Pin exact versions (no `^` or `~`)
- Commit `yarn.lock` to version control
- Document reason for each plugin version in `CHANGELOG.md`

2. **Plugin Registry Versioning**:
```typescript
// orbit-www/src/collections/PluginRegistry.ts - Add version field
{
  name: 'pluginVersion',
  type: 'text',
  required: true,
  admin: {
    description: 'NPM package version (e.g., "1.2.3")',
  },
},
{
  name: 'backstageVersion',
  type: 'text',
  required: true,
  admin: {
    description: 'Compatible Backstage core version (e.g., "1.20.x")',
  },
},
```

3. **Dependency Conflict Detection**:
```bash
# services/backstage-backend/scripts/check-plugin-compatibility.sh
#!/bin/bash

echo "Checking plugin compatibility..."

# Extract peer dependencies for all plugins
for plugin in jira github-actions kubernetes jenkins; do
  echo "Checking @backstage-community/plugin-$plugin-backend..."
  npm info "@backstage-community/plugin-$plugin-backend" peerDependencies
done

# Check for version conflicts
yarn install --check-files

if [ $? -ne 0 ]; then
  echo "ERROR: Plugin dependency conflicts detected!"
  exit 1
fi

echo "All plugins compatible"
```

**Plugin Upgrade Process:**

1. **Test in Staging**:
```bash
# 1. Update plugin version in separate branch
cd services/backstage-backend
yarn add @backstage-community/plugin-jira-backend@1.3.0

# 2. Run compatibility check
./scripts/check-plugin-compatibility.sh

# 3. Build and test
yarn build
yarn test

# 4. Deploy to staging environment
kubectl apply -f infrastructure/kubernetes/backstage-deployment-staging.yaml

# 5. Run integration tests against staging
cd ../../
make test-integration BACKSTAGE_URL=https://staging-backstage.orbit.internal

# 6. Manual verification
curl https://staging-backstage.orbit.internal/api/jira/projects

# 7. If tests pass, merge to main and deploy to production
```

2. **Rollback Strategy**:
```bash
# If plugin upgrade causes issues in production:

# Option 1: Git revert
git revert <commit-hash>
git push origin main
# Redeploy with previous version

# Option 2: Manual downgrade
cd services/backstage-backend
yarn add @backstage-community/plugin-jira-backend@1.2.3
yarn build
docker build -t orbit-backstage:rollback .
kubectl set image deployment/backstage-backend backstage=orbit-backstage:rollback
```

**Plugin Removal Process:**

When deprecating a plugin:

1. **Disable in Payload** (soft delete):
```sql
-- Mark all configs as disabled
UPDATE plugin_configs
SET enabled = false
WHERE plugin_id = (SELECT id FROM plugin_registry WHERE plugin_id = 'deprecated-plugin');
```

2. **Monitor for 30 days**:
- Check metrics: `plugins_requests_total{plugin_id="deprecated-plugin"}`
- If requests = 0 for 30 days, proceed to removal

3. **Remove from codebase**:
```bash
cd services/backstage-backend
yarn remove @backstage-community/plugin-deprecated-backend

# Remove from imports
# services/backstage-backend/src/index.ts
# Delete: backend.add(import('@backstage-community/plugin-deprecated-backend'));

yarn build
yarn test
```

4. **Delete from registry**:
```sql
-- Archive plugin (don't delete for audit trail)
UPDATE plugin_registry
SET archived = true, archived_at = NOW()
WHERE plugin_id = 'deprecated-plugin';
```

**Plugin Dependency Matrix**:

Maintain compatibility matrix in documentation:

```markdown
## services/backstage-backend/PLUGINS.md

| Plugin | Version | Backstage Core | Peer Dependencies | Status |
|--------|---------|----------------|-------------------|--------|
| API Docs | 1.20.0 | ^1.20.0 | None (core plugin) | Active |
| GitHub Actions | 2.0.1 | ^1.20.0 | @octokit/rest@^19.0.0 | Active |
| Azure Pipelines | 1.5.0 | ^1.20.0 | @azure/devops-node-api@^12.0.0 | Active |
| ArgoCD | 2.3.1 | ^1.20.0 | None | Active |
| Azure Resources | 0.8.2 | ^1.20.0 | @azure/arm-resources@^5.0.0 | Active |

### Update History
- 2025-10-19: Initial plugin selection for MVP
- 2025-10-19: Added Azure Resources plugin v0.8.2
- 2025-10-19: Added ArgoCD plugin v2.3.1
```

### Authentication & Authorization Flow

**Problem**: How do we ensure secure authentication across the entire request chain (Frontend → Go → Backstage → External APIs) while maintaining workspace isolation?

**Solution**: JWT-based authentication with workspace claim validation at each layer.

**Complete Authentication Flow:**

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 1. User Login                                                            │
│    User → Payload Auth → JWT issued with claims:                         │
│    {                                                                      │
│      "sub": "user-123",                                                  │
│      "email": "user@example.com",                                        │
│      "workspaces": ["ws-abc", "ws-xyz"],  // Workspaces user can access │
│      "role": "developer",                                                │
│      "exp": 1735689600                                                   │
│    }                                                                      │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ 2. Frontend gRPC Call                                                    │
│    React Component calls:                                                │
│    pluginsClient.proxyPluginRequest({                                   │
│      workspaceId: "ws-abc",                                             │
│      pluginId: "jira",                                                  │
│      endpointPath: "/issues",                                           │
│    }, {                                                                  │
│      headers: {                                                          │
│        authorization: `Bearer ${jwtToken}`  // JWT from login           │
│      }                                                                   │
│    })                                                                    │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ 3. Go gRPC Service (Plugins Service)                                     │
│                                                                           │
│    a) Extract JWT from gRPC metadata:                                    │
│       md, _ := metadata.FromIncomingContext(ctx)                        │
│       token := md.Get("authorization")[0]                               │
│                                                                           │
│    b) Validate JWT signature:                                            │
│       claims, err := jwt.Parse(token, secretKey)                        │
│       if err != nil { return Unauthenticated }                          │
│                                                                           │
│    c) Verify workspace access:                                           │
│       if !claims.Workspaces.Contains(req.WorkspaceId) {                 │
│         return PermissionDenied                                          │
│       }                                                                   │
│                                                                           │
│    d) Log access for audit:                                              │
│       log.Info("Plugin access", "user", claims.Sub,                     │
│                "workspace", req.WorkspaceId, "plugin", req.PluginId)    │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ 4. Go → Backstage HTTP Call                                              │
│                                                                           │
│    HTTP Request:                                                          │
│    GET http://backstage:7007/api/jira/issues                           │
│    Headers:                                                               │
│      X-Orbit-Workspace-Id: ws-abc        ← CRITICAL for isolation       │
│      X-Orbit-User-Id: user-123           ← For Backstage logging        │
│      X-Orbit-Plugin-Id: jira             ← Plugin context               │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ 5. Backstage Workspace Isolation Middleware                              │
│                                                                           │
│    app.use((req, res, next) => {                                        │
│      const workspaceId = req.headers['x-orbit-workspace-id'];          │
│                                                                           │
│      if (!workspaceId) {                                                │
│        return res.status(400).json({ error: 'Missing workspace ID' }); │
│      }                                                                   │
│                                                                           │
│      // Attach to request for plugins to use                            │
│      req.workspaceContext = { workspaceId };                            │
│      next();                                                             │
│    });                                                                   │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ 6. Backstage Plugin (Jira)                                               │
│                                                                           │
│    a) Fetch plugin config for workspace:                                │
│       const config = await getPluginConfig(req.workspaceContext.workspaceId); │
│       // Returns: { jiraUrl, apiToken } from Orbit config endpoint      │
│                                                                           │
│    b) Make authenticated call to external API:                           │
│       const response = await fetch(`${config.jiraUrl}/rest/api/3/issue/search`, { │
│         headers: {                                                        │
│           'Authorization': `Bearer ${config.apiToken}`                   │
│         }                                                                │
│       });                                                                │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ 7. External API (Jira Cloud)                                             │
│                                                                           │
│    Jira validates API token, returns issues:                             │
│    {                                                                      │
│      "issues": [                                                         │
│        { "key": "PROJ-123", "summary": "Bug fix" }                      │
│      ]                                                                   │
│    }                                                                      │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ 8. Response Chain (Reverse Flow)                                         │
│                                                                           │
│    Jira API → Backstage Plugin → Backstage HTTP Response                │
│             → Go Service → gRPC Response → Frontend                      │
│                                                                           │
│    At each layer, workspace_id is verified in logs/metrics               │
└─────────────────────────────────────────────────────────────────────────┘
```

**JWT Claims Structure:**

```typescript
// orbit-www/src/lib/auth/jwt-types.ts
interface OrbitJWTClaims {
  sub: string;              // User ID
  email: string;            // User email
  workspaces: string[];     // Array of workspace IDs user has access to
  role: 'admin' | 'developer' | 'viewer';
  permissions: {
    [workspaceId: string]: string[];  // Per-workspace permissions
  };
  exp: number;              // Expiration timestamp
  iat: number;              // Issued at timestamp
}
```

**Workspace Access Validation (Go):**

```go
// services/plugins/internal/auth/jwt.go
package auth

import (
    "fmt"
    "time"

    "github.com/golang-jwt/jwt/v5"
)

type Claims struct {
    UserID     string   `json:"sub"`
    Email      string   `json:"email"`
    Workspaces []string `json:"workspaces"`
    Role       string   `json:"role"`
    jwt.RegisteredClaims
}

func (c *Claims) HasWorkspaceAccess(workspaceID string) bool {
    for _, ws := range c.Workspaces {
        if ws == workspaceID {
            return true
        }
    }
    return false
}

func ValidateJWT(tokenString string, secretKey []byte) (*Claims, error) {
    token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
        // Validate signing method
        if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
            return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
        }
        return secretKey, nil
    })

    if err != nil {
        return nil, fmt.Errorf("parse token: %w", err)
    }

    if claims, ok := token.Claims.(*Claims); ok && token.Valid {
        // Check expiration
        if claims.ExpiresAt.Before(time.Now()) {
            return nil, fmt.Errorf("token expired")
        }
        return claims, nil
    }

    return nil, fmt.Errorf("invalid token")
}
```

**Multi-Workspace Scenario:**

User belongs to Workspace A and Workspace B:

```
Request 1: workspace_id=ws-a, JWT.workspaces=[ws-a, ws-b]
  ✅ Allowed - user has access to ws-a

Request 2: workspace_id=ws-b, JWT.workspaces=[ws-a, ws-b]
  ✅ Allowed - user has access to ws-b

Request 3: workspace_id=ws-c, JWT.workspaces=[ws-a, ws-b]
  ❌ Denied - user does NOT have access to ws-c
  Response: 403 Forbidden
```

**Security Considerations:**

1. **Token Rotation**: JWTs expire after 24 hours, requiring re-authentication
2. **Workspace Claim Immutability**: Workspace list is validated against database on each critical operation
3. **Audit Logging**: All workspace accesses logged with user ID, workspace ID, plugin ID, timestamp
4. **Rate Limiting**: Per-workspace rate limits prevent abuse (100 req/min per workspace)
5. **No Direct Backstage Access**: Backstage backend is not publicly accessible, only via Go proxy

**Failure Scenarios:**

| Scenario | HTTP Status | gRPC Code | Response |
|----------|-------------|-----------|----------|
| Missing JWT | 401 | Unauthenticated | "Missing authorization header" |
| Invalid JWT signature | 401 | Unauthenticated | "Invalid token" |
| Expired JWT | 401 | Unauthenticated | "Token expired" |
| Workspace not in claims | 403 | PermissionDenied | "Access denied to workspace" |
| Plugin disabled | 403 | PermissionDenied | "Plugin not enabled for workspace" |
| Backstage API error | 500 | Internal | "Backstage unavailable" |

### Circuit Breaker & Resilience Patterns

**Problem**: Backstage backend may become unavailable or slow, causing cascading failures in the Go plugins service. How do we prevent total system failure when Backstage is down?

**Solution**: Implement circuit breaker pattern with automatic retries and graceful degradation.

**Circuit Breaker States:**

```
┌──────────────┐
│    CLOSED    │  ← Normal operation, requests flow through
│ (Healthy)    │
└──────┬───────┘
       │ Failures exceed threshold (5 failures in 10s)
       ↓
┌──────────────┐
│     OPEN     │  ← Circuit broken, requests fail fast
│ (Broken)     │     No requests sent to Backstage
└──────┬───────┘
       │ After timeout (30s)
       ↓
┌──────────────┐
│  HALF-OPEN   │  ← Testing recovery, allow 1 request
│ (Testing)    │
└──────┬───────┘
       │
       ├─ Success → Back to CLOSED
       └─ Failure → Back to OPEN
```

**Implementation:**

```go
// services/plugins/internal/backstage/circuit_breaker.go
package backstage

import (
    "context"
    "fmt"
    "net/http"
    "sync"
    "time"

    "github.com/sony/gobreaker"
)

type ClientWithCircuitBreaker struct {
    baseClient    *Client
    circuitBreaker *gobreaker.CircuitBreaker
}

func NewClientWithCircuitBreaker(baseURL string) *ClientWithCircuitBreaker {
    settings := gobreaker.Settings{
        Name:        "backstage-api",
        MaxRequests: 3,                    // Max requests allowed in HALF-OPEN state
        Interval:    10 * time.Second,     // Reset failure counter after this duration
        Timeout:     30 * time.Second,     // Duration to wait before trying HALF-OPEN
        ReadyToTrip: func(counts gobreaker.Counts) bool {
            failureRatio := float64(counts.TotalFailures) / float64(counts.Requests)
            return counts.Requests >= 5 && failureRatio >= 0.6
        },
        OnStateChange: func(name string, from gobreaker.State, to gobreaker.State) {
            log.Warn("Circuit breaker state changed",
                "service", name,
                "from", from.String(),
                "to", to.String(),
            )

            // Send alert if circuit opens
            if to == gobreaker.StateOpen {
                alert.Send("Backstage circuit breaker OPEN - service degraded")
            }
        },
    }

    return &ClientWithCircuitBreaker{
        baseClient:     NewClient(baseURL),
        circuitBreaker: gobreaker.NewCircuitBreaker(settings),
    }
}

func (c *ClientWithCircuitBreaker) ProxyRequest(
    ctx context.Context,
    req *ProxyRequest,
) (*ProxyResponse, error) {
    // Execute with circuit breaker
    result, err := c.circuitBreaker.Execute(func() (interface{}, error) {
        return c.baseClient.ProxyRequest(ctx, req)
    })

    if err != nil {
        // Circuit breaker is open or request failed
        if err == gobreaker.ErrOpenState {
            return nil, fmt.Errorf("backstage service unavailable (circuit breaker open)")
        }
        return nil, err
    }

    return result.(*ProxyResponse), nil
}
```

**Retry Strategy with Exponential Backoff:**

```go
// services/plugins/internal/backstage/retry.go
package backstage

import (
    "context"
    "fmt"
    "time"

    "github.com/cenkalti/backoff/v4"
)

func (c *Client) executeWithRetry(ctx context.Context, req *http.Request) (*http.Response, error) {
    var resp *http.Response
    var err error

    // Configure exponential backoff
    b := backoff.NewExponentialBackOff()
    b.InitialInterval = 100 * time.Millisecond
    b.MaxInterval = 2 * time.Second
    b.MaxElapsedTime = 10 * time.Second
    b.Multiplier = 2.0

    retryableFunc := func() error {
        resp, err = c.httpClient.Do(req)
        if err != nil {
            return err // Network error, retry
        }

        // Retry on 5xx errors and 429 (rate limit)
        if resp.StatusCode >= 500 || resp.StatusCode == 429 {
            resp.Body.Close()
            return fmt.Errorf("server error: %d", resp.StatusCode)
        }

        return nil // Success or 4xx (non-retryable)
    }

    // Retry with backoff
    if err := backoff.Retry(retryableFunc, backoff.WithContext(b, ctx)); err != nil {
        return nil, fmt.Errorf("retry exhausted: %w", err)
    }

    return resp, nil
}
```

**Fallback Strategy:**

When Backstage is completely unavailable, provide cached or default responses:

```go
// services/plugins/internal/backstage/fallback.go
package backstage

import (
    "context"
    "encoding/json"
    "time"

    "github.com/go-redis/redis/v8"
)

type CacheClient struct {
    redis      *redis.Client
    backendClient *ClientWithCircuitBreaker
}

func (c *CacheClient) ProxyRequestWithFallback(
    ctx context.Context,
    req *ProxyRequest,
) (*ProxyResponse, error) {
    // Try to fetch from Backstage
    resp, err := c.backendClient.ProxyRequest(ctx, req)
    if err == nil {
        // Success - cache the response
        c.cacheResponse(ctx, req, resp, 5*time.Minute)
        return resp, nil
    }

    // Backstage failed - try cache
    log.Warn("Backstage unavailable, attempting cache fallback",
        "plugin", req.PluginID,
        "workspace", req.WorkspaceID,
        "error", err,
    )

    cachedResp, cacheErr := c.getCachedResponse(ctx, req)
    if cacheErr == nil {
        log.Info("Serving cached response",
            "plugin", req.PluginID,
            "age", cachedResp.CachedAt,
        )
        return cachedResp, nil
    }

    // No cache available - return degraded response
    return &ProxyResponse{
        StatusCode:   503,
        Data:         []byte(`{"error":"Service temporarily unavailable"}`),
        ErrorMessage: "Backstage unavailable and no cached data",
    }, fmt.Errorf("backstage unavailable: %w", err)
}

func (c *CacheClient) cacheResponse(ctx context.Context, req *ProxyRequest, resp *ProxyResponse, ttl time.Duration) {
    cacheKey := fmt.Sprintf("plugin:%s:%s:%s", req.WorkspaceID, req.PluginID, req.EndpointPath)

    data, _ := json.Marshal(resp)
    c.redis.Set(ctx, cacheKey, data, ttl)
}
```

**Timeout Configuration:**

```go
// services/plugins/internal/config/timeouts.go
package config

import "time"

type TimeoutConfig struct {
    // Backstage HTTP client timeout
    BackstageRequestTimeout time.Duration

    // Overall gRPC request deadline
    GRPCRequestDeadline time.Duration

    // Circuit breaker timeout (OPEN → HALF-OPEN)
    CircuitBreakerTimeout time.Duration
}

var DefaultTimeouts = TimeoutConfig{
    BackstageRequestTimeout: 10 * time.Second,
    GRPCRequestDeadline:     15 * time.Second,
    CircuitBreakerTimeout:   30 * time.Second,
}
```

**Monitoring Circuit Breaker State:**

```go
// Export circuit breaker metrics for Prometheus
func (c *ClientWithCircuitBreaker) RegisterMetrics(registry *prometheus.Registry) {
    stateGauge := prometheus.NewGaugeVec(
        prometheus.GaugeOpts{
            Name: "backstage_circuit_breaker_state",
            Help: "Circuit breaker state (0=closed, 1=open, 2=half-open)",
        },
        []string{"service"},
    )

    registry.MustRegister(stateGauge)

    // Update gauge based on circuit breaker state
    go func() {
        ticker := time.NewTicker(5 * time.Second)
        defer ticker.Stop()

        for range ticker.C {
            state := c.circuitBreaker.State()
            var value float64
            switch state {
            case gobreaker.StateClosed:
                value = 0
            case gobreaker.StateOpen:
                value = 1
            case gobreaker.StateHalfOpen:
                value = 2
            }
            stateGauge.WithLabelValues("backstage-api").Set(value)
        }
    }()
}
```

**Testing Circuit Breaker:**

```go
// services/plugins/internal/backstage/circuit_breaker_test.go
func TestCircuitBreakerOpens(t *testing.T) {
    // Mock server that always returns 500
    failingServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        w.WriteHeader(500)
    }))
    defer failingServer.Close()

    client := NewClientWithCircuitBreaker(failingServer.URL)

    // Make requests until circuit opens
    for i := 0; i < 10; i++ {
        _, err := client.ProxyRequest(context.Background(), &ProxyRequest{
            WorkspaceID:    "ws-test",
            PluginID:       "jira",
            PluginBasePath: "/api/jira",
            EndpointPath:   "/issues",
            Method:         "GET",
        })

        // After ~5 failures, circuit should open
        if i >= 5 {
            assert.ErrorContains(t, err, "circuit breaker open")
        }
    }
}
```

**Graceful Degradation UI:**

Frontend should handle circuit breaker errors gracefully:

```typescript
// orbit-www/src/components/plugins/JiraIssuesList.tsx
export function JiraIssuesList({ workspaceId }: Props) {
  const [status, setStatus] = useState<'loading' | 'success' | 'degraded' | 'error'>('loading');

  useEffect(() => {
    async function fetchIssues() {
      try {
        const response = await pluginsClient.proxyPluginRequest({...});

        if (response.statusCode === 503) {
          setStatus('degraded');
          // Show cached data or "service temporarily unavailable" message
        } else {
          setStatus('success');
        }
      } catch (err) {
        setStatus('error');
      }
    }

    fetchIssues();
  }, [workspaceId]);

  if (status === 'degraded') {
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded p-4">
        <p className="text-yellow-800">
          Jira integration is temporarily unavailable. Showing cached data.
        </p>
      </div>
    );
  }

  // ...rest of component
}
```

**Key Resilience Metrics:**

- `backstage_circuit_breaker_state` - Circuit breaker state (0/1/2)
- `backstage_request_failures_total` - Total failed requests
- `backstage_request_duration_seconds` - Request latency histogram
- `backstage_cache_hits_total` - Cache hit rate during degradation
- `backstage_retry_attempts_total` - Number of retries performed

### Patterns to Follow
- gRPC service structure from `.agent/SOPs/adding-grpc-services.md`
- External API integration patterns from `.agent/SOPs/integrating-apis.md`
- Workspace isolation patterns from `services/repository/internal/service/`
- Payload collection patterns from existing collections

## Phase 0: Proof of Concept & Research

### Overview
Validate Backstage integration assumptions through a minimal proof-of-concept before committing to full production architecture. This phase de-risks the project by confirming plugin behavior, API contracts, and multi-tenancy feasibility.

### Prerequisites
- [ ] Node.js 18+ installed locally
- [ ] Docker available for local Backstage instance
- [ ] Access to test Jira/GitHub accounts for plugin testing

### Research Questions to Answer

**1. Backstage Multi-Tenancy Database Isolation**
- **Question**: How do we ensure plugin data is isolated by workspace at the database level?
- **Research Tasks**:
  - Review Backstage database schema for plugin tables
  - Test if plugins write directly to shared tables (data leakage risk)
  - Investigate Backstage's multitenancy support or lack thereof
  - Document whether we need separate Backstage instances per workspace vs shared instance with middleware filtering
- **Success Criteria**: Clear architectural decision on single vs multi-instance deployment

**2. Plugin API Contract Discovery**
- **Question**: What are the actual HTTP API endpoints and response formats for each plugin?
- **Research Tasks**:
  - Install Jira plugin, make test API calls, document actual endpoints and responses
  - Install GitHub Actions plugin, document API format
  - Compare documented API vs actual behavior (breaking changes?)
  - Test error responses (404, 500, rate limits)
- **Success Criteria**: Documented API contracts for 2-3 plugins with example requests/responses

**3. Configuration Sync Mechanism**
- **Question**: How can we dynamically update Backstage config from Payload CMS without restarts?
- **Research Tasks**:
  - Test Backstage config reloading capabilities
  - Explore dynamic config provider API
  - Build PoC config loader that fetches from HTTP endpoint (Payload API)
  - Measure config reload latency
- **Success Criteria**: Working prototype of dynamic config loading from external source

**4. Plugin Dependency Chains**
- **Question**: Do plugins have complex dependency trees that complicate version management?
- **Research Tasks**:
  - Analyze `package.json` for 5 target plugins
  - Map peer dependencies and version constraints
  - Test installing conflicting plugin versions
  - Document any plugin incompatibilities
- **Success Criteria**: Dependency matrix showing which plugins can coexist

### Changes Required

#### 1. Minimal Backstage PoC

**Files to Create:**
- `poc/backstage-test/package.json` - Minimal Backstage with 1-2 plugins
- `poc/backstage-test/app-config.yaml` - Test configuration
- `poc/backstage-test/src/index.ts` - Minimal backend
- `poc/backstage-test/FINDINGS.md` - Research findings document

**Commands to Run:**
```bash
# Create PoC directory
mkdir -p poc/backstage-test
cd poc/backstage-test

# Initialize minimal Backstage backend
npx @backstage/create-app --skip-install

# Install only Jira plugin for testing
yarn add @backstage-community/plugin-jira-backend

# Start Backstage
yarn dev

# Test API endpoints
curl http://localhost:7007/api/jira/issues?project=TEST

# Inspect database schema
psql -h localhost -U postgres -d backstage -c "\dt"
psql -h localhost -U postgres -d backstage -c "\d+ jira_issues"
```

**Research Script:**
```bash
#!/bin/bash
# poc/backstage-test/research.sh

echo "=== Backstage Multi-Tenancy Research ==="

# Test 1: Database schema inspection
echo "1. Inspecting plugin tables..."
docker exec -it postgres psql -U postgres -d backstage -c "\dt" > db-tables.txt

# Test 2: API endpoint discovery
echo "2. Testing Jira plugin API..."
curl -v http://localhost:7007/api/jira/projects > api-response-jira.json

# Test 3: Workspace header injection test
echo "3. Testing custom header propagation..."
curl -H "X-Orbit-Workspace-Id: ws-123" http://localhost:7007/api/jira/projects

# Test 4: Config reload test
echo "4. Testing dynamic config changes..."
# Modify app-config.yaml
# Check if Backstage picks up changes without restart

echo "Research complete. See FINDINGS.md for analysis."
```

#### 2. Document Findings

**File**: `poc/backstage-test/FINDINGS.md`

Template:
```markdown
# Backstage Integration PoC Findings

## Date: [YYYY-MM-DD]

### Multi-Tenancy Feasibility

**Database Isolation:**
- [ ] Plugin tables contain workspace/tenant identifier field
- [ ] Plugins write to shared tables (RISK: data leakage)
- [ ] Backstage supports built-in multitenancy: YES/NO
- [ ] Decision: [Single shared instance with middleware filtering / Separate instances per workspace]

**Justification:**
[Detailed reasoning based on observations]

### Plugin API Contracts

**Jira Plugin:**
- Endpoint: `/api/jira/projects`
- Method: GET
- Required Headers: [list]
- Response Format: [paste example JSON]
- Error Codes: 404 (project not found), 401 (auth failed), 500 (Jira API down)

**GitHub Actions Plugin:**
- [Similar documentation]

### Configuration Sync

**Current Behavior:**
- Config changes require: [restart / reload endpoint / automatic detection]
- Reload latency: [X seconds]

**Proposed Solution:**
[Description of dynamic config loader approach]

### Plugin Dependencies

**Compatibility Matrix:**
| Plugin | Version | Peer Dependencies | Conflicts |
|--------|---------|-------------------|-----------|
| Jira   | 1.2.0   | @backstage/core ^1.0 | None |
| GitHub | 2.0.1   | @backstage/core ^1.0 | None |

### Blockers Identified

1. [List any show-stoppers discovered]
2. [Alternative approaches if needed]

### Recommendations

- [ ] Proceed with original architecture
- [ ] Modify approach based on findings: [details]
- [ ] Investigate alternative: [alternative approach]
```

### Dependencies
- None (this is Phase 0, foundational research)

### Success Criteria

#### Automated Verification
- [ ] PoC Backstage instance starts successfully
- [ ] At least 1 plugin is operational (Jira or GitHub)
- [ ] API calls return expected data formats
- [ ] Database tables created by plugins are documented

#### Manual Verification
- [ ] FINDINGS.md document completed with all sections filled
- [ ] Multi-tenancy approach validated and documented
- [ ] Plugin API contracts documented with examples
- [ ] Configuration sync mechanism identified
- [ ] Team reviews findings and approves proceeding to Phase 1

### Time Estimate
**2-3 days** for research, testing, and documentation

### Rollback Plan
Delete `poc/` directory. No production systems affected.

---

## Phase 1: Backstage Backend Setup

### Overview
Bootstrap a minimal Backstage backend with dependency injection system, select and install 5-10 initial community plugins, configure for Orbit's environment (no Backstage catalog, custom auth).

### Prerequisites
- [ ] Node.js 18+ installed in development environment
- [ ] Docker and docker-compose available for containerization
- [ ] Network connectivity to npm registry for plugin installation

### Changes Required

#### 1. Backstage Backend Service

**Files to Create:**
- `services/backstage-backend/package.json` - Node.js dependencies
- `services/backstage-backend/app-config.yaml` - Backstage configuration
- `services/backstage-backend/src/index.ts` - Backend entry point
- `services/backstage-backend/src/plugins/` - Plugin registration
- `services/backstage-backend/Dockerfile` - Container image
- `services/backstage-backend/.dockerignore` - Build exclusions

**Changes Summary:**
Create a new Backstage backend application using `@backstage/create-app` as reference, but stripped down to only plugin execution. Remove Backstage catalog, auth, and frontend components.

**Code Examples:**
```typescript
// services/backstage-backend/src/index.ts
import { createBackend } from '@backstage/backend-defaults';

const backend = createBackend();

// Core services (minimal set)
backend.add(import('@backstage/plugin-app-backend'));

// Initial plugin set - API Catalog category
backend.add(import('@backstage/plugin-api-docs')); // Core Backstage API docs plugin
backend.add(import('@backstage-community/plugin-graphql-backend'));

// Initial plugin set - CI/CD category
backend.add(import('@backstage-community/plugin-github-actions-backend'));
backend.add(import('@backstage-community/plugin-azure-devops-backend')); // Azure Pipelines

// Initial plugin set - Infrastructure/Deployment category
backend.add(import('@roadiehq/backstage-plugin-argo-cd-backend')); // ArgoCD

// Initial plugin set - Cloud Resources category
backend.add(import('@vippsas/plugin-azure-resources-backend')); // Azure Resources

// Custom workspace middleware
backend.add(import('./modules/workspace-isolation'));

backend.start();
```

```yaml
# services/backstage-backend/app-config.yaml
app:
  title: Orbit Backstage Integration
  baseUrl: http://localhost:7007

backend:
  baseUrl: http://localhost:7007
  listen:
    port: 7007
    host: 0.0.0.0
  cors:
    origin: http://localhost:3000
    credentials: true
  database:
    client: pg
    connection:
      host: ${POSTGRES_HOST}
      port: ${POSTGRES_PORT}
      user: ${POSTGRES_USER}
      password: ${POSTGRES_PASSWORD}
      database: backstage

# Plugin configurations (populated from Orbit Payload API)
# This will be dynamically loaded via custom config loader
integrations: {}
```

```dockerfile
# services/backstage-backend/Dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production

COPY . .

RUN yarn build

EXPOSE 7007
CMD ["node", "packages/backend", "--config", "app-config.yaml"]
```

#### 2. Docker Compose Integration

**Files to Modify:**
- `docker-compose.yml` - Add Backstage backend service

**Changes:**
```yaml
# docker-compose.yml - Add to services section
  backstage-backend:
    build:
      context: ./services/backstage-backend
      dockerfile: Dockerfile
    ports:
      - "7007:7007"
    environment:
      POSTGRES_HOST: postgres
      POSTGRES_PORT: 5433
      POSTGRES_USER: orbit
      POSTGRES_PASSWORD: orbit
      POSTGRES_DATABASE: backstage
      NODE_ENV: development
      ORBIT_API_URL: http://localhost:3000
    depends_on:
      - postgres
      - redis
    volumes:
      - ./services/backstage-backend:/app
    networks:
      - orbit-network
```

#### 3. Workspace Isolation Middleware

**Files to Create:**
- `services/backstage-backend/src/modules/workspace-isolation/index.ts` - Custom backend module
- `services/backstage-backend/src/modules/workspace-isolation/WorkspaceService.ts` - Workspace context

**Changes Summary:**
Create custom Backstage backend module that intercepts all HTTP requests, validates workspace_id from headers, and injects workspace context into plugin requests.

**Code Examples:**
```typescript
// services/backstage-backend/src/modules/workspace-isolation/index.ts
import { createBackendModule } from '@backstage/backend-plugin-api';
import { loggerToWinstonLogger } from '@backstage/backend-common';
import express from 'express';

export const workspaceIsolationModule = createBackendModule({
  pluginId: 'app',
  moduleId: 'workspace-isolation',
  register(env) {
    env.registerInit({
      deps: {
        logger: coreServices.logger,
        httpRouter: coreServices.httpRouter,
      },
      async init({ logger, httpRouter }) {
        const middleware = async (
          req: express.Request,
          res: express.Response,
          next: express.NextFunction,
        ) => {
          const workspaceId = req.headers['x-orbit-workspace-id'];

          if (!workspaceId) {
            logger.warn('Request missing workspace ID header');
            return res.status(400).json({
              error: 'Missing x-orbit-workspace-id header'
            });
          }

          // Attach workspace context to request
          (req as any).workspaceContext = {
            workspaceId: workspaceId as string,
          };

          next();
        };

        httpRouter.use(middleware);
      },
    });
  },
});

export default workspaceIsolationModule;
```

### Dependencies
- Depends on: PostgreSQL running on port 5433
- Depends on: Node.js 18+ runtime

### Success Criteria

#### Automated Verification
- [ ] Backstage backend builds successfully: `cd services/backstage-backend && yarn build`
- [ ] Docker image builds: `docker build -t orbit-backstage services/backstage-backend`
- [ ] Backstage starts and listens on port 7007: `docker-compose up backstage-backend`
- [ ] Health check endpoint responds: `curl http://localhost:7007/api/health`
- [ ] Database migrations succeed (Backstage creates its schema)
- [ ] No HIGH/CRITICAL npm vulnerabilities: `npm audit`

#### Manual Verification
- [ ] Backstage backend starts without errors in docker-compose logs
- [ ] Can access Backstage API at http://localhost:7007
- [ ] PostgreSQL has `backstage` database with plugin tables
- [ ] Workspace isolation middleware rejects requests without workspace ID header
- [ ] Workspace isolation middleware accepts requests with valid workspace ID
- [ ] Installed plugins appear in Backstage's plugin registry

### Rollback Plan
Remove Backstage service from docker-compose, drop `backstage` database, delete `services/backstage-backend/` directory.

---

## Phase 2: Go Plugins gRPC Service

### Overview
Create new Go microservice that acts as a proxy between Orbit's frontend and Backstage backend, implementing workspace filtering, auth validation, and data transformation.

### Prerequisites
- [x] Phase 1 completed (Backstage backend running)
- [ ] Protobuf definitions created for plugin service

### Changes Required

#### 1. Protocol Buffer Definitions

**Files to Create:**
- `proto/plugins.proto` - gRPC service contract

**Code Examples:**
```protobuf
// proto/plugins.proto
syntax = "proto3";

package idp.plugins.v1;

option go_package = "github.com/drewpayment/orbit/proto/gen/go/idp/plugins/v1;pluginsv1";

// PluginsService provides access to Backstage community plugins
service PluginsService {
  // ListPlugins returns all available plugins for the workspace
  rpc ListPlugins(ListPluginsRequest) returns (ListPluginsResponse);

  // ProxyPluginRequest is a generic proxy that forwards requests to Backstage
  // This allows adding new plugins without changing the proto definition
  rpc ProxyPluginRequest(ProxyPluginRequestMessage) returns (ProxyPluginResponse);

  // GetPluginSchema returns the schema for a specific plugin's data
  // Used by frontend to dynamically render plugin data
  rpc GetPluginSchema(GetPluginSchemaRequest) returns (GetPluginSchemaResponse);
}

message ListPluginsRequest {
  string workspace_id = 1;
}

message ListPluginsResponse {
  repeated Plugin plugins = 1;
}

message Plugin {
  string id = 1;
  string name = 2;
  string category = 3; // "api-catalog", "ci-cd", "infrastructure", "cloud-resources"
  bool enabled = 4;
  map<string, string> config = 5;
  string api_base_path = 6; // e.g., "/api/argocd"
}

// Generic proxy pattern - no plugin-specific endpoints needed
message ProxyPluginRequestMessage {
  string workspace_id = 1;
  string plugin_id = 2;
  string endpoint_path = 3; // e.g., "/projects" or "/issues?project=PROJ"
  string http_method = 4; // "GET", "POST", "PUT", "DELETE"
  map<string, string> query_params = 5;
  map<string, string> headers = 6;
  bytes body = 7; // For POST/PUT requests
}

message ProxyPluginResponse {
  int32 status_code = 1;
  bytes data = 2; // Raw JSON from Backstage
  map<string, string> headers = 3;
  string error_message = 4; // Only populated if error occurred
}

// Plugin schema for dynamic frontend rendering
message GetPluginSchemaRequest {
  string plugin_id = 1;
}

message GetPluginSchemaResponse {
  string json_schema = 1; // JSON schema describing the data structure
  repeated PluginEndpoint endpoints = 2;
}

message PluginEndpoint {
  string path = 1;
  string method = 2;
  string description = 3;
  repeated PluginParameter parameters = 4;
}

message PluginParameter {
  string name = 1;
  string type = 2; // "string", "number", "boolean"
  bool required = 3;
  string description = 4;
}
```

#### 2. Go Service Structure

**Files to Create:**
- `services/plugins/go.mod` - Go module definition
- `services/plugins/cmd/server/main.go` - Entry point
- `services/plugins/internal/domain/plugin.go` - Domain entities
- `services/plugins/internal/service/plugins_service.go` - Business logic
- `services/plugins/internal/grpc/server.go` - gRPC server
- `services/plugins/internal/backstage/client.go` - HTTP client for Backstage
- `services/plugins/internal/config/config.go` - Configuration

**Changes Summary:**
Create new Go service following Orbit's standard layout pattern, implementing HTTP client to communicate with Backstage backend and gRPC server to expose data to frontend.

**Code Examples:**
```go
// services/plugins/internal/backstage/client.go
package backstage

import (
    "context"
    "encoding/json"
    "fmt"
    "net/http"
)

type Client struct {
    baseURL    string
    httpClient *http.Client
}

func NewClient(baseURL string) *Client {
    return &Client{
        baseURL:    baseURL,
        httpClient: &http.Client{Timeout: 10 * time.Second},
    }
}

// ProxyRequest is a generic proxy that forwards requests to Backstage
// This allows adding new plugins without modifying the Go service code
func (c *Client) ProxyRequest(ctx context.Context, req *ProxyRequest) (*ProxyResponse, error) {
    // Build full URL
    url := fmt.Sprintf("%s%s%s", c.baseURL, req.PluginBasePath, req.EndpointPath)

    // Add query parameters
    if len(req.QueryParams) > 0 {
        params := url.Values{}
        for k, v := range req.QueryParams {
            params.Add(k, v)
        }
        url = fmt.Sprintf("%s?%s", url, params.Encode())
    }

    // Create HTTP request
    httpReq, err := http.NewRequestWithContext(ctx, req.Method, url, bytes.NewReader(req.Body))
    if err != nil {
        return nil, fmt.Errorf("create request: %w", err)
    }

    // Inject workspace ID for Backstage's isolation middleware (CRITICAL)
    httpReq.Header.Set("X-Orbit-Workspace-Id", req.WorkspaceID)

    // Forward additional headers
    for k, v := range req.Headers {
        httpReq.Header.Set(k, v)
    }

    // Execute request with circuit breaker (see Circuit Breaker section)
    resp, err := c.executeWithCircuitBreaker(httpReq)
    if err != nil {
        return nil, fmt.Errorf("http call: %w", err)
    }
    defer resp.Body.Close()

    // Read response body
    body, err := io.ReadAll(resp.Body)
    if err != nil {
        return nil, fmt.Errorf("read response body: %w", err)
    }

    // Return generic response
    return &ProxyResponse{
        StatusCode:   resp.StatusCode,
        Data:         body,
        Headers:      convertHeaders(resp.Header),
        ErrorMessage: getErrorMessage(resp.StatusCode, body),
    }, nil
}

type ProxyRequest struct {
    WorkspaceID    string
    PluginID       string
    PluginBasePath string // e.g., "/api/jira"
    EndpointPath   string // e.g., "/issues"
    Method         string
    QueryParams    map[string]string
    Headers        map[string]string
    Body           []byte
}

type ProxyResponse struct {
    StatusCode   int
    Data         []byte
    Headers      map[string]string
    ErrorMessage string
}

func getErrorMessage(statusCode int, body []byte) string {
    if statusCode >= 200 && statusCode < 300 {
        return ""
    }

    // Try to extract error message from JSON response
    var errorResp struct {
        Error   string `json:"error"`
        Message string `json:"message"`
    }

    if err := json.Unmarshal(body, &errorResp); err == nil {
        if errorResp.Error != "" {
            return errorResp.Error
        }
        if errorResp.Message != "" {
            return errorResp.Message
        }
    }

    return fmt.Sprintf("HTTP %d", statusCode)
}
```

```go
// services/plugins/internal/grpc/server.go
package grpc

import (
    "context"

    "google.golang.org/grpc/codes"
    "google.golang.org/grpc/status"

    pluginsv1 "github.com/drewpayment/orbit/proto/gen/go/idp/plugins/v1"
    "github.com/drewpayment/orbit/services/plugins/internal/backstage"
    "github.com/drewpayment/orbit/services/plugins/internal/service"
)

type Server struct {
    pluginsv1.UnimplementedPluginsServiceServer
    pluginsService *service.PluginsService
}

func NewServer(pluginsService *service.PluginsService) *Server {
    return &Server{
        pluginsService: pluginsService,
    }
}

// Generic proxy endpoint - works for all plugins
func (s *Server) ProxyPluginRequest(
    ctx context.Context,
    req *pluginsv1.ProxyPluginRequestMessage,
) (*pluginsv1.ProxyPluginResponse, error) {
    // Validate required fields
    if req.WorkspaceId == "" {
        return nil, status.Error(codes.InvalidArgument, "workspace_id is required")
    }
    if req.PluginId == "" {
        return nil, status.Error(codes.InvalidArgument, "plugin_id is required")
    }
    if req.EndpointPath == "" {
        return nil, status.Error(codes.InvalidArgument, "endpoint_path is required")
    }

    // Extract JWT from gRPC metadata and validate workspace ownership
    if err := s.validateWorkspaceAccess(ctx, req.WorkspaceId); err != nil {
        return nil, err
    }

    // Call service layer with generic proxy
    response, err := s.pluginsService.ProxyPluginRequest(ctx, &service.ProxyRequest{
        WorkspaceID:  req.WorkspaceId,
        PluginID:     req.PluginId,
        EndpointPath: req.EndpointPath,
        Method:       req.HttpMethod,
        QueryParams:  req.QueryParams,
        Headers:      req.Headers,
        Body:         req.Body,
    })
    if err != nil {
        return nil, status.Errorf(codes.Internal, "proxy request failed: %v", err)
    }

    return &pluginsv1.ProxyPluginResponse{
        StatusCode:   int32(response.StatusCode),
        Data:         response.Data,
        Headers:      response.Headers,
        ErrorMessage: response.ErrorMessage,
    }, nil
}

// validateWorkspaceAccess extracts JWT from metadata and verifies user has access to workspace
func (s *Server) validateWorkspaceAccess(ctx context.Context, workspaceID string) error {
    // Extract JWT token from gRPC metadata
    md, ok := metadata.FromIncomingContext(ctx)
    if !ok {
        return status.Error(codes.Unauthenticated, "missing authentication metadata")
    }

    tokens := md.Get("authorization")
    if len(tokens) == 0 {
        return status.Error(codes.Unauthenticated, "missing authorization header")
    }

    // Parse JWT and extract workspace claim
    // (Actual JWT validation would use your auth library)
    token := strings.TrimPrefix(tokens[0], "Bearer ")
    claims, err := s.pluginsService.ValidateJWT(token)
    if err != nil {
        return status.Error(codes.Unauthenticated, "invalid token")
    }

    // Verify user has access to requested workspace
    if !claims.HasWorkspaceAccess(workspaceID) {
        return status.Error(codes.PermissionDenied, "access denied to workspace")
    }

    return nil
}
```

```go
// services/plugins/internal/service/plugins_service.go
package service

import (
    "context"
    "fmt"

    "github.com/drewpayment/orbit/services/plugins/internal/backstage"
    "github.com/drewpayment/orbit/services/plugins/internal/payload"
)

type PluginsService struct {
    backstageClient *backstage.Client
    payloadClient   *payload.Client // For fetching plugin metadata
}

func NewPluginsService(backstageClient *backstage.Client, payloadClient *payload.Client) *PluginsService {
    return &PluginsService{
        backstageClient: backstageClient,
        payloadClient:   payloadClient,
    }
}

// ProxyPluginRequest handles generic plugin proxy requests
func (s *PluginsService) ProxyPluginRequest(
    ctx context.Context,
    req *ProxyRequest,
) (*ProxyResponse, error) {
    // 1. Fetch plugin metadata from Payload to get base path
    plugin, err := s.payloadClient.GetPluginConfig(ctx, req.WorkspaceID, req.PluginID)
    if err != nil {
        return nil, fmt.Errorf("get plugin config: %w", err)
    }

    if !plugin.Enabled {
        return nil, fmt.Errorf("plugin %s is not enabled for workspace %s", req.PluginID, req.WorkspaceID)
    }

    // 2. Build Backstage proxy request
    backstageReq := &backstage.ProxyRequest{
        WorkspaceID:    req.WorkspaceID,
        PluginID:       req.PluginID,
        PluginBasePath: plugin.APIBasePath, // e.g., "/api/jira"
        EndpointPath:   req.EndpointPath,
        Method:         req.Method,
        QueryParams:    req.QueryParams,
        Headers:        req.Headers,
        Body:           req.Body,
    }

    // 3. Execute proxy request with circuit breaker and retries
    response, err := s.backstageClient.ProxyRequest(ctx, backstageReq)
    if err != nil {
        return nil, fmt.Errorf("backstage proxy: %w", err)
    }

    return &ProxyResponse{
        StatusCode:   response.StatusCode,
        Data:         response.Data,
        Headers:      response.Headers,
        ErrorMessage: response.ErrorMessage,
    }, nil
}

type ProxyRequest struct {
    WorkspaceID  string
    PluginID     string
    EndpointPath string
    Method       string
    QueryParams  map[string]string
    Headers      map[string]string
    Body         []byte
}

type ProxyResponse struct {
    StatusCode   int
    Data         []byte
    Headers      map[string]string
    ErrorMessage string
}
```

#### 3. Service Registration

**Files to Modify:**
- `docker-compose.yml` - Add plugins service
- `Makefile` - Add build/test targets for plugins service

**Changes:**
```yaml
# docker-compose.yml - Add plugins service
  plugins-service:
    build:
      context: ./services/plugins
      dockerfile: Dockerfile
    ports:
      - "50053:50053"
    environment:
      BACKSTAGE_URL: http://backstage-backend:7007
      POSTGRES_HOST: postgres
      POSTGRES_PORT: 5433
      POSTGRES_USER: orbit
      POSTGRES_PASSWORD: orbit
    depends_on:
      - backstage-backend
      - postgres
    networks:
      - orbit-network
```

### Dependencies
- Depends on: Phase 1 (Backstage backend running)
- Depends on: `make proto-gen` to generate Go/TypeScript code

### Success Criteria

#### Automated Verification
- [ ] Proto generation succeeds: `make proto-gen`
- [ ] Go service builds: `cd services/plugins && go build ./cmd/server`
- [ ] Unit tests pass: `cd services/plugins && go test -v -race ./...`
- [ ] Linting passes: `cd services/plugins && golangci-lint run`
- [ ] Docker image builds: `docker build -t orbit-plugins services/plugins`
- [ ] gRPC server starts on port 50053

#### Manual Verification
- [ ] Can call ListPlugins gRPC endpoint with workspace_id
- [ ] Can call ListJiraIssues and receive data from Backstage Jira plugin
- [ ] Invalid workspace_id returns appropriate gRPC error
- [ ] Backstage HTTP client properly injects X-Orbit-Workspace-Id header
- [ ] Service logs show successful Backstage API calls
- [ ] Error handling works for Backstage API failures

### Rollback Plan
Remove plugins service from docker-compose, delete `services/plugins/` directory, revert `proto/plugins.proto` and regenerate protos.

---

## Phase 3: Payload CMS Plugin Management

### Overview
Create Payload CMS collections for managing plugin registry (available plugins), plugin configurations (API keys, URLs), and plugin enablement per workspace.

### Prerequisites
- [x] Phase 1 completed (Backstage backend)
- [x] Phase 2 completed (Go plugins service)
- [ ] Payload CMS running locally

### Changes Required

#### 1. Plugin Registry Collection

**Files to Create:**
- `orbit-www/src/collections/PluginRegistry.ts` - Available plugins metadata
- `orbit-www/src/collections/PluginConfig.ts` - Plugin configuration per workspace

**Code Examples:**
```typescript
// orbit-www/src/collections/PluginRegistry.ts
import { CollectionConfig } from 'payload'

export const PluginRegistry: CollectionConfig = {
  slug: 'plugin-registry',
  admin: {
    useAsTitle: 'name',
    description: 'Backstage community plugins available in Orbit',
  },
  access: {
    read: ({ req: { user } }) => {
      if (!user) return false
      return true
    },
    create: ({ req: { user } }) => {
      return user?.role === 'admin'
    },
    update: ({ req: { user } }) => {
      return user?.role === 'admin'
    },
    delete: ({ req: { user } }) => {
      return user?.role === 'admin'
    },
  },
  fields: [
    {
      name: 'pluginId',
      type: 'text',
      required: true,
      unique: true,
      admin: {
        description: 'Unique identifier (e.g., "jira", "github-actions")',
      },
    },
    {
      name: 'name',
      type: 'text',
      required: true,
      admin: {
        description: 'Display name (e.g., "Jira Integration")',
      },
    },
    {
      name: 'description',
      type: 'textarea',
      admin: {
        description: 'What this plugin does',
      },
    },
    {
      name: 'category',
      type: 'select',
      required: true,
      options: [
        { label: 'API Catalog', value: 'api-catalog' },
        { label: 'CI/CD', value: 'ci-cd' },
        { label: 'Infrastructure/Deployment', value: 'infrastructure' },
        { label: 'Cloud Resources', value: 'cloud-resources' },
      ],
    },
    {
      name: 'backstagePackage',
      type: 'text',
      required: true,
      admin: {
        description: 'NPM package name (e.g., "@backstage-community/plugin-jira-backend")',
      },
    },
    {
      name: 'configSchema',
      type: 'json',
      admin: {
        description: 'JSON schema for plugin configuration fields',
      },
    },
    {
      name: 'documentationUrl',
      type: 'text',
      admin: {
        description: 'Link to plugin documentation',
      },
    },
  ],
}
```

```typescript
// orbit-www/src/collections/PluginConfig.ts
import { CollectionConfig } from 'payload'

export const PluginConfig: CollectionConfig = {
  slug: 'plugin-configs',
  admin: {
    useAsTitle: 'plugin',
    description: 'Plugin configurations per workspace',
  },
  access: {
    read: ({ req: { user } }) => {
      // Users can only read their workspace's configs
      if (!user) return false
      return {
        workspace: {
          equals: user.workspace,
        },
      }
    },
    create: ({ req: { user } }) => {
      return user?.role === 'admin'
    },
    update: ({ req: { user } }) => {
      return user?.role === 'admin'
    },
  },
  fields: [
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      required: true,
      hasMany: false,
    },
    {
      name: 'plugin',
      type: 'relationship',
      relationTo: 'plugin-registry',
      required: true,
      hasMany: false,
    },
    {
      name: 'enabled',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        description: 'Enable/disable this plugin for the workspace',
      },
    },
    {
      name: 'config',
      type: 'json',
      admin: {
        description: 'Plugin-specific configuration (API keys, URLs, etc.)',
      },
    },
    {
      name: 'secrets',
      type: 'json',
      admin: {
        description: 'Encrypted secrets (API tokens, passwords)',
        condition: (data, siblingData) => {
          // Only show to admins
          return true
        },
      },
    },
  ],
  hooks: {
    beforeChange: [
      async ({ data, req, operation }) => {
        // Encrypt secrets before saving
        if (data.secrets && operation === 'create') {
          // TODO: Implement encryption using crypto library
          // data.secrets = await encryptSecrets(data.secrets)
        }
        return data
      },
    ],
  },
}
```

#### 2. Payload Configuration

**Files to Modify:**
- `orbit-www/src/payload.config.ts` - Register new collections

**Changes:**
```typescript
// orbit-www/src/payload.config.ts - Add to collections array
import { PluginRegistry } from './collections/PluginRegistry'
import { PluginConfig } from './collections/PluginConfig'

export default buildConfig({
  collections: [
    Users,
    Media,
    Workspaces,
    Repositories,
    PluginRegistry,    // Add this
    PluginConfig,      // Add this
  ],
  // ... rest of config
})
```

#### 3. Admin UI Components

**Files to Create:**
- `orbit-www/src/app/(admin)/plugins/page.tsx` - Plugin management UI
- `orbit-www/src/components/PluginCard.tsx` - Plugin display component
- `orbit-www/src/components/PluginConfigForm.tsx` - Plugin configuration form

**Changes Summary:**
Create admin UI pages for browsing available plugins, enabling/disabling them, and configuring plugin settings.

**Code Examples:**
```tsx
// orbit-www/src/app/(admin)/plugins/page.tsx
import { getPayload } from 'payload'
import config from '@payload-config'

export default async function PluginsPage() {
  const payload = await getPayload({ config })

  const plugins = await payload.find({
    collection: 'plugin-registry',
    limit: 100,
  })

  return (
    <div className="container mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">Plugin Management</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {plugins.docs.map((plugin) => (
          <PluginCard key={plugin.id} plugin={plugin} />
        ))}
      </div>
    </div>
  )
}
```

### Dependencies
- Depends on: Phase 2 (Go plugins service providing gRPC APIs)

### Success Criteria

#### Automated Verification
- [ ] Payload migrations succeed: `cd orbit-www && pnpm payload migrate`
- [ ] TypeScript compiles: `cd orbit-www && pnpm typecheck`
- [ ] Collections appear in Payload admin: Access http://localhost:3000/admin

#### Manual Verification
- [ ] Can create plugin registry entry in Payload admin
- [ ] Can create plugin configuration for a workspace
- [ ] Enable/disable toggle updates database correctly
- [ ] Plugin secrets are stored (encryption validated in later phase)
- [ ] Access control prevents non-admins from creating plugins
- [ ] Workspace filtering works (users only see their workspace's configs)

### Rollback Plan
Remove collections from payload.config.ts, drop plugin_registry and plugin_configs tables from database, delete collection files.

---

## Phase 4: Frontend Integration & API Consumption

### Overview
Create React components in Orbit frontend to display plugin data, connect to Go plugins gRPC service using generated TypeScript clients, handle loading states and errors.

### Prerequisites
- [x] Phase 2 completed (Go plugins service)
- [x] Phase 3 completed (Payload collections)
- [ ] Proto code generated for frontend

### Changes Required

#### 1. TypeScript gRPC Client

**Files Created (Auto-generated):**
- `orbit-www/src/lib/proto/idp/plugins/v1/plugins_connect.ts` - Connect-ES client (generated by `make proto-gen`)

**Files to Create:**
- `orbit-www/src/lib/grpc/plugins-client.ts` - Client wrapper

**Code Examples:**
```typescript
// orbit-www/src/lib/grpc/plugins-client.ts
import { createClient } from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-web'
import { PluginsService } from '@/lib/proto/idp/plugins/v1/plugins_connect'

const transport = createConnectTransport({
  baseUrl: process.env.NEXT_PUBLIC_PLUGINS_API_URL || 'http://localhost:50053',
})

export const pluginsClient = createClient(PluginsService, transport)
```

#### 2. React Components for Plugin Data

**Files to Create:**
- `orbit-www/src/components/plugins/JiraIssuesList.tsx` - Display Jira issues
- `orbit-www/src/components/plugins/GitHubPRsList.tsx` - Display GitHub PRs
- `orbit-www/src/components/plugins/PluginDataCard.tsx` - Generic plugin data container

**Code Examples:**
```tsx
// orbit-www/src/components/plugins/JiraIssuesList.tsx
'use client'

import { useEffect, useState } from 'react'
import { pluginsClient } from '@/lib/grpc/plugins-client'
import { ListJiraIssuesRequest } from '@/lib/proto/idp/plugins/v1/plugins_pb'

interface JiraIssue {
  key: string
  summary: string
  status: string
  assignee: string
  createdAt: string
}

export function JiraIssuesList({ workspaceId, projectKey }: {
  workspaceId: string
  projectKey: string
}) {
  const [issues, setIssues] = useState<JiraIssue[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchIssues() {
      try {
        setLoading(true)
        const response = await pluginsClient.listJiraIssues({
          workspaceId,
          projectKey,
          status: '',
        })

        setIssues(response.issues.map(issue => ({
          key: issue.key,
          summary: issue.summary,
          status: issue.status,
          assignee: issue.assignee,
          createdAt: issue.createdAt,
        })))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch issues')
      } finally {
        setLoading(false)
      }
    }

    fetchIssues()
  }, [workspaceId, projectKey])

  if (loading) return <div>Loading Jira issues...</div>
  if (error) return <div className="text-red-500">Error: {error}</div>

  return (
    <div className="space-y-2">
      <h3 className="text-lg font-semibold">Jira Issues</h3>
      {issues.length === 0 ? (
        <p className="text-gray-500">No issues found</p>
      ) : (
        <ul className="divide-y">
          {issues.map((issue) => (
            <li key={issue.key} className="py-2">
              <div className="flex justify-between items-start">
                <div>
                  <span className="font-mono text-sm text-blue-600">{issue.key}</span>
                  <p className="font-medium">{issue.summary}</p>
                  <p className="text-sm text-gray-500">
                    {issue.assignee} • {new Date(issue.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <span className="px-2 py-1 text-xs rounded bg-gray-100">
                  {issue.status}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

#### 3. Dashboard Integration

**Files to Create:**
- `orbit-www/src/app/(app)/workspace/[id]/integrations/page.tsx` - Integrations dashboard

**Code Examples:**
```tsx
// orbit-www/src/app/(app)/workspace/[id]/integrations/page.tsx
import { JiraIssuesList } from '@/components/plugins/JiraIssuesList'
import { GitHubPRsList } from '@/components/plugins/GitHubPRsList'
import { getPayload } from 'payload'
import config from '@payload-config'

export default async function WorkspaceIntegrationsPage({
  params,
}: {
  params: { id: string }
}) {
  const payload = await getPayload({ config })

  // Fetch enabled plugins for this workspace
  const pluginConfigs = await payload.find({
    collection: 'plugin-configs',
    where: {
      and: [
        { workspace: { equals: params.id } },
        { enabled: { equals: true } },
      ],
    },
  })

  return (
    <div className="container mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">Workspace Integrations</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {pluginConfigs.docs.map((config) => {
          const plugin = config.plugin

          // Render appropriate component based on plugin type
          if (plugin.pluginId === 'jira') {
            return (
              <JiraIssuesList
                key={config.id}
                workspaceId={params.id}
                projectKey={config.config.projectKey}
              />
            )
          }

          if (plugin.pluginId === 'github-actions') {
            return (
              <GitHubPRsList
                key={config.id}
                workspaceId={params.id}
                repository={config.config.repository}
              />
            )
          }

          return null
        })}
      </div>
    </div>
  )
}
```

### Dependencies
- Depends on: Phase 2 (gRPC service)
- Depends on: Phase 3 (Payload collections)
- Depends on: `make proto-gen` for TypeScript client code

### Success Criteria

#### Automated Verification
- [ ] TypeScript compiles: `cd orbit-www && pnpm typecheck`
- [ ] React components render without errors: `cd orbit-www && pnpm test`
- [ ] Proto client imports successfully

#### Manual Verification
- [ ] Integrations page loads without errors
- [ ] JiraIssuesList component displays real Jira data
- [ ] GitHubPRsList component displays real GitHub PR data
- [ ] Loading states appear during API calls
- [ ] Error messages display when API calls fail
- [ ] Components respect workspace isolation (only show workspace's data)
- [ ] Clicking on plugin items navigates to appropriate external links

### Rollback Plan
Delete integration components, remove integrations routes, remove gRPC client imports.

---

## Phase 5: Security Hardening & Production Readiness

### Overview
Implement secrets encryption, security scanning, rate limiting, monitoring, and production deployment configuration.

### Prerequisites
- [x] All previous phases completed
- [ ] Production environment configured

### Changes Required

#### 1. Secrets Encryption

**Files to Create:**
- `orbit-www/src/lib/crypto/secrets.ts` - Encryption utilities
- `services/plugins/internal/crypto/encryption.go` - Go encryption utilities

**Code Examples:**
```typescript
// orbit-www/src/lib/crypto/secrets.ts
import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const KEY = Buffer.from(process.env.ENCRYPTION_KEY || '', 'hex')

export function encryptSecret(text: string): string {
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv)

  let encrypted = cipher.update(text, 'utf8', 'hex')
  encrypted += cipher.final('hex')

  const authTag = cipher.getAuthTag()

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`
}

export function decryptSecret(encrypted: string): string {
  const [ivHex, authTagHex, encryptedText] = encrypted.split(':')

  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv)

  decipher.setAuthTag(authTag)

  let decrypted = decipher.update(encryptedText, 'hex', 'utf8')
  decrypted += decipher.final('utf8')

  return decrypted
}
```

#### 2. Rate Limiting

**Files to Create:**
- `services/plugins/internal/middleware/rate_limiter.go` - Rate limiting middleware

**Code Examples:**
```go
// services/plugins/internal/middleware/rate_limiter.go
package middleware

import (
    "context"
    "time"

    "golang.org/x/time/rate"
    "google.golang.org/grpc"
    "google.golang.org/grpc/codes"
    "google.golang.org/grpc/status"
)

type RateLimiter struct {
    limiters map[string]*rate.Limiter
    mu       sync.RWMutex
}

func NewRateLimiter() *RateLimiter {
    return &RateLimiter{
        limiters: make(map[string]*rate.Limiter),
    }
}

func (rl *RateLimiter) getLimiter(key string) *rate.Limiter {
    rl.mu.Lock()
    defer rl.mu.Unlock()

    limiter, exists := rl.limiters[key]
    if !exists {
        // 100 requests per minute per workspace
        limiter = rate.NewLimiter(rate.Every(time.Minute/100), 10)
        rl.limiters[key] = limiter
    }

    return limiter
}

func (rl *RateLimiter) UnaryInterceptor() grpc.UnaryServerInterceptor {
    return func(
        ctx context.Context,
        req interface{},
        info *grpc.UnaryServerInfo,
        handler grpc.UnaryHandler,
    ) (interface{}, error) {
        // Extract workspace ID from request
        workspaceID := extractWorkspaceID(req)

        limiter := rl.getLimiter(workspaceID)

        if !limiter.Allow() {
            return nil, status.Error(codes.ResourceExhausted, "rate limit exceeded")
        }

        return handler(ctx, req)
    }
}
```

#### 3. Security Scanning & Monitoring

**Files to Create:**
- `.github/workflows/security-scan.yml` - CI security scanning
- `services/backstage-backend/scripts/audit-plugins.sh` - Plugin security audit

**Code Examples:**
```yaml
# .github/workflows/security-scan.yml
name: Security Scan

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  schedule:
    - cron: '0 0 * * 0' # Weekly

jobs:
  security-scan:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Run npm audit on Backstage
        working-directory: services/backstage-backend
        run: |
          npm audit --audit-level=high

      - name: Run Snyk security scan
        uses: snyk/actions/node@master
        env:
          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
        with:
          args: --severity-threshold=high

      - name: Run gosec on Go services
        run: |
          make security
```

```bash
#!/bin/bash
# services/backstage-backend/scripts/audit-plugins.sh

echo "Auditing Backstage plugin security..."

# Check for high/critical vulnerabilities
npm audit --audit-level=high

# Check for outdated packages
npm outdated

# Verify plugin signatures (if available)
# TODO: Implement plugin signature verification

echo "Audit complete"
```

#### 4. Production Configuration

**Files to Create:**
- `services/backstage-backend/app-config.production.yaml` - Production config
- `infrastructure/kubernetes/backstage-deployment.yaml` - K8s deployment

**Code Examples:**
```yaml
# services/backstage-backend/app-config.production.yaml
app:
  baseUrl: https://plugins.orbit.example.com

backend:
  baseUrl: https://plugins.orbit.example.com
  listen:
    port: 7007
    host: 0.0.0.0
  cors:
    origin: https://orbit.example.com
    credentials: true
  database:
    client: pg
    connection:
      host: ${POSTGRES_HOST}
      port: 5432
      user: ${POSTGRES_USER}
      password: ${POSTGRES_PASSWORD}
      database: backstage
      ssl:
        rejectUnauthorized: true

# Rate limiting
rateLimit:
  enabled: true
  max: 100
  windowMs: 60000

# Monitoring
monitoring:
  enabled: true
  metricsPort: 9090
```

### Dependencies
- Depends on: All previous phases

### Success Criteria

#### Automated Verification
- [ ] Security scan passes: `npm audit --audit-level=high`
- [ ] Go security scan passes: `make security`
- [ ] Rate limiting tests pass: `go test ./internal/middleware/...`
- [ ] Encryption/decryption round-trip test passes
- [ ] Kubernetes manifests validate: `kubectl apply --dry-run -f infrastructure/kubernetes/`

#### Manual Verification
- [ ] Secrets are encrypted in database (verify via psql query)
- [ ] Rate limiting triggers when exceeding 100 req/min per workspace
- [ ] Monitoring metrics exposed at :9090/metrics
- [ ] Production deployment successful to staging environment
- [ ] Health checks pass in production configuration
- [ ] All plugin API calls succeed with production credentials
- [ ] Multi-workspace isolation verified in production

### Rollback Plan
Revert production configurations, disable rate limiting, remove encryption (decrypt existing secrets first), roll back Kubernetes deployments.

---

## Testing Strategy

### Unit Tests

**Location**:
- Go: `services/plugins/internal/*/\*_test.go`
- Frontend: `orbit-www/src/components/plugins/*.test.tsx`

**Approach**: Table-driven tests for Go, React Testing Library for frontend

**Test Cases**:
- **Backstage client**: Mock HTTP responses, test error handling
- **gRPC server**: Test request validation, workspace ID extraction
- **Plugin service**: Test data transformation, filtering logic
- **React components**: Test loading states, error display, data rendering
- **Encryption**: Round-trip encryption/decryption, invalid key handling
- **Rate limiting**: Test limit enforcement, key-based isolation

**Example**:
```go
// services/plugins/internal/backstage/client_test.go
func TestClient_FetchJiraIssues(t *testing.T) {
    tests := []struct {
        name           string
        workspaceID    string
        projectKey     string
        mockResponse   string
        mockStatusCode int
        wantErr        bool
        wantCount      int
    }{
        {
            name:           "success",
            workspaceID:    "ws-123",
            projectKey:     "PROJ",
            mockResponse:   `{"issues":[{"key":"PROJ-1","summary":"Test"}]}`,
            mockStatusCode: 200,
            wantErr:        false,
            wantCount:      1,
        },
        {
            name:           "backstage error",
            workspaceID:    "ws-123",
            projectKey:     "PROJ",
            mockResponse:   `{"error":"not found"}`,
            mockStatusCode: 404,
            wantErr:        true,
            wantCount:      0,
        },
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
                // Verify workspace header
                assert.Equal(t, tt.workspaceID, r.Header.Get("X-Orbit-Workspace-Id"))

                w.WriteHeader(tt.mockStatusCode)
                w.Write([]byte(tt.mockResponse))
            }))
            defer server.Close()

            client := NewClient(server.URL)
            issues, err := client.FetchJiraIssues(context.Background(), tt.workspaceID, tt.projectKey)

            if tt.wantErr {
                assert.Error(t, err)
            } else {
                assert.NoError(t, err)
                assert.Len(t, issues, tt.wantCount)
            }
        })
    }
}
```

### Integration Tests

**Location**: `services/plugins/tests/integration/`

**Approach**: Test full request/response cycle with running Backstage backend

**Test Scenarios**:
- Full data flow: Frontend gRPC call → Go service → Backstage HTTP → External API (mocked)
- Multi-tenant isolation: Create two workspaces, verify data separation
- Plugin enablement: Toggle plugin in Payload, verify API returns/blocks data
- Configuration changes: Update plugin config, verify Backstage receives new settings
- Error propagation: Backstage error properly handled and returned to frontend

### E2E Tests

**Location**: `orbit-www/tests/e2e/plugins.spec.ts`

**Tool**: Playwright

**Test Flows**:
1. Admin enables Jira plugin for workspace
2. Admin configures Jira API credentials
3. User navigates to integrations page
4. Jira issues load and display correctly
5. Admin disables plugin
6. Jira section no longer appears on integrations page

**Example**:
```typescript
// orbit-www/tests/e2e/plugins.spec.ts
import { test, expect } from '@playwright/test'

test('admin can enable and configure Jira plugin', async ({ page }) => {
  // Login as admin
  await page.goto('/admin')
  await page.fill('[name="email"]', 'admin@example.com')
  await page.fill('[name="password"]', 'password')
  await page.click('button[type="submit"]')

  // Navigate to plugins
  await page.goto('/admin/collections/plugin-configs')

  // Create new plugin config
  await page.click('text=Create New')

  // Select workspace
  await page.selectOption('[name="workspace"]', 'workspace-id-123')

  // Select Jira plugin
  await page.selectOption('[name="plugin"]', 'jira')

  // Enable plugin
  await page.check('[name="enabled"]')

  // Configure
  await page.fill('[name="config.jiraUrl"]', 'https://company.atlassian.net')
  await page.fill('[name="secrets.apiToken"]', 'fake-api-token')

  // Save
  await page.click('button:has-text("Save")')

  // Verify success
  await expect(page.locator('.toast-success')).toBeVisible()
})

test('user sees Jira issues on integrations page', async ({ page }) => {
  // Login as user
  await page.goto('/workspace/workspace-id-123/integrations')

  // Wait for Jira issues to load
  await expect(page.locator('text=Jira Issues')).toBeVisible()

  // Verify issue displayed
  await expect(page.locator('text=PROJ-1')).toBeVisible()
})
```

### Manual Testing Steps

1. **Plugin Installation Verification**
   - Run `docker-compose up backstage-backend`
   - Verify logs show plugins loaded: `grep "Loaded plugin" logs/backstage.log`
   - Access http://localhost:7007/api/health
   - Verify response: `{"status":"ok","plugins":["jira","github-actions"...]}`

2. **Multi-Tenant Isolation**
   - Create Workspace A and Workspace B in Payload
   - Enable Jira plugin for both workspaces
   - Configure different Jira projects (PROJ-A for Workspace A, PROJ-B for Workspace B)
   - Call gRPC ListJiraIssues for Workspace A → Verify only PROJ-A issues returned
   - Call gRPC ListJiraIssues for Workspace B → Verify only PROJ-B issues returned

3. **Plugin Configuration Changes**
   - Disable Jira plugin for Workspace A in Payload
   - Call gRPC ListJiraIssues for Workspace A → Verify error or empty response
   - Re-enable plugin → Verify issues returned again

4. **Security Testing**
   - Attempt to access Backstage directly without X-Orbit-Workspace-Id header → Verify rejection
   - Attempt to call Go plugins service with invalid workspace ID → Verify gRPC error
   - Inspect database to verify secrets are encrypted
   - Attempt 101 requests in 1 minute → Verify rate limit error

## Database Changes

### Schema Modifications

**Migration Files**: Managed by Payload CMS (auto-generated)

**New Tables**:
- `plugin_registry` - Available Backstage plugins metadata
- `plugin_configs` - Plugin configurations per workspace
- `backstage.*` - Backstage backend tables (managed by Backstage migrations)

**Schema**:
```sql
-- Managed by Payload CMS migrations

CREATE TABLE plugin_registry (
  id VARCHAR(255) PRIMARY KEY,
  plugin_id VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(50) NOT NULL,
  backstage_package VARCHAR(255) NOT NULL,
  config_schema JSONB,
  documentation_url TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE plugin_configs (
  id VARCHAR(255) PRIMARY KEY,
  workspace_id VARCHAR(255) REFERENCES workspaces(id) ON DELETE CASCADE,
  plugin_id VARCHAR(255) REFERENCES plugin_registry(id) ON DELETE CASCADE,
  enabled BOOLEAN DEFAULT FALSE,
  config JSONB,
  secrets JSONB, -- Encrypted
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(workspace_id, plugin_id)
);

CREATE INDEX idx_plugin_configs_workspace ON plugin_configs(workspace_id);
CREATE INDEX idx_plugin_configs_enabled ON plugin_configs(enabled);
```

### Data Migration

**Initial Plugin Registry Seeding**:
```typescript
// Script to seed initial plugins
const initialPlugins = [
  {
    pluginId: 'api-docs',
    name: 'API Documentation',
    category: 'api-catalog',
    backstagePackage: '@backstage/plugin-api-docs',
    apiBasePath: '/api/api-docs',
  },
  {
    pluginId: 'github-actions',
    name: 'GitHub Actions',
    category: 'ci-cd',
    backstagePackage: '@backstage-community/plugin-github-actions-backend',
    apiBasePath: '/api/github-actions',
  },
  {
    pluginId: 'azure-pipelines',
    name: 'Azure Pipelines',
    category: 'ci-cd',
    backstagePackage: '@backstage-community/plugin-azure-devops-backend',
    apiBasePath: '/api/azure-devops',
  },
  {
    pluginId: 'argocd',
    name: 'ArgoCD',
    category: 'infrastructure',
    backstagePackage: '@roadiehq/backstage-plugin-argo-cd-backend',
    apiBasePath: '/api/argocd',
  },
  {
    pluginId: 'azure-resources',
    name: 'Azure Resources',
    category: 'infrastructure',
    backstagePackage: '@vippsas/plugin-azure-resources-backend',
    apiBasePath: '/api/azure-resources',
  },
]

// Run: node scripts/seed-plugins.ts
```

### Rollback Migration

```sql
-- Rollback steps
DROP TABLE IF EXISTS plugin_configs;
DROP TABLE IF EXISTS plugin_registry;

-- Drop Backstage database
DROP DATABASE IF EXISTS backstage;
```

## API Changes

### New Endpoints (gRPC)

**Proto File**: `proto/plugins.proto`

**Services**:
- `PluginsService.ListPlugins` - Get available plugins for workspace
- `PluginsService.GetPluginData` - Generic plugin data fetch
- `PluginsService.ListJiraIssues` - Jira-specific endpoint
- `PluginsService.ListGitHubPullRequests` - GitHub-specific endpoint

**No Breaking Changes**: This is a new service, no existing APIs are modified.

### Versioning Strategy

- Proto package: `idp.plugins.v1`
- Future changes will use `v2` package for breaking changes
- Backward compatibility maintained within v1

## Performance Considerations

### Expected Impact

- **Backstage Backend**: Node.js service adds ~200-500MB memory footprint
- **Network Latency**: Additional hop (Frontend → Go → Backstage → External API) adds ~50-200ms
- **Database Load**: Plugin config queries are lightweight, indexed by workspace_id
- **Concurrent Requests**: Rate limited to 100 req/min per workspace

### Optimizations

- **Caching**: Implement Redis cache for plugin data with 5-minute TTL
- **Connection Pooling**: HTTP client reuses connections to Backstage
- **Parallel Fetching**: When displaying multiple plugins, fetch data in parallel
- **Lazy Loading**: Only fetch plugin data when user expands section

### Monitoring

**Metrics to Track**:
- `backstage_api_latency_seconds` - Histogram of Backstage API call durations
- `plugins_grpc_requests_total` - Counter of gRPC requests by method
- `plugins_rate_limit_exceeded_total` - Counter of rate limit rejections
- `backstage_plugin_errors_total` - Counter of plugin errors by type

**Alerts**:
- Alert if p95 latency > 2 seconds
- Alert if error rate > 5%
- Alert if Backstage backend is unreachable for > 1 minute

## Security Considerations

### Authentication/Authorization

- **Frontend → Go**: Orbit JWT token validated by Go service
- **Go → Backstage**: Workspace ID propagated via `X-Orbit-Workspace-Id` header
- **Backstage → External APIs**: Plugin-specific credentials from encrypted Payload config
- **Admin Actions**: Only users with `role === 'admin'` can enable/configure plugins

### Input Validation

- **Workspace ID**: Validated against database before forwarding to Backstage
- **Plugin ID**: Must exist in `plugin_registry` table
- **Configuration**: Validated against plugin's JSON schema
- **API Responses**: Sanitized before returning to frontend (no script injection)

### Data Protection

- **Secrets Encryption**: AES-256-GCM for API tokens, keys stored in environment variables
- **TLS in Transit**: All HTTP calls to Backstage use TLS in production
- **Database Encryption**: PostgreSQL encryption at rest enabled in production
- **Workspace Isolation**: Middleware enforces workspace_id on all queries

### Third-Party Plugin Risks

- **Code Review**: Manually audit top 10 most-used community plugins before installation
- **Dependency Scanning**: Weekly `npm audit` runs in CI/CD
- **Sandboxing**: Backstage runs in isolated container with limited network access (whitelist external domains)
- **Updates**: Monitor Backstage security advisories, patch within 48 hours of disclosure

### SSRF (Server-Side Request Forgery) Mitigation

**Attack Vector**: Admin enters malicious URL as "Jira URL" (e.g., `http://internal-service:9200`), causing Backstage to make requests to internal services.

**Impact**: Internal service enumeration, data exfiltration, potential RCE if internal services are vulnerable.

**Mitigation Strategy:**

**1. URL Validation in Payload CMS**

```typescript
// orbit-www/src/collections/PluginConfig.ts - Add URL validation hook
{
  name: 'config',
  type: 'json',
  hooks: {
    beforeChange: [
      async ({ value, req }) => {
        // Extract URLs from config
        const urls = extractURLs(value);

        for (const url of urls) {
          // Validate URL is external and not internal
          if (!await isAllowedURL(url)) {
            throw new ValidationError(
              `URL ${url} is not allowed. Only external services are permitted.`
            );
          }
        }

        return value;
      },
    ],
  },
}

async function isAllowedURL(urlString: string): Promise<boolean> {
  try {
    const url = new URL(urlString);

    // 1. Reject non-HTTP(S) protocols
    if (!['http:', 'https:'].includes(url.protocol)) {
      return false;
    }

    // 2. Reject private IP ranges (RFC 1918)
    const hostname = url.hostname;

    // Reject localhost
    if (['localhost', '127.0.0.1', '::1'].includes(hostname)) {
      return false;
    }

    // Reject private IP ranges
    const privateIPRanges = [
      /^10\./,                   // 10.0.0.0/8
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12
      /^192\.168\./,             // 192.168.0.0/16
      /^169\.254\./,             // Link-local
      /^fc00:/,                  // IPv6 private
    ];

    for (const range of privateIPRanges) {
      if (range.test(hostname)) {
        return false;
      }
    }

    // 3. Resolve DNS and check IP (prevent DNS rebinding attacks)
    const resolvedIPs = await dns.resolve4(hostname);
    for (const ip of resolvedIPs) {
      if (isPrivateIP(ip)) {
        return false;
      }
    }

    // 4. Check against allowlist (recommended for production)
    const allowedDomains = [
      'github.com',              // GitHub
      'api.github.com',          // GitHub API
      'dev.azure.com',           // Azure DevOps
      'azure.com',               // Azure services
      'management.azure.com',    // Azure Resource Manager
      // ArgoCD instances are typically self-hosted, validate per workspace config
      // ... other approved domains
    ];

    const isAllowed = allowedDomains.some(domain =>
      hostname.endsWith(domain)
    );

    if (!isAllowed) {
      // Log for security monitoring
      await securityLog.warn('Non-allowlisted domain attempted', {
        url: urlString,
        user: req.user.id,
        workspace: req.body.workspace,
      });
    }

    return isAllowed;
  } catch (error) {
    return false;
  }
}
```

**2. Backstage Network Policies (Kubernetes)**

```yaml
# infrastructure/kubernetes/backstage-network-policy.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: backstage-backend-egress
  namespace: orbit
spec:
  podSelector:
    matchLabels:
      app: backstage-backend
  policyTypes:
  - Egress
  egress:
  # Allow DNS
  - to:
    - namespaceSelector:
        matchLabels:
          name: kube-system
    ports:
    - protocol: UDP
      port: 53

  # Allow external HTTPS only to specific domains (via egress gateway)
  - to:
    - podSelector:
        matchLabels:
          app: egress-gateway
    ports:
    - protocol: TCP
      port: 443

  # DENY all other egress traffic
  # This prevents access to internal cluster services
```

**3. Egress Gateway with Domain Filtering**

```yaml
# infrastructure/kubernetes/egress-gateway.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: squid-config
data:
  squid.conf: |
    # Allowlist external domains only
    acl allowed_domains dstdomain .github.com .dev.azure.com .azure.com .management.azure.com .windows.net

    http_access allow allowed_domains
    http_access deny all

    # Log denied requests for security monitoring
    access_log /var/log/squid/access.log
```

**4. Backstage HTTP Client with Safeguards**

```typescript
// services/backstage-backend/src/lib/http-client.ts
import fetch from 'node-fetch';
import { URL } from 'url';

export async function safeFetch(url: string, options?: RequestInit) {
  // Additional runtime check (defense in depth)
  const parsedURL = new URL(url);

  // Reject if IP is private (in case validation was bypassed)
  if (isPrivateIP(parsedURL.hostname)) {
    throw new Error(`Access to private IP ${parsedURL.hostname} is forbidden`);
  }

  // Set timeout to prevent hanging on slow internal services
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      // Follow redirects with caution (max 3 redirects)
      redirect: 'manual',
    });

    // If redirect, validate redirect target
    if (response.status >= 300 && response.status < 400) {
      const redirectURL = response.headers.get('location');
      if (redirectURL) {
        const redirectParsed = new URL(redirectURL, url);
        if (isPrivateIP(redirectParsed.hostname)) {
          throw new Error('Redirect to private IP blocked');
        }
      }
    }

    return response;
  } finally {
    clearTimeout(timeout);
  }
}
```

**5. Security Monitoring & Alerts**

```go
// services/plugins/internal/security/ssrf_monitor.go
package security

import (
    "net/url"
    "regexp"
)

type SSRFMonitor struct {
    alerter *Alert
}

func (m *SSRFMonitor) CheckURL(rawURL string, userID, workspaceID string) error {
    u, err := url.Parse(rawURL)
    if err != nil {
        return err
    }

    // Check for suspicious patterns
    suspiciousPatterns := []string{
        "localhost",
        "127.0.0.1",
        "169.254",    // Link-local
        "10.",        // Private network
        "192.168",    // Private network
        "metadata",   // Cloud metadata endpoints
        "internal",   // Common internal naming
    }

    for _, pattern := range suspiciousPatterns {
        if regexp.MustCompile(pattern).MatchString(u.Host) {
            // Alert security team
            m.alerter.Critical("SSRF attempt detected", map[string]interface{}{
                "user_id":      userID,
                "workspace_id": workspaceID,
                "url":          rawURL,
                "pattern":      pattern,
            })

            return fmt.Errorf("forbidden URL pattern detected")
        }
    }

    return nil
}
```

**6. Domain Allowlist Management**

```typescript
// orbit-www/src/lib/security/allowed-domains.ts
export const PLUGIN_ALLOWED_DOMAINS = {
  'api-docs': [
    // API Docs is a Backstage core plugin, no external URLs needed
  ],
  'github-actions': [
    'github.com',
    'api.github.com',
  ],
  'azure-pipelines': [
    'dev.azure.com',
    'azure.com',
    'visualstudio.com',
  ],
  'argocd': [
    // ArgoCD URLs are typically self-hosted
    // Validation should check against workspace-configured ArgoCD instance
    // Pattern: *.argocd.example.com or custom domains
  ],
  'azure-resources': [
    'management.azure.com',
    'azure.microsoft.com',
    'windows.net',
  ],
} as const;

export function isAllowedForPlugin(
  pluginId: string,
  url: string
): boolean {
  const allowedDomains = PLUGIN_ALLOWED_DOMAINS[pluginId];
  if (!allowedDomains) {
    return false;
  }

  const hostname = new URL(url).hostname;
  return allowedDomains.some(domain => hostname.endsWith(domain));
}
```

**Testing SSRF Protection:**

```typescript
// orbit-www/tests/security/ssrf.spec.ts
import { test, expect } from '@playwright/test';

test('SSRF: Rejects localhost URLs', async ({ page }) => {
  await page.goto('/admin/collections/plugin-configs');
  await page.click('text=Create New');

  // Attempt to configure ArgoCD plugin with localhost URL
  await page.fill('[name="config.argocdUrl"]', 'http://localhost:9200');
  await page.click('button:has-text("Save")');

  // Should show validation error
  await expect(page.locator('.error-message')).toContainText(
    'URL http://localhost:9200 is not allowed'
  );
});

test('SSRF: Rejects private IP ranges', async ({ page }) => {
  const privateIPs = [
    'http://10.0.0.1',
    'http://192.168.1.1',
    'http://172.16.0.1',
    'http://169.254.169.254', // AWS metadata
  ];

  for (const ip of privateIPs) {
    await page.fill('[name="config.argocdUrl"]', ip);
    await page.click('button:has-text("Save")');

    await expect(page.locator('.error-message')).toBeVisible();
  }
});
```

**AWS/Cloud Metadata Protection:**

Special attention to cloud metadata endpoints:

```typescript
// Additional check for cloud metadata endpoints
const CLOUD_METADATA_IPS = [
  '169.254.169.254',  // AWS, Azure, GCP metadata
  'fd00:ec2::254',    // AWS IPv6 metadata
];

function isCloudMetadataIP(hostname: string): boolean {
  return CLOUD_METADATA_IPS.includes(hostname);
}
```

**Security Checklist:**

- [x] URL validation in Payload CMS (frontend)
- [x] IP range validation (reject RFC 1918)
- [x] DNS resolution check (prevent rebinding)
- [x] Domain allowlist enforcement
- [x] Network policies (Kubernetes)
- [x] Egress gateway with filtering
- [x] Runtime checks in Backstage
- [x] Redirect validation
- [x] Security monitoring and alerting
- [x] Cloud metadata IP protection

## Deployment Strategy

### Deployment Steps

1. **Deploy Backstage Backend**:
   ```bash
   cd services/backstage-backend
   docker build -t orbit-backstage:latest .
   docker push registry.example.com/orbit-backstage:latest
   kubectl apply -f infrastructure/kubernetes/backstage-deployment.yaml
   ```

2. **Deploy Go Plugins Service**:
   ```bash
   cd services/plugins
   docker build -t orbit-plugins:latest .
   docker push registry.example.com/orbit-plugins:latest
   kubectl apply -f infrastructure/kubernetes/plugins-deployment.yaml
   ```

3. **Run Database Migrations**:
   ```bash
   cd orbit-www
   pnpm payload migrate
   ```

4. **Seed Plugin Registry**:
   ```bash
   node scripts/seed-plugins.ts
   ```

5. **Deploy Frontend**:
   ```bash
   cd orbit-www
   pnpm build
   # Deploy to Vercel/hosting platform
   ```

6. **Verify Health Checks**:
   ```bash
   curl https://plugins.orbit.example.com/api/health
   curl https://api.orbit.example.com/health
   ```

### Feature Flags (if applicable)

- **Flag**: `feature_backstage_plugins_enabled`
- **Rollout**: Gradual rollout to 10% → 50% → 100% of workspaces
- **Implementation**: Check flag in Go service before forwarding to Backstage

### Rollback Procedure

1. Set feature flag to 0% (disable for all workspaces)
2. Scale down Backstage backend pods to 0
3. Scale down plugins service pods to 0
4. Revert frontend deployment to previous version
5. Verify application works without plugin features

## Monitoring & Observability

### Metrics to Track

- **Request Volume**: `plugins_requests_total{method, status, workspace_id}`
- **Latency**: `plugins_request_duration_seconds{method, workspace_id}`
- **Error Rate**: `plugins_errors_total{type, plugin_id}`
- **Plugin Usage**: `plugins_enabled_total{plugin_id, workspace_id}`
- **Cache Hit Rate**: `plugins_cache_hits_total / plugins_cache_requests_total`

### Logging

**Log Structured JSON** (following Orbit's logging patterns):
```go
log.WithFields(log.Fields{
    "workspace_id": workspaceID,
    "plugin_id": pluginID,
    "method": "ListJiraIssues",
    "duration_ms": duration.Milliseconds(),
}).Info("Plugin API call completed")
```

**Log Levels**:
- INFO: Successful API calls, plugin enablement
- WARN: Rate limit exceeded, plugin configuration missing
- ERROR: Backstage API failures, encryption errors, database errors

### Alerts

**Critical Alerts** (PagerDuty):
- Backstage backend unreachable for > 5 minutes
- Plugins service error rate > 10% for > 5 minutes
- Database connection failures

**Warning Alerts** (Slack):
- p95 latency > 2 seconds for > 10 minutes
- Rate limit exceeded > 100 times in 1 hour
- Plugin API errors > 5% for > 10 minutes

## Documentation Updates

### Code Documentation

- [ ] Add godoc comments to all exported Go functions in `services/plugins/`
- [ ] Add JSDoc comments to TypeScript plugin client wrappers
- [ ] Document Backstage plugin selection criteria in `docs/plugins.md`

### User Documentation

- [ ] Create admin guide: "How to Enable and Configure Plugins"
- [ ] Create developer guide: "How to Add New Plugin Support"
- [ ] Update API documentation with new gRPC endpoints

### .agent System Updates

After implementation:
- [ ] Run `/update doc save task backstage-plugin-integration`
- [ ] Update `.agent/SOPs/integrating-apis.md` with Backstage patterns
- [ ] Create `.agent/SOPs/adding-backstage-plugins.md` for adding new plugins
- [ ] Update `.agent/system/api-architecture.md` with plugins service diagram

## Risks & Mitigation

### Technical Risks

**Risk**: Backstage plugin incompatibility or breaking changes
- **Impact**: High - Plugin functionality breaks after upstream update
- **Mitigation**: Pin plugin versions, test updates in staging, maintain compatibility matrix

**Risk**: Performance degradation from additional service hop
- **Impact**: Medium - Slower user experience, higher cloud costs
- **Mitigation**: Implement aggressive caching, connection pooling, monitor latencies

**Risk**: Multi-tenant data leakage via plugin bugs
- **Impact**: Critical - Workspace A sees Workspace B's data
- **Mitigation**: Thorough integration testing, middleware validation, security audits

**Risk**: Node.js service operational complexity
- **Impact**: Medium - Additional service to monitor, deploy, scale
- **Mitigation**: Containerization, health checks, auto-scaling, runbooks

### Business Risks

**Risk**: Limited plugin ecosystem adoption (users don't use plugins)
- **Impact**: Medium - Wasted development effort
- **Mitigation**: Start with high-value plugins (Jira, GitHub), gather user feedback, iterate

**Risk**: Security vulnerabilities in third-party plugin code
- **Impact**: High - Potential data breaches or service disruption
- **Mitigation**: Code audits, dependency scanning, sandbox execution, security monitoring

## Dependencies

### External Dependencies

- **Node.js**: v18+ (LTS) - Backstage runtime
- **@backstage/backend-defaults**: ^0.2.0 - Backstage core
- **@backstage-community/plugin-***: Various - Community plugins
- **PostgreSQL**: 14+ - Backstage database
- **http-proxy-middleware**: ^2.0.0 - Backstage proxy

### Internal Dependencies

- **Orbit Go services**: Repository, API Catalog, Knowledge services must be running
- **Payload CMS**: Required for plugin configuration UI
- **Temporal**: (Optional) Could be used for long-running plugin sync operations

### Blocking Issues

- None currently identified

## Future Enhancements

Items explicitly deferred for future implementation:

1. **Dynamic Plugin Installation** - Allow admins to install npm plugins at runtime without redeployment
   - **Why deferred**: Complex security implications, requires plugin sandboxing, hot module reloading

2. **Backstage Frontend UI Embedding** - Embed Backstage React components via iframe or module federation
   - **Why deferred**: Complex integration, most value is in backend data, frontend can be custom-built

3. **Plugin Marketplace** - Searchable catalog of all available Backstage plugins with ratings
   - **Why deferred**: MVP only needs 5-10 curated plugins, marketplace adds complexity

4. **Custom Plugin Development SDK** - Orbit-specific plugin SDK for partners
   - **Why deferred**: Backstage plugins already provide this, focus on integration first

5. **Advanced Plugin Orchestration** - Chain multiple plugins together (e.g., Jira issue → GitHub PR)
   - **Why deferred**: Requires workflow engine integration, complex use case for later

## References

### .agent Documentation

- [.agent/system/project-structure.md](.agent/system/project-structure.md) - Monorepo layout
- [.agent/system/api-architecture.md](.agent/system/api-architecture.md) - gRPC patterns
- [.agent/SOPs/adding-grpc-services.md](.agent/SOPs/adding-grpc-services.md) - gRPC service creation
- [.agent/SOPs/integrating-apis.md](.agent/SOPs/integrating-apis.md) - External API patterns
- [.agent/SOPs/error-handling.md](.agent/SOPs/error-handling.md) - Error handling conventions

### Similar Implementations

- [.agent/tasks/feature-repository-service.md](.agent/tasks/feature-repository-service.md) - Go gRPC service example
- [.agent/tasks/feature-workspace-management.md](.agent/tasks/feature-workspace-management.md) - Multi-tenancy patterns

### External Resources

- [Backstage Plugin Architecture](https://backstage.io/docs/plugins/structure-of-a-plugin)
- [Backstage Backend System](https://backstage.io/docs/backend-system/)
- [Community Plugins Repository](https://github.com/backstage/community-plugins)
- [Backstage Plugin Development](https://backstage.io/docs/plugins/backend-plugin/)

## Lessons Learned (To Be Filled Post-Implementation)

### What Worked Well
[To be completed after implementation]

### Challenges Encountered
[To be completed after implementation]

### Changes from Plan
[To be completed if plan changed during implementation]

### Recommendations for Similar Features
[To be completed after implementation]
