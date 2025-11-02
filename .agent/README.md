# Orbit IDP Documentation Index

> **Important**: Always read this file first to understand what documentation exists and when to reference it.

## Quick Navigation

### 📋 Active Planning (Superpowers)
**For new features and major changes - READ FIRST:**

- **[../docs/plans/](../docs/plans/)** - Active implementation plans from `/superpowers:write-plan`
  - Created after `/superpowers:brainstorm` completes
  - Contains exact file paths and verification steps
  - Updated during implementation
  - **Always read these BEFORE implementing planned features**

### 📋 System Documentation (.agent)
**For architecture reference during implementation:**

- **[Project Structure](system/project-structure.md)** - Monorepo layout, service organization, and module dependencies
- **[API Architecture](system/api-architecture.md)** - gRPC service contracts and communication patterns

### 📚 Standard Operating Procedures (SOPs)
**Read before performing specific tasks:**

- **[Error Handling SOP](SOPs/error-handling.md)** - Go and TypeScript error handling patterns
- **[Adding gRPC Services SOP](SOPs/adding-grpc-services.md)** - Creating new protobuf services

**Note**: All SOPs reference superpowers skills as constitutional requirements.

### 🎯 Completed Features
**Reference for similar implementations:**

- **[Workspace Management Feature](tasks/feature-workspace-management.md)** - Multi-tenant workspace implementation
- **[Knowledge Management Navigator](tasks/feature-knowledge-management-navigator.md)** - Hierarchical documentation with Payload CMS and Lexical editor
- **[Backstage Plugin Integration](tasks/feature-backstage-plugin-integration.md)** - Integrating Backstage community plugins as a third-party integration layer

## When to Read What

### Planning a New Feature (MANDATORY)
1. **Run `/superpowers:brainstorm [feature idea]`** (constitutional requirement)
2. Complete interactive design refinement
3. **Run `/superpowers:write-plan`** (constitutional requirement)
4. Plan created in `../docs/plans/[###-feature].md`
5. Read `.agent/system/` docs referenced in your plan
6. Check `.agent/tasks/` for similar implementations
7. Review `.agent/SOPs/` for applicable procedures

### Implementing a Planned Feature
1. **ALWAYS read `../docs/plans/[feature].md` FIRST**
2. Reference `.agent/SOPs/` for step-by-step procedures
3. Check `.agent/tasks/` for code examples from similar features
4. **Follow `superpowers:test-driven-development`** (write tests first - MANDATORY)
5. **Use `superpowers:code-reviewer` before completion** (MANDATORY)

### Adding a New gRPC Service
1. **MUST**: Run `/superpowers:brainstorm` first (constitutional requirement)
2. **MUST**: Run `/superpowers:write-plan` (constitutional requirement)
3. **READ**: `SOPs/adding-grpc-services.md` during implementation
4. **READ**: `system/api-architecture.md` for patterns
5. **REFERENCE**: `tasks/feature-workspace-management.md` for example
6. **FOLLOW**: TDD (tests first - constitutional requirement)

### Debugging (MANDATORY)
1. **Use `superpowers:systematic-debugging`** (constitutional requirement)
2. Check `.agent/SOPs/error-handling.md` for patterns
3. Document findings in `../docs/plans/[bugfix].md`

### Before Committing (MANDATORY)
1. **Run `superpowers:verification-before-completion`** (constitutional requirement)
2. Run `make lint` and `make test`
3. Verify protobuf code generation if .proto files changed
4. Update relevant system docs if architecture changed

### After Completion
1. **Run `superpowers:code-reviewer`** (constitutional requirement)
2. Update `../docs/plans/[feature].md` with actual implementation
3. Create summary: `/update doc save task [feature-name]` → `.agent/tasks/`
4. Update this README if new docs were added

## Documentation System Integration

This project uses a hybrid documentation approach combining superpowers planning with architectural context:

### ../docs/plans/ (Superpowers Planning)
- **Purpose**: Active implementation plans with bite-sized tasks
- **Created by**: `/superpowers:write-plan` after `/superpowers:brainstorm`
- **Format**: Step-by-step implementation with exact file paths and verification steps
- **When to use**: For ALL new features and major changes (constitutional requirement)
- **Lifespan**: Created during planning, updated during implementation, archived after completion

### .agent/ (Architectural Context)
- **Purpose**: High-level architecture and established patterns
- **Created by**: `/update doc` commands
- **Format**: System docs, SOPs, feature summaries
- **When to use**: Reference during planning and implementation
- **Lifespan**: Long-lived, updated as architecture evolves

### Workflow Integration
```
1. Planning Phase:
   /superpowers:brainstorm → Interactive design refinement
   /superpowers:write-plan → Creates docs/plans/[feature].md

2. Implementation Phase:
   Read docs/plans/[feature].md → Detailed tasks
   Reference .agent/system/*.md → Architecture constraints
   Reference .agent/SOPs/*.md → Standard procedures
   Reference .agent/tasks/*.md → Similar implementations
   Follow superpowers:test-driven-development → Tests first

3. Completion Phase:
   Run superpowers:code-reviewer → Quality validation
   Run superpowers:verification-before-completion → Evidence-based claims
   Update docs/plans/[feature].md → Actual implementation
   /update doc save task [feature] → Create .agent/tasks/[feature].md summary
```

### Key Principle
- **docs/plans/** = WHAT to implement (active plans with tasks)
- **.agent/** = HOW to implement (architecture and patterns)

## Documentation Maintenance

This documentation system is updated using the `/update doc` command:
- **Initialize**: `/update doc initialize` - Set up new .agent folder
- **Generate SOP**: `/update doc generate SOP [topic]` - Create procedure documentation
- **Update System**: `/update doc update system` - Refresh architecture docs
- **Save Task**: `/update doc save task [name]` - Document completed implementation

## Architecture Quick Reference

### Service Communication
```
Frontend (Next.js/Payload)
  ↓ TypeScript gRPC clients (Connect-ES)
Go Services (repository, api-catalog, knowledge)
  ↓ gRPC inter-service communication
Temporal Workflows (long-running operations)
  ↓
PostgreSQL / Redis / MinIO
```

### Key Ports
- 3000: Frontend (Next.js)
- 7233: Temporal gRPC
- 8080: Temporal UI
- 5432: Temporal PostgreSQL
- 5433: Application PostgreSQL

### Development Workflow
1. `make dev` - Start infrastructure
2. `cd orbit-www && bun dev` - Start frontend
3. `make proto-gen` - Regenerate after .proto changes
4. `make test` - Run all tests before committing

## File Organization Principles

### System Docs
- **Purpose**: High-level architecture snapshots
- **Content**: Module layout, critical code paths, key decisions
- **Update Frequency**: After significant architectural changes
- **Token Budget**: Keep under 1000 tokens per file

### SOPs
- **Purpose**: Step-by-step procedures to prevent mistakes
- **Content**: Prerequisites, implementation steps, code examples, gotchas
- **Update Frequency**: When fixing recurring errors or establishing new patterns
- **Token Budget**: 500-1500 tokens (detailed but focused)

### Tasks
- **Purpose**: Implementation plans and lessons learned
- **Content**: Requirements, steps taken, code patterns, challenges
- **Update Frequency**: When completing significant features
- **Token Budget**: 1000-2000 tokens (comprehensive but concise)

## Related Files
- **CLAUDE.md** - Main project instructions (always read first)
- **.claude/agents/** - Specialized sub-agents for focused tasks
- **.claude/commands/** - Custom slash commands including `/update doc`
