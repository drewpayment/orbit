# GitHub Configuration & Workflows

This directory contains GitHub-specific configuration, issue templates, and project board documentation for the Orbit Internal Developer Portal.

## 📋 Issue Templates

We use standardized templates for different types of work:

- **[Bug Report](ISSUE_TEMPLATE/bug.md)** - Report bugs or unexpected behavior
- **[Feature Request](ISSUE_TEMPLATE/feature_request.md)** - Propose new features or enhancements
- **[Documentation](ISSUE_TEMPLATE/documentation_request.md)** - Request or update documentation
- **[Technical Task](ISSUE_TEMPLATE/technical_task.md)** - Internal technical work, refactoring, or infrastructure

When creating an issue, select the appropriate template to ensure all necessary information is captured.

## 🎯 GitHub Projects Board

We use GitHub Projects v2 for sprint planning, task tracking, and workflow management.

### Quick Links

- **[Setup Guide](PROJECT_BOARD_SETUP.md)** - Complete instructions for setting up the project board
- **[Workflow Guide](WORKFLOW_GUIDE.md)** - Team workflows, best practices, and common scenarios
- **[Visual Summary](PROJECT_BOARD_SUMMARY.md)** - Quick reference with diagrams and examples

### Quick Setup

```bash
# Automated setup (creates labels and milestones)
./scripts/setup-github-project.sh drewpayment/orbit

# Then follow the manual steps in PROJECT_BOARD_SETUP.md for:
# - Creating the GitHub Project board
# - Configuring custom fields
# - Setting up views
# - Enabling automations
```

## 🏗️ Board Structure

### Status Flow
```
📋 Backlog → 🔍 Refined → 🏗️ In Progress → 👀 In Review →
✅ Testing/QA → 🚀 Ready for Deploy → ✨ Done
```

### Key Views

1. **Sprint Board** - Daily standup view, current sprint only
2. **Service Kanban** - Work distribution across services
3. **TDD Workflow** - Track test-driven development compliance
4. **Backlog Refinement** - Sprint planning and grooming
5. **Bug Triage** - Prioritize and assign bugs
6. **Documentation Tracker** - Track documentation coverage
7. **Performance Dashboard** - Monitor performance targets

### Custom Fields

- **Type**: Bug, Feature, Documentation, Technical Task, Test, Infrastructure
- **Priority**: Critical (P0), High (P1), Medium (P2), Low (P3)
- **Service/Area**: Frontend, Repository, API Catalog, Knowledge, Temporal, etc.
- **Effort**: XS (<2h), S (<1d), M (1-3d), L (3-5d), XL (>1w)
- **Sprint**: 2-week iterations
- **TDD Phase**: Test First → Make it Pass → Refactor → Complete
- **Test Coverage %**: Track actual coverage (target: 90% business logic, 80% overall)
- **Performance Target**: API <200ms, Auth <100ms, Code Gen <30s

## 🏷️ Labeling Strategy

### Auto-applied (from templates)
- `bug`, `feature`, `documentation`, `tech-task`

### Required for all issues
- **Priority**: `priority:critical`, `priority:high`, `priority:medium`, `priority:low`
- **Service**: `service:repository`, `service:api-catalog`, `service:knowledge`, `frontend`, etc.

### Optional (as needed)
- **Phase**: `phase:setup`, `phase:tdd`, `phase:implementation`, `phase:integration`, `phase:qa`
- **Status**: `blocked`, `needs-refinement`, `ready-for-review`, `breaking-change`
- **Quality**: `tdd-required`, `needs-tests`, `performance-critical`, `security-sensitive`

## 🔄 Standard Workflows

### TDD Workflow (Constitutional Requirement)

All code must follow Test-Driven Development:

1. 🔴 **Test First** - Write failing test
2. 🟢 **Make it Pass** - Implement minimal code
3. 🔵 **Refactor** - Improve code quality
4. ✅ **Complete** - Verify coverage (90%+ business logic)

### Bug Workflow

1. Report using Bug template → Auto: Backlog
2. Triage: Add priority, service, effort → Refined
3. Assign developer → In Progress
4. Write test that reproduces bug
5. Fix bug following TDD
6. Create PR → Auto: In Review
7. Merge → Auto: Testing/QA
8. Verify → Ready for Deploy
9. Deploy → Close → Auto: Done

### Feature Workflow

1. Request using Feature template → Auto: Backlog
2. Refine: Break into subtasks, define criteria
3. Create test task (label: `tdd-required`)
4. Write tests → TDD Phase: Test First
5. Implement → TDD Phase: Make it Pass
6. Refactor → TDD Phase: Refactor
7. Verify coverage → TDD Phase: Complete
8. Create PR → Auto: In Review
9. Review & merge → Auto: Testing/QA
10. Deploy → Done

## 📊 Milestones

Development is organized into 6 phases:

1. **Foundation (Phase 3.1)** - Setup, tooling, dev environment (T001-T010)
2. **TDD Gate (Phase 3.2)** - Contract & integration tests (T011-T028)
3. **Core Services (Phase 3.3)** - Data models, services, APIs (T029-T044)
4. **Frontend & Workflows** - UI components, Temporal workflows (T045-T052)
5. **Integration (Phase 3.4)** - Middleware, auth, caching (T053-T062)
6. **Production Ready (Phase 3.5)** - QA, performance, security (T063-T074)

See [tasks.md](../specs/001-internal-developer-portal/tasks.md) for complete task breakdown.

## 🎭 Team Ceremonies

### Sprint Planning (Bi-weekly)
- Review Backlog Refinement view
- Prioritize work (bugs → features → tech debt → docs)
- Balance across services
- Assign effort and check capacity
- Assign to current sprint

### Daily Standup (15 min)
- Use Sprint Board view
- Walk through Status columns
- Identify blockers
- Update TDD Phase

### Refinement Session (Weekly)
- Review Backlog
- Add priority, service, effort
- Break down large items
- Ensure TDD tasks exist
- Move refined items to "Refined"

### Retrospective (End of sprint)
- Review Done items
- Check test coverage metrics
- Review performance targets
- Identify improvements

## 📈 Success Metrics

### Sprint Health
- **Velocity**: Track effort points completed
- **Completion Rate**: % of committed work completed
- **Cycle Time**: Average time from Backlog → Done

### Quality Metrics
- **Test Coverage**: 90% (business logic), 80% (overall)
- **Bug Escape Rate**: <10%
- **Performance**: <200ms p95 API, <100ms auth, <30s code gen

### Team Distribution
Monitor work balance across:
- Frontend (orbit-www)
- Repository Service
- API Catalog Service
- Knowledge Service
- Temporal Workflows
- Infrastructure

## 🚀 Getting Started

### For Developers

1. **Find work**: Check Sprint Board for "Refined" items
2. **Start task**: Assign yourself, move to "In Progress"
3. **Create branch**: `git checkout -b ORB-123-feature-name`
4. **Follow TDD**: Write test → Implement → Refactor
5. **Create PR**: Link issue with `Closes #123`
6. **After merge**: Verify in QA, deploy

### For Reviewers

1. **Check tests**: Ensure tests included and passing
2. **Verify coverage**: Must meet 90% (business logic) or 80% (overall)
3. **Run locally**: Test functionality
4. **Security review**: If `security-sensitive` label
5. **Approve or request changes**

### For Team Leads

1. **Triage issues**: Add priority, service, effort labels
2. **Refine backlog**: Break down large items, define criteria
3. **Sprint planning**: Balance work across services and team
4. **Monitor metrics**: Track velocity, coverage, performance
5. **Remove blockers**: Address dependencies and impediments

## 📚 Additional Resources

- **[Architecture Overview](../specs/001-internal-developer-portal/diagram.md)**
- **[Development Guide](../CLAUDE.md)**
- **[Data Model](../specs/001-internal-developer-portal/data-model.md)**
- **[API Contracts](../specs/001-internal-developer-portal/contracts/)**

## 🆘 Need Help?

- **Workflow questions**: Check [WORKFLOW_GUIDE.md](WORKFLOW_GUIDE.md)
- **Setup issues**: See [PROJECT_BOARD_SETUP.md](PROJECT_BOARD_SETUP.md)
- **Technical questions**: Refer to [CLAUDE.md](../CLAUDE.md)
- **Team discussion**: Create a Technical Task issue

---

**Maintained by**: Platform Team
**Last Updated**: 2025-10-01
**Version**: 1.0
