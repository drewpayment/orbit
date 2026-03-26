# Technical Debt Optimization — QA Plan

**Date:** 2026-03-26
**Author:** Bill (QA Expert)
**Based on:** [Design Document](./2026-03-26-tech-debt-optimization-design.md), [Implementation Plan](./2026-03-26-tech-debt-optimization-implementation.md)
**Branch:** `feat/tech-debt-optimization`

---

## 1. QA Strategy Overview

This QA plan provides verification coverage for all four waves of the tech debt optimization initiative. The strategy is:

1. **Shift-left metrics tracking** — start measuring debt indicators in Wave 1, not after the fact
2. **Layered testing** — unit tests per repository, integration tests per wave, one E2E smoke test for the critical path
3. **Isolation by design** — tests must not share mutable state; each test owns its namespace
4. **Contract-driven gRPC validation** — proto files are the source of truth for both Go and TypeScript
5. **Regression gates in CI** — automated checks that prevent debt from creeping back

---

## 2. QA Concerns and Mitigations

### Concern 1: Data Migration Risk (Wave 1) — HIGH

**Issue:** The persistence swap from in-memory to PostgreSQL has no data migration path. Any state in the running dev environment will be silently lost.

**Mitigation:**
- Document explicitly in the Wave 1 PR description that this is a **clean-slate migration** — acceptable because in-memory repos were volatile by design (data was already lost on every restart).
- Add a startup log line in the Kafka service: `"INFO: Using PostgreSQL persistence — in-memory stubs removed"` so it's obvious to developers.
- If any dev has seeded meaningful test data, provide a one-time JSON export script before merging Wave 1.

**Verification:** Confirm that the PR description and CHANGELOG (if applicable) explicitly state the clean-slate nature of the migration.

---

### Concern 2: Missing Rollback Testing (Wave 1) — HIGH

**Issue:** The implementation plan defines down migrations but never verifies them. A broken down migration blocks hotfix rollbacks.

**Mitigation:**
- Add a CI step that runs the full migration round-trip: `up` → seed sample data → `down` → `up` again.
- The second `up` must succeed cleanly with no leftover state.

**Verification checkpoint:**
```bash
# Run against a clean test database
golang-migrate -path ./migrations -database $TEST_DATABASE_URL up
# Seed minimal data (1 cluster, 1 topic, 1 schema)
psql $TEST_DATABASE_URL -f testdata/seed.sql
# Roll back
golang-migrate -path ./migrations -database $TEST_DATABASE_URL down
# Re-apply
golang-migrate -path ./migrations -database $TEST_DATABASE_URL up
# Verify tables exist and are empty
psql $TEST_DATABASE_URL -c "\dt kafka_*"
```

---

### Concern 3: Connection Pool Exhaustion Under Test (Wave 1) — MEDIUM

**Issue:** Each test function creating its own `pgxpool.Pool` can exhaust PostgreSQL's `max_connections` (default 100), causing flaky test failures.

**Mitigation:**
- The `testutil_test.go` helper should create **one shared pool per test suite** with an explicit max pool size (e.g., 5 connections).
- Individual tests should use **per-test transactions that roll back** instead of creating/destroying databases.
- Pattern:
  ```go
  func setupTestTx(t *testing.T, pool *pgxpool.Pool) pgx.Tx {
      tx, err := pool.Begin(context.Background())
      require.NoError(t, err)
      t.Cleanup(func() { tx.Rollback(context.Background()) })
      return tx
  }
  ```

**Verification:** Run the full integration test suite 3 times consecutively. All 3 runs must pass with zero connection errors.

---

### Concern 4: gRPC Contract Test Gap (Wave 2) — HIGH

**Issue:** The implementation plan mentions "contract tests for implemented handlers" but does not define the contract format or how both Go and TypeScript clients are validated.

**Mitigation:**
- Use the existing `.proto` files as the single source of truth.
- **Go side:** Test that each implemented handler accepts valid proto requests and returns valid proto responses matching the schema.
- **TypeScript side:** Generate TypeScript types from the same `.proto` files (via `buf` or `grpc-tools`) and verify the frontend gRPC client matches.
- Add a CI step: `buf breaking --against .git#branch=main` to catch proto-breaking changes.

**Verification checkpoint:**
```bash
# Go contract tests
cd services/repository && go test -run TestGRPC ./internal/grpc/...

# Proto breaking change detection
buf breaking --against '.git#branch=main'

# TypeScript client type check
cd orbit-www && npx tsc --noEmit
```

---

### Concern 5: TypeScript Baseline Before Type Regeneration (Wave 3) — MEDIUM

**Issue:** The design doc identifies "Payload type regeneration introduces new type errors" as a risk, but the implementation plan has no checkpoint to measure the before/after impact.

**Mitigation:**
- Before regenerating types, capture the baseline:
  ```bash
  cd orbit-www && npx tsc --noEmit 2>&1 | tail -1  # e.g., "Found 42 errors"
  ```
- After regenerating and applying bulk replacements, run the same command.
- The error count must be **equal or lower**. If higher, investigate and fix before merging.

**Verification checkpoint:**
| Step | Command | Acceptance Criteria |
|------|---------|-------------------|
| Baseline | `tsc --noEmit 2>&1 \| grep "Found .* error" \|\| echo "0 errors"` | Record number |
| Regenerate types | `bun run payload generate:types` | Completes without crash |
| Bulk replace | Apply `as any` replacements | — |
| Post-check | `tsc --noEmit 2>&1 \| grep "Found .* error" \|\| echo "0 errors"` | Count <= baseline |

---

### Concern 6: Test Isolation for Integration Tests (Wave 4) — MEDIUM

**Issue:** 32 integration tests sharing the same database and topic state will produce ordering-dependent failures (flaky tests).

**Mitigation:**
- Each test must create its own `workspace_id` (random UUID) and use it for all entities.
- Topic names should include the test name or a random suffix: `test-topic-${testId}`.
- Tests must not rely on global state or assume the database is empty.
- For the Go integration tests: use the per-test transaction rollback pattern from Concern 3.
- For the TypeScript integration tests: use `beforeEach` to create a fresh workspace context via the API.

**Verification:** Run the full test suite with `--randomize` (or equivalent) to detect ordering dependencies. Must pass 5 consecutive randomized runs.

---

### Concern 7: No E2E Smoke Test for the Critical Path (Wave 4) — HIGH

**Issue:** Individual wave tests validate components in isolation, but the design doc calls out the **catalog -> request -> approve -> ACL sync** flow as the critical path. No test exercises this end-to-end.

**Mitigation:**
- Add a single E2E smoke test in Wave 4 that exercises the full flow:
  1. Create a Kafka topic in workspace A
  2. From workspace B, request a share on that topic
  3. Approve the share request from workspace A
  4. Verify ACL is synced (service account has read access)
- This test runs against the full docker-compose stack (not mocks).
- It should be a separate CI job that runs after all unit/integration tests pass.

**Test outline:**
```
E2E: Kafka Topic Sharing Critical Path
  1. POST /api/kafka/topics (workspace A) → 201, topic created
  2. POST /api/kafka/shares (workspace B, requesting read on topic) → 201, share pending
  3. PATCH /api/kafka/shares/:id/approve (workspace A owner) → 200, share approved
  4. GET /api/kafka/shares/:id → status = "active"
  5. Verify: service account for workspace B has read ACL on the topic
```

**Verification:** This test must pass on every PR merge to `feat/tech-debt-optimization` and before the branch merges to `main`.

---

### Concern 8: Debt Metrics Automation Timing — MEDIUM

**Issue:** The design doc plans CI-based debt metrics tracking, but the implementation plan defers it to Wave 4. Without early measurement, there's no objective way to confirm Waves 1-3 are reducing debt.

**Mitigation:**
- Implement the metrics CI job in **Wave 1** using the commands already defined in the design doc's Appendix A.
- The job runs on every PR and posts a comment with current counts vs. baseline.
- Regression threshold: fail if any metric increases by more than 5 from baseline.

**GitHub Actions step (add to existing CI workflow):**
```yaml
- name: Tech Debt Metrics
  run: |
    echo "## Tech Debt Metrics" >> $GITHUB_STEP_SUMMARY
    echo "| Metric | Count |" >> $GITHUB_STEP_SUMMARY
    echo "|--------|-------|" >> $GITHUB_STEP_SUMMARY

    INMEM=$(grep -r "inMemory.*Repository" services/kafka/ --include="*.go" | grep -v _test.go | wc -l | tr -d ' ')
    echo "| In-memory stubs | $INMEM |" >> $GITHUB_STEP_SUMMARY

    ASANY=$(grep -r "as any" orbit-www/src/ --include="*.ts" --include="*.tsx" | wc -l | tr -d ' ')
    echo "| as any casts | $ASANY |" >> $GITHUB_STEP_SUMMARY

    TODO_TESTS=$(grep -r "\.todo(" orbit-www/src/ --include="*.ts" | wc -l | tr -d ' ')
    echo "| .todo() tests | $TODO_TESTS |" >> $GITHUB_STEP_SUMMARY

    STUBS=$(grep -rn "status.Errorf(codes.Unimplemented" services/ --include="*.go" | wc -l | tr -d ' ')
    echo "| Stubbed gRPC handlers | $STUBS |" >> $GITHUB_STEP_SUMMARY

    TODOS=$(grep -rE "TODO|FIXME|HACK" services/ orbit-www/src/ --include="*.go" --include="*.ts" --include="*.tsx" | wc -l | tr -d ' ')
    echo "| TODO/FIXME/HACK | $TODOS |" >> $GITHUB_STEP_SUMMARY
```

**Baseline (2026-03-26):**
| Metric | Baseline |
|--------|----------|
| In-memory stubs | 10 |
| `as any` casts | 406 |
| `.todo()` tests | 32 |
| Stubbed gRPC handlers | ~30 |
| TODO/FIXME/HACK | 156+ |

---

## 3. Test Matrix

| Wave | Test Type | Scope | Coverage Target | Runner |
|------|-----------|-------|-----------------|--------|
| 1 | Unit tests | Repository CRUD (10 repos) | 90%+ per repo | `go test ./internal/repository/postgres/...` |
| 1 | Integration test | Migration round-trip (up/down/up) | Clean round-trip | `golang-migrate` CLI in CI |
| 1 | Integration test | Data persistence across restart | Create → restart → query survives | Docker Compose + test script |
| 1 | CI job | Debt metrics baseline | All 5 metrics tracked | GitHub Actions |
| 2 | Contract tests | gRPC handler proto compliance | All implemented handlers | `go test -run TestGRPC ./...` |
| 2 | Integration tests | Frontend action → gRPC endpoint | Happy path + error cases per action | `bun test` with gRPC test server |
| 2 | CI job | Proto breaking change detection | No breaking changes | `buf breaking` |
| 3 | Regression test | TypeScript type safety | `tsc --noEmit` error count <= baseline | `npx tsc --noEmit` |
| 3 | Smoke test | Payload type gen + bulk replace | Build succeeds, no new type errors | `bun run build` |
| 4 | Integration tests | 32 `.todo` Kafka tests | 100% pass rate (0 `.todo` remaining) | `bun test` |
| 4 | E2E smoke test | Critical path (create → share → approve → ACL) | Full flow passes | Docker Compose + test script |
| 4 | Stability test | Randomized test ordering | 5 consecutive randomized runs pass | `bun test --randomize` / `go test -shuffle=on` |

---

## 4. Verification Checkpoints Per Wave

### Wave 1 Checkpoints

| # | Check | Command | Pass Criteria |
|---|-------|---------|---------------|
| 1.1 | Migrations apply cleanly | `golang-migrate -path ./migrations -database $DATABASE_URL up` | Exit 0, all tables created |
| 1.2 | Migration round-trip | up → seed → down → up | No errors, tables exist and empty |
| 1.3 | Go builds | `cd services/kafka && go build ./...` | Exit 0 |
| 1.4 | Unit tests pass | `cd services/kafka && go test ./internal/repository/postgres/...` | All pass, 90%+ coverage |
| 1.5 | Integration tests pass | `cd services/kafka && go test -tags=integration ./...` | All pass |
| 1.6 | Service starts with PG | `docker compose up kafka-service` | Connects to PG, logs migration success |
| 1.7 | Data persists across restart | Create entity → restart → query | Entity survives |
| 1.8 | In-memory stub count = 0 | `grep -r "inMemory.*Repository" services/kafka/ \| grep -v _test.go \| wc -l` | 0 |
| 1.9 | Debt metrics CI job runs | Push PR, check Actions | Metrics comment posted |

### Wave 2 Checkpoints

| # | Check | Command | Pass Criteria |
|---|-------|---------|---------------|
| 2.1 | gRPC handlers return real data | Contract tests per handler | All pass |
| 2.2 | Proto compatibility | `buf breaking --against '.git#branch=main'` | No breaking changes |
| 2.3 | Frontend actions connect | `bun test` for `kafka-*.ts` action tests | All pass |
| 2.4 | Stubbed handler count reduced | `grep -rn "status.Errorf(codes.Unimplemented" services/ \| wc -l` | < 15 |
| 2.5 | Frontend TODO count reduced | `grep -r "TODO" orbit-www/src/app/actions/kafka-*.ts \| wc -l` | < 10 |

### Wave 3 Checkpoints

| # | Check | Command | Pass Criteria |
|---|-------|---------|---------------|
| 3.1 | Type gen succeeds | `bun run payload generate:types` | Exit 0 |
| 3.2 | Type error count <= baseline | `npx tsc --noEmit 2>&1 \| grep "Found"` | Count <= pre-Wave-3 baseline |
| 3.3 | `as any` count reduced | `grep -r "as any" orbit-www/src/ --include="*.ts" --include="*.tsx" \| wc -l` | < 150 |
| 3.4 | ESLint suppressions reduced | `grep -r "eslint-disable" orbit-www/src/ \| wc -l` | Measurable reduction |
| 3.5 | Build passes | `cd orbit-www && bun run build` | Exit 0 |

### Wave 4 Checkpoints

| # | Check | Command | Pass Criteria |
|---|-------|---------|---------------|
| 4.1 | All `.todo` tests implemented | `grep -r "\.todo(" orbit-www/src/ --include="*.ts" \| wc -l` | 0 |
| 4.2 | Integration tests pass | `bun test --filter integration` | 32/32 pass |
| 4.3 | E2E smoke test passes | `./scripts/e2e-kafka-sharing.sh` | Full critical path succeeds |
| 4.4 | Randomized ordering stable | Run test suite 5x with `--randomize` | 5/5 pass |
| 4.5 | CI integration test pipeline | Push PR, check Actions | Integration tests run and pass |

---

## 5. CI Integration Summary

The following CI jobs should be added incrementally:

| Wave | Job Name | Trigger | Timeout |
|------|----------|---------|---------|
| 1 | `tech-debt-metrics` | Every PR | 1 min |
| 1 | `kafka-postgres-tests` | PR touching `services/kafka/` | 3 min |
| 1 | `migration-roundtrip` | PR touching `services/kafka/migrations/` | 2 min |
| 2 | `grpc-contract-tests` | PR touching `services/repository/` | 3 min |
| 2 | `buf-breaking` | PR touching `*.proto` | 1 min |
| 3 | `type-safety-check` | PR touching `orbit-www/src/` | 2 min |
| 4 | `integration-tests` | PR to `main` | 5 min (max budget per implementation plan) |
| 4 | `e2e-kafka-sharing` | PR to `main` | 5 min |

---

## 6. Risk Register (QA-Specific)

| Risk | Likelihood | Impact | Mitigation | Owner |
|------|-----------|--------|------------|-------|
| Flaky integration tests block PRs | High | Medium | Transaction rollback isolation, randomized ordering verification, 3-strike retry in CI | QA |
| Migration rollback breaks in production | Low | Critical | Round-trip testing in CI, tested down migrations | QA + Eng |
| gRPC contract drift between Go and TS | Medium | High | `buf breaking` CI check, shared proto source of truth | Eng |
| Test infrastructure setup delays Wave 4 | Medium | Low | Start with `testcontainers-go` (lighter), defer `docker-compose.test.yml` | Eng |
| Type regeneration introduces runtime bugs | Low | Medium | `tsc --noEmit` gate + manual smoke test of auth flows | QA |

---

## Appendix: Test Naming Conventions

To keep test output readable and searchable:

- **Go unit tests:** `TestClusterRepository_Create`, `TestTopicRepository_ListByWorkspace`
- **Go integration tests:** `TestIntegration_MigrationRoundTrip`, `TestIntegration_DataPersistsAcrossRestart`
- **TypeScript integration tests:** `describe("Kafka Topic Catalog Integration")` → `it("creates a topic and lists it in the catalog")`
- **E2E tests:** `describe("E2E: Kafka Topic Sharing Critical Path")` → `it("completes the full create → share → approve → ACL flow")`
