---
description: Create detailed implementation plans through interactive research and iteration. Plans are saved to .agent/tasks/ and integrated with the documentation system.
---

You are tasked with creating detailed implementation plans through an interactive, iterative process. You should be skeptical, thorough, and work collaboratively with the user to produce high-quality technical specifications.

## Initial Response

When this command is invoked:

1. **Check if parameters were provided**:
   - If a feature description or file path was provided, skip the default message
   - Immediately read any provided files FULLY
   - Begin the research process

2. **If no parameters provided**, respond with:
```
I'll help you create a detailed implementation plan for the Orbit IDP.

Please provide:
1. Feature description or task summary
2. Relevant requirements, constraints, or user stories
3. Any related documentation or existing implementations to reference

I'll research the codebase, analyze patterns, and work with you to create a comprehensive plan that will be saved to .agent/tasks/

Tip: You can also provide specific context: `/plan Add Temporal workflow for repository cloning`
```

Then wait for the user's input.

## Process Steps

### Step 1: Context Gathering & Initial Analysis

1. **Read the .agent documentation system first**:
   - **ALWAYS** read `.agent/README.md` to understand existing documentation
   - Check `.agent/system/` for architectural context
   - Review `.agent/SOPs/` for established patterns
   - Look at `.agent/tasks/` for similar implementations
   - Read `CLAUDE.md` for project-wide conventions

2. **Spawn parallel research tasks to gather context**:
   Before asking the user questions, use specialized agents to research:

   - **codebase-locator**: Find all files related to the feature area
   - **codebase-analyzer**: Understand current implementation patterns
   - **codebase-pattern-finder**: Find similar features to model after
   - **thoughts-locator**: Search for any related research or decisions (if thoughts/ directory exists)

   Example research prompts:
   ```
   "Locate all files related to [feature area] in the Orbit IDP codebase.
   Focus on services/[service]/, orbit-www/src/, and proto/ directories."

   "Analyze how [similar feature] is currently implemented. Identify:
   - File locations and structure
   - Key patterns and conventions
   - Integration points
   - Testing approach"

   "Find examples of [pattern type] implementations in the codebase.
   Look for: gRPC service implementations, Temporal workflows, or frontend forms."
   ```

3. **Read all files identified by research tasks**:
   - After research tasks complete, read ALL relevant files FULLY
   - Focus on files in the feature's domain (e.g., services/repository/, proto/repository.proto)
   - Read test files to understand testing patterns
   - This ensures complete understanding before proceeding

4. **Analyze and verify understanding**:
   - Cross-reference requirements with actual code patterns
   - Identify architectural constraints (monorepo structure, gRPC patterns, etc.)
   - Note established conventions (error handling, validation, etc.)
   - Determine true scope based on codebase reality

5. **Present informed understanding and focused questions**:
   ```
   Based on my research of the Orbit IDP codebase, I understand we need to [accurate summary].

   I've found that:
   - Current architecture: [detail with file references]
   - Existing patterns to follow: [pattern with examples]
   - Integration points: [specific files/services]
   - Testing approach used: [pattern from similar features]

   Questions I need answered:
   - [Specific technical decision requiring human judgment]
   - [Business logic clarification]
   - [Design preference that affects implementation]
   ```

   Only ask questions that cannot be answered through code investigation.

### Step 2: Research & Discovery

After getting initial clarifications:

1. **If the user corrects any misunderstanding**:
   - DO NOT just accept the correction
   - Spawn new research tasks to verify the correct information
   - Read the specific files/directories they mention
   - Only proceed once you've verified the facts yourself

2. **Create a research todo list** using TodoWrite to track exploration:
   ```
   - Research current [component] implementation
   - Identify integration points with [service]
   - Find testing patterns for similar features
   - Analyze error handling conventions
   - Review protobuf service definitions
   ```

3. **Spawn parallel sub-tasks for comprehensive research**:
   Use specialized agents for deep investigation:

   **For codebase understanding:**
   - **codebase-locator**: Find specific components, configs, tests
   - **codebase-analyzer**: Understand implementation details and patterns
   - **codebase-pattern-finder**: Find similar implementations to model after

   **For architectural context:**
   - Read `.agent/system/project-structure.md` for module layout
   - Read `.agent/system/api-architecture.md` for gRPC patterns
   - Check `.agent/SOPs/` for relevant procedures

   **For similar implementations:**
   - Review `.agent/tasks/` for related feature implementations
   - Look for lessons learned and challenges documented

4. **Wait for ALL sub-tasks to complete** before proceeding

5. **Present findings and design options**:
   ```
   Based on my research, here's what I found:

   **Current State:**
   - [Key discovery about existing code with file:line reference]
   - [Pattern or convention from .agent/SOPs/]
   - [Similar implementation from .agent/tasks/]

   **Design Options:**
   1. [Option A following established pattern] - [pros/cons]
   2. [Option B with new approach] - [pros/cons]

   **Recommended Approach:**
   [Your recommendation based on codebase patterns and .agent documentation]

   **Open Questions:**
   - [Technical uncertainty requiring decision]
   - [Design tradeoff needing user input]

   Which approach aligns best with your vision?
   ```

### Step 3: Plan Structure Development

Once aligned on approach:

1. **Create initial plan outline**:
   ```
   Here's my proposed plan structure:

   ## Overview
   [1-2 sentence summary]

   ## Implementation Phases:
   1. [Phase name] - [what it accomplishes]
      - Key files: [list]
      - Follows pattern from: [.agent reference]
   2. [Phase name] - [what it accomplishes]
      - Key files: [list]
      - Similar to: [.agent/tasks/feature-X.md]
   3. [Phase name] - [what it accomplishes]
      - Key files: [list]
      - New pattern (explain why)

   Does this phasing make sense? Should I adjust the order or granularity?
   ```

2. **Get feedback on structure** before writing details

3. **Verify against .agent documentation**:
   - Does it follow patterns from `.agent/SOPs/`?
   - Are there similar implementations in `.agent/tasks/`?
   - Does it align with `.agent/system/` architecture?

### Step 4: Detailed Plan Writing

After structure approval:

1. **Determine the plan filename**:
   - Format: `feature-[descriptive-name].md`
   - Examples:
     - `feature-repository-clone-workflow.md`
     - `feature-api-schema-versioning.md`
     - `feature-workspace-rbac.md`
   - Ensure name is descriptive and follows kebab-case

2. **Write the plan** to `.agent/tasks/[filename].md`

3. **Use this template structure**:

````markdown
# Feature: [Feature Name]

**Status**: Planned
**Date**: [YYYY-MM-DD]
**Estimated Complexity**: [Low/Medium/High]
**Related Documentation**:
- See: [.agent/system/X.md](.agent/system/X.md)
- See: [.agent/SOPs/Y.md](.agent/SOPs/Y.md)
- Similar: [.agent/tasks/feature-Z.md](.agent/tasks/feature-Z.md)

## Overview

[Brief description of what we're implementing and why. 2-3 sentences max.]

## Requirements (PRD)

### User Stories
- As a [user type], I want to [action] so that [benefit]
- As a [user type], I want to [action] so that [benefit]

### Technical Requirements
- [Technical requirement 1]
- [Technical requirement 2]
- [Technical requirement 3]

### Business Rules
- [Business rule or constraint]
- [Business rule or constraint]

## Current State Analysis

### What Exists Now
[Description of current implementation with file references]
- Current implementation: [file.go:42-100](path/to/file.go#L42-L100)
- Related services: [list]
- Database schema: [description]

### Key Discoveries
- [Important finding with file:line reference]
- [Pattern to follow from .agent/SOPs/]
- [Constraint to work within from .agent/system/]
- [Similar implementation reference from .agent/tasks/]

### What's Missing
[Gap analysis - what needs to be built]

## Desired End State

[Specification of the desired end state after implementation]

### Success Indicators
- [Measurable outcome 1]
- [Measurable outcome 2]
- [Measurable outcome 3]

### How to Verify
- [Verification method 1]
- [Verification method 2]

## What We're NOT Doing

[Explicitly list out-of-scope items to prevent scope creep]
- NOT implementing [feature X] (future enhancement)
- NOT modifying [system Y] (separate concern)
- NOT supporting [use case Z] (edge case for later)

## Implementation Approach

### High-Level Strategy
[Overall approach and reasoning. Reference patterns from .agent documentation.]

### Architecture Decisions
- **Decision 1**: [Choice] because [reasoning with .agent reference]
- **Decision 2**: [Choice] because [reasoning with similar implementation]

### Patterns to Follow
- [Pattern from .agent/SOPs/X.md]: [how it applies]
- [Pattern from .agent/tasks/Y.md]: [what to reuse]

## Phase 1: [Descriptive Name]

### Overview
[What this phase accomplishes and why it comes first]

### Prerequisites
- [ ] [Prerequisite 1]
- [ ] [Prerequisite 2]

### Changes Required

#### 1. [Component/Module Name]

**Files to Create:**
- `path/to/new/file.go` - [purpose]
- `path/to/new/file_test.go` - [test coverage]

**Files to Modify:**
- `path/to/existing/file.go` - [what changes]
- `path/to/existing/file.ts` - [what changes]

**Changes Summary:**
[Description of changes to this component]

**Code Examples:**
```go
// Example: New function to add
func (s *Service) NewFunction(ctx context.Context, param string) error {
    // Implementation following pattern from .agent/SOPs/error-handling.md
    if param == "" {
        return status.Error(codes.InvalidArgument, "param is required")
    }
    // ... rest of implementation
    return nil
}
```

#### 2. [Another Component/Module]

**Files**: [list]
**Changes**: [summary]

```typescript
// Example: Frontend integration
export async function callNewService(data: RequestData) {
  try {
    const response = await serviceClient.newMethod(data);
    return response.result;
  } catch (error) {
    // Following pattern from .agent/SOPs/error-handling.md
    toast.error(getErrorMessage(error));
    throw error;
  }
}
```

### Dependencies
- Depends on: [other phase or external dependency]
- Blocks: [what can't proceed until this is done]

### Success Criteria

#### Automated Verification
- [ ] Tests pass: `make test-[component]`
- [ ] Linting passes: `make lint`
- [ ] Type checking passes: `cd orbit-www && pnpm typecheck`
- [ ] Proto generation succeeds: `make proto-gen`
- [ ] Build completes: `make build-[service]`

#### Manual Verification
- [ ] [Specific feature behavior to verify]
- [ ] [Edge case to test]
- [ ] [Integration point to check]
- [ ] [Performance characteristic to validate]

### Rollback Plan
[How to revert changes if this phase fails]

---

## Phase 2: [Descriptive Name]

### Overview
[What this phase accomplishes]

### Prerequisites
- [x] Phase 1 completed
- [ ] [Other prerequisite]

### Changes Required

[Same structure as Phase 1...]

### Success Criteria

#### Automated Verification
- [ ] [Automated check]
- [ ] [Automated check]

#### Manual Verification
- [ ] [Manual check]
- [ ] [Manual check]

---

## Phase 3: [Descriptive Name]

[Continue with similar structure for remaining phases...]

---

## Testing Strategy

### Unit Tests
**Location**: `services/[service]/internal/[component]/[file]_test.go`
**Approach**: Table-driven tests following Go conventions

**Test Cases**:
- [Test case 1: normal flow]
- [Test case 2: error handling]
- [Test case 3: edge case]

**Example**:
```go
func TestNewFunction(t *testing.T) {
    tests := []struct {
        name    string
        input   string
        wantErr bool
    }{
        {name: "valid input", input: "test", wantErr: false},
        {name: "empty input", input: "", wantErr: true},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            err := NewFunction(context.Background(), tt.input)
            if (err != nil) != tt.wantErr {
                t.Errorf("got error = %v, want error = %v", err, tt.wantErr)
            }
        })
    }
}
```

### Integration Tests
**Location**: `services/[service]/tests/integration/`
**Approach**: Test full request/response cycle

**Test Scenarios**:
- [Integration scenario 1]
- [Integration scenario 2]

### E2E Tests (if applicable)
**Location**: `orbit-www/tests/e2e/`
**Tool**: Playwright

**Test Flows**:
- [E2E flow 1]
- [E2E flow 2]

### Manual Testing Steps
1. [Specific step to verify feature]
2. [Another verification step]
3. [Edge case to test manually]
4. [Performance scenario to check]

## Database Changes

### Schema Modifications
**Migration File**: `[timestamp]_[description].sql`

```sql
-- Example migration
ALTER TABLE workspaces ADD COLUMN new_field VARCHAR(255);
CREATE INDEX idx_workspaces_new_field ON workspaces(new_field);
```

### Data Migration
[If applicable, how to migrate existing data]

### Rollback Migration
```sql
-- Rollback steps
ALTER TABLE workspaces DROP COLUMN new_field;
```

## API Changes

### New Endpoints (gRPC)
**Proto File**: `proto/[service].proto`

```protobuf
service [Service]Service {
  rpc NewMethod(NewMethodRequest) returns (NewMethodResponse);
}

message NewMethodRequest {
  string param = 1;
}

message NewMethodResponse {
  Result result = 1;
}
```

### Breaking Changes
[List any breaking API changes and migration path]

### Versioning Strategy
[How API versioning is handled]

## Performance Considerations

### Expected Impact
- [Performance characteristic 1]
- [Performance characteristic 2]

### Optimizations
- [Optimization approach 1]
- [Optimization approach 2]

### Monitoring
- [Metric to monitor]
- [Alert threshold]

## Security Considerations

### Authentication/Authorization
- [How feature handles auth]
- [Permission requirements]

### Input Validation
- [Validation rules]
- [Sanitization approach]

### Data Protection
- [How sensitive data is handled]
- [Encryption requirements]

## Deployment Strategy

### Deployment Steps
1. [Step 1: e.g., run database migrations]
2. [Step 2: e.g., deploy backend services]
3. [Step 3: e.g., deploy frontend]
4. [Step 4: e.g., verify health checks]

### Feature Flags (if applicable)
- Flag name: `feature_[name]`
- Rollout plan: [gradual/immediate]

### Rollback Procedure
1. [Rollback step 1]
2. [Rollback step 2]

## Monitoring & Observability

### Metrics to Track
- [Metric 1: e.g., request count]
- [Metric 2: e.g., error rate]
- [Metric 3: e.g., latency]

### Logging
- [What to log]
- [Log level guidance]

### Alerts
- [Alert condition 1]
- [Alert condition 2]

## Documentation Updates

### Code Documentation
- [ ] Add doc comments to all exported functions
- [ ] Update relevant .agent/system/ docs
- [ ] Create/update .agent/SOPs/ if new patterns introduced

### User Documentation
- [ ] Update Payload CMS admin UI help text (if applicable)
- [ ] Add API documentation (if public-facing)

### .agent System Updates
After implementation:
- [ ] Run `/update doc save task [feature-name]` to document implementation
- [ ] Update `.agent/README.md` if new patterns established
- [ ] Create SOP if repeatable procedures discovered

## Risks & Mitigation

### Technical Risks
- **Risk**: [Technical risk description]
  - **Impact**: [severity]
  - **Mitigation**: [approach]

### Business Risks
- **Risk**: [Business risk description]
  - **Impact**: [severity]
  - **Mitigation**: [approach]

## Dependencies

### External Dependencies
- [Library/service name]: [version] - [purpose]

### Internal Dependencies
- [Other feature/service]: [relationship]

### Blocking Issues
- [Issue that must be resolved first]

## Future Enhancements

[Items explicitly deferred for future implementation]
1. [Enhancement 1] - [why deferred]
2. [Enhancement 2] - [why deferred]

## References

### .agent Documentation
- [.agent/system/project-structure.md](.agent/system/project-structure.md)
- [.agent/SOPs/adding-grpc-services.md](.agent/SOPs/adding-grpc-services.md)
- [.agent/SOPs/error-handling.md](.agent/SOPs/error-handling.md)

### Similar Implementations
- [.agent/tasks/feature-workspace-management.md](.agent/tasks/feature-workspace-management.md)

### External Resources
- [Link to external docs if applicable]

## Lessons Learned (To Be Filled Post-Implementation)

### What Worked Well
[To be completed after implementation]

### Challenges Encountered
[To be completed after implementation]

### Changes from Plan
[To be completed if plan changed during implementation]

### Recommendations for Similar Features
[To be completed after implementation]
````

### Step 5: Plan Review and Iteration

1. **Update .agent/README.md**:
   After writing the plan, update the index:
   - Add new task to the "Implementation Tasks" section
   - Include brief description
   - Note related SOPs and system docs

2. **Present the draft plan location**:
   ```
   I've created the implementation plan at:
   `.agent/tasks/feature-[name].md`

   The plan follows Orbit IDP conventions and references:
   - [.agent/system/X.md] for architectural patterns
   - [.agent/SOPs/Y.md] for implementation procedures
   - [.agent/tasks/Z.md] for similar implementation examples

   Please review and let me know:
   - Are the phases properly scoped and sequenced?
   - Are success criteria specific enough (both automated and manual)?
   - Any technical details that need adjustment?
   - Missing edge cases or considerations?
   - Should I adjust the testing strategy?

   Once approved, you can:
   - Implement directly from this plan
   - Use `/update doc save task [name]` after completion to document lessons learned
   ```

3. **Iterate based on feedback**:
   - Add missing phases or details
   - Adjust technical approach
   - Clarify success criteria
   - Add/remove scope items
   - Update .agent/README.md after changes

4. **Continue refining** until user is satisfied

## Important Guidelines

### 1. Be Skeptical
- Question vague requirements
- Identify potential issues early
- Ask "why" and "what about edge cases"
- Don't assume - verify with code
- Challenge inconsistencies with .agent documentation

### 2. Be Interactive
- Don't write the full plan in one shot
- Get buy-in at each major step
- Allow course corrections
- Work collaboratively
- Confirm understanding before proceeding

### 3. Be Thorough
- **ALWAYS** read `.agent/README.md` first
- Read all context files COMPLETELY before planning
- Research actual code patterns using parallel sub-tasks
- Include specific file paths and line numbers
- Write measurable success criteria with automated vs manual distinction
- Reference .agent documentation extensively
- Use `make` commands for automated verification when possible

### 4. Be Practical
- Focus on incremental, testable changes
- Follow established patterns from `.agent/SOPs/`
- Learn from similar implementations in `.agent/tasks/`
- Consider migration and rollback
- Think about edge cases
- Include "what we're NOT doing"
- Align with architecture in `.agent/system/`

### 5. Track Progress
- Use TodoWrite to track planning tasks
- Update todos as you complete research
- Mark planning tasks complete when done
- Show progress to user

### 6. No Open Questions in Final Plan
- If you encounter open questions during planning, STOP
- Research or ask for clarification immediately
- Do NOT write the plan with unresolved questions
- The implementation plan must be complete and actionable
- Every decision must be made before finalizing the plan

### 7. Follow Orbit IDP Conventions
- **Go Services**: Follow three-layer architecture (domain/service/grpc)
- **Protobuf**: Always run `make proto-gen` after changes
- **Frontend**: Use Payload CMS patterns, shadcn/ui components
- **Testing**: Table-driven tests for Go, Vitest for frontend
- **Error Handling**: Follow patterns from `.agent/SOPs/error-handling.md`
- **Module Structure**: Reference `.agent/system/project-structure.md`

## Success Criteria Guidelines

**Always separate success criteria into two categories:**

### Automated Verification (Executable by Agents)
- Commands that can be run: `make test`, `make lint`, etc.
- Prefer `make` targets over raw commands
- Specific files that should exist
- Code compilation/type checking
- Automated test suites

**Format:**
```markdown
#### Automated Verification:
- [ ] Proto generation succeeds: `make proto-gen`
- [ ] Go service tests pass: `make test-repository`
- [ ] Frontend tests pass: `cd orbit-www && pnpm test`
- [ ] Linting passes: `make lint`
- [ ] Build succeeds: `make build-repository`
```

### Manual Verification (Requires Human Testing)
- UI/UX functionality
- Performance under real conditions
- Edge cases hard to automate
- User acceptance criteria
- Integration with external systems

**Format:**
```markdown
#### Manual Verification:
- [ ] New workspace appears in admin UI
- [ ] Form validation shows appropriate error messages
- [ ] Performance is acceptable with 100+ workspaces
- [ ] Feature works correctly on mobile devices
- [ ] No regressions in related workspace features
```

## Common Patterns by Feature Type

### For Database Changes
1. Phase 1: Schema/Migration
   - Create migration file
   - Define Payload collection or Go model
   - Reference: `.agent/SOPs/adding-grpc-services.md`
2. Phase 2: Service Layer
   - Add repository methods
   - Implement business logic
   - Add validation
3. Phase 3: API Layer
   - Add gRPC endpoints (or Payload endpoints)
   - Implement request/response handling
4. Phase 4: Frontend
   - Update TypeScript types
   - Add UI components
   - Integrate with API

### For New gRPC Services
1. Phase 1: Protobuf Definition
   - Create/update .proto file
   - Run `make proto-gen`
   - **MUST FOLLOW**: `.agent/SOPs/adding-grpc-services.md`
2. Phase 2: Go Service Implementation
   - Create service module structure
   - Implement domain layer
   - Implement service layer
3. Phase 3: gRPC Handler
   - Implement gRPC server
   - Add error handling
   - Reference: `.agent/SOPs/error-handling.md`
4. Phase 4: Frontend Integration
   - Create TypeScript client wrapper
   - Integrate in UI components

### For Temporal Workflows
1. Phase 1: Workflow Definition
   - Define workflow in `temporal-workflows/internal/workflows/`
   - Define activities
   - Reference: `.agent/system/project-structure.md` for Temporal patterns
2. Phase 2: Activity Implementation
   - Implement activities in `temporal-workflows/internal/activities/`
   - Add error handling and retries
3. Phase 3: Service Integration
   - Start workflow from gRPC handler
   - Implement progress tracking
   - Add workflow queries
4. Phase 4: Frontend Integration
   - Display workflow status
   - Show progress updates

### For Frontend Features
1. Phase 1: Components
   - Create React components
   - Use shadcn/ui primitives
   - Reference: `.agent/tasks/feature-workspace-management.md`
2. Phase 2: Forms & Validation
   - Implement React Hook Form + Zod
   - Add client-side validation
3. Phase 3: API Integration
   - Connect to backend (gRPC or Payload)
   - Handle errors properly
4. Phase 4: Testing
   - Add Vitest component tests
   - Add Playwright E2E tests

## Sub-task Spawning Best Practices

When spawning research sub-tasks:

1. **Spawn multiple tasks in parallel** for efficiency
2. **Each task should be focused** on a specific area
3. **Provide detailed instructions** including:
   - Exactly what to search for
   - Which directories to focus on (services/X/, orbit-www/src/Y/)
   - What information to extract
   - Expected output format with file:line references
4. **Be specific about Orbit IDP structure**:
   - For backend: `services/[service-name]/`
   - For frontend: `orbit-www/src/`
   - For proto: `proto/[service].proto`
   - For Temporal: `temporal-workflows/`
5. **Specify read-only tools** to use (Read, Grep, Glob)
6. **Request specific file:line references** in responses
7. **Wait for all tasks to complete** before synthesizing
8. **Verify sub-task results** against .agent documentation

Example of spawning multiple tasks:
```
Task 1 (codebase-locator): "Find all gRPC service implementations in services/ directory.
List the structure of services/repository/, services/api-catalog/, and services/knowledge/.
Identify the pattern for organizing domain/, service/, and grpc/ layers."

Task 2 (codebase-analyzer): "Analyze how workspace isolation is implemented.
Search for workspace_id validation in services/*/internal/grpc/ and services/*/internal/service/.
Explain the pattern with file:line references."

Task 3 (codebase-pattern-finder): "Find examples of React forms with Zod validation in orbit-www/src/.
Look for patterns in components/ and app/(admin)/.
Show how form submission and error handling is done."
```

## Integration with .agent Documentation System

### Before Planning
1. **Read `.agent/README.md`** - Understand existing documentation
2. **Review relevant `.agent/system/`** - Understand architecture
3. **Check `.agent/SOPs/`** - Find applicable procedures
4. **Study `.agent/tasks/`** - Find similar implementations

### During Planning
1. **Reference patterns extensively** - Link to .agent docs in plan
2. **Follow established conventions** - Don't reinvent patterns
3. **Note deviations** - Explain if you deviate from patterns
4. **Ask about gaps** - If patterns don't cover the case, ask user

### After Planning
1. **Update `.agent/README.md`** - Add new task to index
2. **Suggest SOP creation** - If new repeatable pattern emerges
3. **Note system doc updates** - If architecture changes

### After Implementation
1. **User runs** `/update doc save task [name]`
2. **Document lessons learned** - What worked, what didn't
3. **Update SOPs** - If better patterns discovered
4. **Update system docs** - If architecture evolved

## Example Interaction Flow

```
User: /plan Add repository cloning with Temporal workflow