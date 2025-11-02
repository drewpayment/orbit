# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Orbit is a multi-tenant SaaS Internal Developer Portal (IDP) that provides centralized repository management, API schema cataloging, and collaborative knowledge sharing. The platform uses a polyglot architecture:

- **Frontend**: Payload 3.0 CMS with Next.js 15 (TypeScript, React 19)
- **Backend Services**: Go 1.21+ microservices communicating via gRPC
- **Workflow Engine**: Temporal for durable, long-running operations
- **Data Layer**: PostgreSQL (production), SQLite (dev), Redis (caching), MeiliSearch (search), MinIO/S3 (storage)

## Development Commands

### Starting Development

```bash
# Start all infrastructure services (Temporal, PostgreSQL, Redis, etc.)
make dev

# Alternative: Start individual services
docker-compose up -d temporal-postgresql temporal-elasticsearch temporal-server temporal-ui postgres redis
cd orbit-www && pnpm dev
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
- Uses SQLite for local development, PostgreSQL for production
- Payload collections define the CMS data model
- Uses generated TypeScript clients to call backend gRPC services
- Testing: Vitest for unit/integration tests, Playwright for E2E

### Database & Migrations

- **Frontend database**: Managed by Payload CMS (migrations handled automatically)
- **Go services**: Each service manages its own database schema (migrations TBD based on future implementation)
- Development uses local PostgreSQL via Docker (ports: 5432 for Temporal, 5433 for application)

### Testing Strategy

- **Go services**: Table-driven tests with `testify`, race detection enabled, 90% coverage target
- **Frontend**: Vitest for component/integration tests, Playwright for E2E
- **Contract tests**: Validate gRPC service contracts (see `contract-tests-summary.md`)
- **Integration tests**: Validate service interactions (see `integration-tests-summary.md`)

## Mandatory Workflows (Constitutional Requirement)

**IMPORTANT**: This project enforces superpowers skills as constitutional requirements. These workflows are MANDATORY and must be followed for all work.

### Pre-Implementation (MANDATORY)

#### brainstorming
- **When**: Before ANY feature work, design decisions, or implementation planning
- **How**: Run `/superpowers:brainstorm [feature description]` or use Skill tool: `superpowers:brainstorming`
- **Purpose**:
  - Refines rough ideas through Socratic questioning
  - Explores alternatives before committing to approach
  - Validates assumptions and requirements through iterative dialog
- **Output**: Fully-formed design ready for implementation planning
- **Rule**: NO IMPLEMENTATION without brainstorming first

#### writing-plans
- **When**: After brainstorming completes and design is validated
- **How**: Run `/superpowers:write-plan` or use Skill tool: `superpowers:writing-plans`
- **Purpose**:
  - Creates comprehensive implementation plans in `docs/plans/[feature].md`
  - Breaks down work into bite-sized tasks with exact file paths
  - Defines verification steps (automated + manual) for each task
  - References `.agent/SOPs/` and `.agent/system/` docs
- **Output**: Implementation plan in `docs/plans/###-feature-name.md`
- **Rule**: NO IMPLEMENTATION without written plan

### During Implementation (MANDATORY)

#### test-driven-development
- **When**: For ALL code changes, no exceptions
- **How**: Follow write-test-first → watch-fail → implement-to-pass cycle
- **Purpose**:
  - Ensures tests actually verify behavior (must see failure first)
  - Constitutional requirement for code quality
  - Prevents writing code without test coverage
- **Process**:
  1. Write test FIRST
  2. Watch it FAIL (required - proves test works)
  3. Write minimal code to pass
  4. Refactor if needed
  5. Repeat
- **Rule**: Write test FIRST, watch it FAIL, then implement
- **See**: `skills/test-driven-development/SKILL.md`

#### systematic-debugging
- **When**: For ANY bug, test failure, or unexpected behavior
- **How**: Use Skill tool: `superpowers:systematic-debugging`
- **Purpose**:
  - Four-phase framework: root cause investigation, pattern analysis, hypothesis testing, implementation
  - Ensures understanding before attempting solutions
  - Prevents guess-and-check debugging
- **Process**:
  1. Root cause investigation (add instrumentation if needed)
  2. Pattern analysis (is this systemic?)
  3. Hypothesis testing (verify assumptions)
  4. Implementation (fix with confidence)
- **Rule**: Understand BEFORE fixing
- **See**: `skills/systematic-debugging/SKILL.md`

### Post-Implementation (MANDATORY)

#### code-reviewer
- **When**: After completing significant code changes, before considering work "done"
- **How**: Use Skill tool: `superpowers:code-reviewer` (launches subagent)
- **Purpose**:
  - Reviews implementation against plan and coding standards
  - Validates quality, security, performance, and project standards
  - Must pass before work is considered complete
- **Rule**: Must pass review before proceeding to next task
- **See**: `skills/code-reviewer/SKILL.md`

#### verification-before-completion
- **When**: Before claiming any work is done/fixed/passing, before commits/PRs
- **How**: Use Skill tool: `superpowers:verification-before-completion`
- **Purpose**:
  - Requires running actual verification commands
  - Confirms output before making success claims
  - Checks authorship before amending commits
  - Prevents false "it works" claims
- **Rule**: Evidence before assertions, always
- **See**: `skills/verification-before-completion/SKILL.md`

### Supporting Skills (Use When Applicable)

- **dispatching-parallel-agents**: For 3+ independent failures/tasks
- **root-cause-tracing**: For bugs deep in execution requiring systematic backtracing
- **defense-in-depth**: For validation across multiple system layers
- **finishing-a-development-branch**: When implementation complete and ready to integrate
- **receiving-code-review**: When receiving external code review feedback
- **condition-based-waiting**: For tests with race conditions or timing dependencies

## Documentation Structure

### docs/plans/ (Active Implementation Plans)
Implementation plans created by `/superpowers:write-plan`:
- Comprehensive feature plans with exact file paths
- Bite-sized tasks with verification steps
- Updated during implementation as work progresses
- **Read FIRST** before implementing any planned feature

### .agent/ (Architectural Context)
System architecture and established patterns:
- **system/**: High-level architecture snapshots (project-structure.md, api-architecture.md)
- **SOPs/**: Standard procedures that reference superpowers skills
- **tasks/**: Completed feature summaries for reference
- **README.md**: Navigation guide and workflow integration

### specs/ (ARCHIVED)
Historical planning artifacts from pre-superpowers workflow. See `specs/README.md` for details.
**Current planning**: Use `docs/plans/` directory exclusively.

## Workflow Example

```
1. User: "Add Temporal workflow for repository cloning"

2. Claude: Runs /superpowers:brainstorm
   - Clarifies requirements through Socratic dialog
   - Explores design alternatives
   - Validates assumptions
   - Output: Refined design

3. Claude: Runs /superpowers:write-plan
   - Creates docs/plans/002-repository-cloning-workflow.md
   - Breaks down into tasks with file paths
   - Defines verification steps

4. Implementation:
   - Read plan from docs/plans/002-repository-cloning-workflow.md
   - Reference .agent/SOPs/adding-grpc-services.md for procedures
   - Follow superpowers:test-driven-development (tests first)
   - Use TodoWrite to track active tasks

5. Review:
   - Run superpowers:code-reviewer before completion
   - Run superpowers:verification-before-completion

6. Documentation:
   - Update docs/plans/002-*.md with actual implementation
   - Create summary: /update doc save task repository-cloning
   - Summary saved to .agent/tasks/feature-repository-cloning.md
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

## Important Notes

- **Package management**: Frontend uses `pnpm`, Go uses `go mod`
- **Environment variables**: Check `.env` files (not in repo) for local configuration
- **Ports**:
  - 3000: Frontend (Next.js)
  - 5432: Temporal PostgreSQL
  - 5433: Application PostgreSQL
  - 6379: Redis
  - 7233: Temporal gRPC
  - 8080: Temporal UI
  - 9200: Elasticsearch (Temporal)
- **Node version**: Requires Node.js 18.20.2+ or 20.9.0+
- **Go version**: Requires Go 1.21+

## License

Elastic License 2.0