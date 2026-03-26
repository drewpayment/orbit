# Technical Debt Optimization — Implementation Plan

**Date:** 2026-03-26
**Author:** Gage (Principal Software Engineer)
**Based on:** [Design Document](./2026-03-26-tech-debt-optimization-design.md), [QA Plan](./2026-03-26-tech-debt-optimization-qa-plan.md)
**Branch:** `feat/tech-debt-optimization`

---

## Open Questions Resolution

Before diving into implementation, here are decisions on the design doc's open questions:

| # | Question | Decision | Rationale |
|---|----------|----------|-----------|
| 1 | PostgreSQL instance | Share `orbit-postgres` (port 5433) with a dedicated `kafka_service` database | Already in docker-compose, reduces operational overhead. Separate DB provides isolation. |
| 2 | Migration tooling | `golang-migrate` | Battle-tested, fits Go ecosystem, up/down migrations. No need to evaluate alternatives for this scope. |
| 3 | Feature flag gating | No | The in-memory repos are stubs returning nil — swapping to real persistence is purely additive, not a behavior change that needs gradual rollout. |
| 4 | Payload source-of-truth transition | Deferred to Wave 2 | Frontend currently writes directly to MongoDB via Payload. The Go service becomes authoritative for its entities after Wave 1, but frontend migration to gRPC reads happens in Wave 2. |
| 5 | CI budget | 5 min max for integration test suite | Use `testcontainers-go` with parallel execution. Docker-compose.test.yml is a Phase 2.6.4 concern. |

---

## Wave 1: Kafka Persistence Layer (PostgreSQL Migration)

> **QA-001: Clean-Slate Migration.** This is a clean-slate migration — no data migration is needed. The in-memory stubs were volatile by design (all state was lost on every restart). Switching to PostgreSQL is purely additive. The Kafka service will log `"INFO: Using PostgreSQL persistence — in-memory stubs removed"` on startup to make this explicit. PR description and any CHANGELOG entry must state the clean-slate nature.

### 1.1 — PostgreSQL Schema Migrations

**Location:** `services/kafka/migrations/`

Create `golang-migrate` compatible migration files (SQL up/down pairs):

#### Migration 001: Core Tables

**File:** `000001_initial_schema.up.sql`

Tables to create:
1. `kafka_clusters` — maps to `domain.KafkaCluster`
   - `id` UUID PK
   - `name` TEXT UNIQUE NOT NULL
   - `provider_id` TEXT NOT NULL
   - `connection_config` JSONB NOT NULL DEFAULT '{}'
   - `validation_status` TEXT NOT NULL DEFAULT 'pending'
   - `last_validated_at` TIMESTAMPTZ
   - `created_at` TIMESTAMPTZ NOT NULL DEFAULT NOW()
   - `updated_at` TIMESTAMPTZ NOT NULL DEFAULT NOW()

2. `kafka_environment_mappings` — maps to `domain.KafkaEnvironmentMapping`
   - `id` UUID PK
   - `environment` TEXT NOT NULL
   - `cluster_id` UUID NOT NULL REFERENCES kafka_clusters(id)
   - `routing_rule` JSONB NOT NULL DEFAULT '{}'
   - `priority` INT NOT NULL DEFAULT 0
   - `is_default` BOOLEAN NOT NULL DEFAULT false
   - `created_at` TIMESTAMPTZ NOT NULL DEFAULT NOW()
   - INDEX: `(environment, is_default)`

3. `kafka_topics` — maps to `domain.KafkaTopic`
   - `id` UUID PK
   - `workspace_id` UUID NOT NULL
   - `name` TEXT NOT NULL
   - `description` TEXT NOT NULL DEFAULT ''
   - `environment` TEXT NOT NULL
   - `cluster_id` UUID (nullable — assigned on provisioning)
   - `partitions` INT NOT NULL DEFAULT 3
   - `replication_factor` INT NOT NULL DEFAULT 3
   - `retention_ms` BIGINT NOT NULL DEFAULT 604800000
   - `cleanup_policy` TEXT NOT NULL DEFAULT 'delete'
   - `compression` TEXT NOT NULL DEFAULT 'none'
   - `config` JSONB NOT NULL DEFAULT '{}'
   - `status` TEXT NOT NULL DEFAULT 'pending-approval'
   - `workflow_id` TEXT NOT NULL DEFAULT ''
   - `approval_required` BOOLEAN NOT NULL DEFAULT true
   - `approved_by` UUID
   - `approved_at` TIMESTAMPTZ
   - `created_at` TIMESTAMPTZ NOT NULL DEFAULT NOW()
   - `updated_at` TIMESTAMPTZ NOT NULL DEFAULT NOW()
   - UNIQUE INDEX: `(workspace_id, environment, name)`
   - INDEX: `(workspace_id, environment)`

4. `kafka_topic_policies` — maps to `domain.KafkaTopicPolicy`
   - `id` UUID PK
   - `scope` TEXT NOT NULL DEFAULT 'platform'
   - `workspace_id` UUID
   - `environment` TEXT NOT NULL
   - `naming_pattern` TEXT NOT NULL DEFAULT ''
   - `auto_approve_patterns` JSONB NOT NULL DEFAULT '[]'
   - `partition_limits` JSONB
   - `retention_limits` JSONB
   - `require_schema` BOOLEAN NOT NULL DEFAULT false
   - `require_approval_for` JSONB NOT NULL DEFAULT '[]'
   - `created_at` TIMESTAMPTZ NOT NULL DEFAULT NOW()
   - `updated_at` TIMESTAMPTZ NOT NULL DEFAULT NOW()
   - INDEX: `(workspace_id, environment)`

5. `kafka_schemas` — maps to `domain.KafkaSchema`
   - `id` UUID PK
   - `workspace_id` UUID NOT NULL
   - `topic_id` UUID NOT NULL REFERENCES kafka_topics(id)
   - `type` TEXT NOT NULL (key/value)
   - `subject` TEXT NOT NULL
   - `format` TEXT NOT NULL
   - `content` TEXT NOT NULL
   - `version` INT NOT NULL DEFAULT 0
   - `schema_id` INT NOT NULL DEFAULT 0
   - `compatibility` TEXT NOT NULL DEFAULT 'backward'
   - `status` TEXT NOT NULL DEFAULT 'pending'
   - `created_at` TIMESTAMPTZ NOT NULL DEFAULT NOW()
   - `updated_at` TIMESTAMPTZ NOT NULL DEFAULT NOW()
   - UNIQUE INDEX: `(topic_id, type)`

6. `kafka_schema_registries` — maps to `domain.SchemaRegistry`
   - `id` UUID PK
   - `cluster_id` UUID NOT NULL REFERENCES kafka_clusters(id)
   - `url` TEXT NOT NULL
   - `subject_naming_template` TEXT NOT NULL DEFAULT ''
   - `default_compatibility` TEXT NOT NULL DEFAULT 'backward'
   - `environment_overrides` JSONB NOT NULL DEFAULT '[]'
   - `created_at` TIMESTAMPTZ NOT NULL DEFAULT NOW()
   - `updated_at` TIMESTAMPTZ NOT NULL DEFAULT NOW()
   - UNIQUE INDEX: `(cluster_id)`

7. `kafka_topic_shares` — maps to `domain.KafkaTopicShare`
   - `id` UUID PK
   - `topic_id` UUID NOT NULL REFERENCES kafka_topics(id)
   - `shared_with_type` TEXT NOT NULL DEFAULT 'workspace'
   - `shared_with_workspace_id` UUID
   - `shared_with_user_id` UUID
   - `permission` TEXT NOT NULL
   - `status` TEXT NOT NULL DEFAULT 'pending-request'
   - `requested_by` UUID NOT NULL
   - `requested_at` TIMESTAMPTZ NOT NULL DEFAULT NOW()
   - `justification` TEXT NOT NULL DEFAULT ''
   - `approved_by` UUID
   - `approved_at` TIMESTAMPTZ
   - `expires_at` TIMESTAMPTZ
   - `created_at` TIMESTAMPTZ NOT NULL DEFAULT NOW()
   - `updated_at` TIMESTAMPTZ NOT NULL DEFAULT NOW()
   - INDEX: `(topic_id, shared_with_workspace_id)`

8. `kafka_topic_share_policies` — maps to `domain.KafkaTopicSharePolicy`
   - `id` UUID PK
   - `workspace_id` UUID NOT NULL
   - `scope` TEXT NOT NULL
   - `topic_pattern` TEXT NOT NULL DEFAULT ''
   - `topic_id` UUID
   - `environment` TEXT NOT NULL DEFAULT ''
   - `visibility` TEXT NOT NULL DEFAULT 'private'
   - `auto_approve` JSONB
   - `default_permission` TEXT NOT NULL DEFAULT 'read'
   - `require_justification` BOOLEAN NOT NULL DEFAULT false
   - `access_ttl_days` INT NOT NULL DEFAULT 0
   - `created_at` TIMESTAMPTZ NOT NULL DEFAULT NOW()
   - `updated_at` TIMESTAMPTZ NOT NULL DEFAULT NOW()
   - INDEX: `(workspace_id, topic_id)`

9. `kafka_service_accounts` — maps to `domain.KafkaServiceAccount`
   - `id` UUID PK
   - `workspace_id` UUID NOT NULL
   - `name` TEXT NOT NULL
   - `type` TEXT NOT NULL
   - `status` TEXT NOT NULL DEFAULT 'active'
   - `created_by` UUID NOT NULL
   - `created_at` TIMESTAMPTZ NOT NULL DEFAULT NOW()
   - `updated_at` TIMESTAMPTZ NOT NULL DEFAULT NOW()
   - INDEX: `(workspace_id)`

**File:** `000001_initial_schema.down.sql`
- DROP all tables in reverse dependency order

**File:** `testdata/seed.sql`
- Minimal seed data: 1 cluster, 1 topic, 1 schema — used for migration round-trip testing

**Verification:**
1. `golang-migrate` can run `up` cleanly against a fresh PostgreSQL instance
2. **QA-003: Migration round-trip test:** `up` → seed data → `down` → `up` again. Second `up` must succeed cleanly with no leftover state. All tables exist and are empty after the round-trip.

---

### 1.2 — PostgreSQL Repository Implementations

**Location:** `services/kafka/internal/repository/postgres/`

Each file implements one or more related repository interfaces from `services/kafka/internal/service/`:

| File | Interfaces Implemented | Key Methods |
|------|----------------------|-------------|
| `db.go` | — | `NewDB(connString)` returns `*pgxpool.Pool`, runs migrations |
| `cluster_repo.go` | `ClusterRepository` | CRUD with JSONB for connection_config |
| `provider_repo.go` | `ProviderRepository` | Read-only, returns `domain.DefaultProviders()` (no DB needed) |
| `mapping_repo.go` | `EnvironmentMappingRepository` | CRUD with environment-based queries |
| `topic_repo.go` | `TopicRepository` | CRUD with composite key lookup (workspace_id, environment, name) |
| `policy_repo.go` | `PolicyRepository` | GetEffectivePolicy with workspace→platform fallback |
| `schema_repo.go` | `SchemaRepository` | CRUD with topic_id+type unique lookup |
| `registry_repo.go` | `SchemaRegistryRepository` | GetByClusterID with cluster_id unique lookup |
| `share_repo.go` | `ShareRepository` | CRUD with filter-based List, GetExisting dedup |
| `share_policy_repo.go` | `SharePolicyRepository` | GetEffectivePolicy with scope matching |
| `service_account_repo.go` | `ServiceAccountRepository` | CRUD with workspace_id scoping |

**Implementation pattern for each repo:**

```go
type ClusterRepository struct {
    pool *pgxpool.Pool
}

func NewClusterRepository(pool *pgxpool.Pool) *ClusterRepository {
    return &ClusterRepository{pool: pool}
}

func (r *ClusterRepository) Create(ctx context.Context, cluster *domain.KafkaCluster) error {
    _, err := r.pool.Exec(ctx,
        `INSERT INTO kafka_clusters (id, name, provider_id, connection_config, validation_status, last_validated_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        cluster.ID, cluster.Name, cluster.ProviderID, cluster.ConnectionConfig,
        cluster.ValidationStatus, cluster.LastValidatedAt, cluster.CreatedAt, cluster.UpdatedAt)
    return err
}
```

**Key considerations:**
- Use `pgx` native types for UUID, JSONB, TIMESTAMPTZ
- `ProviderRepository` stays in-memory (read-only hardcoded providers) — no DB table needed
- `PolicyRepository.GetEffectivePolicy` must check workspace-scoped first, then fall back to platform-scoped
- `ShareRepository.List` must handle dynamic filter building based on which ShareFilter fields are set
- All repos return `domain.Err*` sentinel errors for not-found cases

---

### 1.3 — Database Connection & Migration Runner

**File:** `services/kafka/internal/repository/postgres/db.go`

```go
func NewDB(ctx context.Context, connString string) (*pgxpool.Pool, error) {
    pool, err := pgxpool.New(ctx, connString)
    if err != nil {
        return nil, fmt.Errorf("connect to postgres: %w", err)
    }
    if err := pool.Ping(ctx, nil); err != nil {
        return nil, fmt.Errorf("ping postgres: %w", err)
    }
    if err := runMigrations(connString); err != nil {
        return nil, fmt.Errorf("run migrations: %w", err)
    }
    return pool, nil
}
```

**File:** `services/kafka/cmd/server/main.go` — Updated wiring:

```go
// Replace:
clusterRepo := newInMemoryClusterRepository()
// With:
pool, err := postgres.NewDB(ctx, os.Getenv("DATABASE_URL"))
if err != nil {
    log.Fatalf("failed to connect to database: %v", err)
}
defer pool.Close()
clusterRepo := postgres.NewClusterRepository(pool)
```

**Environment variable:** `DATABASE_URL=postgres://orbit:orbit@localhost:5433/kafka_service?sslmode=disable`

---

### 1.4 — Repository Unit Tests

**Location:** `services/kafka/internal/repository/postgres/*_test.go`

**Strategy:** Build-tag gated integration tests (`//go:build integration`)

**QA-004: Shared pool + per-test transaction rollback.** To prevent connection pool exhaustion, all tests share one `pgxpool.Pool` (max 5 connections) created at suite level. Individual tests use per-test transactions that roll back on cleanup — no data leaks between tests, no connection exhaustion.

Each test file follows this pattern:
1. Suite setup (once): Connect to test PostgreSQL, run migrations, store shared pool
2. Per-test setup: Begin transaction from shared pool
3. Test: CRUD operations, edge cases, not-found errors (all through the transaction)
4. Per-test cleanup: Rollback transaction (automatic via `t.Cleanup`)

**Test helper:** `services/kafka/internal/repository/postgres/testutil_test.go`

```go
var testPool *pgxpool.Pool

func TestMain(m *testing.M) {
    // One pool for the entire test suite (max 5 conns)
    pool, err := pgxpool.New(ctx, os.Getenv("TEST_DATABASE_URL"))
    // ... run migrations ...
    testPool = pool
    code := m.Run()
    pool.Close()
    os.Exit(code)
}

func setupTestTx(t *testing.T) pgx.Tx {
    tx, err := testPool.Begin(context.Background())
    require.NoError(t, err)
    t.Cleanup(func() { tx.Rollback(context.Background()) })
    return tx
}
```

**Note:** Repository constructors accept a `Querier` interface (`pgxpool.Pool` and `pgx.Tx` both satisfy it) so tests can inject the transaction directly.

**Minimum test coverage per repo:**
- Create + GetByID round-trip
- List returns created items
- Update modifies fields
- Delete removes item
- Not-found returns correct domain error

**Stability verification:** Run the full integration test suite 3 times consecutively. All 3 runs must pass with zero connection errors.

---

### 1.5 — CI Debt Metrics Baseline

**QA-005: Metrics from day one, not Wave 4.** The entire initiative is about measurable reduction — we need baselines before any code changes land.

**File:** `.github/workflows/tech-debt-metrics.yml` (or added as a step to existing CI workflow)

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

**Regression threshold:** Fail the build if any metric increases by more than 5 from baseline.

---

### 1.6 — Infrastructure Updates

**`docker-compose.yml`** — Add init script for kafka_service database:
- `infrastructure/postgres-init/02-kafka-service.sql`: `CREATE DATABASE kafka_service;`

**`services/kafka/go.mod`** — Add dependencies:
- `github.com/jackc/pgx/v5` — PostgreSQL driver
- `github.com/golang-migrate/migrate/v4` — Migration runner
- `embed` — For embedding migration SQL files

**`docker-compose.yml`** — Update kafka-service environment:
- Add `DATABASE_URL` env var pointing to orbit-postgres

---

## Wave 2: gRPC Critical Path (Summary — Detailed plan after Wave 1 execution)

### 2.1 — Kafka Management Handlers
- Implement real handlers in `services/repository/internal/grpc/` that delegate to the Kafka service via gRPC
- Focus on handlers called by `orbit-www/src/app/actions/kafka-*.ts`

### 2.2 — Temporal Workflow Handlers
- Replace placeholder stubs in `temporal_server.go` with real Temporal SDK calls

### 2.3 — Frontend Action Wiring
- Resolve TODOs in `orbit-www/src/app/actions/kafka-*.ts` by connecting to real gRPC endpoints

### 2.4 — Contract Tests

**QA-006: Proto-based contract testing.** The `.proto` files are the single source of truth for both Go and TypeScript clients.

**Go side:** Test that each implemented handler accepts valid proto requests and returns valid proto responses matching the schema. Test files in `services/repository/internal/grpc/*_test.go` with naming convention `TestGRPC_<HandlerName>`.

**TypeScript side:** Generate TypeScript types from the same `.proto` files via `buf` (already installed locally in `orbit-www/node_modules`). Verify the frontend gRPC client (Connect-ES) matches.

**CI step:** `buf breaking --against '.git#branch=main'` on every PR touching `*.proto` files to catch breaking changes.

**Verification:**
```bash
# Go contract tests
cd services/repository && go test -run TestGRPC ./internal/grpc/...
# Proto breaking change detection
buf breaking --against '.git#branch=main'
# TypeScript client type check
cd orbit-www && npx tsc --noEmit
```

---

## Wave 3: Type Safety (Summary)

### 3.1 — Payload Type Generation Fix
- Add Better Auth fields to Payload collection schemas
- Regenerate `payload-types.ts`
- Bulk-replace `(req.user as any).field` patterns

**QA-007: `tsc --noEmit` before/after checkpoint.** Capture TypeScript error count before regeneration, then verify it is equal or lower after applying changes. This gates the Wave 3 PR — no merge if error count increases.

```bash
# Before (capture baseline)
cd orbit-www && npx tsc --noEmit 2>&1 | grep "Found .* error" || echo "0 errors"
# Regenerate types
bun run payload generate:types
# Apply bulk replacements
# After (must be <= baseline)
npx tsc --noEmit 2>&1 | grep "Found .* error" || echo "0 errors"
```

### 3.2 — Gradual Cleanup
- Fix remaining `as any` casts in files touched during Waves 1-2

---

## Wave 4: Integration Tests (Summary)

### 4.1 — Test Infrastructure
- `docker-compose.test.yml` override
- Go `testutil` package
- CI pipeline

### 4.2 — Kafka Topic Sharing Tests
- Implement all 32 `.todo` tests in `kafka-topic-catalog.integration.test.ts`

**QA-008: Test isolation.** Each integration test creates its own `workspace_id` (random UUID) and uses it for all entities. Topic names include a random suffix: `test-topic-${crypto.randomUUID().slice(0,8)}`. Tests must not rely on global state or assume the database is empty. For Go tests, use the per-test transaction rollback pattern from Wave 1.4. For TypeScript tests, use `beforeEach` to create a fresh workspace context.

**CI strategy:** Run tests sequentially first. Enable parallelism only after 5 consecutive randomized runs pass (`bun test --randomize` / `go test -shuffle=on`).

### 4.3 — E2E Smoke Test: Kafka Topic Sharing Critical Path

**QA-002: Full critical path E2E test.** Individual wave tests cover components in isolation. This test covers the complete flow end-to-end against the full docker-compose stack (no mocks).

**Test outline:**
```
E2E: Kafka Topic Sharing Critical Path
  1. Create a Kafka topic in workspace A → 201, topic created
  2. From workspace B, request a share on that topic → 201, share pending
  3. Approve the share request from workspace A → 200, share approved
  4. GET share → status = "approved", share active
  5. Verify: service account for workspace B has read ACL on the topic
```

**Location:** `services/kafka/tests/e2e/kafka_sharing_test.go` or `orbit-www/tests/e2e/kafka-sharing.spec.ts`

**CI:** Runs as a separate job after all unit/integration tests pass. Must pass on every PR merge to `feat/tech-debt-optimization` and before branch merges to `main`.

---

## Verification Checkpoints

Full checkpoint matrix is defined in the [QA Plan](./2026-03-26-tech-debt-optimization-qa-plan.md#4-verification-checkpoints-per-wave). Key checkpoints per wave:

### Wave 1

| # | Check | Command | Pass Criteria |
|---|-------|---------|---------------|
| 1.1 | Migrations apply | `golang-migrate -path ./migrations -database $DATABASE_URL up` | Exit 0, all tables created |
| 1.2 | Migration round-trip (QA-003) | up → seed → down → up | No errors, tables exist and empty |
| 1.3 | Go builds | `cd services/kafka && go build ./...` | Exit 0 |
| 1.4 | Unit tests pass | `cd services/kafka && go test -tags=integration ./internal/repository/postgres/...` | All pass, 90%+ coverage |
| 1.5 | Pool stability (QA-004) | Run test suite 3x consecutively | 3/3 pass, 0 connection errors |
| 1.6 | Service starts with PG | `docker compose up kafka-service` | Logs `"Using PostgreSQL persistence"` |
| 1.7 | Data persists | Create entity → restart → query | Entity survives restart |
| 1.8 | In-memory stubs removed | `grep -r "inMemory.*Repository" services/kafka/ \| grep -v _test.go \| wc -l` | 0 (was 10) |
| 1.9 | Debt metrics CI (QA-005) | Push PR, check GitHub Actions | Metrics posted to step summary |

### Wave 2

| # | Check | Command | Pass Criteria |
|---|-------|---------|---------------|
| 2.1 | Contract tests (QA-006) | `go test -run TestGRPC ./internal/grpc/...` | All pass |
| 2.2 | Proto compatibility | `buf breaking --against '.git#branch=main'` | No breaking changes |
| 2.3 | Frontend actions | `bun test` for kafka action tests | All pass |

### Wave 3

| # | Check | Command | Pass Criteria |
|---|-------|---------|---------------|
| 3.1 | Type gen succeeds | `bun run payload generate:types` | Exit 0 |
| 3.2 | tsc checkpoint (QA-007) | `npx tsc --noEmit` | Error count <= baseline |
| 3.3 | `as any` reduced | `grep -r "as any" orbit-www/src/ --include="*.ts" --include="*.tsx" \| wc -l` | < 150 |

### Wave 4

| # | Check | Command | Pass Criteria |
|---|-------|---------|---------------|
| 4.1 | All .todo tests pass | `grep -r "\.todo(" orbit-www/src/ --include="*.ts" \| wc -l` | 0 |
| 4.2 | E2E smoke (QA-002) | Full critical path test | create → share → approve → ACL |
| 4.3 | Randomized stability (QA-008) | 5x randomized runs | 5/5 pass |
