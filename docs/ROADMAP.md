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
| Kafka Self-Service (Bifrost) | 🟢 90% | Virtual clusters, topics, schemas, ACLs, consumer groups, lineage, decommissioning, Go gateway |
| Workspace Management | 🟢 75% | Multi-tenant RBAC, membership workflows, workspace isolation |
| Temporal Workflows | 🟢 85% | Comprehensive workflow/activity coverage for Kafka operations |
| Knowledge Management | 🟢 85% | Spaces, hierarchical pages, tree sidebar with drag-drop, breadcrumbs, Lexical editor, MeiliSearch |
| Secret Management | 🟢 100% | AES-256-GCM encryption at rest for all sensitive fields |
| Repository & Templates | 🟡 55% | GitHub App integration, template instantiation — GitOps sync missing |
| Application Lifecycle | 🟡 50% | Lineage graph exists, deployment generators schema only |
| API Catalog | 🔴 15% | Service scaffold exists, minimal UI |
| Build Service | 🔴 10% | Dockerfile exists, Railpack integration incomplete |

---

## Roadmap Phases

### Phase 1: Production Readiness ✅ COMPLETE
**Status:** Done

#### 1.1 Secret Encryption ✅
- [x] AES-256-GCM encryption service (`orbit-www/src/lib/encryption/`)
- [x] EnvironmentVariables auto-encrypt via beforeChange hook
- [x] RegistryConfigs encrypt ghcrPat and acrToken
- [x] GitHubInstallations token encrypted at refresh time

#### 1.2 Authentication Completeness (DEPRIORITIZED)
- [ ] Email verification for signups
- [ ] Password reset flow
- [ ] Session management UI

*Moved to backlog per product decision.*

#### 1.3 Bifrost Docker Deployment ✅
- [x] Go rewrite complete (`services/bifrost/`)
- [x] Dockerfile with multi-stage build
- [x] docker-compose.yml integration with healthcheck
- [x] Admin gRPC, metrics, and proxy ports configured

---

### Phase 2: Core IDP Features (P1)
**Timeline:** 4-6 weeks
**Goal:** Complete the core IDP value proposition

#### 2.1 GitOps Manifest Sync (`.orbit.yaml`)
- [ ] Define manifest schema and validation
- [ ] Implement `orbit-primary` mode: UI changes auto-commit to repo
- [ ] Implement `manifest-primary` mode: GitHub webhook detects manifest changes
- [ ] Conflict resolution when DB and manifest diverge
- [ ] UI to toggle sync mode per application

**Current state:** `lastManifestSha` field exists in Apps.ts, no sync logic implemented.

**Effort:** 1-2 weeks

#### 2.2 API Catalog Integration
- [ ] Build OpenAPI/AsyncAPI import UI
- [ ] Auto-discover specs from registered repositories
- [ ] API version management and deprecation workflows
- [ ] API documentation rendering (Swagger UI / Redoc embed)
- [ ] Usage analytics integration

**Current state:** `services/api-catalog/` scaffold exists, `SchemaEditor.tsx` component exists, no CRUD UI.

**Effort:** 1-2 weeks

#### 2.3 Deployment Generators
- [ ] Docker Compose generator (implementation)
- [ ] Helm chart generator (implementation)
- [ ] Terraform generator (implementation)
- [ ] Secret injection at deploy time

**Current state:** `DeploymentGenerators` collection exists, UI references all types, but no actual generation code.

**Effort:** 1 week per generator

#### 2.4 Kafka UX Polish
- [ ] Wire "Retry Provisioning" button to existing `retryVirtualClusterProvisioning()` 
- [ ] Add error details modal for failed resources
- [ ] Workflow history link to Temporal UI

**Current state:** `retryVirtualClusterProvisioning()` server action exists, needs UI integration.

**Effort:** 2-3 days

---

### Phase 3: User Experience (P2)
**Timeline:** 2-4 weeks
**Goal:** Polish and usability improvements

#### 3.1 Knowledge Management UI ✅ COMPLETE
- [x] KnowledgeTreeSidebar with drag-drop (@dnd-kit)
- [x] KnowledgeBreadcrumbs component
- [x] Page creation, move, duplicate, delete modals
- [x] PageTreeNode with context menu
- [x] Full test coverage

#### 3.2 Integration Tests
- [ ] Implement 27 Kafka topic sharing integration tests
- [ ] Implement 5 topic visibility integration tests
- [ ] CI pipeline with test gates

**Current state:** 32 tests marked as `.todo` in `kafka-topic-catalog.integration.test.ts`

**Effort:** Ongoing (1-2 tests/day)

#### 3.3 Observability Dashboard
- [ ] Service health overview page
- [ ] Kafka cluster health dashboard
- [ ] Workflow execution monitoring
- [ ] Embed Grafana panels or build native metrics UI

**Current state:** Prometheus endpoints exist, no UI dashboard.

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

**Current state:** Workspace-level RBAC works, no fine-grained permissions.

#### 4.3 Cost Attribution & Chargeback
- [ ] Cost calculation engine
- [ ] Department/team billing views
- [ ] Budget alerts
- [ ] Usage reports UI

**Current state:** `KafkaChargebackRates`, `KafkaUsageMetrics` collections exist, no UI.

#### 4.4 Audit Logging
- [ ] Global audit log collection
- [ ] User activity tracking
- [ ] Resource change history
- [ ] Export/SIEM integration

**Current state:** Not implemented.

#### 4.5 Build Service (Railpack)
- [ ] Railpack analysis implementation
- [ ] Railpack build implementation
- [ ] Multi-package manager support
- [ ] Build caching

**Current state:** `services/build-service/` scaffold in docker-compose, integration incomplete.

---

### Backlog (Unprioritized)

#### Authentication Enhancements
- Email verification for signups
- Password reset flow
- Session management UI

#### Key Rotation
- Encryption key rotation support
- Re-encrypt existing secrets on rotation

#### Secret Access Audit
- Audit logging for secret access
- Access reports

---

## Technical Debt

### High Priority
| Item | Location | Notes |
|------|----------|-------|
| Go service persistence | `services/kafka/cmd/server/main.go` | All repos are in-memory stubs |
| GitHub token refresh | `GitHubInstallations` afterChange hook | Workflow not auto-started (TODO in code) |

### Medium Priority
| Item | Location | Notes |
|------|----------|-------|
| Offset recovery placeholder | `kafka-offset-recovery.ts:373` | Returns placeholder |
| Consumer offset checkpoint | `decommissioning_activities.go` | Not implemented |

---

## Success Metrics

### Phase 1 ✅
- [x] Zero plaintext secrets in database
- [x] Bifrost runs in Docker Compose

### Phase 2
- [ ] 3+ applications using `.orbit.yaml` sync
- [ ] 10+ API specs registered in catalog
- [ ] 1+ deployment generator producing working manifests

### Phase 3
- [x] Knowledge navigation with drag-drop reordering
- [ ] 80%+ integration test coverage on critical paths
- [ ] Failed resource retry success rate > 90%

---

## Changelog

| Date | Change |
|------|--------|
| 2026-01-29 | Audit against codebase: marked 1.1, 1.3, 3.1 complete; updated current state notes |
| 2026-01-29 | Initial roadmap created from codebase analysis |
