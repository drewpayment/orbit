<p align="center">
  <img src="assets/orbit_master.png" alt="Orbit Logo" width="400">
</p>

# Orbit

An Internal Developer Portal (IDP) that gives platform teams self-service infrastructure while maintaining governance. Orbit centralizes repository management, application lifecycle tracking, API/schema cataloging, Kafka self-service, and collaborative documentation.

## What Problem Does Orbit Solve?

Platform teams face a common challenge: developers need fast, autonomous access to infrastructure (repos, deployments, Kafka topics, documentation), but without guardrails this leads to sprawl, inconsistency, and lost context.

Orbit bridges this gap by providing:

- **Self-service with guardrails** - Teams provision resources autonomously within policy boundaries
- **Lineage tracking** - Every deployed application traces back to its origin template
- **Unified catalog** - Single pane of glass for services, APIs, topics, and docs across your organization
- **GitOps-ready** - Designed for `.orbit.yaml` manifest sync between UI and repositories (coming soon)

## ✨ Key Features

### 🏗️ Repository & Template Management
Create new services from organization-approved templates with automated configuration. Templates generate repositories with CI/CD pipelines, Kubernetes manifests, and documentation pre-configured. Track which template spawned each service for consistent updates across your fleet.

### 📦 Application Lifecycle Catalog
End-to-end tracking from template instantiation through deployment to production. The catalog provides card grid and visual graph views showing application lineage, deployment status, and live health monitoring. Pluggable deployment generators support Terraform, Helm, and Docker Compose.

### 🔄 Kafka Self-Service (Project Bifrost)
Self-service Kafka access with virtual clusters per application/environment. Teams get autonomous topic creation, schema management, and consumer group tracking while platform admins maintain governance through quotas and approval workflows. The Bifrost gateway handles multi-tenant routing, authentication, and policy enforcement.

### 📚 Knowledge Management
Collaborative documentation with hierarchical knowledge spaces per workspace. Real-time editing, full-text search via MeiliSearch, and fine-grained access control. Organize runbooks, architecture docs, and team knowledge in one place.

### ⚡ Workflow Orchestration
Durable execution for long-running operations via Temporal. Repository cloning, code generation, deployments, and health monitoring run as reliable workflows with progress tracking, automatic retries, and visibility into every step.

### 🔐 Multi-Tenant Architecture
Workspace-level isolation with row-level security. Each workspace gets its own resources, permissions, and quotas. OAuth 2.0 integration with GitHub, Google, and Azure AD.

### 🧊 Frozen Capabilities
Per the product focus strategy (`docs/plans/2026-06-09-product-focus-strategy.md`), two
capabilities remain functional but accept no new feature work:

- **Container Registry** (port 5050, `/api/registry/token`, `RegistryConfigs`/`RegistryImages`
  collections) — GHCR/ACR cover this; the built-in registry stays as-is.
- **Health Monitoring** (`HealthChecks` collection, `health_check_workflow.go`, catalog
  health badges) — SLO/alerting belongs to dedicated observability tooling; only the
  catalog badge is maintained.

Cloud launches are **Azure and DigitalOcean only** — the AWS and GCP workers were removed
(last present at git tag `archive/pre-strip-2026-06-10`).

## 🏛️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Orbit Platform                          │
├─────────────────────────────────────────────────────────────────┤
│  Frontend                                                       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Payload CMS 3.0 + Next.js 15 (TypeScript, React 19)    │   │
│  │  • Admin UI & Public Pages                               │   │
│  │  • Content Management                                    │   │
│  │  • Temporal Workflow Management                          │   │
│  └─────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│  Backend Services (Go 1.21+)                                    │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐            │
│  │  Repository  │ │  API Catalog │ │  Knowledge   │            │
│  │   Service    │ │   Service    │ │   Service    │            │
│  └──────────────┘ └──────────────┘ └──────────────┘            │
│  ┌──────────────┐ ┌──────────────────────────────┐             │
│  │   Temporal   │ │      Bifrost Gateway         │             │
│  │   Workers    │ │   (Kafka Multi-Tenant)       │             │
│  └──────────────┘ └──────────────────────────────┘             │
├─────────────────────────────────────────────────────────────────┤
│  Data Layer                                                     │
│  ┌────────┐ ┌───────┐ ┌────────────┐ ┌─────────┐ ┌──────────┐ │
│  │Postgres│ │ Redis │ │ MeiliSearch│ │ MinIO/S3│ │ Redpanda │ │
│  └────────┘ └───────┘ └────────────┘ └─────────┘ └──────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### Tech Stack Summary

| Layer | Technology |
|-------|------------|
| Frontend | Payload CMS 3.0, Next.js 15, TypeScript, React 19 |
| Backend | Go 1.21+ microservices, gRPC (Protocol Buffers) |
| Workflows | Temporal for durable execution |
| Database | PostgreSQL (prod), SQLite (dev), MongoDB (Payload) |
| Caching | Redis |
| Search | MeiliSearch |
| Storage | MinIO / S3 |
| Messaging | Redpanda (Kafka-compatible) |

## 🚀 Getting Started

### Prerequisites

- Docker and Docker Compose
- Node.js 18.20.2+ or 20.9.0+
- Go 1.21+
- [Bun](https://bun.sh/) (for frontend)

### Quick Start

Clone the repository:

```bash
git clone git@github.com:drewpayment/orbit.git
cd orbit
```

**Option A: Hybrid Setup (Recommended)**

Run infrastructure in Docker, frontend locally for faster hot-reload:

```bash
# Start infrastructure (Postgres, Redis, Temporal, Redpanda, etc.)
make dev-local

# In another terminal, start the frontend
cd orbit-www && bun run dev
```

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
# Run all tests
make test

# Lint code
make lint

# Generate protobuf code
make proto-gen

# View all available commands
make help
```

### Environment Setup

Copy the example environment file and configure:

```bash
cp orbit-www/.env.example orbit-www/.env
```

Key variables to configure:
- `DATABASE_URI` - MongoDB connection string
- `PAYLOAD_SECRET` - Secret for Payload CMS
- GitHub App credentials (for repository integration)

See [DEV_SETUP.md](./DEV_SETUP.md) for complete environment configuration, troubleshooting, and Kafka setup instructions.

## 📁 Project Structure

```
orbit/
├── orbit-www/              # Payload CMS + Next.js frontend
│   ├── src/
│   │   ├── app/            # Next.js App Router pages
│   │   ├── collections/    # Payload CMS collections
│   │   ├── components/     # React components
│   │   └── lib/            # Utilities & generated proto clients
│   └── payload.config.ts
│
├── services/               # Go microservices
│   ├── repository/         # Repository management
│   ├── api-catalog/        # API schema catalog
│   └── knowledge/          # Knowledge management
│
├── temporal-workflows/     # Temporal worker & workflows
│   ├── cmd/worker/         # Worker entry point
│   └── internal/           # Workflow implementations
│
├── proto/                  # Protocol Buffer definitions
│   └── gen/go/             # Generated Go code
│
├── infrastructure/         # Docker, Kubernetes configs
│
└── docs/                   # Documentation & plans
    └── plans/              # Implementation plans
```

Each Go service follows clean architecture: `cmd/` for entry points, `internal/domain/` for business logic, `internal/grpc/` for API layer, and `internal/temporal/` for workflow activities.

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
