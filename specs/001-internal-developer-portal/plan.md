
# Implementation Plan: Internal Developer Portal (IDP)

**Branch**: `001-internal-developer-portal/`

**Spec**: [spec.md](./spec.md)                     

**Input**: Feature specification from `/specs/001-internal-developer-portal/spec.md`

## Execution Flow (/plan command scope)
```
1. Load feature spec from Input path
   → If not found: ERROR "No feature spec at {path}"
2. Fill Technical Context (scan for NEEDS CLARIFICATION)
   → Detect Project Type from file system structure or context (web=frontend+backend, mobile=app+api)
   → Set Structure Decision based on project type
3. Fill the Constitution Check section based on the content of the constitution document.
4. Evaluate Constitution Check section below
   → If violations exist: Document in Complexity Tracking
   → If no justification possible: ERROR "Simplify approach first"
   → Update Progress Tracking: Initial Constitution Check
5. Execute Phase 0 → research.md
   → If NEEDS CLARIFICATION remain: ERROR "Resolve unknowns"
6. Execute Phase 1 → contracts, data-model.md, quickstart.md, agent-specific template file (e.g., `CLAUDE.md` for Claude Code, `.github/copilot-instructions.md` for GitHub Copilot, `GEMINI.md` for Gemini CLI, `QWEN.md` for Qwen Code or `AGENTS.md` for opencode).
7. Re-evaluate Constitution Check section
   → If new violations: Refactor design, return to Phase 1
   → Update Progress Tracking: Post-Design Constitution Check
8. Plan Phase 2 → Describe task generation approach (DO NOT create tasks.md)
9. STOP - Ready for /tasks command
```

**IMPORTANT**: The /plan command STOPS at step 7. Phases 2-4 are executed by other commands:
- Phase 2: /tasks command creates tasks.md
- Phase 3-4: Implementation execution (manual or via tools)

## Summary
Internal Developer Portal (IDP) is a multi-tenant SaaS platform that serves as a centralized hub for developer productivity, infrastructure management, and service collaboration. The platform enables teams to create repositories from templates, manage API schemas with automatic code generation, and maintain collaborative documentation spaces. Core capabilities include Git integration (GitHub/GitLab), OAuth authentication, role-based access control, and real-time collaborative editing. Performance requirements include 200ms p95 API responses, 30-second code generation, and support for 500 concurrent users per workspace.

## Technical Context
**Language/Version**: Go 1.21+ (backend services), TypeScript/Node.js 18+ (Payload frontend), Python 3.11+ (optional tooling)
**Primary Dependencies**: Payload 3.0 with NextJS 15 integration, PostgreSQL, Redis, Temporal, Pulumi, Docker, Kubernetes
**Storage**: PostgreSQL 15+ (primary), SQLite (Payload development), Redis (cache), MinIO/S3 (object storage), Git repositories
**Testing**: Go testing, Vitest (frontend), Playwright (e2e), Artillery (load testing), Temporal workflow testing
**Target Platform**: Linux containers, Kubernetes, Docker Compose (development)
**Project Type**: web - Multi-service web application with Payload CMS frontend and multiple backend services
**Communication Patterns**:
  - Temporal workflows for IDP operations (repository generation, code generation, infrastructure provisioning)
  - HTTP REST APIs for CRUD operations (knowledge management, catalog browsing, search)
  - Protocol Buffers for type-safe contracts across both patterns
**Performance Goals**: 200ms p95 API responses, 30s code generation, 1s search results, 500 concurrent users per workspace
**Constraints**: <200ms p95 API responses, <100ms auth operations, <512MB memory per service, TLS 1.3 required
**Scale/Scope**: 500 concurrent users per workspace, 10,000 files per repository sync, multi-tenant architecture

## Constitution Check
*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Code Quality Standards**: 
- [x] Architecture follows established patterns and principles
- [x] Static analysis tools configured for chosen technology stack
- [x] Code review process defined with quality criteria
- [x] Documentation standards established

**Test-First Development**:
- [x] TDD approach planned with test framework selection
- [x] Test coverage targets defined (90% business logic, 80% overall)
- [x] Integration test strategy for all API endpoints planned
- [x] Test automation pipeline designed

**User Experience Consistency**:
- [x] UI/UX patterns defined and documented
- [x] Error handling and messaging standards established
- [x] Accessibility requirements (WCAG 2.1 AA) planned
- [x] User feedback collection mechanisms designed

**Performance Requirements**:
- [x] Response time targets defined (200ms p95, 100ms auth)
- [x] Load testing strategy planned (10,000 concurrent users)
- [x] Caching strategy designed for frequently accessed data
- [x] Performance monitoring and alerting planned

**Security & Compliance**:
- [x] Authentication and authorization architecture defined
- [x] Security headers and OWASP guidelines implementation planned
- [x] Audit logging requirements specified
- [x] Data protection compliance requirements addressed

## Project Structure

### Documentation (this feature)
```
specs/[###-feature]/
├── plan.md              # This file (/plan command output)
├── research.md          # Phase 0 output (/plan command)
├── data-model.md        # Phase 1 output (/plan command)
├── quickstart.md        # Phase 1 output (/plan command)
├── contracts/           # Phase 1 output (/plan command)
└── tasks.md             # Phase 2 output (/tasks command - NOT created by /plan)
```

### Source Code (repository root)
```
# Payload 3.0 Application with integrated NextJS
orbit-www/
├── src/
│   ├── app/
│   │   ├── (frontend)/     # Public frontend pages
│   │   ├── (payload)/      # Payload admin interface
│   │   ├── workspaces/
│   │   ├── repositories/
│   │   ├── api-catalog/
│   │   └── knowledge/
│   ├── components/
│   │   ├── ui/             # UI components
│   │   └── features/       # Feature-specific components
│   ├── lib/
│   │   ├── temporal/       # Temporal client configuration
│   │   └── payload/        # PayloadCMS configuration
│   ├── collections/        # PayloadCMS collections (Users, Media)
│   └── payload.config.ts   # Payload configuration
└── tests/

services/
├── repository/              # Go Repository Service
│   ├── cmd/server/
│   ├── internal/
│   │   ├── api/
│   │   ├── domain/
│   │   ├── service/
│   │   └── temporal/       # Temporal workers and activities
│   ├── pkg/
│   └── tests/
├── api-catalog/            # Go API Catalog Service
│   ├── cmd/server/
│   ├── internal/
│   │   ├── codegen/
│   │   ├── protobuf/
│   │   ├── storage/
│   │   └── temporal/       # Temporal workers and activities
│   ├── pkg/
│   └── tests/
├── knowledge/              # Go Knowledge Service
│   ├── cmd/server/
│   ├── internal/
│   │   ├── api/
│   │   ├── domain/
│   │   ├── service/
│   │   └── temporal/       # Temporal workers and activities
│   ├── pkg/
│   └── tests/
└── temporal-workflows/      # Temporal Workflow Service
    ├── cmd/worker/
    ├── internal/
    │   ├── workflows/
    │   ├── activities/
    │   └── config/
    ├── pkg/
    └── tests/

proto/                      # Protobuf Definitions
├── idp/
│   ├── repository/v1/
│   ├── catalog/v1/
│   └── knowledge/v1/

infrastructure/
├── docker-compose.yml
├── k8s/
└── terraform/
```

**Structure Decision**: Web application with hybrid communication architecture. Frontend uses Next.js 15 with integrated Payload CMS 3.0 for content management and admin interface. Go backend services implement two communication patterns: (1) Temporal workflows for user-initiated IDP tasks (repository generation, code generation, infrastructure provisioning via Pulumi) with polling-based status updates, and (2) HTTP REST APIs for conventional CRUD operations (knowledge management, catalog browsing, search). Protocol Buffers define type-safe contracts for both communication patterns, generating TypeScript clients for the frontend and Go implementations for the backend.

## Phase 0: Outline & Research
1. **Extract unknowns from Technical Context** above:
   - For each NEEDS CLARIFICATION → research task
   - For each dependency → best practices task
   - For each integration → patterns task

2. **Generate and dispatch research agents**:
   ```
   For each unknown in Technical Context:
     Task: "Research {unknown} for {feature context}"
   For each technology choice:
     Task: "Find best practices for {tech} in {domain}"
   ```

3. **Consolidate findings** in `research.md` using format:
   - Decision: [what was chosen]
   - Rationale: [why chosen]
   - Alternatives considered: [what else evaluated]

**Output**: research.md with all NEEDS CLARIFICATION resolved

## Phase 1: Design & Contracts
*Prerequisites: research.md complete*

1. **Extract entities from feature spec** → `data-model.md`:
   - Entity name, fields, relationships
   - Validation rules from requirements
   - State transitions if applicable

2. **Generate API contracts** from functional requirements:
   - For each user action → endpoint
   - Use standard REST/GraphQL patterns
   - Output OpenAPI/GraphQL schema to `/contracts/`

3. **Generate contract tests** from contracts:
   - One test file per endpoint
   - Assert request/response schemas
   - Tests must fail (no implementation yet)

4. **Extract test scenarios** from user stories:
   - Each story → integration test scenario
   - Quickstart test = story validation steps

5. **Update agent file incrementally** (O(1) operation):
   - Run `.specify/scripts/bash/update-agent-context.sh copilot`
     **IMPORTANT**: Execute it exactly as specified above. Do not add or remove any arguments.
   - If exists: Add only NEW tech from current plan
   - Preserve manual additions between markers
   - Update recent changes (keep last 3)
   - Keep under 150 lines for token efficiency
   - Output to repository root

**Output**: data-model.md, /contracts/*, failing tests, quickstart.md, agent-specific file

## Phase 2: Task Planning Approach
*This section describes what the /tasks command will do - DO NOT execute during /plan*

**Task Generation Strategy**:
- Load `.specify/templates/tasks-template.md` as base
- Generate tasks from Phase 1 design docs (contracts, data model, quickstart)
- Each contract → contract test task [P]
- Each entity → model creation task [P] 
- Each user story → integration test task
- Implementation tasks to make tests pass

**Ordering Strategy**:
- TDD order: Tests before implementation 
- Dependency order: Models before services before UI
- Mark [P] for parallel execution (independent files)

**Estimated Output**: 25-30 numbered, ordered tasks in tasks.md

**IMPORTANT**: This phase is executed by the /tasks command, NOT by /plan

## Phase 3+: Future Implementation
*These phases are beyond the scope of the /plan command*

**Phase 3**: Task execution (/tasks command creates tasks.md)  
**Phase 4**: Implementation (execute tasks.md following constitutional principles)  
**Phase 5**: Validation (run tests, execute quickstart.md, performance validation)

## Complexity Tracking
*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |


## Progress Tracking
*This checklist is updated during execution flow*

**Phase Status**:
- [x] Phase 0: Research complete (/plan command)
- [x] Phase 1: Design complete (/plan command)
- [ ] Phase 2: Task planning complete (/plan command - describe approach only) - READY
- [ ] Phase 3: Tasks generated (/tasks command)
- [ ] Phase 4: Implementation complete
- [ ] Phase 5: Validation passed

**Gate Status**:
- [ ] Initial Constitution Check: PASS
- [ ] Post-Design Constitution Check: PASS
- [ ] All NEEDS CLARIFICATION resolved
- [ ] Complexity deviations documented

---
*Based on Constitution v2.1.1 - See `/memory/constitution.md`*
