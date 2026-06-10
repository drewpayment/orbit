# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Orbit is a multi-tenant SaaS Internal Developer Portal (IDP) that provides centralized repository management, API schema cataloging, and collaborative knowledge sharing. The platform uses a polyglot architecture:

- **Frontend**: Payload 3.0 CMS with Next.js 15 (TypeScript, React 19)
- **Backend Services**: Go 1.21+ microservices communicating via gRPC
- **Workflow Engine**: Temporal for durable, long-running operations
- **Data Layer**: MongoDB (Payload CMS), PostgreSQL (Temporal), Redis (caching), MeiliSearch (search), MinIO/S3 (storage)

## Development Commands

**📘 See [DEV_SETUP.md](./DEV_SETUP.md) for comprehensive development environment setup and troubleshooting.**

### Starting Development

```bash
# Start complete development environment (all services in Docker with HMR)
make dev

# OR: Start infrastructure in Docker, run orbit-www locally (faster iteration)
make dev-local
cd orbit-www && bun run dev
```

### Testing

```bash
# Run all tests (Go + Frontend)
make test

# Run individual test suites
make test-go          # All Go service tests with race detection and coverage
make test-frontend    # Frontend unit tests (Vitest)
make test-e2e         # Playwright E2E tests

# Run tests for a single Go service
cd services/repository && go test -v -race ./...

# Run a single Go test
cd services/repository && go test -v -race -run TestFunctionName ./path/to/package

# Run a single frontend test
cd orbit-www && pnpm exec vitest run path/to/test.spec.ts
```

### Linting & Code Quality

```bash
make lint           # Lint all code (Go + Frontend)
make lint-go        # golangci-lint on all Go services
make lint-frontend  # Next.js ESLint
make security       # Run gosec security scans and pnpm audit
```

### Building

```bash
make build          # Build all services
make clean          # Clean build artifacts and generated files

# Build individual Go services
cd services/repository && go build -o bin/repository ./cmd/server
cd services/api-catalog && go build -o bin/api-catalog ./cmd/server
cd services/knowledge && go build -o bin/knowledge ./cmd/server
cd temporal-workflows && go build -o bin/worker ./cmd/worker

# Build frontend
cd orbit-www && pnpm build
```

### Protocol Buffers

```bash
make proto-gen      # Generate gRPC code from protobuf definitions (no global tools needed!)
                    # Generates Go code to proto/gen/go
                    # Generates TypeScript code to orbit-www/src/lib/proto
                    # Uses locally installed buf CLI from orbit-www/node_modules

# Alternative: Run directly from frontend
cd orbit-www && bun run generate:proto
```

**Note**: No global installation of `buf` required! The buf CLI is installed as a dev dependency in `orbit-www/package.json`. This ensures consistent versions across all developers and CI/CD environments.

### Docker Commands

```bash
make docker-up      # Start all services with Docker Compose
make docker-down    # Stop all services
make docker-logs    # View service logs
```

### Installing Dependencies

```bash
make install-deps   # Install golangci-lint, gosec, and frontend deps (includes buf CLI)
                    # Note: buf is installed locally via npm, not globally
```

## Architecture & Code Organization

### Multi-Service Structure

The repository is organized as a monorepo with distinct services:

```
orbit-www/                 # Payload 3.0 + Next.js 15 frontend
  src/
    app/                   # Next.js app router pages
    collections/           # Payload CMS collections (Users, Media, etc.)
    components/            # React components
    lib/                   # Shared utilities and proto-generated code
    payload.config.ts      # Payload CMS configuration

services/                  # Go microservices (gRPC-based)
  repository/              # Repository management service
  api-catalog/             # API schema catalog service
  knowledge/               # Knowledge management service

  Each service follows Go standard layout:
    cmd/server/            # Main entry point
    internal/              # Private application code
      domain/              # Business logic and entities
      service/             # Service layer implementation
      grpc/                # gRPC server implementations
      api/                 # HTTP API handlers (if needed)
      temporal/            # Temporal workflow/activity implementations
    pkg/                   # Exported packages (if any)
    tests/                 # Integration and E2E tests

temporal-workflows/        # Temporal workflow definitions
  cmd/worker/              # Temporal worker entry point
  internal/                # Workflow and activity implementations
  pkg/                     # Shared workflow utilities

proto/                     # Protocol buffer definitions
  *.proto                  # Service definitions (gRPC)
  gen/go/                  # Generated Go code (gitignored)
  idp/                     # Package organization

infrastructure/            # Deployment and infrastructure configs
  temporal/dynamicconfig/  # Temporal configuration

specs/                     # Feature specifications and requirements
```

### Service Communication Patterns

- **Frontend ↔ Backend**: The frontend uses generated TypeScript clients (Connect-ES) to communicate with Go gRPC services
- **Service ↔ Service**: Go services communicate via gRPC using generated code from `proto/` definitions
- **Long-running operations**: Initiated through Temporal workflows, with progress tracked via workflow queries
- **Inter-service dependencies**: All services are replaceable with local proto module references: `replace github.com/drewpayment/orbit/proto => ../../proto`

### Protocol Buffers Code Generation

When modifying `.proto` files:
1. Update the relevant `.proto` file in the `proto/` directory
2. Run `make proto-gen` to regenerate both Go and TypeScript code
3. The generated code will be placed in:
   - Go: `proto/gen/go/` (used by Go services via the proto module)
   - TypeScript: `orbit-www/src/lib/proto/` (used by the frontend)

### Go Services Architecture

Each Go service follows a clean architecture pattern:
- **domain/**: Domain entities and business rules (no external dependencies)
- **service/**: Business logic implementation, coordinates between layers
- **grpc/**: gRPC server implementation, handles request/response translation
- **temporal/**: Temporal workflows and activities for async operations
- **api/**: HTTP API handlers (if the service needs REST endpoints)

### Temporal Workflows

Temporal is used for:
- Long-running repository operations (cloning, syncing, code generation)
- Distributed transactions across services
- Background jobs with reliability guarantees
- Progress tracking for user-facing operations

The Temporal server runs on port 7233, with the UI on port 8080.

### Frontend (orbit-www)

- Built on **Payload 3.0** with Next.js 15 (App Router)
- Uses MongoDB for data storage (via Payload's MongoDB adapter)
- Payload collections define the CMS data model
- Uses generated TypeScript clients to call backend gRPC services
- Testing: Vitest for unit/integration tests, Playwright for E2E

### Database & Migrations

- **Payload CMS database**: MongoDB (runs on port 27017 via Docker)
- **Temporal database**: PostgreSQL (port 5432)
- **Go services**: Each service manages its own database schema (migrations TBD based on future implementation)

### Testing Strategy

- **Go services**: Table-driven tests with `testify`, race detection enabled, 90% coverage target
- **Frontend**: Vitest for component/integration tests, Playwright for E2E
- **Contract tests**: Validate gRPC service contracts (see `contract-tests-summary.md`)
- **Integration tests**: Validate service interactions (see `integration-tests-summary.md`)

## Development Workflow

These engineering practices are expected for all non-trivial work in this repo.

### Before implementing
- **Brainstorm first.** Refine rough ideas — explore alternatives, and validate
  requirements and assumptions through dialog — before committing to an approach.
- **Write a plan.** For multi-step work, capture a plan in
  `docs/plans/###-feature-name.md` with exact file paths and verification steps
  (automated + manual) before touching code. Reference `.agent/SOPs/` and
  `.agent/system/` docs for established procedures.

### While implementing
- **Test-driven development.** Write the test FIRST, watch it FAIL, then write the
  minimal code to pass, and refactor. A test you never saw fail isn't proven to
  verify anything.
- **Systematic debugging.** For any bug, test failure, or unexpected behavior, find
  the root cause before proposing a fix: investigate (instrument if needed),
  analyze whether it's systemic, test the hypothesis, then fix with confidence.
  Understand before fixing.

### Before calling work done
- **Code review.** Review significant changes against the plan and project standards
  — quality, security, performance — before considering them complete.
- **Verify before claiming.** Run the actual verification commands and confirm the
  output before asserting anything is done, fixed, or passing. Check authorship
  before amending commits. Evidence before assertions, always.

### agent-browser UI verification
- **When**: After ANY code change that impacts the UI/UX of the application
- **How**: Use Skill tool: `agent-browser`
- **Purpose**:
  - Verifies UI changes work correctly in a real browser
  - Tests user flows end-to-end (navigation, form submission, data persistence)
  - Catches visual regressions and broken interactions that unit tests miss
- **Process**:
  1. **Pre-flight: check for orphaned sessions.** Before launching agent-browser, run `pgrep -fl "agent-browser-darwin-arm64|agent-browser-chrome-"`. If anything is returned, those are leftover headless Chrome instances from prior sessions — kill them with `pkill -f "agent-browser-darwin-arm64"; pkill -f "agent-browser-chrome-"` and verify with `pgrep` again before continuing. Orphaned sessions keep open EventSource/poll loops against `localhost` dev servers and silently hammer whatever now runs on that port (see incident: orbit-www `/api/agent/.../stream` retry loop hitting an unrelated Payload app on :3000).
  2. Navigate to the affected page(s)
  3. Take screenshots to verify visual state
  4. Interact with changed UI elements (click, fill forms, submit)
  5. Verify the expected outcome (data persisted, page updated, etc.)
  6. **Post-flight: clean up.** Close the agent-browser session explicitly when verification is done. After exiting, re-run the `pgrep` check above to confirm no Chrome-for-Testing processes are left behind. Never leave headless Chrome running between Claude Code sessions.
- **Rule**: If your changes touch UI, you MUST verify with agent-browser before considering the work done
- **Rule**: ALWAYS run the pre-flight orphan check before launching agent-browser, and the post-flight cleanup check after — no exceptions

## Documentation Structure

### docs/plans/ (Active Implementation Plans)
Implementation plans:
- Comprehensive feature plans with exact file paths
- Bite-sized tasks with verification steps
- Updated during implementation as work progresses
- **Read FIRST** before implementing any planned feature

### .agent/ (Architectural Context)
System architecture and established patterns:
- **system/**: High-level architecture snapshots (project-structure.md, api-architecture.md)
- **SOPs/**: Standard procedures and conventions
- **tasks/**: Completed feature summaries for reference
- **README.md**: Navigation guide and workflow integration

### specs/ (ARCHIVED)
Historical planning artifacts from an earlier planning workflow. See `specs/README.md` for details.
**Current planning**: Use `docs/plans/` directory exclusively.

## Workflow Example

```
1. User: "Add Temporal workflow for repository cloning"

2. Brainstorm the design — clarify requirements, explore alternatives, and
   validate assumptions until the approach is clear.

3. Write a plan in docs/plans/002-repository-cloning-workflow.md — task
   breakdown with exact file paths and verification steps.

4. Implementation:
   - Follow the plan; reference .agent/SOPs/adding-grpc-services.md for procedures
   - Test-driven: write tests first, watch them fail, then implement
   - Track active tasks as you go

5. Review and verify:
   - Review the change against the plan and project standards
   - Run the verification commands and confirm output before claiming done

6. Documentation:
   - Update docs/plans/002-*.md with the actual implementation
   - Add a summary under .agent/tasks/ if useful
```

## Common Patterns

### Adding a New Go Service

1. Create service directory under `services/`
2. Initialize Go module: `go mod init github.com/drewpayment/orbit/services/[name]`
3. Add proto module replace: `replace github.com/drewpayment/orbit/proto => ../../proto`
4. Follow standard layout: `cmd/server/`, `internal/`, `pkg/`, `tests/`
5. Update `Makefile` to include new service in build/test/lint targets
6. Update `docker-compose.yml` if service needs containerization

### Adding a New Protobuf Service

1. Create or update `.proto` file in `proto/`
2. Run `make proto-gen` to generate code
3. Implement the service in the relevant Go service's `internal/grpc/` directory
4. Update frontend to use generated TypeScript client from `orbit-www/src/lib/proto/`

### Working with Temporal Workflows

- Workflow definitions live in `temporal-workflows/internal/`
- Activities should be idempotent and handle retries gracefully
- Use workflow queries for progress tracking
- Test workflows using Temporal's test framework

## Git Workflow

- **NEVER push directly to `main`**. All work must be done on a feature branch and submitted as a pull request.
- Create a descriptively named feature branch (e.g., `fix/workspace-mock-data`, `feat/template-instantiation`) before committing.
- Push the feature branch to the remote and open a PR targeting `main`.
- If you are already on `main` with uncommitted changes, create a new branch first before committing.

## Important Notes

- **Package management**: Frontend uses `pnpm`, Go uses `go mod`
- **Environment variables**: Check `.env` files (not in repo) for local configuration
- **Ports**:
  - 3000: Frontend (Next.js)
  - 5050: Orbit Container Registry
  - 5432: Temporal PostgreSQL
  - 6379: Redis
  - 27017: MongoDB (Payload CMS)
  - 7233: Temporal gRPC
  - 8080: Temporal UI
  - 8083: Redpanda Console
  - 9000: MinIO API
  - 9001: MinIO Console
  - 9200: Elasticsearch (Temporal)
  - 19092: Kafka/Redpanda API
- **Node version**: Requires Node.js 18.20.2+ or 20.9.0+
- **Go version**: Requires Go 1.21+

## License

Elastic License 2.0