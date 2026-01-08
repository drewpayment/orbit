# Current Plan: Project Bifrost Phase 3

## Overview

**Project**: Bifrost - Kafka Gateway Self-Service
**Phase**: Phase 3 - Policies, Callbacks, Topics UI
**Status**: Implementation Complete, Docker Setup In Progress

## Design & Plan References

- **Original Design Specification**: `docs/plans/2026-01-03-kafka-proxy-design.md`
  - Defines the overall Bifrost architecture: Layer 7 Kafka protocol proxy using Kroxylicious
  - Covers multi-tenancy, virtualization, governance, encryption, and migration features
  - Establishes the 4-phase roadmap this work follows

- **Phase 3 Implementation Plan**: `docs/plans/2026-01-06-bifrost-phase3-implementation.md`
  - Detailed task breakdown for self-service topic management
  - Policy enforcement, callback services, and frontend UI

## Completed Tasks

### Part A: Proto & Gateway Filters ✅

| Task | Description | Commit |
|------|-------------|--------|
| Task 1 | Proto definitions for policies and callbacks | `854edf0` |
| Task 2 | PolicyStore and PolicyConfig in Bifrost | `29a6c2f` |
| Task 3 | PolicyEnforcementFilter for CreateTopics validation | `6487b95` |
| Task 4 | Policy management RPCs in BifrostAdminServiceImpl | `9652bc6` |
| Task 5 | Register PolicyEnforcementFilter in filter chain | `14d6a1b` |

### Part B: Callback Service & Temporal Workflows ✅

| Task | Description | Commit |
|------|-------------|--------|
| Task 6 | Go Callback Service (bifrost-callback) | `25be358` |
| Task 7 | TopicCreatedSyncWorkflow | `caec4ca` |
| Task 8 | TopicDeletedSyncWorkflow | `caec4ca` |
| Task 9 | Register workflows in Temporal worker | `83f878f` |

### Part C: Frontend - Collections, Server Actions & Topics UI ✅

| Task | Description | Commit |
|------|-------------|--------|
| Task 10 | Extend KafkaTopics Collection | `f685816` |
| Task 11 | Create Topic Server Actions | `0fed822` |
| Task 12 | Create Topics Panel Component | `e9341ed` |
| Task 13 | Create Topic Dialog Component | `e9341ed` |
| Task 14 | Add formatDuration utility | `e9341ed` |
| Task 15 | Integration - Wire up Topics UI | `cf4738f` |

### Docker Setup (In Progress)

| Task | Description | Status |
|------|-------------|--------|
| bifrost-callback Dockerfile | Go service containerization | ✅ Complete |
| bifrost-callback in docker-compose | Service configuration | ✅ Complete |
| bifrost (Kotlin gateway) build | Fix compilation errors | 🔄 In Progress |

## Current Work

### Last Completed Task
**Task 15**: Integration - Wire up Topics UI to Virtual Cluster Page

### Current Focus
**Docker Setup**: Fixing Bifrost gateway (Kotlin/Java) compilation errors

The Bifrost gateway has compilation errors related to:
1. Proto import mismatches (`idp.gateway.v1` vs `io.orbit.bifrost.proto`)
2. Type mismatches (Short vs Int) in Kafka API key comparisons
3. Typo in `CreateableTopicConfig` class name

The `bifrost-callback` Go service is running successfully in Docker.

## Key Files Modified in Phase 3

### Proto
- `proto/idp/gateway/v1/gateway.proto` - Policy and callback definitions

### Gateway (Kotlin)
- `gateway/bifrost/src/main/kotlin/io/orbit/bifrost/policy/PolicyStore.kt`
- `gateway/bifrost/src/main/kotlin/io/orbit/bifrost/policy/PolicyConfig.kt`
- `gateway/bifrost/src/main/kotlin/io/orbit/bifrost/filter/PolicyEnforcementFilter.kt`
- `gateway/bifrost/src/main/kotlin/io/orbit/bifrost/admin/BifrostAdminServiceImpl.kt`

### Callback Service (Go)
- `services/bifrost-callback/` - New service directory
- `services/bifrost-callback/cmd/server/main.go`
- `services/bifrost-callback/internal/service/callback_service.go`

### Temporal Workflows (Go)
- `temporal-workflows/internal/workflows/topic_sync_workflow.go`
- `temporal-workflows/internal/activities/topic_sync_activities.go`
- `temporal-workflows/cmd/worker/main.go`

### Frontend (TypeScript/React)
- `orbit-www/src/collections/kafka/KafkaTopics.ts`
- `orbit-www/src/app/actions/kafka-topics.ts`
- `orbit-www/src/components/features/kafka/TopicsPanel.tsx`
- `orbit-www/src/components/features/kafka/VirtualClusterCreateTopicDialog.tsx`
- `orbit-www/src/lib/utils/format.ts`
- `orbit-www/src/app/(frontend)/workspaces/[slug]/kafka/applications/[appSlug]/`

### Docker
- `services/bifrost-callback/Dockerfile`
- `docker-compose.yml`

## PR

PR #20: https://github.com/drewpayment/orbit/pull/20

## Next Steps

1. Fix Bifrost gateway compilation errors
2. Verify both services run in Docker
3. Push changes and update PR
4. Manual end-to-end testing
