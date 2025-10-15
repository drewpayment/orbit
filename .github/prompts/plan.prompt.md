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

### Step 0: Silent Scan & Confidence Check

**CRITICAL RULE**: Do NOT proceed past Step 1.5 until confidence >= 95%

**Before any research, privately assess:**
1. What facts do I NEED to know that aren't provided?
2. What constraints or requirements are unclear?
3. What architectural decisions require human judgment?
4. What edge cases or failure scenarios must be considered?
5. **Current confidence level: [0-100%]**
6. **Confidence blockers**: What specific information would raise confidence to 95%+?

**Create initial planning todo list** (privately, using manage_todo_list):
```json
[
  {"id": 1, "title": "Read .agent documentation", "description": "Read README, system docs, SOPs, similar tasks", "status": "not-started"},
  {"id": 2, "title": "Clarify requirements with user", "description": "Ask clarifying questions until >= 95% confidence", "status": "not-started"},
  {"id": 3, "title": "Spawn deep research tasks", "description": "Use codebase-locator, analyzer, pattern-finder", "status": "not-started"},
  {"id": 4, "title": "Analyze research findings", "description": "Synthesize discoveries, identify patterns", "status": "not-started"},
  {"id": 5, "title": "Create plan blueprint", "description": "High-level structure, phases, key files", "status": "not-started"},
  {"id": 6, "title": "Write detailed plan", "description": "Complete markdown with all sections", "status": "not-started"},
  {"id": 7, "title": "Self-test plan quality", "description": "Verify completeness, quality, confidence", "status": "not-started"}
]
```

**Confidence Threshold**: Do NOT proceed to detailed planning until >= 95% confidence that you understand:
- The feature's purpose and business value
- Technical requirements and constraints
- Success criteria (both automated and manual)
- Integration points with existing systems
- Risks and mitigation strategies

### Step 1A: Initial Context Gathering

**OBJECTIVE**: Gather enough context to ask intelligent clarifying questions

**DO NOT show confidence percentage or echo check in this step**

1. **Read the .agent documentation system first**:
   - **ALWAYS** read `.agent/README.md` to understand existing documentation
   - Check `.agent/system/` for architectural context
   - Review `.agent/SOPs/` for established patterns
   - Look at `.agent/tasks/` for similar implementations
   - Read `CLAUDE.md` for project-wide conventions

2. **Quick skim of provided context**:
   - Review user's request carefully
   - Scan any attached files (don't deep read yet - save for Step 2)
   - Identify obvious gaps in information
   - Note apparent constraints or requirements

3. **Update planning todo status**:
   ```
   ✅ Mark todo #1 "Read .agent documentation" as completed
   ⏳ Mark todo #2 "Clarify requirements" as in-progress (if questions needed)
   ```

4. **Identify critical clarification needs**:
   - What business requirements are ambiguous?
   - What technical constraints are missing?
   - What success criteria need definition?
   - What scope boundaries are unclear?
   - Which architectural decisions require human judgment?

**DO NOT**:
- ❌ Spawn deep research tasks yet (save for Step 2)
- ❌ Show echo check or confidence level to user
- ❌ Make architectural decisions
- ❌ Start writing any plan sections
- ❌ Read full file contents (quick skim only)

**IF clarification needed**: Proceed to Step 1.5 (Clarification Loop)  
**IF no questions needed** (rare): Skip to Step 1B (Echo Check)

---

### Step 1.5: Clarification Loop (MANDATORY GATE)

**CRITICAL RULE**: This step MUST complete before showing any confidence level or echo check

**PREREQUISITE**: Step 1A identified gaps that need clarification

**Process:**

1. **Ask ONE clarifying question at a time**:
   ```
   I need to clarify: [specific question about requirement/constraint/scope]
   
   This will help me: [explain how it impacts the plan]
   
   Current understanding: [show what you think might be true]
   
   Options I'm considering:
   - Option A: [approach]
   - Option B: [approach]
   ```

2. **Wait for user response** - DO NOT proceed without answer

3. **Update confidence tracking** (privately):
   - Record answer
   - Recalculate confidence level
   - Identify next highest-priority blocker
   - Update planning todos if needed

4. **Repeat until confidence >= 95%**:
   - **IF** more critical questions → Ask next ONE question
   - **IF** confidence < 95% → Ask next ONE question  
   - **IF** confidence >= 95% → Proceed to Step 1B

**GATE CHECK** (before proceeding to Step 1B):
```
✅ All critical questions answered
✅ Confidence level >= 95%
✅ No ambiguous requirements remain
✅ Success criteria are clear
✅ Scope boundaries are defined
✅ Technical constraints understood
```

**DO NOT**:
- ❌ Show confidence percentage to user yet
- ❌ Show echo check yet
- ❌ Skip questions and assume answers
- ❌ Ask multiple questions in one message (ONE AT A TIME)
- ❌ Proceed to Step 1B without >= 95% confidence
- ❌ Batch questions together

**Update todos**:
```
✅ Mark todo #2 "Clarify requirements" as completed when done
```

---

### Step 1B: Echo Check & Research Planning

**PREREQUISITE**: 
- ✅ Step 1.5 completed (all questions answered) OR no clarification was needed
- ✅ Confidence >= 95%
- ✅ Gate check passed

**NOW you can show the echo check**:

1. **Present understanding with confidence**:
   ```
   UNDERSTANDING: [Deliverable] + [#1 must-include fact] + [hardest constraint]
   
   CONFIDENCE: 95%+ - Ready to proceed with detailed research
   
   Based on [clarification/initial context], I understand we need to [accurate summary].

   Key requirements confirmed:
   - [Requirement 1 with source/confirmation]
   - [Requirement 2 with source/confirmation]
   - [Constraint 1 with source/confirmation]

   Initial research plan:
   - Research current [component] implementation
   - Identify integration points with [service]
   - Find testing patterns for similar features
   - Analyze error handling conventions
   
   **Ready for:**
   - ✅ YES - Proceed to deep research (Step 2)
   - ❌ EDITS - Clarify understanding
   - 🔍 BLUEPRINT - Show plan structure first
   - 🚩 RISK - Analyze failure scenarios
   ```

2. **Update planning todos**:
   ```
   Progress: ✅ 2/7 todos completed
   
   ✅ Read .agent documentation
   ✅ Clarify requirements
   ⏳ Spawn research tasks (next - waiting for approval)
   - [ ] Analyze research findings
   - [ ] Create plan structure
   - [ ] Write detailed plan
   - [ ] Self-test plan quality
   ```

3. **WAIT for user approval** before proceeding to Step 2

**DO NOT proceed to Step 2 without explicit user approval**

---

### Step 2: Research & Discovery (Only After Echo Check Approval)

**PREREQUISITE**: 
- ✅ User responded to Step 1B with approval (YES, BLUEPRINT, or RISK)
- ✅ Confidence >= 95%

**Update todos**:
```
✅ Mark todo #2 "Clarify requirements" as completed (if not already)
⏳ Mark todo #3 "Spawn research tasks" as in-progress
```


After getting ✅ YES or resolving EDITS:

1. **If the user corrects any misunderstanding**:
   - DO NOT just accept the correction
   - Spawn new research tasks to verify the correct information
   - Read the specific files/directories they mention
   - Only proceed once you've verified the facts yourself

2. **Spawn parallel sub-tasks for comprehensive research**:
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

3. **Wait for ALL sub-tasks to complete** before proceeding

4. **Update todos**:
   ```
   ✅ Mark todo #3 "Spawn research tasks" as completed
   ⏳ Mark todo #4 "Analyze research findings" as in-progress
   
   Progress: ✅ 3/7 todos completed
   ```

5. **Present findings and design options with confidence check**:
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

   **CONFIDENCE: [X%]**
   
   **Remaining Questions** (if < 95% confidence):
   - [ONE specific question - most critical uncertainty]
   
   (Ask one at a time until >= 95% confidence)

   **Ready for:**
   - ✅ **YES** - Proceed to structure planning
   - ❌ **EDITS** - Adjust approach or clarify
   - 🔍 **BLUEPRINT** - See high-level plan outline
   - 🚩 **RISK** - Review top 3 failure scenarios
   ```

### Step 2.5: Risk Analysis (If User Selects 🚩 RISK)

**Top 3 Failure Scenarios:**

1. **[Risk Category: Technical/Security/Performance/Business]**
   - **Scenario**: [What could go wrong]
   - **Impact**: [Severity and consequences]
   - **Probability**: [High/Medium/Low]
   - **Mitigation**: [Specific approach to prevent/handle]

2. **[Risk Category]**
   - **Scenario**: [What could go wrong]
   - **Impact**: [Severity and consequences]
   - **Probability**: [High/Medium/Low]
   - **Mitigation**: [Specific approach to prevent/handle]

3. **[Risk Category]**
   - **Scenario**: [What could go wrong]
   - **Impact**: [Severity and consequences]
   - **Probability**: [High/Medium/Low]
   - **Mitigation**: [Specific approach to prevent/handle]

**Ready for:**
- ✅ **YES** - Proceed to structure planning
- ❌ **EDITS** - Adjust risk analysis
- 🔍 **BLUEPRINT** - See high-level plan outline

### Step 3: Blueprint/Structure Development (If User Selects 🔍 BLUEPRINT or ✅ YES)

**PREREQUISITE**:
- ✅ Step 2 research findings presented and approved
- ✅ Confidence >= 95%

**Update todos**:
```
✅ Mark todo #4 "Analyze research findings" as completed (if not already)
⏳ Mark todo #5 "Create plan blueprint" as in-progress

Progress: ✅ 4/7 todos completed
```

Once aligned on approach and >= 95% confidence:

1. **Create high-level blueprint first**:
   ```
   🔍 BLUEPRINT - High-Level Plan Structure

   ## Overview
   [1-2 sentence summary]

   ## Implementation Phases:
   1. [Phase name] - [what it accomplishes]
      - Key files: [list]
      - Follows pattern from: [.agent reference]
      - Estimated complexity: [Low/Medium/High]
   2. [Phase name] - [what it accomplishes]
      - Key files: [list]
      - Similar to: [.agent/tasks/feature-X.md]
      - Estimated complexity: [Low/Medium/High]
   3. [Phase name] - [what it accomplishes]
      - Key files: [list]
      - New pattern (explain why)
      - Estimated complexity: [Low/Medium/High]

   ## Key Integration Points:
   - [Integration 1 with file reference]
   - [Integration 2 with file reference]

   ## Testing Approach:
   - Unit: [scope]
   - Integration: [scope]
   - E2E: [scope]

   **CONFIDENCE: [X%]** - Ready to write detailed plan
   
   **Ready for:**
   - ✅ **YES-GO** - Write full detailed plan
   - ❌ **EDITS** - Adjust structure/phasing
   - 🚩 **RISK** - Review failure scenarios first
   ```

2. **WAIT for explicit YES-GO** before writing detailed plan

3. **Verify against .agent documentation**:
   - Does it follow patterns from `.agent/SOPs/`?
   - Are there similar implementations in `.agent/tasks/`?
   - Does it align with `.agent/system/` architecture?

4. **Update todos**:
   ```
   ✅ Mark todo #5 "Create plan blueprint" as completed
   
   Progress: ✅ 5/7 todos completed
   Current: Waiting for blueprint approval
   ```

### Step 4: Detailed Plan Writing (Only After ✅ YES-GO)

**GATE CHECK**: Do NOT write detailed plan unless:
- ✅ User has approved with explicit YES-GO
- ✅ Confidence >= 95%
- ✅ All critical questions answered
- ✅ Blueprint/structure approved
- ✅ No unresolved technical uncertainties

**Update todos**:
```
⏳ Mark todo #6 "Write detailed plan" as in-progress

Progress: ✅ 5/7 todos completed
Current: Writing detailed implementation plan
```

After structure approval and YES-GO:

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

### Step 5: Self-Test Before Delivery

**PREREQUISITE**:
- ✅ Detailed plan has been written to `.agent/tasks/[filename].md`
- ✅ Plan includes all required sections

**Update todos**:
```
✅ Mark todo #6 "Write detailed plan" as completed
⏳ Mark todo #7 "Self-test plan quality" as in-progress

Progress: ✅ 6/7 todos completed
Current: Performing self-test before delivery
```

**Before presenting the plan, self-review:**

1. **Completeness Check:**
   - [ ] All phases have specific file paths
   - [ ] Success criteria split into automated vs manual
   - [ ] Testing strategy covers unit/integration/E2E
   - [ ] Risk mitigation included for top failure scenarios
   - [ ] Rollback plans for each phase
   - [ ] .agent documentation referenced throughout

2. **Quality Check:**
   - [ ] Code examples follow project conventions
   - [ ] Patterns align with .agent/SOPs/
   - [ ] Architecture decisions justified with .agent/system/ references
   - [ ] No open questions or TBD items
   - [ ] Phases are properly sequenced with dependencies

3. **Confidence Check:**
   - [ ] >= 95% confidence plan is actionable
   - [ ] No assumptions that need verification
   - [ ] All edge cases considered
   - [ ] Technical approach validated against codebase

**Fix any issues found before delivery.**

**Update todos**:
```
✅ Mark todo #7 "Self-test plan quality" as completed

Progress: ✅ 7/7 todos completed - Ready for delivery
```

### Step 6: Plan Delivery and Iteration

1. **Update .agent/README.md**:
   After writing the plan, update the index:
   - Add new task to the "Implementation Tasks" section
   - Include brief description
   - Note related SOPs and system docs

2. **Present the completed plan**:
   ```
   ✅ PLAN COMPLETE - Implementation plan created at:
   `.agent/tasks/feature-[name].md`

   **CONFIDENCE: 95%+** - Plan is actionable and complete

   **Progress: ✅ 7/7 todos completed**

   The plan follows project conventions and references:
   - [.agent/system/X.md] for architectural patterns
   - [.agent/SOPs/Y.md] for implementation procedures
   - [.agent/tasks/Z.md] for similar implementation examples

   **Self-Test Results:**
   ✅ All phases have specific file paths and changes
   ✅ Success criteria split into automated vs manual verification
   ✅ Top 3 risks identified with mitigation strategies
   ✅ Testing strategy covers all layers
   ✅ Rollback plans included
   ✅ No unresolved questions or TBD items

   **Ready for:**
   - ✅ **IMPLEMENT** - Start building from this plan
   - ❌ **REVISE** - Adjust specific sections
   - 🔍 **REVIEW** - Discuss specific phases or decisions

   After implementation:
   - Use `/update doc save task [name]` to document lessons learned
   - Update .agent/SOPs/ if new patterns emerged
   ```

3. **Iterate based on feedback**:
   - Add missing phases or details
   - Adjust technical approach
   - Clarify success criteria
   - Add/remove scope items
   - Update .agent/README.md after changes

4. **Continue refining** until user is satisfied

## Important Guidelines

### 1. Be Skeptical & Confidence-Driven
- Question vague requirements
- Identify potential issues early
- Ask "why" and "what about edge cases"
- Don't assume - verify with code
- Challenge inconsistencies with .agent documentation
- **Track confidence explicitly** - Don't proceed without >= 95% confidence
- **Stop and ask** if critical information is missing
- **Use Step 1.5 Clarification Loop** - Ask ONE question at a time until confident

### 2. Be Interactive with Explicit Gates
- **Use approval gates**: ✅ YES / ❌ EDITS / 🔍 BLUEPRINT / 🚩 RISK
- **Ask ONE question at a time** in Step 1.5 (don't batch questions)
- Get buy-in at each major step
- Allow course corrections
- **Echo check ONLY in Step 1B** after confidence >= 95%
- **WAIT for YES-GO** before writing detailed plan (Step 4 gate)
- Work collaboratively with clear checkpoints
- **Never show confidence percentage until >= 95%**

### 3. Be Thorough
- **ALWAYS** read `.agent/README.md` first in Step 1A
- Read all context files COMPLETELY before planning (but quick skim in Step 1A)
- Research actual code patterns using parallel sub-tasks in Step 2
- Include specific file paths and line numbers
- Write measurable success criteria with automated vs manual distinction
- Reference .agent documentation extensively
- Use `make` commands for automated verification when possible
- **Follow the step sequence**: 0 → 1A → 1.5 → 1B → 2 → 2.5 → 3 → 4 → 5 → 6

### 4. Be Practical
- Focus on incremental, testable changes
- Follow established patterns from `.agent/SOPs/`
- Learn from similar implementations in `.agent/tasks/`
- Consider migration and rollback
- Think about edge cases
- Include "what we're NOT doing"
- Align with architecture in `.agent/system/`

### 5. Track Progress
- **MANDATORY**: Use manage_todo_list to track planning tasks (see guideline #7)
- Create initial todo list in Step 0
- Update todos at each major step transition
- Mark todos complete immediately when finished
- Show progress to user in status updates
- Never skip todo updates - they maintain context across conversation gaps

### 6. No Open Questions & Confidence Threshold
- **STOP if confidence < 95%** at any stage
- If you encounter open questions during planning, **PAUSE and ask ONE question**
- Research or ask for clarification immediately
- Do NOT write the plan with unresolved questions
- The implementation plan must be complete and actionable
- Every decision must be made before finalizing the plan
- **Track and communicate confidence level** at each major step
- Use explicit approval gates before proceeding to next phase

### 7. Todo List Management (MANDATORY)

**RULE**: You MUST use `manage_todo_list` to track planning progress throughout the entire process

#### When to Create Initial Todo List
- **Immediately in Step 0** (privately, not shown to user initially)
- Contains all major planning phases as separate todos
- Use the standard structure shown in Step 0

#### Todo Structure for Planning
The standard planning todo list should contain these 7 todos:
```json
[
  {"id": 1, "title": "Read .agent documentation", "description": "Read README, system docs, SOPs, similar tasks", "status": "not-started"},
  {"id": 2, "title": "Clarify requirements with user", "description": "Ask clarifying questions until >= 95% confidence", "status": "not-started"},
  {"id": 3, "title": "Spawn deep research tasks", "description": "Use codebase-locator, analyzer, pattern-finder", "status": "not-started"},
  {"id": 4, "title": "Analyze research findings", "description": "Synthesize discoveries, identify patterns", "status": "not-started"},
  {"id": 5, "title": "Create plan blueprint", "description": "High-level structure, phases, key files", "status": "not-started"},
  {"id": 6, "title": "Write detailed plan", "description": "Complete markdown with all sections", "status": "not-started"},
  {"id": 7, "title": "Self-test plan quality", "description": "Verify completeness, quality, confidence", "status": "not-started"}
]
```

#### When to Update Todos (Mandatory Update Points)
- **Step 0 complete**: Create initial list (all not-started)
- **Step 1A complete**: Mark #1 completed
- **Step 1.5 start**: Mark #2 in-progress
- **Step 1.5 complete**: Mark #2 completed
- **Step 1B presented**: Show progress summary
- **Step 2 start**: Mark #3 in-progress
- **Step 2 research complete**: Mark #3 completed, #4 in-progress
- **Step 2 findings presented**: Mark #4 completed
- **Step 3 start**: Mark #5 in-progress
- **Step 3 blueprint approved**: Mark #5 completed, #6 in-progress
- **Step 4 plan written**: Mark #6 completed, #7 in-progress
- **Step 5 self-test complete**: Mark #7 completed
- **Step 6 delivery**: All completed

#### Update Frequency
- **Minimum**: At the start and end of each major step (0, 1A, 1.5, 1B, 2, 3, 4, 5, 6)
- **Recommended**: After completing any significant sub-task within a step
- **Required**: Before asking user for approval/input at gates

#### Show Progress to User
When showing echo checks, research findings, blueprints, or status updates, include:
```
Progress: ✅ 3/7 todos completed
Current: Analyzing research findings (todo #4)

✅ Read .agent documentation
✅ Clarify requirements  
✅ Spawn research tasks
⏳ Analyze findings (current)
- [ ] Create plan blueprint
- [ ] Write detailed plan
- [ ] Self-test plan quality
```

#### Why This Matters
- **Prevents skipping steps**: Explicit checklist ensures no shortcuts
- **Maintains context**: If conversation pauses, todos show current state
- **Shows user progress**: Transparency about what's done and what's next
- **Enforces confidence gates**: Can't mark "Clarify requirements" done until >= 95%
- **Accountability**: Clear audit trail of planning process

### 8. Self-Test Before Delivery
- **Always run self-test** before presenting plan
- Check for completeness, quality, and confidence
- Fix any issues found during self-review
- Ensure no TBD items or unresolved questions
- Verify alignment with .agent documentation

### 9. Follow Project Conventions
- **Package-First**: Business logic in shared packages first
- **TypeScript**: 100% TypeScript with strict type checking
- **React Native**: Mobile-first with Expo patterns
- **PayloadCMS**: Headless CMS with MongoDB
- **Testing**: Unit tests with Vitest, E2E with Playwright
- **Monorepo**: Turborepo with pnpm workspaces
- **Reference .agent docs**: Always align with documented patterns

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