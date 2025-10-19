# Phase 0 PoC - Progress Report
**Date:** 2025-10-19
**Status:** In Progress

## Objective
Validate Backstage integration assumptions through proof-of-concept before committing to full production architecture.

## Setup Completed ✅

### Environment
- **Tool:** Official Backstage scaffolding (`@backstage/create-app@latest`)
- **Package Manager:** Yarn 4.4.1 (Backstage standard)
- **Node Version:** v22.16.0
- **Backend Port:** 7007
- **Database:** SQLite (in-memory for PoC)

### Plugins Installed
1. **@roadiehq/backstage-plugin-argo-cd-backend** v4.4.2
   - Status: Installed, requires configuration
   - Configuration needed: `argocd.appLocatorMethods` in app-config.yaml

### Architecture Observations

**Backend Structure:**
```
packages/backend/
├── src/index.ts          # Plugin registration
├── package.json          # Backend dependencies
└── Dockerfile            # Container build config
```

**Plugin Registration Pattern:**
```typescript
// New plugins added via backend.add()
backend.add(import('@roadiehq/backstage-plugin-argo-cd-backend'));
```

**Key Learning:** Backstage uses a modular plugin system where:
- Each plugin is an npm package
- Plugins register via `backend.add(import('package-name'))`
- Plugins can fail gracefully if not configured (ArgoCD example)

## Research Questions - Initial Findings

### Q1: Multi-Tenancy & Database Isolation

**Status:** 🟡 Partially Investigated

**Observations:**
- Default Backstage uses SQLite (in-memory) for PoC
- Production config references PostgreSQL
- No obvious workspace/tenant isolation in default schema
- **Critical Finding:** Backstage catalog appears to be **single-tenant by design**

**Database Location:**
```yaml
# app-config.yaml
backend:
  database:
    client: better-sqlite3
    connection: ':memory:'
```

**Implication for Orbit:**
We may need to:
- Run separate Backstage instances per workspace (isolated databases), OR
- Implement workspace filtering middleware in our Go layer (data leakage risk)

**Next Steps:**
- [ ] Inspect actual database schema when backend fully initializes
- [ ] Test if plugins write workspace identifiers to tables
- [ ] Review Backstage docs on multi-tenancy support

---

### Q2: Plugin API Contracts

**Status:** 🔴 Blocked - Authentication Required

**Current Blocker:**
```json
{
  "error": {
    "name": "AuthenticationError",
    "message": "Missing credentials"
  }
}
```

**Discovery:**
- Backstage enforces authentication by default
- Guest authentication is enabled in config but requires proper headers
- Plugin API endpoints follow pattern: `/api/{plugin-id}/{endpoint}`

**Observed Endpoints:**
- `/api/catalog/entities` - Catalog plugin (401 - auth required)
- `/api/argocd/*` - ArgoCD plugin (not tested, requires config)

**Next Steps:**
- [ ] Configure guest authentication or disable auth for PoC
- [ ] Document actual API responses for catalog plugin
- [ ] Test ArgoCD endpoints once configured

---

### Q3: Configuration Sync Mechanism

**Status:** 🟡 Partially Investigated

**Discovery:**
- Backstage loads config from `app-config.yaml` at startup
- Uses `MergedConfigSource` to combine multiple config files
- Default setup: `app-config.yaml` + `app-config.local.yaml` + env vars

**Current Config Loading:**
```
Loading config from MergedConfigSource{
  FileConfigSource{path="app-config.yaml"},
  FileConfigSource{path="app-config.local.yaml"},
  EnvConfigSource{count=0}
}
```

**Key Question:** Can config be reloaded without restart?
- **Hypothesis:** Likely requires restart for most config changes
- **Alternative:** Dynamic config provider (needs research)

**Next Steps:**
- [ ] Test config file modification while backend running
- [ ] Check if Backstage provides config reload API
- [ ] Research dynamic config provider implementation

---

### Q4: Plugin Dependency Chains

**Status:** ✅ Partially Complete

**Installed Packages:** 2838 packages (~985 MB)

**ArgoCD Plugin Analysis:**
- Package: `@roadiehq/backstage-plugin-argo-cd-backend@4.4.2`
- Direct dependency of backend package
- Peer dependencies: (need to inspect package.json in node_modules)

**Dependency Warnings:**
```
⚠️  @testing-library/react version mismatch
⚠️  react/react-dom peer dependency warnings
⚠️  webpack not provided by workspaces
```

**Assessment:** Common Backstage peer dependency warnings, non-blocking

**Compatibility Matrix (Preliminary):**

| Plugin | Version | Backstage Core | Status |
|--------|---------|----------------|--------|
| ArgoCD | 4.4.2 | Compatible | ✅ Installed |
| Kubernetes | 0.20.3 | Compatible | ✅ Installed (default) |
| Catalog | 3.1.2 | Core | ✅ Installed (default) |

**Next Steps:**
- [ ] Extract full peer dependency list for ArgoCD plugin
- [ ] Test installing multiple plugins simultaneously
- [ ] Document version conflicts if any

---

## Blockers & Issues

### 1. Authentication Requirement
- **Impact:** Cannot test API endpoints
- **Workaround Options:**
  - Disable authentication for PoC
  - Configure guest authentication headers
  - Use Backstage frontend for testing

### 2. ArgoCD Plugin Configuration Missing
- **Impact:** Plugin fails to initialize
- **Expected:** We don't have an ArgoCD server
- **Resolution:** Document as expected, test with mock config

### 3. Kubernetes Plugin Configuration Missing
- **Impact:** Plugin warns about missing config
- **Expected:** We don't have a k8s cluster
- **Resolution:** Document as expected

---

## Initial Architectural Insights

### 1. Single-Tenant Design
Backstage appears to be **single-tenant by default**. This is the biggest finding so far.

**Evidence:**
- No workspace/tenant configuration in default setup
- Database schema doesn't show tenant isolation
- All plugins access shared catalog

**Implication:**
For multi-tenant Orbit, we likely need:
- **Option A:** Separate Backstage instance per workspace (isolated)
- **Option B:** Shared instance + middleware filtering (complex, risky)

### 2. Plugin Independence
Plugins are relatively independent and fail gracefully.

**Observed:**
- ArgoCD plugin failed due to missing config
- Other plugins continued initializing
- Backend remained operational

**Implication:**
- Can add/remove plugins without full system restart risk
- Plugin failures are contained
- Good for incremental rollout

### 3. Configuration Complexity
Backstage configuration is file-based and static.

**Challenge:**
- Admin UI changes in Payload CMS need to propagate to Backstage
- File-based config doesn't integrate easily with database-driven config
- Likely need dynamic config provider (as planned in feature doc)

---

## Recommendations

### Immediate Next Steps

1. **Resolve Authentication Block**
   - Disable auth for PoC, OR
   - Configure proper guest auth headers
   - **Priority:** HIGH (blocks Q2, Q3 API testing)

2. **Complete Q1 Research (Multi-Tenancy)**
   - Inspect actual database schema
   - Review Backstage docs on multi-tenancy
   - Make architectural decision: separate instances vs. shared
   - **Priority:** CRITICAL (architectural decision)

3. **Document Q2 (API Contracts)**
   - Test catalog API with proper auth
   - Test ArgoCD API (with mock config if needed)
   - Document request/response formats
   - **Priority:** HIGH

4. **Complete Q4 (Dependencies)**
   - Extract full dependency tree
   - Test adding Azure plugins
   - Document any conflicts
   - **Priority:** MEDIUM

### Should We Proceed to Phase 1?

**Current Confidence:** MEDIUM

**Green Flags:** ✅
- Backstage installed and running
- Plugin system works as expected
- Good error handling and logging

**Yellow Flags:** ⚠️
- Multi-tenancy approach unclear (needs decision)
- Authentication complexity
- Config sync mechanism needs validation

**Red Flags:** ❌
- None critical, but multi-tenancy is a significant design question

**Recommendation:**
Continue Phase 0 research for **1-2 more hours** to:
- Resolve authentication
- Validate multi-tenancy approach
- Document plugin API contracts

Then make GO/NO-GO decision for Phase 1.

---

## Time Estimate

- **Elapsed:** ~1 hour (setup + initial research)
- **Remaining:** 1-2 hours (complete all 4 research questions)
- **Total Phase 0:** 2-3 hours (as planned)

---

## Files Created

- `/poc/backstage-test/` - Official Backstage app
- `/poc/backstage-test/research.sh` - Automated research script
- `/poc/backstage-test/FINDINGS.md` - Research findings template
- `/poc/backstage-test/PHASE0-PROGRESS.md` - This document

---

## Next Session Plan

1. Fix authentication (15 min)
2. Complete Q1 database inspection (30 min)
3. Complete Q2 API contract documentation (30 min)
4. Complete Q3 config sync testing (15 min)
5. Finalize Q4 dependencies (15 min)
6. Document in FINDINGS.md (30 min)
7. Make Phase 1 decision (15 min)

**Total:** ~2.5 hours remaining
