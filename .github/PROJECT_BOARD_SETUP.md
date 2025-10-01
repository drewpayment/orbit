# GitHub Projects Board Setup Guide

This guide contains all commands and configuration to set up the "Orbit IDP - Development" GitHub Projects board.

## Prerequisites

```bash
# Install GitHub CLI if not already installed
brew install gh

# Authenticate
gh auth login

# Set your repository (update if different)
REPO="drewpayment/orbit"
```

## Step 1: Create Labels

```bash
# By Type (matches issue templates)
gh label create "bug" --color "d73a4a" --description "Bug or unexpected behavior" --repo $REPO
gh label create "feature" --color "0075ca" --description "New feature or enhancement" --repo $REPO
gh label create "documentation" --color "0e8a16" --description "Documentation updates" --repo $REPO
gh label create "tech-task" --color "7057ff" --description "Internal technical work" --repo $REPO

# By Service
gh label create "service:repository" --color "fbca04" --description "Repository management service" --repo $REPO
gh label create "service:api-catalog" --color "f9d0c4" --description "API Catalog service" --repo $REPO
gh label create "service:knowledge" --color "1d76db" --description "Knowledge management service" --repo $REPO
gh label create "service:temporal" --color "e99695" --description "Temporal workflows" --repo $REPO
gh label create "frontend" --color "5319e7" --description "Frontend (orbit-www)" --repo $REPO
gh label create "infra" --color "8B4513" --description "Infrastructure and deployment" --repo $REPO

# By Priority
gh label create "priority:critical" --color "b60205" --description "Critical priority (P0)" --repo $REPO
gh label create "priority:high" --color "d93f0b" --description "High priority (P1)" --repo $REPO
gh label create "priority:medium" --color "fbca04" --description "Medium priority (P2)" --repo $REPO
gh label create "priority:low" --color "c5def5" --description "Low priority (P3)" --repo $REPO

# By Status
gh label create "blocked" --color "d73a4a" --description "Blocked by dependency" --repo $REPO
gh label create "needs-refinement" --color "fbca04" --description "Needs more details" --repo $REPO
gh label create "ready-for-review" --color "0e8a16" --description "Ready for code review" --repo $REPO
gh label create "breaking-change" --color "d73a4a" --description "Breaking API change" --repo $REPO

# By Testing
gh label create "tdd-required" --color "7057ff" --description "Must follow TDD approach" --repo $REPO
gh label create "needs-tests" --color "f9d0c4" --description "Missing test coverage" --repo $REPO
gh label create "performance-critical" --color "b60205" --description "Performance sensitive code" --repo $REPO
gh label create "security-sensitive" --color "b60205" --description "Security-related changes" --repo $REPO

# By Phase (from tasks.md)
gh label create "phase:setup" --color "ededed" --description "Phase 3.1: Setup" --repo $REPO
gh label create "phase:tdd" --color "7057ff" --description "Phase 3.2: TDD Tests" --repo $REPO
gh label create "phase:implementation" --color "0075ca" --description "Phase 3.3: Core Implementation" --repo $REPO
gh label create "phase:integration" --color "0e8a16" --description "Phase 3.4: Integration" --repo $REPO
gh label create "phase:qa" --color "f9d0c4" --description "Phase 3.5: Quality Assurance" --repo $REPO
```

## Step 2: Create Milestones

```bash
# Milestone 1: Foundation
gh api repos/$REPO/milestones -X POST -f title="Foundation (Phase 3.1)" \
  -f description="Setup tasks (T001-T010): Project structure, tooling, dev environment" \
  -f due_on="2025-10-15T00:00:00Z"

# Milestone 2: TDD Gate
gh api repos/$REPO/milestones -X POST -f title="TDD Gate (Phase 3.2)" \
  -f description="All contract and integration tests (T011-T028) - Constitutional requirement" \
  -f due_on="2025-11-05T00:00:00Z"

# Milestone 3: Core Services
gh api repos/$REPO/milestones -X POST -f title="Core Services (Phase 3.3)" \
  -f description="Data models, services, APIs (T029-T044)" \
  -f due_on="2025-12-03T00:00:00Z"

# Milestone 4: Frontend & Workflows
gh api repos/$REPO/milestones -X POST -f title="Frontend & Workflows" \
  -f description="UI components and Temporal workflows (T045-T052)" \
  -f due_on="2025-12-24T00:00:00Z"

# Milestone 5: Integration
gh api repos/$REPO/milestones -X POST -f title="Integration (Phase 3.4)" \
  -f description="Middleware, auth, caching (T053-T062)" \
  -f due_on="2026-01-07T00:00:00Z"

# Milestone 6: Production Ready
gh api repos/$REPO/milestones -X POST -f title="Production Ready (Phase 3.5)" \
  -f description="QA, performance, security (T063-T074)" \
  -f due_on="2026-01-21T00:00:00Z"
```

## Step 3: Create GitHub Project (Manual Setup Required)

GitHub Projects v2 requires manual creation through the web UI. Follow these steps:

### 3.1 Create Project
1. Go to https://github.com/orgs/YOUR_ORG/projects (or your user projects)
2. Click "New project"
3. Choose "Table" as the starting view
4. Name it "Orbit IDP - Development"

### 3.2 Add Custom Fields

Navigate to Settings (⚙️) in your project and add these fields:

**Type** (Single select)
- 🐛 Bug
- ✨ Feature
- 📚 Documentation
- 🔧 Technical Task
- 🧪 Test
- 🏗️ Infrastructure

**Priority** (Single select)
- 🔴 Critical (P0)
- 🟠 High (P1)
- 🟡 Medium (P2)
- 🟢 Low (P3)

**Service/Area** (Single select)
- 🎨 Frontend (orbit-www)
- 📦 Repository Service
- 📊 API Catalog Service
- 📖 Knowledge Service
- ⏱️ Temporal Workflows
- 🔌 Protocol Buffers
- 🏗️ Infrastructure
- 🔒 Security/Auth
- 📱 Cross-Service

**Effort** (Single select)
- XS (< 2 hours)
- S (< 1 day)
- M (1-3 days)
- L (3-5 days)
- XL (> 1 week)

**Sprint** (Iteration)
- Duration: 2 weeks
- Start date: (your choice)

**TDD Phase** (Single select)
- 🔴 Test First (Write failing test)
- 🟢 Make it Pass (Implement)
- 🔵 Refactor (Improve)
- ✅ Complete

**Test Coverage %** (Number)

**Performance Target** (Text)

### 3.3 Configure Status Field

Update the default "Status" field with these options:
- 📋 Backlog
- 🔍 Refined (Ready for Dev)
- 🏗️ In Progress
- 👀 In Review
- ✅ Testing/QA
- 🚀 Ready for Deploy
- ✨ Done

### 3.4 Create Views

#### View 1: Sprint Board (Board)
- Layout: Board
- Group by: Status
- Filter: Sprint = @current
- Sort: Priority (High to Low)
- Card fields: Type, Service/Area, Assignee

#### View 2: Service Kanban (Board)
- Layout: Board
- Group by: Service/Area
- Filter: Status ≠ Done
- Sort: Priority
- Card fields: Status, Type, Assignee

#### View 3: TDD Workflow (Table)
- Layout: Table
- Group by: TDD Phase
- Filter: Type = Test OR Type = Technical Task
- Visible fields: Title, Status, Service/Area, Test Coverage %, Assignee
- Sort: TDD Phase, then Priority

#### View 4: Backlog Refinement (Table)
- Layout: Table
- Filter: Status = Backlog OR Status = Refined
- Sort: Priority (High to Low), then Effort (XS to XL)
- Show all fields

#### View 5: Bug Triage (Table)
- Layout: Table
- Group by: Priority
- Filter: Type = Bug
- Sort: Created date (newest first)
- Visible fields: Title, Service/Area, Status, Priority, Assignee

#### View 6: Documentation Tracker (Table)
- Layout: Table
- Filter: Type = Documentation
- Visible fields: Title, Status, Service/Area, Assignee, Sprint
- Sort: Status, then Priority

#### View 7: Performance Dashboard (Table)
- Layout: Table
- Filter: Performance Target is set
- Visible fields: Title, Service/Area, Performance Target, Status, Test Coverage %, Assignee
- Sort: Service/Area, then Priority

## Step 4: Set Up Automations

In Project Settings → Workflows, add these automations:

### Auto-add to project
```
When: Issues opened
Then: Add to project with Status = Backlog
```

### PR Linked
```
When: Pull request linked to issue
Then: Set Status = In Review
```

### PR Merged
```
When: Pull request merged
Then: Set Status = Testing/QA
```

### Issue Closed
```
When: Issue closed
Then: Set Status = Done
```

### Label-based Automation (Type)
```
When: Label "bug" added
Then: Set Type = Bug

When: Label "feature" added
Then: Set Type = Feature

When: Label "documentation" added
Then: Set Type = Documentation

When: Label "tech-task" added
Then: Set Type = Technical Task
```

### Label-based Automation (Priority)
```
When: Label "priority:critical" added
Then: Set Priority = Critical (P0)

When: Label "priority:high" added
Then: Set Priority = High (P1)

When: Label "priority:medium" added
Then: Set Priority = Medium (P2)

When: Label "priority:low" added
Then: Set Priority = Low (P3)
```

### TDD Automation
```
When: Label "tdd-required" added
Then: Set TDD Phase = Test First (Write failing test)
```

## Step 5: Add Repository to Project

```bash
# Get your project number from the project URL
# Example: https://github.com/orgs/YOUR_ORG/projects/1 -> PROJECT_NUMBER=1

PROJECT_NUMBER=1  # Update this

# Add repository to project (requires GraphQL)
gh api graphql -f query='
mutation($project:ID!, $contentId:ID!) {
  addProjectV2ItemById(input: {projectId: $project, contentId: $contentId}) {
    item {
      id
    }
  }
}' -f project="PROJECT_NUMBER" -f contentId="REPO_NODE_ID"
```

## Step 6: Bulk Import Existing Tasks

If you have tasks from `specs/001-internal-developer-portal/tasks.md` to import:

### Create Issues from Tasks Script

Save this as `scripts/import-tasks.sh`:

```bash
#!/bin/bash

REPO="drewpayment/orbit"

# Example: Import Phase 3.1 tasks
gh issue create --repo $REPO \
  --title "[Setup] T001: Create project structure" \
  --body "Create project structure per implementation plan (orbit-www/, services/, temporal-workflows/, proto/, infrastructure/)" \
  --label "tech-task,phase:setup,tdd-required" \
  --milestone "Foundation (Phase 3.1)"

gh issue create --repo $REPO \
  --title "[Setup] T002: Initialize Go modules" \
  --body "Initialize Go modules for all four services (repository, api-catalog, knowledge, temporal-workflows)" \
  --label "tech-task,phase:setup,service:repository,service:api-catalog,service:knowledge,service:temporal" \
  --milestone "Foundation (Phase 3.1)"

# Continue for remaining tasks...
```

## Best Practices

### For Developers

1. **Starting Work**
   - Assign yourself to the issue
   - Move to "In Progress"
   - Create feature branch: `git checkout -b ORB-<issue-number>-description`

2. **TDD Workflow**
   - If `tdd-required` label: Set TDD Phase to "Test First"
   - Write failing test
   - Update TDD Phase to "Make it Pass"
   - Implement feature
   - Update TDD Phase to "Refactor"
   - Clean up code
   - Update Test Coverage % field

3. **Creating PR**
   - Link issue in PR: `Closes #123` or `Fixes #123`
   - PR auto-moves issue to "In Review"
   - Ensure tests pass and coverage meets targets

4. **After Merge**
   - Issue auto-moves to "Testing/QA"
   - Verify in staging environment
   - Move to "Ready for Deploy" when verified
   - Close issue after production deployment

### For Team Leads

1. **Sprint Planning**
   - Use "Backlog Refinement" view
   - Assign Priority, Service/Area, Effort to issues
   - Move refined items to "Refined" status
   - Assign to current Sprint

2. **Daily Standups**
   - Use "Sprint Board" view
   - Walk through Status columns
   - Add `blocked` label if dependencies exist

3. **Monitoring**
   - Check "TDD Workflow" view for TDD compliance
   - Review "Performance Dashboard" for perf targets
   - Use "Bug Triage" for critical issues

## Troubleshooting

### Labels not applying automatically
- Check Project automations are enabled
- Verify label names match exactly (case-sensitive)

### Items not appearing in views
- Check filter criteria
- Ensure Status field is set
- Verify issue is added to project

### Automation not triggering
- Workflows can take 1-2 minutes to execute
- Check Project settings → Workflows for errors
- Ensure you have admin access to the project

## Next Steps

1. Run label creation commands
2. Create milestones
3. Set up project board through web UI
4. Configure views and automations
5. Import existing tasks (optional)
6. Train team on workflows
7. Start first sprint!

---

**Project Board URL**: https://github.com/orgs/YOUR_ORG/projects/YOUR_PROJECT_NUMBER
**Repository**: https://github.com/$REPO
