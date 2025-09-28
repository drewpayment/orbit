# Tasks: [FEATURE NAME]

**Input**: Design documents from `/specs/[###-feature-name]/`
**Prerequisites**: plan.md (required), research.md, data-model.md, contracts/

## Execution Flow (main)
```
1. Load plan.md from feature directory
   → If not found: ERROR "No implementation plan found"
   → Extract: tech stack, libraries, structure
2. Load optional design documents:
   → data-model.md: Extract entities → model tasks
   → contracts/: Each file → contract test task
   → research.md: Extract decisions → setup tasks
3. Generate tasks by category:
   → Setup: project init, dependencies, linting
   → Tests: contract tests, integration tests
   → Core: models, services, CLI commands
   → Integration: DB, middleware, logging
   → Polish: unit tests, performance, docs
4. Apply task rules:
   → Different files = mark [P] for parallel
   → Same file = sequential (no [P])
   → Tests before implementation (TDD)
5. Number tasks sequentially (T001, T002...)
6. Generate dependency graph
7. Create parallel execution examples
8. Validate task completeness:
   → All contracts have tests?
   → All entities have models?
   → All endpoints implemented?
9. Return: SUCCESS (tasks ready for execution)
```

## Format: `[ID] [P?] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- Include exact file paths in descriptions

## Path Conventions
- **Single project**: `src/`, `tests/` at repository root
- **Web app**: `backend/src/`, `frontend/src/`
- **Mobile**: `api/src/`, `ios/src/` or `android/src/`
- Paths shown below assume single project - adjust based on plan.md structure

## Phase 3.1: Setup & Quality Gates
- [ ] T001 Create project structure per implementation plan
- [ ] T002 Initialize [language] project with [framework] dependencies
- [ ] T003 [P] Configure code quality tools (linting, formatting, static analysis)
- [ ] T004 [P] Configure test framework and coverage reporting (target: 90% business, 80% overall)
- [ ] T005 [P] Set up performance monitoring and benchmarking tools
- [ ] T006 [P] Configure security scanning and vulnerability checks

## Phase 3.2: Tests First (TDD) ⚠️ MUST COMPLETE BEFORE 3.3
**CONSTITUTIONAL REQUIREMENT: Tests MUST be written first and MUST FAIL before implementation**
- [ ] T007 [P] Contract test POST /api/users in tests/contract/test_users_post.py
- [ ] T008 [P] Contract test GET /api/users/{id} in tests/contract/test_users_get.py
- [ ] T009 [P] Integration test user registration in tests/integration/test_registration.py
- [ ] T010 [P] Integration test auth flow in tests/integration/test_auth.py
- [ ] T011 [P] Performance test auth operations (<100ms p95) in tests/performance/test_auth_performance.py
- [ ] T012 [P] Security test authentication flows in tests/security/test_auth_security.py

## Phase 3.3: Core Implementation (ONLY after tests are failing)
**CONSTITUTIONAL REQUIREMENT: All code MUST pass quality gates before acceptance**
- [ ] T013 [P] User model in src/models/user.py (with comprehensive documentation)
- [ ] T014 [P] UserService CRUD in src/services/user_service.py (with error handling)
- [ ] T015 [P] CLI --create-user in src/cli/user_commands.py (with input validation)
- [ ] T016 POST /api/users endpoint (with security headers and audit logging)
- [ ] T017 GET /api/users/{id} endpoint (with proper caching and performance optimization)
- [ ] T018 Input validation middleware (user-friendly error messages)
- [ ] T019 Comprehensive error handling and audit logging

## Phase 3.4: Integration & Security
- [ ] T020 Connect UserService to DB with optimized queries and indexing
- [ ] T021 Auth middleware with security headers (OWASP compliance)
- [ ] T022 Request/response logging with audit trail
- [ ] T023 CORS and comprehensive security headers
- [ ] T024 Caching layer for frequently accessed data
- [ ] T025 Rate limiting and DDoS protection

## Phase 3.5: Quality Assurance & Polish
- [ ] T026 [P] Unit tests for all validation logic in tests/unit/test_validation.py
- [ ] T027 [P] Performance tests verify <200ms p95 response times
- [ ] T028 [P] Load testing for 10,000 concurrent users
- [ ] T029 [P] Accessibility testing (WCAG 2.1 AA compliance)
- [ ] T030 [P] Update API documentation with security considerations
- [ ] T031 Code quality review and refactoring (eliminate duplication)
- [ ] T032 Security vulnerability scan and remediation
- [ ] T033 Final performance optimization and monitoring setup

## Dependencies
- Quality Gates Setup (T001-T006) before Tests (T007-T012)
- Tests (T007-T012) before implementation (T013-T019) - CONSTITUTIONAL REQUIREMENT
- T013 blocks T014, T020
- T021 blocks T023, T024
- Integration (T020-T025) before QA (T026-T033)
- All implementation before quality assurance and polish (T026-T033)

## Parallel Example
```
# Launch T007-T012 together (Test First):
Task: "Contract test POST /api/users in tests/contract/test_users_post.py"
Task: "Contract test GET /api/users/{id} in tests/contract/test_users_get.py"
Task: "Integration test registration in tests/integration/test_registration.py"
Task: "Integration test auth in tests/integration/test_auth.py"
Task: "Performance test auth operations in tests/performance/test_auth_performance.py"
Task: "Security test authentication flows in tests/security/test_auth_security.py"
```

## Notes
- [P] tasks = different files, no dependencies
- CONSTITUTIONAL: Verify tests fail before implementing (TDD mandatory)
- CONSTITUTIONAL: All code must pass quality gates (90% coverage business logic, 80% overall)
- CONSTITUTIONAL: Performance targets must be met (<200ms p95, <100ms auth)
- CONSTITUTIONAL: Security scanning must pass without high-severity vulnerabilities
- Commit after each task with descriptive messages
- Avoid: vague tasks, same file conflicts, skipping quality checks

## Task Generation Rules
*Applied during main() execution*

1. **From Contracts**:
   - Each contract file → contract test task [P]
   - Each endpoint → implementation task
   
2. **From Data Model**:
   - Each entity → model creation task [P]
   - Relationships → service layer tasks
   
3. **From User Stories**:
   - Each story → integration test [P]
   - Quickstart scenarios → validation tasks

4. **Ordering**:
   - Setup → Tests → Models → Services → Endpoints → Polish
   - Dependencies block parallel execution

## Validation Checklist
*GATE: Checked by main() before returning*

- [ ] All contracts have corresponding tests
- [ ] All entities have model tasks
- [ ] All tests come before implementation
- [ ] Parallel tasks truly independent
- [ ] Each task specifies exact file path
- [ ] No task modifies same file as another [P] task