# .agent System Quick Start

Get started with the `.agent` documentation system in 5 minutes.

## TL;DR

```bash
# Planning a feature
/plan Add Temporal workflow for repository cloning

# After implementing
/update doc save task repository-clone-workflow

# Creating a procedure
/update doc generate SOP handling temporal failures

# Refreshing docs
/update doc update system
```

## Your First Feature with .agent

### Step 1: Read the Index (30 seconds)

```
> Read .agent/README.md
```

This gives you:
- Overview of all documentation
- "When to read what" guidance
- Quick reference for the Orbit IDP

### Step 2: Plan Your Feature (10-15 minutes)

```
> /plan Add workspace invitation system with email notifications
```

Claude will:
1. ✅ Research the codebase automatically
2. ✅ Review existing patterns from .agent docs
3. ✅ Ask focused questions
4. ✅ Create detailed plan in `.agent/tasks/feature-workspace-invitations.md`

**What you get:**
- Phased implementation plan
- Success criteria (automated + manual)
- Code examples following project patterns
- Testing strategy
- References to similar implementations

### Step 3: Implement (time varies)

Follow the plan phase by phase:

```
> Implement Phase 1 from .agent/tasks/feature-workspace-invitations.md
```

Claude will:
- Read the plan
- Follow procedures from `.agent/SOPs/`
- Use patterns from `.agent/system/`
- Reference similar code from `.agent/tasks/`

**Verify each phase:**
```
> Run the automated success criteria for Phase 1
```

### Step 4: Document Completion (5 minutes)

```
> /update doc save task workspace-invitations
```

Claude will:
- Ask about lessons learned
- Document challenges faced
- Update `.agent/tasks/feature-workspace-invitations.md`
- Update `.agent/README.md` index

## Common Scenarios

### Scenario 1: "I need to add a new gRPC service"

```
1. Read: .agent/README.md
   → Points you to adding-grpc-services.md

2. Read: .agent/SOPs/adding-grpc-services.md
   → Complete step-by-step procedure

3. Run: /plan Add gRPC service for [your service]
   → Creates plan following the SOP

4. Implement following the plan

5. Run: /update doc save task [service-name]
   → Document completion
```

**Time saved:** 30-60 minutes of research and pattern discovery

### Scenario 2: "How should I handle errors in this service?"

```
1. Read: .agent/SOPs/error-handling.md
   → Go error patterns
   → gRPC error conversion
   → Frontend error handling

2. Reference: .agent/tasks/feature-workspace-management.md
   → See actual implementation examples

3. Implement using the patterns
```

**Time saved:** 15-30 minutes of pattern research

### Scenario 3: "I'm building something similar to an existing feature"

```
1. Check: .agent/tasks/
   → Find similar implementation

2. Run: /plan [your feature] similar to [existing feature]
   → Claude references the existing task
   → Adapts patterns to your needs

3. Implement with modifications
```

**Time saved:** 1-2 hours of architectural decisions

### Scenario 4: "I keep making the same mistake"

```
1. Fix the error

2. Run: /update doc generate SOP [error topic]
   → Example: "forgetting to run make proto-gen"

3. Claude creates SOP in .agent/SOPs/

4. Future: SOP prevents recurrence
```

**Time saved:** Prevents future debugging time

## Understanding the Structure

```
.agent/
├── README.md              # ← START HERE - Index of everything
├── WORKFLOW.md            # Detailed workflow guide
├── QUICKSTART.md          # This file
│
├── system/                # What IS (architecture)
│   ├── project-structure.md    # Monorepo layout
│   └── api-architecture.md     # gRPC patterns
│
├── SOPs/                  # How TO (procedures)
│   ├── adding-grpc-services.md # Step-by-step service creation
│   └── error-handling.md       # Error patterns
│
└── tasks/                 # What WAS (implementations)
    └── feature-workspace-management.md  # Completed feature example
```

### System Docs (What IS)
**Read when:** Starting new work or joining project
**Contains:** Architecture, patterns, tech stack
**Examples:** "How are services structured?" "What's our gRPC pattern?"

### SOPs (How TO)
**Read when:** About to perform a specific task
**Contains:** Step-by-step procedures, code examples, gotchas
**Examples:** "How do I add a gRPC service?" "How do I handle errors?"

### Tasks (What WAS)
**Read when:** Building something similar
**Contains:** Completed implementations, lessons learned, code references
**Examples:** "How did we build workspace management?" "What challenges did we face?"

## Cheat Sheet

| I want to... | Command | Output |
|--------------|---------|--------|
| Plan a feature | `/plan [description]` | `.agent/tasks/feature-X.md` |
| Find relevant docs | Read `.agent/README.md` | Index with guidance |
| Follow a procedure | Read `.agent/SOPs/[topic].md` | Step-by-step instructions |
| See similar code | Read `.agent/tasks/feature-X.md` | Implementation examples |
| Document completion | `/update doc save task [name]` | Updated task doc |
| Create a procedure | `/update doc generate SOP [topic]` | New SOP file |
| Update architecture | `/update doc update system` | Refreshed system docs |

## Reading Priority

### For Your First Feature
1. ✅ `.agent/README.md` - Overview (5 min)
2. ✅ `.agent/system/project-structure.md` - Architecture (10 min)
3. ✅ Run `/plan [your feature]` - Let Claude guide you
4. Skip detailed reading - Claude will reference docs as needed

### When Implementing
**Don't read everything** - Use Claude to pull relevant sections:

```
> What does .agent/SOPs/error-handling.md say about gRPC errors?
```

Claude will extract the relevant section for you.

### When Stuck
1. Check `.agent/README.md` index
2. Read the relevant SOP if listed
3. Ask Claude to research if not documented

## Tips for Success

### ✅ DO
- Start with `/plan` for new features
- Reference `.agent/` docs in your plans
- Update docs after completing features (`/update doc save task`)
- Create SOPs for repeatable patterns (`/update doc generate SOP`)
- Read `.agent/README.md` when starting work

### ❌ DON'T
- Don't read all documentation before starting
- Don't duplicate content from .agent docs (reference instead)
- Don't implement without a plan
- Don't skip documenting lessons learned
- Don't let docs get stale (update after changes)

## Integration with Your Workflow

### Before Starting Work
```bash
# 1. Quick context refresh
> Read .agent/README.md

# 2. Plan the feature
> /plan [feature description]

# Result: Comprehensive plan in .agent/tasks/
```

### During Implementation
```bash
# Follow the plan phase by phase
> Implement Phase 1 from .agent/tasks/feature-X.md

# Verify success criteria
> Run automated checks for Phase 1
```

### After Completing Work
```bash
# Document lessons learned
> /update doc save task [feature-name]

# Create SOP if new pattern emerged
> /update doc generate SOP [pattern-name]
```

## Real Example

Let's walk through adding a new feature:

### 1. Planning (10 min)
```
User: /plan Add email notifications when workspace members are invited

Claude:
Reading .agent/README.md...
Reviewing .agent/system/project-structure.md...
Checking .agent/tasks/feature-workspace-management.md for patterns...

Based on my research:
- Workspace management exists (see .agent/tasks/feature-workspace-management.md)
- Need to add email service (new)
- Should follow gRPC pattern (see .agent/SOPs/adding-grpc-services.md)

Questions:
- Which email provider? (SendGrid, AWS SES, etc.)
- Should invitations expire?
- What happens if email fails?

[Interactive planning continues...]

Created plan: .agent/tasks/feature-workspace-invitations.md
```

### 2. Implementation (1-2 hours)
```
User: Implement Phase 1

Claude:
Reading .agent/tasks/feature-workspace-invitations.md...
Following .agent/SOPs/adding-grpc-services.md for service setup...
Using error patterns from .agent/SOPs/error-handling.md...

[Implements Phase 1]

Automated Verification:
✅ Proto generation: make proto-gen
✅ Tests pass: make test-workspace
✅ Linting passes: make lint

Manual verification needed:
- Test invitation email arrives
- Check email template formatting
```

### 3. Documentation (5 min)
```
User: /update doc save task workspace-invitations

Claude:
What challenges did you face during implementation?

User: Email rate limiting wasn't initially considered

Claude:
Documented in .agent/tasks/feature-workspace-invitations.md:

Lessons Learned:
- Email rate limiting is important (we added retry logic)
- Email templates need mobile testing
- Consider async processing for email sending

Updated .agent/README.md index.
```

## Next Steps

### Immediate (Right Now)
1. Read [.agent/README.md](.agent/README.md) - 5 minutes
2. Try `/plan [simple feature]` - 10 minutes
3. Implement one phase - see how it works

### Short Term (This Week)
1. Use `/plan` for all new features
2. Create your first SOP with `/update doc generate SOP`
3. Get comfortable with the workflow

### Long Term (Ongoing)
1. Build up `.agent/SOPs/` as patterns emerge
2. Keep `.agent/tasks/` updated with lessons learned
3. Refresh `.agent/system/` when architecture changes

## Getting Help

### Common Questions

**Q: Do I need to read all documentation before starting?**
A: No! Read `.agent/README.md` for overview, then use `/plan`. Claude will reference docs as needed.

**Q: When should I create an SOP?**
A: When you find yourself doing the same thing multiple times, or when you want to prevent a recurring error.

**Q: How often should I update system docs?**
A: Run `/update doc update system` after significant architectural changes (new services, major refactors).

**Q: Can I modify the plan during implementation?**
A: Yes! Edit `.agent/tasks/feature-X.md` as you learn more. Document changes in "Changes from Plan" section.

**Q: What if .agent docs conflict with CLAUDE.md?**
A: CLAUDE.md is the source of truth for project-wide conventions. .agent docs should align with CLAUDE.md.

### More Information
- Detailed workflow: [WORKFLOW.md](WORKFLOW.md)
- Complete index: [README.md](README.md)
- Example implementations: Browse `.agent/tasks/`

## Success Metrics

You're using `.agent` effectively when:
- ✅ New features start with `/plan`
- ✅ Plans reference existing `.agent/` docs
- ✅ Implementation follows established patterns
- ✅ Lessons learned are documented
- ✅ Recurring procedures become SOPs
- ✅ You spend less time on architectural decisions
- ✅ Code consistency improves across features

## Remember

The goal isn't perfect documentation - it's **making the next feature easier to build**.

Start simple:
1. `/plan` for new features
2. Implement following the plan
3. Document lessons with `/update doc save task`
4. Create SOPs as patterns emerge

The system grows organically with your project.

---

**Ready to start?** Run this now:

```
> Read .agent/README.md
> /plan [your next feature]
```
