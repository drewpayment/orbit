# .agent Documentation System Workflow

This document explains how to use the `.agent` documentation system with Claude Code for effective context engineering and feature development.

## Quick Reference

| Command | Purpose | Output |
|---------|---------|--------|
| `/plan [description]` | Create implementation plan | `.agent/tasks/feature-X.md` |
| `/update doc initialize` | Set up .agent structure | All .agent directories and README |
| `/update doc generate SOP [topic]` | Document procedure | `.agent/SOPs/[topic].md` |
| `/update doc update system` | Refresh architecture docs | Updated `.agent/system/*.md` |
| `/update doc save task [name]` | Document completed feature | Updated `.agent/tasks/feature-X.md` |

## Complete Feature Development Lifecycle

### 1. Planning Phase

#### Start a New Feature
```
User: /plan Add Temporal workflow for repository cloning

Claude:
1. Reads .agent/README.md for context
2. Reviews .agent/system/project-structure.md for architecture
3. Checks .agent/SOPs/adding-grpc-services.md for patterns
4. Looks at .agent/tasks/ for similar implementations
5. Spawns research agents to analyze codebase
6. Asks focused questions based on research findings
```

#### Interactive Planning
```
Claude presents: Research findings + Design options + Recommendations
User provides: Clarifications + Preferences + Constraints
Claude refines: Plan structure based on feedback
User approves: Phase structure and approach
Claude writes: Detailed implementation plan to .agent/tasks/feature-X.md
```

#### What You Get
A comprehensive plan in `.agent/tasks/feature-[name].md` with:
- Clear phases with success criteria (automated + manual)
- Code examples following established patterns
- File references to similar implementations
- Links to relevant .agent documentation
- Testing strategy
- Rollback procedures

### 2. Implementation Phase

#### Follow the Plan
```
User: Implement Phase 1 from .agent/tasks/feature-repository-clone.md

Claude:
1. Reads the plan from .agent/tasks/
2. References .agent/SOPs/ for procedures (e.g., adding-grpc-services.md)
3. Follows patterns from .agent/system/ (e.g., api-architecture.md)
4. Models code after .agent/tasks/ examples
5. Implements with file references and line numbers
6. Runs automated verification steps from success criteria
```

#### Verify Success
```
User: Run the success criteria for Phase 1

Claude:
Automated Verification:
✅ Proto generation: make proto-gen
✅ Tests pass: make test-repository
✅ Linting passes: make lint
⏸️  Manual verification needed:
   - Test UI functionality
   - Verify performance
```

### 3. Documentation Phase

#### Update Documentation After Implementation
```
User: /update doc save task repository-clone-workflow

Claude:
1. Reads .agent/tasks/feature-repository-clone.md
2. Asks about lessons learned and challenges
3. Updates plan with "Lessons Learned" section
4. Documents actual implementation vs. plan
5. Notes any new patterns discovered
6. Updates .agent/README.md index
```

#### Create SOP for New Patterns
```
User: /update doc generate SOP temporal workflow patterns

Claude:
1. Reads .agent/README.md for existing SOPs
2. Asks clarifying questions about the procedure
3. Searches codebase for examples (Grep, Read)
4. Creates .agent/SOPs/temporal-workflow-patterns.md with:
   - When to use Temporal
   - Step-by-step implementation
   - Code examples from actual implementation
   - Common mistakes to avoid
   - Verification checklist
5. Updates .agent/README.md index
```

### 4. Maintenance Phase

#### Update Architecture Documentation
```
User: /update doc update system

Claude:
1. Asks what changed (new service, API patterns, etc.)
2. Re-analyzes relevant codebase areas
3. Updates .agent/system/*.md files with changes
4. Adds timestamps and "what changed" notes
5. Updates .agent/README.md if new docs created
```

## Workflow Patterns

### Pattern 1: New Feature from Scratch

```mermaid
graph TD
    A[/plan feature] --> B[Research Phase]
    B --> C[Interactive Planning]
    C --> D[Write Plan to .agent/tasks/]
    D --> E[Implement Phase 1]
    E --> F[Verify Success Criteria]
    F --> G{More Phases?}
    G -->|Yes| E
    G -->|No| H[/update doc save task]
    H --> I[Document Lessons Learned]
```

**Commands:**
1. `/plan [feature description]`
2. Implement each phase
3. `/update doc save task [feature-name]`

### Pattern 2: Similar to Existing Feature

```mermaid
graph TD
    A[/plan new feature] --> B[Claude reads .agent/tasks/]
    B --> C[Identifies similar implementation]
    C --> D[Proposes reusing patterns]
    D --> E[User confirms approach]
    E --> F[Plan references existing task]
    F --> G[Implement with modifications]
```

**Benefits:**
- Faster planning (reference existing implementations)
- Consistent patterns across features
- Learn from previous challenges

### Pattern 3: Establishing New Patterns

```mermaid
graph TD
    A[Implement novel feature] --> B[Document in .agent/tasks/]
    B --> C{Repeatable pattern?}
    C -->|Yes| D[/update doc generate SOP]
    C -->|No| E[Document lessons only]
    D --> F[Future features use SOP]
    E --> G[One-off documentation]
```

**When to create SOPs:**
- Pattern will be reused (e.g., adding gRPC services)
- Prevents recurring errors (e.g., error handling)
- Complex procedure with multiple steps
- Best practices worth codifying

### Pattern 4: Fixing Recurring Errors

```mermaid
graph TD
    A[Encounter error] --> B{Documented in SOP?}
    B -->|Yes| C[Follow SOP]
    B -->|No| D[Fix error]
    D --> E{Likely to recur?}
    E -->|Yes| F[/update doc generate SOP]
    E -->|No| G[Move on]
    F --> H[Prevent future occurrences]
```

**Example:**
Error: "Forgot to run make proto-gen after proto changes"
→ Create: `.agent/SOPs/protobuf-workflow.md`
→ Result: Clear procedure prevents future mistakes

## Using .agent Documentation

### When Starting Work

**Always read `.agent/README.md` first:**
```
> Read .agent/README.md

This gives you:
- List of all documentation
- "When to read what" guidance
- Quick architecture reference
- Links to relevant docs for your task
```

### When Planning a Feature

**Check these in order:**
1. `.agent/README.md` - Find relevant docs
2. `.agent/system/project-structure.md` - Understand architecture
3. `.agent/system/api-architecture.md` - Understand communication patterns
4. `.agent/SOPs/` - Find applicable procedures
5. `.agent/tasks/` - Find similar implementations

**Example:**
```
Planning: "Add new gRPC service for API catalog"

Read:
1. .agent/README.md → Points to adding-grpc-services.md
2. .agent/system/api-architecture.md → gRPC patterns
3. .agent/SOPs/adding-grpc-services.md → Step-by-step procedure
4. .agent/tasks/feature-repository-service.md → Reference implementation

Result: Comprehensive understanding before starting
```

### When Implementing

**Reference throughout implementation:**
- **SOPs**: Step-by-step procedures to follow
- **System docs**: Architectural constraints and patterns
- **Task docs**: Code examples from similar features

**Example:**
```
Implementing: Error handling in new service

Read:
- .agent/SOPs/error-handling.md for patterns
- .agent/tasks/feature-workspace-management.md for examples

Apply:
- Domain error definitions from SOP
- gRPC error conversion from SOP
- Frontend error handling from similar task
```

### When Debugging

**Check documentation first:**
1. `.agent/SOPs/` - Is there a procedure for this?
2. `.agent/tasks/` - How was it done in similar features?
3. Ask Claude to research if not documented

## Best Practices

### 1. Keep Documentation Current

**After every significant change:**
- Update `.agent/tasks/` with lessons learned
- Create/update `.agent/SOPs/` for new patterns
- Refresh `.agent/system/` if architecture changed

**Use the commands:**
```bash
# After completing a feature
/update doc save task [feature-name]

# After discovering a new pattern
/update doc generate SOP [pattern-name]

# After architectural changes
/update doc update system
```

### 2. Reference, Don't Duplicate

**In plans and code:**
- Link to `.agent/` docs instead of copying content
- Reference file:line instead of copying code blocks
- Point to similar implementations instead of explaining patterns

**Example:**
```markdown
## Error Handling
Follow patterns from [.agent/SOPs/error-handling.md](.agent/SOPs/error-handling.md):
- Domain errors: [error-handling.md#domain-layer-errors]
- gRPC conversion: [error-handling.md#grpc-layer-error-conversion]
- See implementation: [.agent/tasks/feature-workspace-management.md]
```

### 3. Write for Future You

**Documentation should answer:**
- Why did we make this decision?
- What challenges did we face?
- What patterns should we follow next time?
- What should we NOT do again?

**Not just what was implemented:**
- Code is the "what"
- Documentation is the "why" and "how"

### 4. Use Specialized Agents

**Leverage sub-agents for research:**
- `codebase-locator` - Find relevant files quickly
- `codebase-analyzer` - Understand implementation details
- `codebase-pattern-finder` - Find similar implementations
- `researcher` - General-purpose research agent

**These agents:**
- Save main thread tokens
- Research in parallel
- Return concise summaries
- Provide file:line references

### 5. Maintain Token Budget

**Keep docs concise:**
- System docs: 800-1200 tokens
- SOPs: 500-1500 tokens
- Tasks: 1000-2000 tokens
- README: 500-800 tokens

**Techniques:**
- Use bullet points
- 5-10 line code examples
- File references over full files
- Cross-references over duplication

## Troubleshooting

### Issue: "I can't find documentation for X"

**Solution:**
```
> Read .agent/README.md

Check the index. If not listed:
> /update doc generate SOP [topic]
```

### Issue: "Documentation is outdated"

**Solution:**
```
> /update doc update system

Claude will ask what changed and refresh relevant docs.
```

### Issue: "Plan doesn't match implementation"

**Solution:**
```
> /update doc save task [feature-name]

Document actual implementation and lessons learned.
Update plan with "Changes from Plan" section.
```

### Issue: "Too much documentation to read"

**Solution:**
Use `.agent/README.md` as your guide:
- "When to read what" section
- Quick reference tables
- Links only to relevant docs

Don't read everything - use the index to find what you need.

## Integration with Claude Code Features

### Using with Slash Commands
```
/plan → Create implementation plan in .agent/tasks/
/update doc → Manage .agent documentation system
```

### Using with Sub-Agents
```
researcher.md → General codebase research
code-reviewer.md → Review against .agent standards
```

### Using with TodoWrite
Plans include checklists that integrate with TodoWrite:
- Track implementation progress
- Verify success criteria
- Manage phases

## Migration from Other Systems

### If you have existing plans in thoughts/
1. Keep existing plans as-is (don't migrate)
2. Start using `.agent/tasks/` for new features
3. Reference old plans when relevant
4. Gradually build up `.agent/` documentation

### If you have no documentation system
1. Run `/update doc initialize`
2. Start planning new features with `/plan`
3. Document as you go with `/update doc save task`
4. Build up SOPs organically as patterns emerge

## Advanced Usage

### Combining Multiple .agent Files

**For complex features:**
```markdown
## References
- Architecture: [.agent/system/project-structure.md]
- gRPC Setup: [.agent/SOPs/adding-grpc-services.md]
- Error Handling: [.agent/SOPs/error-handling.md]
- Similar Feature: [.agent/tasks/feature-workspace-management.md]
- Database Patterns: [.agent/tasks/feature-repository-service.md]
```

### Creating Documentation Hierarchies

**System docs** → Define architecture
↓
**SOPs** → Define procedures within that architecture
↓
**Tasks** → Show concrete implementations using those procedures

### Establishing Team Conventions

Use `.agent/SOPs/` to codify:
- Code review standards
- Testing requirements
- Documentation expectations
- Git workflow
- Deployment procedures

## Summary

The `.agent` documentation system provides:
- **Context Engineering**: Optimized information for Claude's context window
- **Knowledge Persistence**: Survives conversation clears
- **Pattern Reuse**: Learn from similar implementations
- **Quality Consistency**: Follow established best practices
- **Onboarding Speed**: New features start with comprehensive context

**Key Commands:**
- `/plan` - Create implementation plans
- `/update doc` - Manage documentation
- Always read `.agent/README.md` first

**Key Principle:**
Documentation should make the next feature easier to build, not just record what was done.
