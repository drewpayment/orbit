# Orbit IDP Documentation Index

> **Important**: Always read this file first to understand what documentation exists and when to reference it.

## Quick Navigation

### 📋 System Documentation
Read these to understand the codebase architecture:

- **[Project Structure](system/project-structure.md)** - Monorepo layout, service organization, and module dependencies
- **[Database Schema](system/database-schema.md)** - Payload CMS collections and service database schemas
- **[API Architecture](system/api-architecture.md)** - gRPC service contracts and communication patterns
- **[Tech Stack](system/tech-stack.md)** - Technologies, versions, and tooling

### 📚 Standard Operating Procedures (SOPs)
Read these before performing specific tasks:

- **[Error Handling SOP](SOPs/error-handling.md)** - Go and TypeScript error handling patterns
- **[Adding gRPC Services SOP](SOPs/adding-grpc-services.md)** - Creating new protobuf services
- **[Testing Workflow SOP](SOPs/testing-workflow.md)** - Test-driven development across Go and frontend
- **[Integrating External APIs SOP](SOPs/integrating-apis.md)** - Third-party API integration best practices

### 🎯 Implementation Tasks
Reference these for similar feature implementations:

- **[Workspace Management Feature](tasks/feature-workspace-management.md)** - Multi-tenant workspace implementation
- **[Repository Service Implementation](tasks/feature-repository-service.md)** - gRPC service creation pattern
- **[Knowledge Management Navigator](tasks/feature-knowledge-management-navigator.md)** - Hierarchical documentation with Payload CMS and Lexical editor

## When to Read What

### Starting a New Feature
1. Read relevant system docs to understand current architecture
2. Check if similar features exist in tasks folder
3. Review related SOPs for standards (especially adding-grpc-services.md)
4. Check CLAUDE.md for project-wide conventions

### Adding a New gRPC Service
1. **MUST READ**: `SOPs/adding-grpc-services.md` first
2. Review `system/api-architecture.md` for patterns
3. Look at `tasks/feature-repository-service.md` for reference implementation

### Fixing a Bug
1. Check if there's an SOP for this error type
2. Review `SOPs/error-handling.md` for proper patterns
3. If it's a recurring issue, generate new SOP after fixing

### Working with Temporal
1. Review architecture in `system/project-structure.md`
2. Check existing workflow implementations in tasks folder
3. Follow patterns for idempotent activities

### Before Committing
1. Run `make lint` and `make test` per testing-workflow.md
2. Verify protobuf code generation if .proto files changed
3. Update relevant system docs if architecture changed

### After Major Changes
1. Update relevant system docs using `/update doc update system`
2. Create/update task documentation with `/update doc save task [name]`
3. Update this README if new docs were added

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
