# ARCHIVED: specs/ Directory

**Status**: Archived as of 2025-11-01
**Reason**: Migrated to superpowers workflow
**Current Planning**: See `docs/plans/` directory

## Overview

This directory contains historical planning artifacts from the pre-superpowers workflow. These documents are preserved for reference but are no longer the active planning system.

## Why Archived?

The project has migrated to **superpowers skills** with constitutional enforcement of:
- **brainstorming** before any implementation
- **writing-plans** for comprehensive planning in `docs/plans/`
- **test-driven-development** as mandatory practice
- **code-reviewer** before completing work

See: `docs/plans/000-migration-guide.md` for full migration details.

## Current Workflow

### For New Features:
1. Run `/superpowers:brainstorm [feature idea]`
2. Complete interactive design refinement
3. Run `/superpowers:write-plan`
4. Plan created in `docs/plans/[###-feature].md`
5. Implement with TDD (mandatory)
6. Code review before completion (mandatory)

### For Reference:
- **Active plans**: `docs/plans/`
- **Architecture**: `.agent/system/`
- **Procedures**: `.agent/SOPs/`
- **Examples**: `.agent/tasks/`

## Archived Content

### 001-internal-developer-portal/

**Original Status** (as of archive date):
- Phase 3.2 (Tests First) completed: T011-T028 ✅
- Phase 3.3 (Core Implementation) in progress: T029-T045 ✅
- Phase 3.4+ pending: T046-T074

**Current Status**:
- See `docs/plans/001-idp-core.md` for ongoing work
- Historical context available in this directory

**Files**:
- `spec.md` - Feature specification (WHAT/WHY)
- `plan.md` - Implementation plan with constitution checks
- `tasks.md` - Task breakdown (T001-T074)
- `research.md` - Technology research findings
- `data-model.md` - Entity relationship design
- `quickstart.md` - User journey validation
- `contracts/` - Protobuf definitions

**Lessons Learned**:
- Comprehensive TDD approach worked well
- Contract-first testing prevented interface mismatches
- Task numbering (T001-T074) helped track progress
- Missing: Interactive design exploration before planning
- Missing: Code review gates before completion
- Missing: Systematic debugging framework

## Migration Mapping

| Old Location | New Location | Purpose |
|--------------|--------------|---------|
| `specs/*/spec.md` | Brainstorming output | Design exploration |
| `specs/*/plan.md` | `docs/plans/*.md` | Implementation plan |
| `specs/*/tasks.md` | Plan tasks section | Bite-sized tasks |
| `specs/*/research.md` | Plan prerequisites | Research findings |
| `.orbit/progress/` | Plan progress tracking | Status updates |
| Post-completion | `.agent/tasks/*.md` | Feature summary |

## Why Not Migrate Content?

The specs/ directory represents a different planning philosophy:
- **Specs approach**: Write comprehensive spec → plan → tasks upfront
- **Superpowers approach**: Brainstorm → plan → implement with TDD → review

Starting fresh with superpowers ensures:
- Constitutional enforcement from the start
- Interactive design exploration
- Quality gates at each phase
- Lessons from specs/ inform future planning

## If You Need Historical Context

**For understanding the IDP vision**:
- Read: `specs/001-internal-developer-portal/spec.md`
- Purpose: Original user scenarios and requirements

**For completed implementation details**:
- Read: `specs/001-internal-developer-portal/tasks.md`
- Purpose: See what's been built (T001-T045 ✅)

**For technical architecture decisions**:
- Read: `specs/001-internal-developer-portal/plan.md`
- Purpose: Original tech stack and structure decisions

**For ongoing work**:
- Read: `docs/plans/001-idp-core.md` (when created)
- Purpose: Current plan with superpowers methodology

## References

- **Migration guide**: `docs/plans/000-migration-guide.md`
- **Superpowers skills**: `skills/*/SKILL.md`
- **Project instructions**: `CLAUDE.md`
- **Architecture docs**: `.agent/README.md`
