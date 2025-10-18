---
description: Manage .agent documentation system for context engineering. Initialize, generate SOPs, update system docs, or save implementation plans.
---

You are helping maintain the `.agent` documentation system for context engineering.

## Documentation Structure

The `.agent` folder contains:
- **system/** - High-level architecture snapshots (project structure, API patterns, tech stack)
- **SOPs/** - Standard Operating Procedures for common tasks and preventing errors
- **tasks/** - Implementation plans and lessons learned from completed features
- **README.md** - Index of all documentation with usage guidance

## Command Modes

The user will invoke this command with different arguments:
- `/update doc initialize` - Create initial `.agent` folder structure
- `/update doc generate SOP [topic]` - Create a new Standard Operating Procedure
- `/update doc update system` - Refresh system documentation after major changes
- `/update doc save task [feature-name]` - Save implementation plan for a completed feature

## Mode 1: Initialize Documentation

**Trigger**: `/update doc initialize`

**Purpose**: Set up the `.agent` folder structure from scratch

**Process**:
1. Create directories: `.agent/system/`, `.agent/SOPs/`, `.agent/tasks/`
2. Read CLAUDE.md to understand project context
3. Generate system documentation:
   - **project-structure.md**: Analyze directory structure, identify key modules
   - **api-architecture.md**: Document gRPC/REST patterns, service communication
   - **tech-stack.md**: Extract from package.json, go.mod, docker-compose.yml
4. Create comprehensive `.agent/README.md` index with:
   - List of all documentation files
   - "When to read what" guidance
   - Navigation structure
   - Maintenance instructions
5. Report completion with list of created files

**Output Message**:
```
Documentation system initialized successfully!

Created:
- .agent/README.md (documentation index)
- .agent/system/project-structure.md
- .agent/system/api-architecture.md
- .agent/system/tech-stack.md

Next steps:
- Read .agent/README.md to understand the system
- Generate SOPs as you encounter recurring patterns: /update doc generate SOP [topic]
- Save implementation plans after completing features: /update doc save task [name]
```

## Mode 2: Generate SOP

**Trigger**: `/update doc generate SOP [topic]`

**Purpose**: Create a Standard Operating Procedure to document a repeatable process

**Process**:
1. Read `.agent/README.md` to understand existing documentation
2. Ask clarifying questions about the SOP:
   - What triggered the need for this SOP? (error, recurring task, etc.)
   - What are the prerequisites?
   - What are the main steps?
   - What common mistakes should be avoided?
3. Search codebase for related examples (use Grep, Glob)
4. Create SOP file in `.agent/SOPs/[topic].md` with structure:
   ```markdown
   # SOP: [Title]

   **Created**: [date]
   **Last Updated**: [date]
   **Trigger**: When [situation occurs]

   ## Purpose
   [Why this SOP exists]

   ## Prerequisites
   [Requirements before starting]

   ## Step-by-Step Process
   [Detailed steps with code examples]

   ## Common Mistakes to Avoid
   [Gotchas and anti-patterns]

   ## Verification Checklist
   [How to verify success]

   ## Related Documentation
   [Links to other .agent files]
   ```
5. Update `.agent/README.md` to include new SOP in index
6. Report completion

**Output Message**:
```
SOP created: .agent/SOPs/[topic].md

This SOP documents: [brief description]

Triggers:
- [When to use this SOP]

Updated:
- .agent/README.md (added to index)

To use this SOP: Read it before performing [task type]
```

## Mode 3: Update System Documentation

**Trigger**: `/update doc update system`

**Purpose**: Refresh system documentation after significant architectural changes

**Process**:
1. Read `.agent/README.md` to see what system docs exist
2. Ask user what changed:
   - New services added?
   - API patterns changed?
   - Tech stack updated?
   - Database schema modified?
3. Re-analyze relevant aspects of codebase
4. Update corresponding `.agent/system/*.md` files:
   - Add new sections for new components
   - Update changed patterns
   - Mark deprecated items
   - Add "Last Updated" timestamp
5. Update `.agent/README.md` if new system docs created
6. Report what was updated

**Output Message**:
```
System documentation updated successfully!

Updated files:
- .agent/system/project-structure.md (added new service: [name])
- .agent/system/api-architecture.md (updated gRPC patterns)

Changes:
- [Summary of what changed]

Recommendation: Review updated docs before starting next feature
```

## Mode 4: Save Task Implementation

**Trigger**: `/update doc save task [feature-name]`

**Purpose**: Document a completed feature implementation for future reference

**Process**:
1. Read `.agent/README.md` to understand existing tasks
2. Ask user for implementation details (or extract from conversation):
   - What was the feature/requirement?
   - What files were created/modified?
   - What were the implementation steps?
   - What challenges were encountered?
   - What lessons were learned?
3. Use Git to find changed files: `git diff --name-only`
4. Create task documentation in `.agent/tasks/feature-[name].md` with structure:
   ```markdown
   # Feature: [Title]

   **Status**: Completed
   **Date**: [date]
   **Implementation Time**: [estimate]

   ## Requirements (PRD)
   [User stories and technical requirements]

   ## Implementation Plan
   [Steps taken, files created/modified]

   ## Key Code Patterns
   [Important patterns used, with brief examples]

   ## Lessons Learned
   [What worked well, challenges, solutions]

   ## Related Documentation
   [Links to SOPs and system docs]
   ```
5. Update `.agent/README.md` to include new task
6. Report completion

**Output Message**:
```
Implementation plan saved: .agent/tasks/feature-[name].md

Documented:
- Requirements and technical approach
- Files created/modified: [count] files
- Key patterns and lessons learned

Updated:
- .agent/README.md (added to tasks index)

This documentation can help with similar features in the future.
```

## Documentation Writing Guidelines

### Style Rules
- **Concise**: Docs are snapshots, not full code dumps
- **Actionable**: Focus on what to do, not just theory
- **Timestamped**: Include creation/update dates
- **Cross-referenced**: Link to related documentation

### Token Budget
- System docs: 800-1200 tokens each
- SOPs: 500-1500 tokens each
- Tasks: 1000-2000 tokens each
- README: 500-800 tokens

### Code Examples
- Keep code snippets to 5-10 lines
- Show both bad (❌) and good (✅) examples
- Include file references: [file.go:42-51]
- Reference full files instead of copying them

### Cross-Referencing
Always link related documentation:
```markdown
## Related Documentation
- See: [api-architecture.md](../system/api-architecture.md) for gRPC patterns
- See: [error-handling.md](error-handling.md) for error handling
- See: CLAUDE.md for project-wide conventions
```

## Before Taking Action

### Always Read First
1. Read `.agent/README.md` if it exists
2. Check if documentation already exists for this topic
3. Review related documentation to maintain consistency

### Ask Questions
Don't assume - ask for clarification:
- "What triggered the need for this SOP?"
- "What files were changed in this feature?"
- "What challenges did you encounter?"
- "Are there similar implementations to reference?"

### Search Before Writing
Use tools to gather context:
- Grep for related code patterns
- Read existing implementations
- Check git history for related changes

## Process Flow

```
User runs: /update doc [mode] [args]
         ↓
Read .agent/README.md (if exists)
         ↓
Ask clarifying questions
         ↓
Gather information (Grep, Read, Git)
         ↓
Create/update documentation file(s)
         ↓
Update .agent/README.md index
         ↓
Report completion with next steps
```

## Error Handling

### If .agent folder doesn't exist
- Suggest running `/update doc initialize` first
- Offer to run it automatically

### If information is missing
- Ask specific questions to gather needed details
- Don't make up information or patterns

### If topic is too broad
- Ask user to narrow scope
- Suggest breaking into multiple SOPs or system docs

## Quality Checklist

Before completing any documentation task:
- [ ] Documentation is concise (within token budget)
- [ ] Code examples are brief and relevant
- [ ] Cross-references to related docs included
- [ ] Timestamp added
- [ ] .agent/README.md index updated
- [ ] User-facing completion message provided
- [ ] Clear guidance on when to use this documentation

## Example Invocations

### Example 1: Generate SOP
```
User: /update doc generate SOP integrating temporal workflows