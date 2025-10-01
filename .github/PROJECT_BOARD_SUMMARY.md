# GitHub Projects Board - Visual Summary

Quick visual reference for the Orbit IDP project board structure.

## 📊 Board Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                  Orbit IDP - Development Board                   │
│                                                                   │
│  Views: Sprint Board | Service Kanban | TDD Workflow | ...      │
└─────────────────────────────────────────────────────────────────┘

Status Flow:
📋 Backlog → 🔍 Refined → 🏗️ In Progress → 👀 In Review →
✅ Testing/QA → 🚀 Ready for Deploy → ✨ Done
```

## 🏷️ Label System

### By Type (Auto-applied from templates)
```
🐛 bug             ✨ feature         📚 documentation
🔧 tech-task       🧪 test            🏗️ infrastructure
```

### By Priority
```
🔴 priority:critical (P0)  🟠 priority:high (P1)
🟡 priority:medium (P2)    🟢 priority:low (P3)
```

### By Service/Area
```
🎨 frontend                📦 service:repository
📊 service:api-catalog     📖 service:knowledge
⏱️ service:temporal        🔌 Protocol Buffers
🏗️ infra                   🔒 Security/Auth
📱 Cross-Service
```

### By Development Phase
```
⚪ phase:setup          🟣 phase:tdd
🔵 phase:implementation 🟢 phase:integration
🟠 phase:qa
```

### Special Labels
```
🚫 blocked                 ⚠️ needs-refinement
✅ ready-for-review        💥 breaking-change
🧪 tdd-required            📊 needs-tests
⚡ performance-critical    🔒 security-sensitive
```

## 🎯 Custom Fields

| Field | Type | Options |
|-------|------|---------|
| **Status** | Single Select | Backlog → Refined → In Progress → In Review → Testing/QA → Ready for Deploy → Done |
| **Type** | Single Select | Bug, Feature, Documentation, Technical Task, Test, Infrastructure |
| **Priority** | Single Select | Critical (P0), High (P1), Medium (P2), Low (P3) |
| **Service/Area** | Single Select | Frontend, Repository, API Catalog, Knowledge, Temporal, Proto, Infra, Security, Cross-Service |
| **Effort** | Single Select | XS (<2h), S (<1d), M (1-3d), L (3-5d), XL (>1w) |
| **Sprint** | Iteration | 2-week sprints |
| **TDD Phase** | Single Select | 🔴 Test First → 🟢 Make it Pass → 🔵 Refactor → ✅ Complete |
| **Test Coverage %** | Number | Target: 90% (business logic), 80% (overall) |
| **Performance Target** | Text | e.g., "<200ms p95", "<100ms auth", "<30s code gen" |

## 📈 Views Reference

### 1️⃣ Sprint Board (Primary)
```
┌──────────────┬──────────────┬──────────────┬──────────────┐
│   Refined    │ In Progress  │  In Review   │  Testing/QA  │
├──────────────┼──────────────┼──────────────┼──────────────┤
│ [P0] Task A  │ [P0] Task B  │ [P1] Task C  │ [P1] Task D  │
│ [P1] Task E  │ [P1] Task F  │              │              │
│              │              │              │              │
└──────────────┴──────────────┴──────────────┴──────────────┘
```
**Use**: Daily standups, sprint tracking
**Filter**: Current sprint only
**Sort**: Priority (High → Low)

### 2️⃣ Service Kanban
```
┌────────────┬────────────┬────────────┬────────────┐
│  Frontend  │ Repository │ API Catalog│  Knowledge │
├────────────┼────────────┼────────────┼────────────┤
│ In Progress│ In Review  │ In Progress│ Refined    │
│ Testing/QA │ Testing/QA │ Refined    │            │
│            │            │            │            │
└────────────┴────────────┴────────────┴────────────┘
```
**Use**: Visualize work distribution
**Filter**: Status ≠ Done
**Group by**: Service/Area

### 3️⃣ TDD Workflow
```
┌─────────────┬─────────────┬─────────────┬─────────────┐
│  Test First │ Make it Pass│  Refactor   │  Complete   │
├─────────────┼─────────────┼─────────────┼─────────────┤
│ Write test  │ Implement   │ Clean up    │ Done ✓      │
│ for Task A  │ Task B      │ Task C      │ Task D      │
│ Coverage: 0%│ Coverage: 75│ Coverage: 92│ Coverage: 95│
└─────────────┴─────────────┴─────────────┴─────────────┘
```
**Use**: Ensure TDD compliance
**Filter**: Type = Test OR Technical Task
**Shows**: Test Coverage %

### 4️⃣ Backlog Refinement
```
Status: Backlog
┌────────┬──────────────────────────┬──────────┬────────┐
│Priority│ Title                     │ Service  │ Effort │
├────────┼──────────────────────────┼──────────┼────────┤
│ P0 🔴  │ Fix critical auth bug     │ Security │ S      │
│ P1 🟠  │ Add repo search           │ Repo     │ M      │
│ P2 🟡  │ Update API docs           │ Docs     │ S      │
│ P3 🟢  │ Refactor cache layer      │ Infra    │ L      │
└────────┴──────────────────────────┴──────────┴────────┘

Status: Refined (Ready for sprint)
┌────────┬──────────────────────────┬──────────┬────────┐
│Priority│ Title                     │ Service  │ Effort │
├────────┼──────────────────────────┼──────────┼────────┤
│ P0 🔴  │ Implement OAuth flow      │ Security │ L      │
│ P1 🟠  │ Add GraphQL schema        │ Catalog  │ M      │
└────────┴──────────────────────────┴──────────┴────────┘
```
**Use**: Sprint planning, grooming
**Sort**: Priority, then Effort

### 5️⃣ Bug Triage
```
┌─────────────────────────────────────────────────────────┐
│ Critical (P0)                                            │
├─────────────────────────────────────────────────────────┤
│ 🐛 Auth fails for new users         │ Security │ S     │
│ 🐛 Search returns 500 error         │ Knowledge│ M     │
└─────────────────────────────────────────────────────────┘
│ High (P1)                                                │
├─────────────────────────────────────────────────────────┤
│ 🐛 Code gen timeout on large schemas│ Catalog  │ L     │
│ 🐛 UI breaks on mobile viewport     │ Frontend │ S     │
└─────────────────────────────────────────────────────────┘
```
**Use**: Prioritize and assign bugs
**Group by**: Priority
**Sort**: Created date (newest first)

### 6️⃣ Documentation Tracker
```
┌──────────────────────────────────┬─────────────┬──────────┐
│ Title                             │ Service     │ Status   │
├──────────────────────────────────┼─────────────┼──────────┤
│ API integration guide             │ Catalog     │ Review   │
│ Temporal workflow docs            │ Temporal    │ Progress │
│ Frontend component library        │ Frontend    │ Backlog  │
└──────────────────────────────────┴─────────────┴──────────┘
```
**Use**: Track documentation coverage
**Filter**: Type = Documentation

### 7️⃣ Performance Dashboard
```
┌─────────────────────┬─────────┬────────────┬──────────┬──────┐
│ Title                │ Service │ Target     │ Coverage │Status│
├─────────────────────┼─────────┼────────────┼──────────┼──────┤
│ API response time    │ Repo    │ <200ms p95 │ 95%      │ Pass │
│ Auth performance     │ Security│ <100ms     │ 88%      │ Pass │
│ Code generation      │ Catalog │ <30s       │ 92%      │ Pass │
└─────────────────────┴─────────┴────────────┴──────────┴──────┘
```
**Use**: Monitor performance targets
**Filter**: Performance Target is set

## 🔄 Workflow Automation

### Automatic Status Updates
```
Issue created ──────────→ Backlog
PR linked ──────────────→ In Review
PR merged ──────────────→ Testing/QA
Issue closed ────────────→ Done
```

### Label-based Automation
```
Label "bug" added ──────→ Type = Bug
Label "priority:critical"→ Priority = Critical (P0)
Label "tdd-required" ───→ TDD Phase = Test First
```

## 📅 Milestones

```
┌─────────────────────────────────────────────────────────────┐
│ Foundation (Phase 3.1)           │ Due: Oct 15  │ T001-T010│
│ ▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░   35% complete            │
├─────────────────────────────────────────────────────────────┤
│ TDD Gate (Phase 3.2)             │ Due: Nov 5   │ T011-T028│
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░   85% complete            │
├─────────────────────────────────────────────────────────────┤
│ Core Services (Phase 3.3)        │ Due: Dec 3   │ T029-T044│
│ ▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░   30% complete            │
├─────────────────────────────────────────────────────────────┤
│ Frontend & Workflows             │ Due: Dec 24  │ T045-T052│
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   0% complete             │
├─────────────────────────────────────────────────────────────┤
│ Integration (Phase 3.4)          │ Due: Jan 7   │ T053-T062│
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   0% complete             │
├─────────────────────────────────────────────────────────────┤
│ Production Ready (Phase 3.5)     │ Due: Jan 21  │ T063-T074│
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   0% complete             │
└─────────────────────────────────────────────────────────────┘
```

## 🎭 Common Workflows

### TDD Workflow (Constitutional Requirement)
```
┌─────────────────────────────────────────────────────────────┐
│                                                              │
│  1. 🔴 TEST FIRST                                            │
│     ├─ Write failing test                                   │
│     ├─ Set TDD Phase = "Test First"                         │
│     └─ Verify test fails                                    │
│                                                              │
│  2. 🟢 MAKE IT PASS                                          │
│     ├─ Implement minimal code                               │
│     ├─ Set TDD Phase = "Make it Pass"                       │
│     └─ Test passes                                          │
│                                                              │
│  3. 🔵 REFACTOR                                              │
│     ├─ Improve code quality                                 │
│     ├─ Set TDD Phase = "Refactor"                           │
│     └─ Tests still pass                                     │
│                                                              │
│  4. ✅ COMPLETE                                              │
│     ├─ Update Test Coverage % (target: 90%+)                │
│     ├─ Set TDD Phase = "Complete"                           │
│     └─ Create PR                                            │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Bug Fix Workflow
```
1. 🐛 Bug reported (template) → Auto: Backlog
2. 🔍 Triage
   ├─ Add priority label (P0-P3)
   ├─ Add service label
   └─ Move to Refined if high priority
3. 👤 Assign developer → In Progress
4. 🧪 Write test that reproduces bug
5. 🔧 Fix bug
6. ✨ Refactor
7. 📤 Create PR → Auto: In Review
8. ✅ Merge → Auto: Testing/QA
9. 🚀 Verify → Ready for Deploy
10. 🎉 Deploy → Close → Auto: Done
```

### Feature Development Workflow
```
1. ✨ Feature request → Auto: Backlog
2. 📋 Refine
   ├─ Break into subtasks
   ├─ Define acceptance criteria
   └─ Create test tasks
3. 🧪 Test task → tdd-required label
4. 🔴 Write tests (TDD: Test First)
5. 🔧 Implementation task
6. 🟢 Implement (TDD: Make it Pass)
7. 🔵 Refactor (TDD: Refactor)
8. 📊 Verify coverage (90%+ business logic)
9. 📤 PR → Auto: In Review
10. ✅ Merge → Auto: Testing/QA
11. 🚀 Deploy → Done
```

## 📊 Key Metrics Dashboard

### Sprint Health
```
┌─────────────────────────────────────────────────────┐
│ Velocity: 42 pts  (Target: 40 pts)  ✅              │
│ Completion Rate: 90%                 ✅              │
│ Avg Cycle Time: 3.2 days            ⚠️ (Target: 3d)│
└─────────────────────────────────────────────────────┘
```

### Quality Metrics
```
┌─────────────────────────────────────────────────────┐
│ Test Coverage: 88%                   ⚠️ (Target: 90%)│
│ Bug Escape Rate: 5%                  ✅ (Target: <10%)│
│ Performance: 195ms p95               ✅ (Target: 200ms)│
└─────────────────────────────────────────────────────┘
```

### Team Distribution
```
Frontend:     ████████░░  80%
Repository:   ██████░░░░  60%
API Catalog:  ████░░░░░░  40%
Knowledge:    ████░░░░░░  40%
Temporal:     ██░░░░░░░░  20%
Infra:        ██████░░░░  60%
```

## 🚀 Quick Actions

### For Developers
```bash
# Start work
1. Assign yourself to issue
2. Move to "In Progress"
3. git checkout -b ORB-123-feature
4. Write test (if tdd-required)
5. Implement
6. Create PR (Closes #123)
```

### For Reviewers
```bash
# Review PR
1. Check tests included
2. Verify coverage (90%+)
3. Run locally
4. Approve or request changes
5. Merge when approved
```

### For Team Leads
```bash
# Sprint planning
1. Open "Backlog Refinement" view
2. Prioritize issues
3. Add labels, effort
4. Move to "Refined"
5. Assign to sprint
6. Balance across services
```

## 📚 Documentation Links

- **Setup Guide**: [.github/PROJECT_BOARD_SETUP.md](.github/PROJECT_BOARD_SETUP.md)
- **Workflow Guide**: [.github/WORKFLOW_GUIDE.md](.github/WORKFLOW_GUIDE.md)
- **Issue Templates**: [.github/ISSUE_TEMPLATE/](.github/ISSUE_TEMPLATE/)
- **Tasks Breakdown**: [specs/001-internal-developer-portal/tasks.md](specs/001-internal-developer-portal/tasks.md)
- **Architecture**: [specs/001-internal-developer-portal/diagram.md](specs/001-internal-developer-portal/diagram.md)

## 🎯 Success Criteria

### Sprint Success
- ✅ All committed work completed
- ✅ Test coverage ≥90% (business logic), ≥80% (overall)
- ✅ Performance targets met (<200ms p95, <100ms auth, <30s codegen)
- ✅ No high-severity security issues
- ✅ All TDD-required tasks follow proper workflow

### Release Success
- ✅ All milestones completed on time
- ✅ Zero critical bugs in production
- ✅ Performance SLOs maintained
- ✅ Documentation complete and accurate
- ✅ Team velocity stable and predictable
