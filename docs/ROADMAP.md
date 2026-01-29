# Orbit Product Roadmap

**Last Updated:** 2026-01-29
**Status:** Active

---

## Vision

Orbit is an Internal Developer Portal (IDP) that gives platform teams self-service infrastructure while maintaining governance. The goal is to be the single pane of glass for services, APIs, Kafka topics, and documentation across an organization.

---

## Current State Assessment

### Feature Maturity Matrix

| Feature | Maturity | Status |
|---------|----------|--------|
| Kafka Self-Service (Bifrost) | 🟢 85% | Virtual clusters, topics, schemas, ACLs, consumer groups, lineage, decommissioning |
| Workspace Management | 🟢 75% | Multi-tenant RBAC, membership workflows, workspace isolation |
| Temporal Workflows | 🟢 80% | Comprehensive workflow/activity coverage for Kafka operations |
| Knowledge Management | 🟡 60% | Spaces, hierarchical pages, Lexical editor, MeiliSearch — UI navigation incomplete |
| Repository & Templates | 🟡 55% | GitHub App integration, template instantiation — GitOps sync missing |
| Application Lifecycle | 🟡 50% | Lineage graph exists, deployment generators not implemented |
| API Catalog | 🔴 20% | Service exists, proto defined, integration/UI minimal |
| Build Service | 🔴 10% | Railpack design exists, no implementation |

---

## Roadmap Phases

### Phase 1: Production Readiness (P0)
**Timeline:** 2-3 weeks
**Goal:** Make Orbit safe for production deployment

#### 1.1 Secret Encryption
- [ ] Implement encryption service for secret values at rest
- [ ] Add key rotation support
- [ ] Audit logging for secret access
- [ ] Migrate existing plaintext secrets

**Files to modify:**
- `orbit-www/src/collections/EnvironmentVariables.ts`
- `temporal-workflows/internal/clients/` (new encryption client)

**Effort:** 2-3 days

#### 1.2 Authentication Completeness
- [ ] Email verification for signups
- [ ] Password reset flow
- [ ] Session management UI
- [ ] Proper admin role verification (`orbit-www/src/access/isAdmin.ts`)

**Effort:** 3-5 days

#### 1.3 Bifrost Docker Deployment
- [ ] Fix Kotlin gateway compilation errors (proto imports, type mismatches)
- [ ] OR: Accelerate Go rewrite to replace Kotlin gateway
- [ ] Verify both bifrost + bifrost-callback run in Docker
- [ ] End-to-end smoke test

**Current blocker:** `docs/current_plan.md` — compilation errors in Kotlin gateway

**Effort:** 2-3 days

---

### Phase 2: Core IDP Features (P1)
**Timeline:** 4-6 weeks
**Goal:** Complete the core IDP value proposition

#### 2.1 GitOps Manifest Sync (`.orbit.yaml`)
- [ ] Define manifest schema and validation
- [ ] Implement `orbit-primary` mode: UI changes auto-commit to repo
- [ ] Implement `manifest-primary` mode: GitHub webhook detects manifest changes
- [ ] Conflict resolution when DB and manifest diverge
- [ ] Manifest validation against schema
- [ ] UI to toggle sync mode per application

**Files to modify:**
- `orbit-www/src/collections/Apps.ts` (schema exists)
- New: `services/manifest-sync/` or Temporal workflow

**Effort:** 1-2 weeks

#### 2.2 API Catalog Integration
- [ ] Build OpenAPI/AsyncAPI import UI
- [ ] Auto-discover specs from registered repositories
- [ ] API version management and deprecation workflows
- [ ] API documentation rendering (Swagger UI / Redoc embed)
- [ ] Usage analytics integration
- [ ] Contract validation (consumer-driven contracts)

**Existing foundation:** `services/api-catalog/`, proto definitions exist

**Effort:** 1-2 weeks

#### 2.3 Deployment Generators
- [ ] Docker Compose generator (start here — lowest complexity)
- [ ] Helm chart generator
- [ ] Terraform generator
- [ ] Secret injection at deploy time
- [ ] Custom generator plugin support

**Design docs:** `docs/archive/2025-12-01-deployment-generators-*.md`

**Effort:** 1 week per generator

#### 2.4 Kafka UX Polish
- [ ] "Retry Provisioning" action for failed topics
- [ ] Error details modal for failed resources
- [ ] Workflow history link to Temporal UI
- [ ] Virtual cluster-aware topic creation on main topics page
- [ ] Deprecate legacy `CreateTopicDialog`

**Effort:** 3-5 days

---

### Phase 3: User Experience (P2)
**Timeline:** 2-4 weeks
**Goal:** Polish and usability improvements

#### 3.1 Knowledge Management UI
- [ ] KnowledgeTreeSidebar component
- [ ] KnowledgeBreadcrumbs component
- [ ] Drag-and-drop page reordering
- [ ] Search within knowledge space
- [ ] Page templates

**Design:** `docs/plans/2025-11-23-knowledge-space-navigation-implementation.md`

**Effort:** 3-5 days

#### 3.2 Integration Tests
- [ ] Implement 27 Kafka integration tests (currently `it.todo`)
- [ ] Bifrost end-to-end lineage test
- [ ] API Catalog integration tests
- [ ] CI pipeline with test gates

**Location:** `orbit-www/src/app/actions/kafka-topic-catalog.integration.test.ts`

**Effort:** Ongoing (1-2 tests/day)

#### 3.3 Observability Dashboard
- [ ] Embed Grafana panels or build native metrics UI
- [ ] Service health overview page
- [ ] Kafka cluster health dashboard
- [ ] Workflow execution monitoring

**Effort:** 1 week

---

### Phase 4: Enterprise Features (P3)
**Timeline:** 6-12 weeks
**Goal:** Enterprise readiness

#### 4.1 SSO/OIDC Integration
- [ ] SAML support
- [ ] OIDC provider configuration
- [ ] Group/team sync from IdP
- [ ] Just-in-time provisioning

#### 4.2 Advanced RBAC
- [ ] Fine-grained permissions (API spec edit, PR approval, etc.)
- [ ] Permission inheritance
- [ ] Custom role definitions
- [ ] Permission audit UI

#### 4.3 Cost Attribution & Chargeback
- [ ] Cost calculation engine
- [ ] Department/team billing views
- [ ] Budget alerts
- [ ] Usage reports

**Foundation exists:** `KafkaChargebackRates`, `KafkaUsageMetrics` collections

#### 4.4 Audit Logging
- [ ] Global audit log collection
- [ ] User activity tracking
- [ ] Resource change history
- [ ] Export/SIEM integration

#### 4.5 Build Service (Railpack)
- [ ] Railpack analysis implementation
- [ ] Railpack build implementation
- [ ] Multi-package manager support
- [ ] Build caching

**Design:** `docs/plans/2025-12-04-railpack-build-service.md`

---

## Technical Debt

### High Priority
| Item | Location | Notes |
|------|----------|-------|
| Go service persistence | `services/kafka/cmd/server/main.go` | All repos are in-memory stubs |
| GitHub token refresh | `orbit-www/src/collections/GitHubInstallations.ts:253` | Workflow not auto-started |
| Template usage tracking | `temporal-workflows/internal/activities/template_activities.go:385-387` | Placeholder implementation |

### Medium Priority
| Item | Location | Notes |
|------|----------|-------|
| Offset recovery | `kafka-offset-recovery.ts:373` | Returns placeholder |
| Consumer offset checkpoint | `decommissioning_activities.go` | Not implemented |
| Notification service | `decommissioning_activities.go` | Workspace admin notifications |

---

## Dependencies & Blockers

### Current Blockers
1. **Bifrost Kotlin compilation** — Blocks Docker deployment
   - Proto import mismatches (`idp.gateway.v1` vs `io.orbit.bifrost.proto`)
   - Type mismatches (Short vs Int) in Kafka API key comparisons
   - Typo in `CreateableTopicConfig` class name

### External Dependencies
- **MeiliSearch** — Knowledge search
- **Temporal** — Workflow orchestration
- **Redpanda/Kafka** — Bifrost target clusters
- **MongoDB** — Payload CMS storage
- **PostgreSQL** — Go services (production)
- **MinIO/S3** — Object storage

---

## Success Metrics

### Phase 1 (Production Readiness)
- [ ] Zero plaintext secrets in database
- [ ] User can sign up → verify email → reset password
- [ ] Bifrost runs in Docker Compose without manual fixes

### Phase 2 (Core IDP)
- [ ] 3+ applications using `.orbit.yaml` sync
- [ ] 10+ API specs registered in catalog
- [ ] 1+ deployment generator producing working manifests

### Phase 3 (UX)
- [ ] Knowledge navigation < 3 clicks to any page
- [ ] 80%+ integration test coverage on critical paths
- [ ] Failed resource retry success rate > 90%

---

## Open Questions

1. **Target audience**: Internal org tool vs. open-source/commercial product?
2. **Bifrost strategy**: Fix Kotlin or accelerate Go rewrite?
3. **GitOps priority**: Is manifest sync truly core, or can it wait?
4. **Build service**: Is Railpack needed, or speculative?

---

## Changelog

| Date | Change |
|------|--------|
| 2026-01-29 | Initial roadmap created from codebase analysis |
