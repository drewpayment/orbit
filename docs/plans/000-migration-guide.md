# Migration to Superpowers Workflow

**Date**: 2025-11-01
**Status**: Complete
**Branch**: feat/ui-workspace-management

## Overview

This document explains the migration from informal task management to superpowers-based workflows with constitutional enforcement.

## What Changed

### Before Migration

**Planning Approach:**
- Specs in `specs/[###-feature]/` with spec.md, plan.md, tasks.md
- Informal progress tracking in `.orbit/progress/`
- Ad-hoc task management without constitutional enforcement
- Mixed documentation between specs/, .agent/, and .orbit/

**Problems:**
- No mandatory brainstorming before implementation
- Plans created without interactive design refinement
- Test-driven development not enforced
- No code review gates before completion
- Documentation scattered across multiple systems

### After Migration

**Superpowers Workflow:**
- `docs/plans/` for active implementation plans
- Constitutional enforcement of superpowers skills
- Mandatory brainstorming → planning → TDD → review cycle
- Unified documentation in `.agent/` and `docs/plans/`

**Benefits:**
- Systematic design exploration before coding
- Comprehensive plans with exact file paths
- TDD constitutionally enforced
- Quality gates via code-reviewer skill
- Clear separation: active plans (docs/plans/) vs. architecture (.agent/)

## Directory Structure

### New Structure

```
docs/
  plans/               # Active implementation plans (superpowers:write-plan)
    000-migration-guide.md       # This file
    001-idp-core.md             # Ongoing IDP implementation
    [future-features].md        # Future planned work

.agent/                # Architectural documentation and patterns
  system/              # High-level architecture snapshots
  SOPs/                # Standard procedures (reference superpowers skills)
  tasks/               # Completed feature summaries
  README.md            # Navigation and workflow guide

specs/                 # ARCHIVED - Historical planning artifacts
  README.md            # Archive notice with migration info
  001-internal-developer-portal/  # Original planning docs
```

### Archived Content

**specs/001-internal-developer-portal/**
- Status: ARCHIVED
- Reason: Pre-superpowers workflow
- Contains: Historical spec.md, plan.md, tasks.md, research.md
- Current status documented in: `docs/plans/001-idp-core.md`

**.orbit/progress/**
- Status: ARCHIVED
- Reason: Replaced by docs/plans/ tracking
- Contains: TDD progress checkpoints (phase-3-2-contract-tests-complete.md)
- Migrated to: Incorporated into docs/plans/001-idp-core.md

## Mandatory Workflows

### 1. Pre-Implementation Phase

**brainstorming (MANDATORY)**
- **When**: Before ANY feature implementation or design work
- **How**: Run `/superpowers:brainstorm` or use Skill tool
- **Purpose**:
  - Refine rough ideas through Socratic questioning
  - Explore alternatives before committing
  - Validate assumptions and requirements
- **Output**: Fully-formed design ready for planning
- **Rule**: NO IMPLEMENTATION without brainstorming first

**writing-plans (MANDATORY)**
- **When**: After brainstorming completes
- **How**: Run `/superpowers:write-plan` or use Skill tool
- **Purpose**:
  - Create comprehensive implementation plans
  - Break down into bite-sized tasks with exact file paths
  - Define verification steps for each task
- **Output**: Plan file in `docs/plans/[feature].md`
- **Rule**: NO IMPLEMENTATION without written plan

### 2. Implementation Phase

**test-driven-development (MANDATORY)**
- **When**: For ALL code changes
- **How**: Follow write-test-first, watch-fail, implement-to-pass cycle
- **Purpose**:
  - Ensure tests actually verify behavior
  - Constitutional requirement for code quality
- **Rule**: Write test FIRST, watch it FAIL, then implement

**systematic-debugging (MANDATORY)**
- **When**: For ANY bug, test failure, or unexpected behavior
- **How**: Use `superpowers:systematic-debugging` skill
- **Purpose**:
  - Root cause investigation before attempting fixes
  - Pattern analysis and hypothesis testing
  - Prevents guess-and-check debugging
- **Rule**: Understand BEFORE fixing

### 3. Post-Implementation Phase

**code-reviewer (MANDATORY)**
- **When**: After completing significant code changes
- **How**: Run `superpowers:code-reviewer` subagent
- **Purpose**:
  - Review against plan and coding standards
  - Quality, security, performance validation
- **Rule**: Must pass review before work is "complete"

**verification-before-completion (MANDATORY)**
- **When**: Before claiming any work is done/fixed/passing
- **How**: Use `superpowers:verification-before-completion` skill
- **Purpose**:
  - Run actual verification commands
  - Confirm output before making claims
- **Rule**: Evidence before assertions, always

## Documentation Workflow

### Planning New Features

1. **Brainstorm**: `/superpowers:brainstorm [feature description]`
   - Interactive design refinement
   - Clarify requirements and constraints
   - Explore alternatives

2. **Write Plan**: `/superpowers:write-plan`
   - Creates `docs/plans/[###-feature-name].md`
   - Bite-sized tasks with file paths
   - Verification steps for each task
   - References to `.agent/SOPs/` and `.agent/system/`

3. **Reference Architecture**: Read `.agent/` docs as needed
   - `.agent/system/` for architecture constraints
   - `.agent/SOPs/` for standard procedures
   - `.agent/tasks/` for similar implementations

### During Implementation

1. **Follow Plan**: Read `docs/plans/[feature].md` continuously
2. **Use TDD**: Write tests first (constitutional requirement)
3. **Update Plan**: Mark tasks complete, add findings
4. **Use TodoWrite**: Track active work in conversation

### After Completion

1. **Code Review**: Run `superpowers:code-reviewer`
2. **Verification**: Run `superpowers:verification-before-completion`
3. **Document Summary**: `/update doc save task [feature-name]`
   - Creates `.agent/tasks/feature-[name].md`
   - Summary with lessons learned
   - Reference implementation for future work

## CLAUDE.md Updates

The main project instructions (CLAUDE.md) now enforce:

1. **Mandatory brainstorming** before any implementation
2. **Mandatory planning** via superpowers:write-plan
3. **Constitutional TDD** enforcement
4. **Mandatory code review** before completion
5. **Documentation in docs/plans/** for active work
6. **Architecture reference in .agent/** for context

See CLAUDE.md "Mandatory Workflows" section for details.

## .agent Integration

**.agent/README.md** updated to:
- Reference `docs/plans/` as primary source for active features
- Position `.agent/` as architectural context
- Clarify when to use each documentation system
- Integrate superpowers skills into workflow descriptions

**.agent/SOPs/** updated to:
- Reference superpowers skills as constitutional requirements
- Link to relevant skills for each procedure
- Maintain step-by-step procedures while acknowledging skill enforcement

**.agent/WORKFLOW.md** updated to:
- Show how superpowers and .agent work together
- Workflow: brainstorm → plan (docs/plans/) → implement (reference .agent/) → review → document (.agent/tasks/)

## Migration Checklist

- [x] Create `docs/plans/` directory
- [x] Create this migration guide
- [x] Add archive notice to `specs/README.md`
- [x] Update CLAUDE.md with mandatory workflows
- [x] Update `.agent/README.md` for hybrid approach
- [x] Update `.agent/SOPs/` to reference skills
- [x] Update `.agent/WORKFLOW.md` integration

## Next Steps for New Features

1. Start with `/superpowers:brainstorm [feature idea]`
2. Complete brainstorming interactively
3. Run `/superpowers:write-plan`
4. Plan will be created in `docs/plans/[###-feature].md`
5. Follow plan with TDD and code review
6. Document summary in `.agent/tasks/` when complete

## Frequently Asked Questions

**Q: What happens to existing specs/001-internal-developer-portal/?**
A: Archived for historical reference. Current status will be tracked in `docs/plans/001-idp-core.md`.

**Q: Do I need to read both docs/plans/ and .agent/?**
A: Yes, but for different purposes:
- `docs/plans/` = What to implement (active plans)
- `.agent/` = How to implement (architecture and patterns)

**Q: Can I skip brainstorming for small changes?**
A: No. Brainstorming is constitutional. Even "small" changes benefit from design exploration.

**Q: What if I want to implement without writing tests first?**
A: Not allowed. TDD is constitutional. Tests must fail before implementation.

**Q: When do I use TodoWrite vs. docs/plans/?**
A: TodoWrite for tracking active work in a conversation. docs/plans/ for persistent implementation plans.

## References

- Superpowers skills documentation: `skills/*/SKILL.md`
- Architecture context: `.agent/README.md`
- Main project instructions: `CLAUDE.md`
- Historical planning: `specs/README.md` (archived)
