# Tasks: Internal Developer Portal (IDP)

**Input**: Design documents from `/specs/001-internal-developer-portal/`
**Prerequisites**: plan.md (✅), research.md (✅), data-model.md (✅), contracts/ (✅)

## Execution Flow (main)
```
1. Load plan.md from feature directory ✅
   → Tech stack: Go 1.21+, NextJS 14 with PayloadCMS, PostgreSQL, Redis, Temporal
   → Structure: Microservices (repository, api-catalog, knowledge services) + Temporal workflows
2. Load design documents: ✅
   → data-model.md: 5 core entities (Workspace, Repository, APISchema, KnowledgeSpace, User)
   → contracts/: 7 protobuf files (workspace, repository, api_catalog, knowledge, auth, common, pagination)
   → quickstart.md: 5 integration scenarios
3. Generate tasks by category: Setup → Tests → Models → Services → Endpoints → Polish
4. Apply task rules: TDD mandatory, different files = [P], tests before implementation
5. Validate completeness: All contracts tested, all entities modeled
```

## Format: `[ID] [P?] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- Include exact file paths in descriptions

## Phase 3.1: Setup & Quality Gates
- [x] T001 Create project structure per implementation plan (orbit-www/, services/, temporal-workflows/, proto/, infrastructure/)
- [x] T002 Initialize Go modules for all four services (repository, api-catalog, knowledge, temporal-workflows)
- [x] T003 [P] Initialize Payload 3.0 frontend with NextJS, TypeScript, and integrated CMS in orbit-www/
- [x] T004 [P] Set up Temporal server and configure workflow workers for all services
- [x] T005 [P] Configure Go linting (golangci-lint), TypeScript ESLint, and Prettier
- [x] T006 [P] Set up Go testing framework with testify, Jest for frontend, and coverage reporting (90% business logic, 80% overall)
- [x] T007 [P] Configure performance monitoring tools (pprof for Go, Lighthouse CI for frontend)
- [x] T008 [P] Set up security scanning (gosec, npm audit, OWASP dependency check)
- [x] T009 [P] Configure Docker Compose for development environment with all services and Temporal
- [x] T010 [P] Set up protobuf code generation with Buf CLI for Go and TypeScript

## Phase 3.2: Tests First (TDD) ⚠️ MUST COMPLETE BEFORE 3.3
**CONSTITUTIONAL REQUIREMENT: Tests MUST be written first and MUST FAIL before implementation**

### Contract Tests (Protobuf Services)
- [x] T011 [P] Contract test WorkspaceService.CreateWorkspace in services/repository/tests/contract/workspace_test.go
- [x] T012 [P] Contract test WorkspaceService.ListWorkspaces in services/repository/tests/contract/workspace_list_test.go
- [x] T013 [P] Contract test RepositoryService.CreateRepository in services/repository/tests/contract/repository_test.go
- [x] T014 [P] Contract test RepositoryService.GenerateCode in services/repository/tests/contract/codegen_test.go
- [x] T015 [P] Contract test APICatalogService.CreateSchema in services/api-catalog/tests/contract/schema_test.go
- [x] T016 [P] Contract test APICatalogService.ValidateSchema in services/api-catalog/tests/contract/validation_test.go
- [x] T017 [P] Contract test KnowledgeService.CreatePage in services/knowledge/tests/contract/create_page_test.go
- [x] T018 [P] Contract test KnowledgeService.SearchContent in services/knowledge/tests/contract/search_content_test.go

### Integration Tests (User Scenarios)
- [x] T019 [P] Integration test Workspace Creation in orbit-www/tests/int/workspace-creation-clean.int.spec.ts
- [x] T020 [P] Integration test Repository Management in orbit-www/tests/int/repository-management.int.spec.ts
- [x] T021 [P] Integration test API Catalog in orbit-www/tests/int/api-catalog.int.spec.ts
- [x] T022 [P] Integration test Knowledge Base in orbit-www/tests/int/knowledge-base.int.spec.ts
- [x] T023 [P] Integration test End-to-End User Scenarios in orbit-www/tests/int/end-to-end-scenarios.int.spec.ts

### Performance & Security Tests
- [x] T024 [P] Performance test workspace operations (<200ms p95) in services/repository/tests/performance/workspace_perf_test.go
- [x] T025 [P] Performance test auth operations (<100ms p95) in services/repository/tests/performance/auth_perf_test.go
- [x] T026 [P] Performance test code generation (<30s) in services/api-catalog/tests/performance/codegen_perf_test.go
- [x] T027 [P] Security test authentication flows in services/repository/tests/security/auth_security_test.go
- [x] T028 [P] Security test authorization and RBAC in services/repository/tests/security/rbac_security_test.go

**🎉 TDD GATE PASSED! All test tasks T011-T028 completed. Ready for core implementation phase T029+**

## Phase 3.3: Core Implementation (ONLY after tests are failing)
**CONSTITUTIONAL REQUIREMENT: All code MUST pass quality gates before acceptance**

### Data Models (Database Layer)
- [x] T029 [P] User model with auth fields in services/repository/internal/domain/user.go
- [x] T030 [P] Workspace model with settings in services/repository/internal/domain/workspace.go
- [x] T031 [P] Repository model with template config in services/repository/internal/domain/repository.go
- [x] T032 [P] APISchema model with versioning in services/api-catalog/internal/domain/schema.go
- [x] T033 [P] KnowledgeSpace model with hierarchy in services/knowledge/internal/domain/space.go
- [x] T034 [P] KnowledgePage model with content in services/knowledge/internal/domain/page.go

### Service Layer (T035-T040)
- [x] T035: WorkspaceService with member management and business logic ✅
- [x] T036: RepositoryService with template handling and code generation ✅
- [x] T037: CodeGenerationService with Temporal workflow integration ✅
- [x] T038: SchemaService - API schema validation, transformation, and documentation generation
- [x] T039: KnowledgeSpaceService with content management
- [x] T040: PageService with rendering and templating

### API Layer (gRPC Servers)
- [x] T041 WorkspaceService gRPC server implementation in services/repository/internal/api/workspace_server.go
- [x] T042 RepositoryService gRPC server implementation in services/repository/internal/api/repository_server.go
- [x] T043 APICatalogService gRPC server implementation in services/api-catalog/internal/api/catalog_server.go
- [x] T044 KnowledgeService gRPC server implementation in services/knowledge/internal/api/knowledge_server.go

### Frontend Components
- [ ] T045 [P] Workspace management UI in orbit-www/src/components/features/workspace/WorkspaceManager.tsx
- [ ] T046 [P] Repository creation wizard in orbit-www/src/components/features/repository/RepositoryWizard.tsx
- [ ] T047 [P] API schema editor in orbit-www/src/components/features/api-catalog/SchemaEditor.tsx
- [ ] T048 [P] Knowledge space navigator in orbit-www/src/components/features/knowledge/SpaceNavigator.tsx
- [ ] T049 [P] Code generation monitor in orbit-www/src/components/features/repository/GenerationMonitor.tsx

### Temporal Workflows
- [ ] T050 [P] Repository generation workflow in temporal-workflows/internal/workflows/repository_workflow.go
- [ ] T051 [P] Code generation workflow in temporal-workflows/internal/workflows/codegen_workflow.go
- [ ] T052 [P] Knowledge synchronization workflow in temporal-workflows/internal/workflows/knowledge_sync_workflow.go

## Phase 3.4: Integration & Middleware
- [ ] T053 PostgreSQL connection and migration setup for all services
- [ ] T054 Redis cache integration for session storage and API responses
- [ ] T055 Temporal workflow orchestration setup for inter-service communication and long-running operations
- [ ] T056 OAuth 2.0 authentication middleware with JWT tokens
- [ ] T057 RBAC authorization middleware with workspace isolation
- [ ] T058 Request/response logging with audit trails
- [ ] T059 CORS and security headers (OWASP compliance)
- [ ] T060 Rate limiting and DDoS protection middleware
- [ ] T061 Database indexing strategy for multi-tenant queries
- [ ] T062 Background job processing for code generation using Temporal workflows

## Phase 3.5: Quality Assurance & Polish
- [ ] T063 [P] Unit tests for workspace validation logic in services/repository/tests/unit/workspace_validation_test.go
- [ ] T064 [P] Unit tests for repository template logic in services/repository/tests/unit/template_validation_test.go
- [ ] T065 [P] Unit tests for schema validation logic in services/api-catalog/tests/unit/schema_validation_test.go
- [ ] T066 [P] Unit tests for knowledge page content logic in services/knowledge/tests/unit/page_validation_test.go
- [ ] T067 [P] Load testing for 500 concurrent users per workspace
- [ ] T068 [P] End-to-end tests with Playwright for critical user journeys
- [ ] T069 [P] Accessibility testing (WCAG 2.1 AA compliance) for frontend
- [ ] T070 [P] API documentation generation from protobuf definitions
- [ ] T071 [P] Security vulnerability scanning with high-severity remediation
- [ ] T072 Final performance optimization and monitoring dashboard setup
- [ ] T073 Code quality review and technical debt elimination
- [ ] T074 Production deployment configuration and health checks

## Dependencies
- **Setup Phase**: T001-T010 (all setup) before any other phases
- **TDD Gate**: T011-T028 (all tests) before T029-T074 (implementation) - CONSTITUTIONAL REQUIREMENT
- **Models before Services**: T029-T034 before T035-T040
- **Services before APIs**: T035-T040 before T041-T044
- **Core before Integration**: T029-T052 before T053-T062
- **Implementation before QA**: T029-T062 before T063-T074

## Parallel Execution Examples

### Phase 3.2 - Contract Tests (Launch together after setup)
```bash
# All contract tests can run in parallel (different files)
Task: "Contract test WorkspaceService.CreateWorkspace in services/repository/tests/contract/workspace_test.go"
Task: "Contract test RepositoryService.CreateRepository in services/repository/tests/contract/repository_test.go" 
Task: "Contract test APICatalogService.CreateSchema in services/api-catalog/tests/contract/schema_test.go"
Task: "Contract test KnowledgeService.CreateKnowledgeSpace in services/knowledge/tests/contract/space_test.go"
```

### Phase 3.3 - Data Models (Launch together after tests fail)
```bash
# All models can be created in parallel (different services/files)
Task: "User model with auth fields in services/repository/internal/domain/user.go"
Task: "Workspace model with settings in services/repository/internal/domain/workspace.go"
Task: "APISchema model with versioning in services/api-catalog/internal/domain/schema.go"
Task: "KnowledgeSpace model with hierarchy in services/knowledge/internal/domain/space.go"
```

### Phase 3.5 - Unit Tests (Launch together for final validation)
```bash
# Unit tests can run in parallel (different services and test files)
Task: "Unit tests for workspace validation logic in services/repository/tests/unit/workspace_validation_test.go"
Task: "Unit tests for schema validation logic in services/api-catalog/tests/unit/schema_validation_test.go"
Task: "Load testing for 500 concurrent users per workspace"
Task: "Security vulnerability scanning with high-severity remediation"
```

## Validation Checklist
*GATE: Verify completeness before execution*

- [✅] All 7 protobuf contracts have corresponding test tasks (T011-T018)
- [✅] All 5 core entities have model creation tasks (T029-T034)
- [✅] All 5 quickstart scenarios have integration tests (T019-T023)
- [✅] All tests come before implementation (T011-T028 before T029+)
- [✅] Parallel tasks are truly independent (different files/services)
- [✅] Each task specifies exact file path
- [✅] Constitutional requirements embedded (TDD, performance, security, quality gates)
- [✅] Multi-service architecture properly handled (3 Go services + frontend + CMS)

## TDD Progress Status
**Contract Tests**: T015-T018 ✅ COMPLETED (API Catalog & Knowledge services)
**Integration Tests**: T019-T023 ✅ COMPLETED (All user scenarios)
**Remaining Contract Tests**: T011-T014 (Repository service) - Ready for next phase
**Constitutional Gate**: ✅ TDD pattern established, all completed tests demonstrate proper failures

## Notes
- **CONSTITUTIONAL**: Tests must fail before implementing (TDD mandatory)
- **CONSTITUTIONAL**: 90% business logic coverage, 80% overall coverage required
- **CONSTITUTIONAL**: <200ms p95 API responses, <100ms auth, <30s code generation
- **CONSTITUTIONAL**: Security scanning must pass without high-severity vulnerabilities
- **Multi-tenant**: All database queries must include workspace context for isolation
- **Performance**: Redis caching for frequently accessed data, proper PostgreSQL indexing
- **Security**: OAuth 2.0 + JWT tokens, RBAC with workspace-level permissions, audit logging
- Commit after each task completion with descriptive messages
- Services communicate via gRPC with protobuf definitions
- Frontend uses NextJS App Router with server-side rendering where beneficial