<p align="center">
  <img src="assets/orbit_master.png" alt="Orbit Logo" width="400">
</p>

# Orbit

An Internal Developer Portal (IDP) built around two audiences:

- **Application developers** self-serve against the cloud and technology your platform team has procured and approved: scaffold a service from a golden-path template, request a Kafka topic, launch an Azure environment, ask the governed infra agent for a change.
- **Platform teams** administer Orbit: they publish the templates, connect the Git hosts and cloud accounts, run the Kafka platform, set scorecard standards, and approve what needs a human.

Everything lives in a multi-tenant workspace model, so each team sees and changes only what it owns.

## What Problem Does Orbit Solve?

Developers need fast, autonomous access to repos, infrastructure, Kafka topics, and documentation. Without guardrails that leads to sprawl, inconsistency, and lost context. Orbit gives platform teams one place to offer those things with policy, approvals, and an audit trail attached, and gives developers one place to find and use them.

## What Works Today

Every item below is wired end to end in this repository. Anything that is not is listed under [Preview / hidden features](#-preview--hidden-features).

### 📚 Catalog & Discovery
A unified catalog of entities (services, APIs, Kafka topics, docs, and custom entity types) with typed relations and a relationship graph. The API schema catalog stores OpenAPI, AsyncAPI, GraphQL, and Protocol Buffers schemas with versions. **Discovery** scans connected GitHub and Azure DevOps repositories, proposes catalog entities into a review queue, and imports the ones you accept.

### 🧭 Self-Service Templates & Golden Paths
Author templates in the portal (`orbit/v2` definitions with skeletons, typed input forms, and RBAC-gated authoring), then run them from a guided wizard. A run clones the skeleton, renders it, pushes a new repository to GitHub (via the GitHub App installation), and registers the resulting app. Azure DevOps is supported for import, discovery, and creating an empty repository, but `git:push` has no Azure DevOps credentials yet, so template runs do not push scaffolded code to ADO. **Actions** (a catalog of things developers can run) and **Automations** (triggered by scorecard changes or a schedule) build on the same engine, with approval gates where a workspace admin must sign off.

### ✅ Scorecards
Define scorecards and rules over catalog entities, evaluate them (on demand and in a nightly sweep), track initiatives, and roll results up into reports for leaders.

### 🏢 Workspaces & Access Control
Workspaces are the tenant boundary. Members have `owner`, `admin`, or `member` roles; platform admins have a separate role. Authorization is enforced in one policy layer (`orbit-www/src/lib/authz`) and by Payload collection access rules, so every query is scoped to the caller's workspaces.

### 🔌 Connections
Connect GitHub (GitHub App installations with automatic token refresh) and Azure DevOps (Entra service principal or PAT) once under **Settings → Connections**; import, clone, and discovery use both, and template runs use GitHub. Apps can export and sync a `.orbit.yaml` manifest with their repository (export, webhook-driven pull, and conflict resolution).

### 🔄 Kafka Self-Service (Project Bifrost)
Multi-tenant Kafka through a gateway that gives each application/environment its own virtual cluster. Developers create topics (with an approval step in governed environments), issue service-account credentials, inspect consumer groups, browse the topic catalog, request access to other workspaces' topics, and view topic lineage. Platform admins manage providers, clusters, environment mappings, virtual clusters, credentials, and gateway status under **Platform → Kafka**. Cluster-level operations require the platform-admin claim.

### ☁️ Cloud Launches
Provision cloud environments from launch templates (Azure: virtual network, blob storage, container app, PostgreSQL flexible server) through a Temporal workflow that runs Pulumi in a provider worker, with optional approval. Cloud accounts are managed under **Settings → Cloud Accounts**.

> Azure is the provider with a worker in this repository (`launches-worker-azure/`). DigitalOcean is accepted by the data model and workflow, but no DigitalOcean launches worker or launch templates ship yet. AWS and GCP were removed.

### 🤖 Governed Infra Agent
An LLM agent that drives infrastructure changes through tools, with human-in-the-loop approval gates for destructive steps, a persisted event log, and a streamed run view. Platform admins register LLM providers (Anthropic, or any OpenAI-compatible endpoint including Ollama).

### 📖 Knowledge Spaces
Hierarchical knowledge spaces per workspace with a rich-text page editor, page links, and private, internal (workspace), or public visibility. There is no full-text search and no real-time multi-user editing.

### 🛠️ Platform Administration
Under **Platform**: user management (invite, roles, deactivation), LLM providers, pending approvals, Kafka management, discovery, and a link out to the Temporal UI for workflow inspection.

### ⚡ Workflow Orchestration
Long-running work (template runs, builds, launches, Kafka provisioning, the infra agent, catalog scans, token refresh) runs as durable Temporal workflows with retries and progress tracking. Image builds run through a BuildKit-backed build service.

## 🧪 Preview / Hidden Features

Surfaces whose backend is stubbed, mocked, or not wired to a real workflow are hidden from the UI, their routes return 404, and their server actions refuse to run. The single source of truth is [`orbit-www/src/lib/features.ts`](orbit-www/src/lib/features.ts).

| Feature key | What is hidden | Why |
|---|---|---|
| `billing` | `/billing`, `/upgrade` | Static placeholders; no billing provider behind them |
| `kafkaChargeback` | `/platform/kafka/billing` | Renders mock data; chargeback collections are unused |
| `kafkaSchemas` | Kafka "Schemas" tabs (topic and virtual-cluster pages) | Schema actions are stubs; the schema workflow is not registered in the worker |
| `kafkaTopicMetrics` | Topic "Metrics" tab | Metrics action always returns an empty list |
| `kafkaTopicSharing` | Topic-detail "Sharing" tab | Stubbed actions; use the topic catalog share-request flow instead |
| `legacyTemplates` | `/templates/**`, `/settings/templates` | Legacy instantiate used placeholder workflow IDs and simulated progress; use `/self-service/templates` |
| `deployments` | App "Deployments" card and actions | Deployment generators are paused (see Frozen Capabilities) |
| `digitalOceanLaunches` | DigitalOcean in the launch wizard and cloud-account form | No DigitalOcean launches worker or launch templates ship; launches would never complete |
| `deployToLaunch` | "Deploy to launch" action | Calls `DeployToLaunchWorkflow`, which is not defined anywhere |

Also unavailable, without a flag: Kafka offset restore (the action returns an explicit "not available" error because `OffsetRestoreWorkflow` is not registered in the worker), repository analysis for builds, the launch "Resources" tab, and knowledge search. Topic-share rejection notifications are only logged (no email or in-app notification is sent).

To turn features back on, set a comma-separated list (or `all`) of the keys above:

```bash
ORBIT_ENABLE_PREVIEW_FEATURES=billing,kafkaSchemas
```

Pages, layouts, and server actions read the variable at runtime (gated pages are `force-dynamic`), so a server restart is enough for them. The sidebar is a client component and uses a build-time copy (`NEXT_PUBLIC_ORBIT_ENABLE_PREVIEW_FEATURES`, mirrored from the same variable by `next.config.mjs`), so entries hidden from the sidebar (currently only Settings → Templates, via `legacyTemplates`) reappear only after a rebuild with the variable set.

### 🧊 Frozen Capabilities
Per the product focus strategy (`docs/plans/2026-06-09-product-focus-strategy.md`), these remain functional but accept no new feature work:

- **Container Registry** (port 5050, `/api/registry/token`, `RegistryConfigs`/`RegistryImages`
  collections) — GHCR/ACR cover this; the built-in registry stays as-is.
- **Health Monitoring** (`HealthChecks` collection, `health_check_workflow.go`, catalog
  health badges) — SLO/alerting belongs to dedicated observability tooling; only the
  catalog badge is maintained.
- **Deployment generators** (Terraform/Helm/Compose) — paused; only the Azure launch path
  is being resumed. The UI is hidden (`deployments` above).

Cloud launches ship with **Azure** only (DigitalOcean is accepted by the data model but has no worker yet); the AWS and GCP workers were removed
(last present at git tag `archive/pre-strip-2026-06-10`).

## 🏛️ Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                           Orbit Platform                             │
├──────────────────────────────────────────────────────────────────────┤
│  Portal (orbit-www)                                                  │
│  Payload CMS 3 + Next.js 15 (TypeScript, React 19), Better-Auth      │
│  UI, server actions, Payload collections, /api/internal for workers  │
├──────────────────────────────────────────────────────────────────────┤
│  Go services (gRPC / Connect, svc-auth JWT)                          │
│  ┌────────────┐ ┌────────────┐ ┌──────────────┐ ┌─────────────────┐ │
│  │ Repository │ │   Kafka    │ │ Build service│ │ Bifrost gateway │ │
│  │  service   │ │  service   │ │  (BuildKit)  │ │ (Kafka proxy)   │ │
│  └────────────┘ └────────────┘ └──────────────┘ └─────────────────┘ │
├──────────────────────────────────────────────────────────────────────┤
│  Temporal workers                                                    │
│  Go worker (orbit-workflows) · Azure launch worker (TS, Pulumi) ·    │
│  Automations worker (TS)                                             │
├──────────────────────────────────────────────────────────────────────┤
│  Data                                                                │
│  MongoDB (Payload) · PostgreSQL (Temporal, kafka-service) ·          │
│  Elasticsearch (Temporal visibility) · MinIO (Pulumi state,          │
│  artifacts) · Redpanda (Kafka)                                       │
└──────────────────────────────────────────────────────────────────────┘
```

See [`.agent/system/reference-architecture.md`](.agent/system/reference-architecture.md) for the runtime topology, call paths, credentials, and data ownership.

### Tech Stack Summary

| Layer | Technology |
|-------|------------|
| Frontend | Payload CMS 3.0, Next.js 15, TypeScript, React 19 |
| Auth | Better-Auth (email and password) |
| Backend | Go 1.21+ services, gRPC / Connect (Protocol Buffers) |
| Workflows | Temporal (Go worker, plus TypeScript launch and automation workers) |
| Databases | MongoDB (Payload), PostgreSQL (Temporal, kafka-service), Elasticsearch (Temporal visibility) |
| Storage | MinIO / S3 (Pulumi state, artifacts) |
| Messaging | Redpanda (Kafka-compatible) behind the Bifrost gateway |
| Builds | BuildKit via the build service; OCI registry (frozen) |

Redis is provisioned in `docker-compose.yml` but is not used by the portal today.

## 🚀 Getting Started

### Prerequisites

- Docker and Docker Compose
- Node.js 18.20.2+ or 20.9.0+
- Go 1.21+
- [Bun](https://bun.sh/) (the frontend's package manager)

### Quick Start

Clone the repository:

```bash
git clone git@github.com:drewpayment/orbit.git
cd orbit
```

**Option A: Hybrid Setup (Recommended)**

Run infrastructure in Docker, frontend locally for faster hot-reload:

```bash
# Start infrastructure (MongoDB, Temporal, Redpanda, Bifrost, Go services, etc.)
make dev-local

# In another terminal, start the frontend
cd orbit-www && bun install && bun run dev
```

Testing launches or image builds? Use `make dev-local-full`, which also starts MinIO, BuildKit, the build service, and the Azure launch worker.

**Option B: Full Docker**

Run everything in containers:

```bash
make dev
```

### Access the Services

| Service | URL |
|---------|-----|
| Frontend | http://localhost:3000 |
| Temporal UI | http://localhost:8080 |
| Redpanda Console | http://localhost:8083 |
| MinIO Console | http://localhost:9001 |

### Common Commands

```bash
# Go tests / lint
make test-go
make lint-go

# Frontend tests / typecheck / lint (run directly; use bun, not pnpm)
cd orbit-www
./node_modules/.bin/vitest run --config ./vitest.config.mts
./node_modules/.bin/tsc --noEmit
bun run lint

# Generate protobuf code
make proto-gen

# View all available commands
make help
```

> `make test-frontend` and `make lint-frontend` still call `pnpm`, but `orbit-www` pins Bun as its package manager, so run the frontend commands above directly.

### Environment Setup

Copy the example environment file and configure:

```bash
cp orbit-www/.env.example orbit-www/.env
```

Key variables to configure:
- `DATABASE_URI` - MongoDB connection string
- `PAYLOAD_SECRET` - Secret for Payload CMS
- GitHub App credentials (for repository integration)
- `ORBIT_INTERNAL_API_KEY` and `ORBIT_SVC_AUTH_SECRET` (worker and Go-service authentication)

Sign in with an email and password account; there is no GitHub, Google, or Azure AD login. The first user created through setup becomes the super admin.

See [DEV_SETUP.md](./DEV_SETUP.md) for complete environment configuration, troubleshooting, and Kafka setup instructions.

## 📁 Project Structure

```
orbit/
├── orbit-www/              # Payload CMS + Next.js portal
│   ├── src/
│   │   ├── app/            # Next.js App Router pages and server actions
│   │   ├── collections/    # Payload CMS collections
│   │   ├── components/     # React components
│   │   └── lib/            # Authz, feature flags, utilities, generated proto clients
│   └── services/automation-worker/   # TypeScript automations worker
│
├── services/               # Go services
│   ├── repository/         # Repository / template scaffolding (gRPC)
│   ├── kafka/              # Kafka topic and access management (gRPC)
│   ├── build-service/      # BuildKit image builds (gRPC)
│   ├── bifrost/            # Multi-tenant Kafka gateway + admin API
│   ├── api-catalog/        # Library only: no entry point, not run
│   └── knowledge/          # Library only: no entry point, not run
│
├── temporal-workflows/     # Go Temporal worker & workflows
├── launches-worker-azure/  # Azure launch worker (TypeScript, Pulumi)
├── proto/                  # Protocol Buffer definitions
├── templates/              # Example templates
├── infrastructure/         # Docker, Kubernetes configs
├── orbit-docs/             # Documentation site
└── docs/                   # Documentation & plans
    └── plans/              # Implementation plans
```

Each Go service follows clean architecture: `cmd/` for entry points, `internal/domain/` for business logic, and `internal/grpc/` for the API layer.

## 🤝 Contributing

We welcome contributions! Here's how to get started:

1. **Fork the repository** and create a feature branch
2. **Follow existing patterns** - check similar code in the codebase for conventions
3. **Write tests** - Go services target 90% coverage; frontend uses Vitest
4. **Run checks before submitting**:
   ```bash
   make lint    # Lint all code
   make test    # Run all tests
   ```
5. **Submit a pull request** with a clear description of changes

### Coding Standards

- **Go**: Follow standard Go conventions; `golangci-lint` enforces style
- **TypeScript**: ESLint + Prettier; strict mode enabled
- **Commits**: Clear, descriptive messages; reference issues when applicable
- **PRs**: Include context on what and why; keep changes focused

### Getting Help

- Open an issue for bugs or feature requests
- Check existing issues and docs/plans/ for context on ongoing work

## 📄 License

This project is licensed under the Elastic License 2.0 - see the [LICENSE](./LICENSE) file for details.
