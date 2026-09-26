# Orbit Reference Architecture

**Pinned revision**: `f958fc59` (main, 2026-09-17). **Diagram**: `docs/architecture/orbit-reference-architecture.html` (interactive, generated from `orbit-reference-architecture.json` with archify; every node links to its source file).

This page is the LLM-facing map of the system: what runs, who calls whom, over which protocol, with which credential, and where each kind of data lives. Read it before touching cross-service behaviour. It is deliberately about runtime topology, not folder layout (`project-structure.md`) or API shapes (`api-architecture.md`).

## 1. Runtime components

| Component | Runtime | Entry point | Listens | Talks to |
|---|---|---|---|---|
| **Orbit portal** (`orbit-www`) | Next.js 15 + Payload 3, React 19, Bun | `orbit-www/src/app/layout.tsx`, `payload.config.ts` | :3000 | MongoDB, Temporal, Go services, Better-Auth |
| **MongoDB** | mongo | docker-compose `mongo` | :27017 | — (Payload is the only writer) |
| **Temporal** | temporalio/auto-setup + UI | docker-compose `temporal-server`, `temporal-ui` | :7233 gRPC, :8080 UI | PostgreSQL :5432, Elasticsearch :9200 |
| **Go worker** (`temporal-workflows`) | Go | `temporal-workflows/cmd/worker/main.go` | — (polls) | Portal `/api/internal`, Bifrost admin, build-service, MinIO, GitHub/ADO, LLM providers |
| **Azure launch worker** | TypeScript Temporal worker + Pulumi | `launches-worker-azure/src/worker.ts` | — (polls `launches_azure`) | Azure ARM, MinIO (Pulumi state) |
| **Automations worker** | TypeScript Temporal worker | `orbit-www/services/automation-worker/src/worker.ts` | — (polls `orbit-automations`) | Portal `/api/internal` |
| **Repository service** | Go gRPC/Connect | `services/repository/cmd/server/main.go` | :50051 gRPC, :8081 HTTP | Temporal, git hosts, filesystem work dirs |
| **Kafka service** | Go gRPC | `services/kafka/cmd/server/main.go` | :50055 | PostgreSQL (own schema), Kafka clusters |
| **Bifrost** | Go Kafka proxy + admin gRPC | `services/bifrost/cmd/bifrost/main.go` | :9092 proxy (behind Traefik), :50060 admin, :8080 metrics | Redpanda :9092 |
| **Build service** | Go gRPC | `services/build-service/cmd/server/main.go` | :50054 | BuildKit, OCI registry, portal `/api/internal` |
| **Redpanda** | Kafka-compatible broker | docker-compose `redpanda`, `redpanda-console` | :19092 Kafka, :18081 schema registry, :8083 console | — |
| **MinIO** | S3-compatible object store | docker-compose `minio` | :9000 API, :9001 console | — |
| **OCI registry** | registry:2 | docker-compose `orbit-registry` | :5050 | — (frozen capability) |
| **Traefik** | TCP entrypoint for Kafka clients | docker-compose `traefik` | :9092 → Bifrost | — |
| **Prometheus** | metrics | docker-compose `prometheus` | :9090 | Bifrost, services |

`services/api-catalog` and `services/knowledge` are Go libraries with tests but no `cmd/` and no compose entry: they do not run. The portal's `lib/grpc/knowledge-client.ts` and `workspace-client.ts` point at stubs. Cloud launches support Azure and DigitalOcean only; the AWS/GCP workers, plugins service and Backstage backend were removed (tag `archive/pre-strip-2026-06-10`).

## 2. Call paths and credentials

Every arrow below is a real call site. There are exactly four trust mechanisms; do not invent a fifth.

| From → To | Protocol | Credential | Where |
|---|---|---|---|
| Browser → Portal | HTTPS, RSC + server actions | Better-Auth session cookie | `orbit-www/src/lib/auth.ts`, `auth-client.ts` |
| Portal → MongoDB | Payload local API | none (in-process); access rules from `lib/authz/payload.ts` unless `overrideAccess: true` | every server action / page |
| Portal → Go services (repository, kafka, bifrost admin, build) | Connect-ES / gRPC | short-TTL HS256 **svc-auth JWT** (`iss=orbit-www`, `sub=<betterAuthId>`, `wid=<workspace>`, `adm=<platform admin>`) minted per call by `lib/grpc/auth-interceptor.ts`; verified with `ORBIT_SVC_AUTH_SECRET` in `proto/pkg/svcauth` | `lib/grpc/*-client.ts`, `lib/clients/*.ts` |
| Portal → Temporal | Temporal client (`@temporalio/client`) | none (namespace `default`) | `lib/temporal/*` |
| Temporal → workers | task-queue polling | none | `orbit-workflows` (Go), `launches_azure`, `orbit-automations` |
| Workers, build-service → Portal | HTTP `/api/internal/**` | `X-API-Key: ORBIT_INTERNAL_API_KEY` (constant-time check, fail-closed) | `orbit-www/src/lib/auth/internal-api-auth.ts`, `temporal-workflows/internal/clients/payload_client.go` |
| Go worker → Bifrost admin, build-service | gRPC | in-cluster, no user identity | `temporal-workflows/internal/clients/bifrost_client.go` |
| Go worker → GitHub / Azure DevOps | REST + git over HTTPS | GitHub App installation tokens (refreshed by `GitHubTokenRefreshWorkflow`); ADO Entra service principal / PAT via `git-connections` | `temporal-workflows/internal/services/github_service.go`, `payload_ado_connection_client.go` |
| Go worker → LLM providers | HTTPS | provider API key loaded from the `llm-providers` collection through `/api/internal/llm-providers/[id]` | `temporal-workflows/internal/agent/providers/` (`anthropic`, `openai_compat` incl. Ollama) |
| Azure launch worker → Azure | Pulumi Azure Native | `AZURE_*` env / cloud-accounts | `launches-worker-azure/src/activities/provision.ts` |
| Workers → MinIO | S3 | MinIO root creds | `temporal-workflows/internal/clients/storage_client.go`; Pulumi backend `s3://pulumi-state` |
| Kafka clients → Redpanda | Kafka protocol via Traefik :9092 → Bifrost | tenant service-account credentials issued by kafka-service | `services/bifrost` |
| GitHub → Portal | webhooks | GitHub App webhook secret | `orbit-www/src/app/api/github/webhooks`, `api/webhooks/github/*` |

Rules that follow from the table:
- The browser never reaches a Go service, Temporal, a git host, an LLM provider or a cloud. Everything external is reached from a server action (portal) or a worker.
- `/api/internal/**` routes are for workers only. They authenticate with the API key, then run Payload calls with `overrideAccess: true`. They must never be called from the browser or use the session.
- A svc-auth `wid` claim is only minted for a workspace the caller is an active member of, even for platform admins (`auth-interceptor.ts`). The `adm` claim is the separate bypass for platform-scoped Kafka cluster RPCs.

## 3. Identity and authorization (one model)

Two user records exist and their ids differ: the Better-Auth user (session authority, `user` collection) and the Payload `users` doc (roles, status, target of every `relationTo: 'users'` field). Rules:

- Server code resolves the caller once with `getActor()` / `requireActor()` from `@/lib/authz` → `Actor { payloadId, betterAuthId, email, role, isPlatformAdmin, user }`. There is no bare `.id`.
- `workspace-members.user` stores the **Better-Auth id** (until authz Phase E moves it to a relationship). Every `relationTo: 'users'` field (`createdBy`, `author`, `triggeredBy`, `launchedBy`, `assignee`, …) stores the **Payload id**. The svc-auth JWT `sub` is the Better-Auth id.
- Decisions: `authorize(verb, resource)` (throws 401/403), `check()` (non-throwing), `memberWorkspaceIds(scope)`, `workspaceRole(id)`; collection `access` rules use the adapters in `lib/authz/payload.ts` over the same `can()` policy. Verbs `read`/`create` need any active role; `update`/`delete`/`manage` need workspace owner/admin. Platform admin (`users.role` ∈ `super_admin`, `admin`) is the only bypass.
- Roster data (list/invite/remove members) lives in `lib/workspaces/members.ts`. Nothing else may query `workspace-members` (lint-enforced).
- Full rules: `.agent/SOPs/authorization.md`; design: `docs/plans/2026-09-16-authz-consolidation.md`.

## 4. Data ownership

| Store | Owner | Holds |
|---|---|---|
| MongoDB `orbit-www` | Payload (portal) | every collection: tenancy (`workspaces`, `workspace-members`, `tenants`, `users`), catalog (`catalog-entities`, `catalog-relations`, `entity-types`, `api-schemas`, `discovered-entities`), self-service (`actions`, `action-runs`, `automations`, `templates`, `template-definitions`, `template-skeletons`, `launches`, `launch-templates`, `apps`, `deployments`, `environment-variables`), agent (`agent-runs`, `agent-events`, `agent-tools`, `pending-approvals`, `llm-providers`), Kafka control plane (`kafka-*`, `bifrost-config`), scorecards, knowledge (`knowledge-spaces`, `knowledge-pages`, `page-links`), connections (`github-installations`, `git-connections`, `cloud-accounts`, `registry-configs`) |
| PostgreSQL :5432 | Temporal | workflow history and visibility (with Elasticsearch) |
| PostgreSQL :5433 | kafka-service | virtual clusters, service accounts, quotas, migrations in `services/kafka/migrations` |
| Redpanda | Bifrost / tenants | topics, consumer groups, schemas (schema registry :18081) |
| MinIO | Go worker, launch worker | template and deployment artifacts, Pulumi state bucket |
| OCI registry :5050 | build-service | built images (frozen capability) |
| Filesystem work dirs | Go worker, repository service | `/tmp/orbit-repos`, `/tmp/orbit-templates`, `/tmp/orbit-deployments`, `/tmp/orbit-builds` (ephemeral) |

The Kafka records in MongoDB are the control plane and audit view; the kafka-service PostgreSQL schema is the operational source of truth for provisioning. Keep them in sync through kafka-service RPCs and the `kafka_*` Temporal workflows, never by writing both from a server action.

## 5. Durable work (Temporal)

| Task queue | Worker | Workflows |
|---|---|---|
| `orbit-workflows` | Go worker | `TemplateInstantiationWorkflow`, `DeploymentWorkflow`, `BuildWorkflow`, `LaunchWorkflow`, `InfrastructureAgentWorkflow`, `CatalogScanWorkflow`, `SpecSyncWorkflow`, `KnowledgeSyncWorkflow`, `GitHubTokenRefreshWorkflow`, `GitHubInstallationReconcileWorkflow`, `HealthCheckWorkflow`, `CredentialSyncWorkflow`, `CodegenWorkflow`, and the Kafka family (`KafkaTopicWorkflow`, `KafkaAccessWorkflow`, `KafkaSchemaWorkflow`, `VirtualClusterWorkflow`, `TopicShareWorkflow`, `TopicSyncWorkflow`, `LineageAggregationWorkflow`, `OffsetCheckpoint/RestoreWorkflow`, `ApplicationDecommissioning/CleanupWorkflow`) |
| `launches_azure` | Azure launch worker (TS) | Pulumi provision / destroy for cloud launches |
| `orbit-automations` | Automations worker (TS) | `schedule`-type automations, nightly scorecard evaluation sweep |

Pattern for anything long-running: the server action authorizes, writes the intent row to MongoDB with `overrideAccess: true`, starts the workflow with the row id, and returns. The worker does the work against external systems and writes status/results back through `/api/internal/<collection>/[id]/status`. UI reads the row (and, for the infra agent, streams `agent-events` over `/api/agent/[runId]/stream`). Two worker builds must never share one task queue.

## 6. Request lifecycles worth knowing

- **Self-service run**: `/self-service` → `runAction` server action (`check('create', workspace)`) → `action-runs` row (`triggeredBy = actor.payloadId`) → executes inline or parks `awaiting-approval` → approver (`workspace-admin` or `platform-admin` policy) resolves via `pending-approvals`.
- **Template instantiation**: template definition version → `TemplateInstantiationWorkflow` → Go worker clones skeleton, renders (`internal/templating/engine.go`), pushes to GitHub/ADO with an installation token, finalizes the `apps` row via `/api/internal`.
- **Infra agent**: `agent-runs` → `InfrastructureAgentWorkflow` → LLM turns through the provider registry → tool calls in a sandbox (`AGENT_SANDBOX_BACKEND` local or k8s) → destructive steps gated by `pending-approvals` → events persisted to `agent-events` and streamed to the UI.
- **Kafka topic**: portal → kafka-service (svc-auth JWT with `wid`) → `KafkaTopicWorkflow` → Bifrost admin / cluster; tenant clients connect through Traefik :9092 → Bifrost, which enforces virtual-cluster isolation.
- **Cloud launch**: `launches` row → `LaunchWorkflow` (Go) → child on `launches_azure` → Pulumi with state in MinIO → outputs written back via `/api/internal/launches/[id]/outputs` (secrets redacted; out-of-band delivery is issue #51).

## 7. Conventions the diagram encodes

- Tenant boundary = `workspace`. Every tenant-scoped collection has a `workspace` relationship (or reaches one through `app` / `knowledgeSpace`); read filters come from `workspaceScopedRead`, writes from `memberCreate` / `manageCreate` / `docWorkspaceMutate`.
- Frozen capabilities (no new feature work): container registry (:5050) and health monitoring. See README "Frozen Capabilities" and `docs/plans/2026-06-09-product-focus-strategy.md`.
- Ports: 3000 portal · 5050 registry · 5432/5433 Postgres · 6379 Redis (provisioned, unused by orbit-www today) · 7233 Temporal · 8080 Temporal UI · 8083 Redpanda Console · 9000/9001 MinIO · 9092 Traefik→Bifrost · 19092 Redpanda · 50051 repository · 50054 build · 50055 kafka · 50060 Bifrost admin.

## 8. Regenerating the diagram

```bash
cd ~/.claude/skills/archify   # archify skill
node bin/archify.mjs deliver architecture \
  <repo>/docs/architecture/orbit-reference-architecture.json \
  <repo>/docs/architecture/orbit-reference-architecture.html \
  --quality showcase --repo-root <repo> --json
```

Update `meta.repository.revision` to the commit you verified against; `sources[].path` must exist at that revision. Keep it at ≤12 primary nodes; put detail in cards or in this file.
