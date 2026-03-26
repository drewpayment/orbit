# Technical Debt Optimization — Implementation Plan

**Date:** 2026-03-26
**Author:** Gage (Principal Software Engineer)
**Based on:** [Design Document](./2026-03-26-tech-debt-optimization-design.md)
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

**Verification:** `golang-migrate` can run up/down cleanly against a fresh PostgreSQL instance.

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

Each test file follows this pattern:
1. Setup: Create test database connection, run migrations
2. Test: CRUD operations, edge cases, not-found errors
3. Teardown: Truncate tables

**Test helper:** `services/kafka/internal/repository/postgres/testutil_test.go`
- Connects to test PostgreSQL (from env var or testcontainers)
- Provides `setupTestDB(t)` that returns a pool and cleanup func

**Minimum test coverage per repo:**
- Create + GetByID round-trip
- List returns created items
- Update modifies fields
- Delete removes item
- Not-found returns correct domain error

---

### 1.5 — Infrastructure Updates

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

---

## Wave 3: Type Safety (Summary)

### 3.1 — Payload Type Generation Fix
- Add Better Auth fields to Payload collection schemas
- Regenerate `payload-types.ts`
- Bulk-replace `(req.user as any).field` patterns

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

---

## Verification Checkpoints

| Checkpoint | Command | Expected Result |
|-----------|---------|-----------------|
| Migrations run | `golang-migrate -path ./migrations -database $DATABASE_URL up` | All tables created |
| Go builds | `cd services/kafka && go build ./...` | No errors |
| Unit tests pass | `cd services/kafka && go test ./...` | All pass |
| Integration tests pass | `cd services/kafka && go test -tags=integration ./...` | All pass |
| Service starts | `docker compose up kafka-service` | Connects to PG, runs migrations, serves gRPC |
| Data persists | Create cluster via gRPC, restart service, query cluster | Cluster survives restart |
| In-memory stub count | `grep -r "inMemory.*Repository" services/kafka/ \| grep -v _test.go \| wc -l` | 0 (was 10) |
