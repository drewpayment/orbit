# Technical Debt Optimization Plan — Design Document

**Date:** 2026-03-26
**Author:** Jon (Product Manager) with Gage (Principal Engineer)
**Status:** Design Complete — Ready for Implementation Planning
**Roadmap Phase:** 2.6 (between Feature Flags 2.5 and User Experience Phase 3)

---

## 1. Problem Statement

Orbit has accumulated significant technical debt across its polyglot codebase as features have been rapidly shipped through Phases 1-2. While feature velocity has been strong (3 major PRs merged in Phase 2), the debt now poses concrete risks:

- **Data loss risk:** 10 in-memory repository stubs in the Kafka service mean all cluster, topic, schema, share, and policy state is lost on any service restart.
- **Feature velocity drag:** 30+ stubbed gRPC handlers block frontend actions (25+ TODOs in `kafka-*.ts` actions) from connecting to real backend logic.
- **Type safety erosion:** 406 `as any` casts across the frontend, mostly from a single root cause (Payload CMS type generation gap), undermine TypeScript's value.
- **Confidence gap:** 32 integration tests marked `.todo` leave the Kafka topic sharing critical path (catalog → request → approve → ACL sync) untested.

This is not a one-time cleanup. This document designs an **ongoing, phase-aligned tech debt remediation initiative** that reduces debt incrementally as features ship.

---

## 2. Scope

### In Scope
- Kafka service persistence layer (in-memory → PostgreSQL)
- gRPC handler completion for the Kafka critical path
- Payload CMS type generation fix + `as any` bulk reduction
- Integration test infrastructure and coverage for Kafka flows
- Tech debt metrics automation (CI-based tracking)
- Roadmap integration as Phase 2.6

### Out of Scope
- Build Service (Railpack) — remains Phase 4.5
- SSO/OIDC — remains Phase 4.1
- Knowledge/API Catalog gRPC stubs — boy scout rule, not dedicated sprint
- Frontend bundle optimization — covered in Phase 2.5.2

---

## 3. Current State Audit

### Debt Inventory

| Category | Count | Severity | Root Cause |
|----------|-------|----------|------------|
| In-memory repository stubs | 10 | CRITICAL | Kafka service built as prototype, never migrated to real persistence |
| Stubbed gRPC handlers | ~30 | HIGH | Repository service handlers return placeholders; frontend can't wire to backend |
| `as any` type casts | 406 | MEDIUM | ~60-70% from Payload type gen missing Better Auth custom fields; ~30-40% scattered |
| ESLint suppressions | 46 | LOW | Mostly `@typescript-eslint/no-explicit-any` — symptom of the type gen gap |
| `.todo()` integration tests | 32 | MEDIUM | Test infrastructure for service dependencies not yet built |
| TODO/FIXME/HACK comments | 156+ | LOW | Accumulated across Go (92) and TypeScript (64); many mark stubs we're addressing |

### High-Risk File Clusters

| Cluster | Files | Debt Density | Impact |
|---------|-------|-------------|--------|
| `services/kafka/cmd/server/main.go` | 1 | 10 in-memory repos | All Kafka state volatile |
| `services/repository/internal/grpc/` | 5+ | 30+ stubbed handlers | Backend unreachable from frontend |
| `orbit-www/src/app/actions/kafka-*.ts` | 6+ | 25+ TODOs | User-facing actions non-functional without gRPC |
| `orbit-www/src/collections/` | 10+ | 69 `as any` casts | Type system blind to auth fields |

---

## 4. Prioritization Framework

### Tiered Approach

Debt is ranked by **blast radius if left unfixed** x **cost growth over time**:

| Tier | Category | Rationale |
|------|----------|-----------|
| **Tier 1 — CRITICAL** | In-memory persistence stubs | Data loss on restart. Every feature built on these compounds the problem. Not debt — a production gap. |
| **Tier 2 — HIGH** | gRPC critical path handlers | Blocks frontend ↔ backend integration. Every workaround creates more debt. |
| **Tier 2 — HIGH** | Integration test gap | Zero coverage on Kafka sharing critical path. Cost of delay is exponential — regressions slip through. |
| **Tier 3 — MEDIUM** | `as any` type casts | Single root cause fixes ~60-70%. Runtime behavior is correct; type checker is blind. |
| **Tier 4 — LOW** | ESLint suppressions, TODO comments | Symptoms that resolve as Tiers 1-3 are addressed. |

---

## 5. Architecture Decisions

### 5.1 Persistence Layer: PostgreSQL with `pgx`

**Decision:** Kafka service persistence moves to PostgreSQL, not MongoDB.

| Factor | MongoDB | PostgreSQL | Verdict |
|--------|---------|------------|---------|
| Data model fit | Kafka entities are highly relational (topics → schemas, shares → topics, policies → workspaces) | Strong relational model with JSONB for flexible fields | **PostgreSQL** |
| Transactional needs | Topic creation + policy eval + approval = needs ACID | Native ACID | **PostgreSQL** |
| Existing infra | Payload CMS uses it | Temporal already uses it (port 5433 in docker-compose) | **PostgreSQL** (operational consistency) |
| Go ecosystem | mongo-driver (verbose) | pgx (excellent, well-maintained) | **PostgreSQL** |
| Migration tooling | Schema-less | golang-migrate (explicit, auditable) | **PostgreSQL** |

**Source of truth:** The Go Kafka service owns the data. Payload collections become views/caches that read via gRPC. This eliminates dual-write risk.

**Implementation shape:**
- `services/kafka/internal/repository/postgres/` — one file per repo interface
- `services/kafka/migrations/` — schema migrations via golang-migrate
- Connection pooling via pgx's built-in pool
- Clean architecture already in place — swap implementation, keep interfaces

### 5.2 Type System: Fix Root Cause, Then Gradual Cleanup

**Decision:** Fix Payload type generation first (option A), then gradual replacement (option C).

**Phase 1 — Root cause (~60-70% of casts):**
1. Ensure Payload collection schemas properly declare `betterAuthId`, `role`, and other Better Auth custom fields
2. Regenerate types with `payload generate:types`
3. Bulk-replace `(req.user as any).betterAuthId` patterns with properly typed access

**Phase 2 — Gradual cleanup (~30-40% of casts):**
- Replace remaining `as any` casts as files are touched for feature work
- No wrapper utilities — they hide the problem and break silently if Payload types change

### 5.3 gRPC Completion: Hybrid Sprint + Boy Scout

**Decision:** Dedicated sprint for Kafka critical path; boy scout rule for everything else.

**Sprint scope (2-3 weeks):**
1. Kafka management handlers — the ones that frontend `kafka-*.ts` actions actually call (unblocks 25+ frontend TODOs)
2. Temporal workflow handlers in `temporal_server.go` — needed for approval and provisioning flows

**Boy scout scope (ongoing):**
- Knowledge handlers, API Catalog handlers, future-facing stubs
- Implement as features demand them

### 5.4 Integration Test Infrastructure

**Decision:** Docker Compose-based test harness, built incrementally alongside persistence work.

**Components:**
1. `docker-compose.test.yml` override — ephemeral databases, test-specific config, seed data service
2. Go: `testutil` package with DB setup/teardown; `testcontainers-go` for CI
3. Frontend: Payload test client + gRPC mocks (real services once available)
4. CI: GitHub Actions workflow for docker-compose.test.yml lifecycle

**MVP:** Go-side integration tests for Kafka persistence layer first (validates Tier 1 debt fix).

---

## 6. Implementation Waves

### Wave 1: Persistence (Week 1-2)
**Goal:** Eliminate data loss risk

| Task | Files | Verification |
|------|-------|-------------|
| Design PostgreSQL schema for all 10 repository entities | `services/kafka/migrations/` | Schema review |
| Implement `postgres/` repository package (10 repos) | `services/kafka/internal/repository/postgres/` | Unit tests per repo |
| Wire PostgreSQL repos into Kafka service startup | `services/kafka/cmd/server/main.go` | Service starts, data persists across restarts |
| Add PostgreSQL to docker-compose for Kafka service | `docker-compose.yml` | `make docker-up` includes Kafka DB |
| Integration tests for persistence layer | `services/kafka/tests/` | `go test -tags=integration ./...` passes |

### Wave 2: gRPC Critical Path (Week 2-3)
**Goal:** Unblock frontend ↔ backend integration

| Task | Files | Verification |
|------|-------|-------------|
| Implement Kafka management gRPC handlers | `services/repository/internal/grpc/` | Handler returns real data, not placeholders |
| Implement Temporal workflow gRPC handlers | `services/repository/internal/grpc/temporal_server.go` | Approval/provisioning workflows trigger |
| Wire frontend actions to real gRPC endpoints | `orbit-www/src/app/actions/kafka-*.ts` | Frontend TODOs resolved, actions functional |
| Contract tests for implemented handlers | `services/repository/tests/` | gRPC contract tests pass |

### Wave 3: Type Safety (Week 3-4)
**Goal:** Restore TypeScript type system integrity

| Task | Files | Verification |
|------|-------|-------------|
| Add Better Auth fields to Payload collection schemas | `orbit-www/src/collections/` | Fields declared in schema |
| Regenerate `payload-types.ts` | `orbit-www/src/payload-types.ts` | Types include `betterAuthId`, `role` |
| Bulk-replace `(req.user as any).field` patterns | `orbit-www/src/` (multiple) | `as any` count drops from 406 to <150 |
| Remove corresponding ESLint suppressions | `orbit-www/src/` (multiple) | ESLint suppression count drops |

### Wave 4: Test Coverage (Week 3-4, parallel with Wave 3)
**Goal:** Build confidence in critical paths

| Task | Files | Verification |
|------|-------|-------------|
| Build `docker-compose.test.yml` | `docker-compose.test.yml` | Test infra spins up with `docker compose -f ... up` |
| Create Go `testutil` package | `services/kafka/internal/testutil/` | DB helpers available |
| Implement 32 `.todo` integration tests | `orbit-www/src/app/actions/kafka-topic-catalog.integration.test.ts` | All 32 tests pass (not `.todo`) |
| CI pipeline for integration tests | `.github/workflows/` | Integration tests run on PR |

### Wave 5: Ongoing — Boy Scout Rule
**Goal:** Continuous debt reduction as features ship

- Implement gRPC stubs as features demand them
- Replace `as any` casts in files touched for feature work
- Resolve TODO comments when the surrounding code is modified
- Track metrics weekly via automated CI dashboard

---

## 7. Success Metrics

### Leading Indicators (measure weekly)

| Metric | Baseline (2026-03-26) | Wave 1-2 Target | Wave 3-4 Target | Steady State |
|--------|----------------------|-----------------|-----------------|-------------|
| In-memory stubs | 10 | 0 | 0 | 0 |
| `as any` casts | 406 | 406 | <150 | <50 |
| `.todo()` tests | 32 | 32 | 0 | 0 |
| Stubbed gRPC handlers | ~30 | <15 | <10 | Boy scout |
| TODO/FIXME/HACK | 156+ | ~130 | <80 | <50 |

### Lagging Indicators

| Metric | How to Measure |
|--------|----------------|
| Go test coverage | `go test -coverprofile` (target: 80%+) |
| Frontend test coverage | Vitest coverage report (target: 70%+) |
| Data loss incidents | Should drop to 0 after Wave 1 |
| Feature implementation time | Track velocity — should improve after Wave 2 |

### Automation

Add a CI step (GitHub Actions) that:
1. Runs leading indicator counts on every PR
2. Posts a comment with current counts vs. baseline
3. Fails the build if any metric regresses beyond a threshold (e.g., `as any` count increases by >5)

---

## 8. Roadmap Integration

This initiative integrates as **Phase 2.6** in the Orbit roadmap:

```
Phase 2: Core IDP Features (P1) ............... ~75% complete
Phase 2.5: Infrastructure Enablers ............ IN PROGRESS (feature flags)
Phase 2.6: Technical Debt Optimization ........ THIS DOCUMENT
Phase 3: User Experience (P2) ................. Unblocked by 2.6
Phase 4: Enterprise Features (P3) ............. Unblocked by 2.6
```

**Key dependencies:**
- Wave 1 (persistence) unblocks Phase 3 observability dashboard (real data to observe)
- Wave 2 (gRPC handlers) unblocks Phase 3 integration tests and Phase 4 features
- Wave 3 (type safety) reduces friction for all future frontend work
- Wave 4 (test coverage) provides safety net for Phase 3+ feature delivery

---

## 9. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| PostgreSQL migration breaks existing Kafka workflows | Medium | High | Build behind feature flag (Phase 2.5); dual-run in-memory + PG during validation |
| Payload type regeneration introduces new type errors | Medium | Medium | Run `tsc --noEmit` before and after; fix new errors before merging |
| gRPC handler implementation reveals missing domain logic | High | Medium | Expected — scope Wave 2 to handlers with clear existing domain logic; defer unclear ones to boy scout |
| Test infrastructure setup takes longer than expected | Medium | Low | MVP with `testcontainers-go` first; docker-compose.test.yml can follow |

---

## 10. Open Questions for Implementation Planning

1. **PostgreSQL instance:** Dedicated instance for Kafka service, or share Temporal's PostgreSQL with a separate database?
2. **Migration tooling:** `golang-migrate` is recommended, but should we evaluate `goose` or `atlas` as well?
3. **Feature flag gating:** Should the persistence migration be gated behind a Flipt feature flag (leveraging Phase 2.5 work)?
4. **Payload source-of-truth transition:** Timeline for deprecating Payload's direct MongoDB writes for Kafka entities in favor of gRPC reads from the Go service?
5. **CI budget:** Integration tests with Docker will increase CI time. Acceptable threshold?

---

## Appendix A: Debt Measurement Commands

```bash
# In-memory stubs
grep -r "inMemory.*Repository" services/kafka/ | grep -v _test.go | wc -l

# as any casts
grep -r "as any" orbit-www/src/ --include="*.ts" --include="*.tsx" | wc -l

# TODO/FIXME/HACK
grep -rE "TODO|FIXME|HACK" services/ orbit-www/src/ --include="*.go" --include="*.ts" --include="*.tsx" | wc -l

# .todo() tests
grep -r "\.todo(" orbit-www/src/ --include="*.ts" | wc -l

# ESLint suppressions
grep -r "eslint-disable" orbit-www/src/ --include="*.ts" --include="*.tsx" | wc -l

# Stubbed gRPC handlers (return unimplemented or placeholder)
grep -rn "status.Errorf(codes.Unimplemented" services/ --include="*.go" | wc -l
```
