# Self-service RBAC + "meet users where they are" discovery

**Date:** 2026-09-16
**Status:** Decisions made 2026-09-16 (§6). §7 is the committed phase plan; GitHub epic + per-phase issues track execution.
**Inputs:** codebase survey of the current authz model and self-service surfaces (2026-09-16), external research on Backstage, Port, Cortex, OpsLevel and Compass, and `docs/plans/2026-07-10-executable-org-model-strategy.md` §7.2 (execution authority ladder).

---

## 1. Where we are today (facts, verified)

**Self-service capabilities that exist**

| Capability | Collection | Who can run today | Who can author | Scoping model |
|---|---|---|---|---|
| Actions | `actions` / `action-runs` | any active workspace member (`action-runs.create = memberCreate`) | workspace owner/admin | single owning `workspace`, no sharing |
| Templates (scaffolding) | `templates` | anyone who can read it | workspace admin/owner | `visibility` workspace/shared/public + `sharedWith[]` + categories/tags |
| Launches | `launches` / `launch-templates` | any workspace member | launch templates: platform admin only | platform-curated, global |
| Automations | `automations` | n/a (event-triggered) | workspace owner/admin | single `workspace` |
| Infra Agent | `agent-runs` | workspace members | n/a | workspace |
| Discovery import | discovery queue | platform admin | n/a | global |

**Authorization substrate**

- Platform roles: `users.role` ∈ super_admin/admin/user. `isPlatformAdmin` is the one global bypass.
- Workspace roles: `workspace-members.role` ∈ owner/admin/member, keyed on Better-Auth id. Enforced through the factories in `orbit-www/src/lib/access/collection-access.ts`. This is the only authz that is actually enforced.
- A second, richer system exists and is **dead**: `permissions` (`resource:action` slugs), `roles`, `user-workspace-roles`, `loadUserPermissions`, `usePermissions`. Zero consumers outside its own files, and `loadUserPermissions` queries by Better-Auth id against a relationship field that stores Payload ids, so it could never resolve a grant anyway.
- Teams exist only as catalog entities (`catalog-entities.kind = team`) referenced by `catalog-entities.owner`. There is no roster linking a team to users, so "is Drew on team X" is unanswerable today.
- Approval already exists on Actions: `approvalPolicy` ∈ none / workspace-admin / platform-admin.

**Discovery surfaces**

- `/self-service` is already the unified hub for Actions, with a hardcoded "More ways to provision" block linking Templates, Launches, Agent.
- Dashboard (`/dashboard`) aggregates all workspaces. `DashboardQuickActions` is a **static list of six links**, not permission-aware and not connected to the real catalog. `DashboardAttention` (approvals, agent runs needing input) is a proven queue/spotlight pattern to reuse.
- Sidebar has no role gating on the main nav; platform nav is admin-only.
- There is no per-workspace "home" page; `/workspaces/[slug]` is a settings/detail view.

## 2. What the market converged on

- **Port**: per-action "who can execute" (everyone / users / teams / entity owners via a dynamic rule) and a separate "who must approve" (users/teams, any-one vs all). Actions appear both on a self-service page and on the entity page they target.
- **Backstage**: conditional policies (`IS_ENTITY_OWNER`, `HAS_TAG`) evaluated against the resource at query time. Raw framework is code-only and painful; the community RBAC plugin adds a no-code UI. Homepage is composable widgets.
- **Cortex**: view / edit / run as three separately grantable verbs on each workflow.
- **Compass**: a single Open vs Restricted org switch plus ownership checks. Deliberately blunt.
- **Pitfalls everyone reports**: policy DSLs nobody can maintain, individual allow-lists that rot, stale templates, and actions that exist but nobody knows about.

## 3. Proposed RBAC model

Design principle: **one resolver, four verbs, three principal types, no DSL.**

### 3.1 Principals

| Principal | Source | Status |
|---|---|---|
| User | `users` / Better-Auth id | exists |
| Workspace role | `workspace-members.role` | exists |
| Team | catalog `team` entity + **new roster** | roster needed |
| Platform admin | `users.role` | exists |

Team roster options (question Q1): a new `team-members` collection (team entity ↔ Better-Auth id, role lead/member), or a `members[]` field on the team entity. A separate collection is easier to sync from GitHub teams / Entra groups later, which is where rosters should ultimately come from.

### 3.2 Verbs

`view`, `edit`, `run`, `approve`. Every self-service capability (Actions, Templates, LaunchTemplates, Automations) gets the same `audience` group:

```ts
audience: {
  visibility: 'workspace' | 'shared' | 'public'   // who can VIEW (lifted from Templates)
  sharedWith: Workspace[]                          // when visibility = shared
  run: {
    mode: 'everyone' | 'restricted'
    roles?: ('owner'|'admin'|'member')[]
    teams?: CatalogEntity[]                        // kind: team
    users?: string[]                               // escape hatch, Better-Auth ids
    entityOwnersOnly?: boolean                     // Backstage IS_ENTITY_OWNER; applies when a run targets an entity
  }
  approve: {                                       // extends existing approvalPolicy
    policy: 'none' | 'workspace-admin' | 'platform-admin' | 'named'
    approvers?: { teams?: CatalogEntity[]; users?: string[] }
    requireAll?: boolean
  }
}
```

`edit` stays what it is today (workspace owner/admin, platform admin for launch templates). No new grant type.

### 3.3 Resolver

One server-side module, `orbit-www/src/lib/access/capabilities.ts`:

- `canRun(user, capability, { entity? })` → `{ allowed, reason }`. Reasons are user-facing ("restricted to team payments-core").
- `canApprove(user, run)`.
- `listRunnable(user, { workspaceIds?, entity?, kinds? })` → resolved list across Actions, Templates, LaunchTemplates. This is the feed every discovery surface reads.

Enforcement points: `action-runs.create` access, template instantiate server action, `launches.create`, `RunActionDialog` (UI hides or explains, server still decides). Platform admin bypasses run/approve as it does everything else.

### 3.4 Workspace posture preset (Compass idea)

`workspaces.selfServicePosture` ∈ `open` (default: `run.mode = everyone` unless an author restricts) or `restricted` (everything defaults to owner/admin + named teams). One switch a workspace admin understands before any per-action config exists.

### 3.5 What to do with the dead permissions system

Recommendation: **delete** `permissions`, `roles`, `user-workspace-roles`, `seed-roles.ts`, `app/actions/permissions.ts`, `lib/permissions.ts`, `hooks/usePermissions.ts`. It has no consumers, has a latent id bug, and a second role vocabulary next to workspace roles is exactly the "two systems, one enforced" trap. If a generic permission registry is ever wanted, it should be generated from the resolver's verbs, not maintained by hand. (Q3)

### 3.6 Relationship to the execution authority ladder

The strategy memo's ladder (Observe → Answer → Propose → Stage → Execute-gated → Execute-standing) is per change-class authority for the agent. The `audience.run` / `audience.approve` split here is the human-facing half of the same idea: `approve.policy = none` is level 5 standing authority for that capability, `named` approvers is level 4. Keep the vocabulary aligned so the agent's tool-listing can reuse `listRunnable(user)` unchanged.

## 4. Discovery: put capabilities where the user already is

Ranked by leverage.

1. **Dashboard "For you" feed** replaces the static `DashboardQuickActions`. Sourced from `listRunnable(user)`, ranked by: last run by you, last run by your team, recently published in your workspaces, then alphabetical. Card shows the capability, the workspace, and an approval badge if one is required. Empty state links to `/self-service`.
2. **Contextual actions on catalog entity pages.** Actions declare `targets: { kinds: ['service', 'api', ...], tags?: [] }`. The entity page renders a "Run on this service" menu of actions whose targets match and whose `canRun(user, action, { entity })` passes. This is Port's blueprint-attached actions and the single biggest discoverability win in the research.
3. **Scorecard failure → remediation.** A scorecard rule can reference a `remediationAction`. A failing rule on an entity page shows "Fix with <action>" prefilled with that entity. Automations already do the automatic version of this; this is the manual, visible one.
4. **Unified `/self-service`.** Fold Templates and Launch Templates into the same filtered grid as Actions (category, workspace, "runnable by me" toggle). Drop the hardcoded "More ways to provision" block.
5. **Workspace home.** Add a "Self-service" tab (or make it the default tab) on `/workspaces/[slug]` listing what this workspace publishes and what its members can run.
6. **Command palette / search.** Actions and templates indexed in MeiliSearch, runnable from search results.
7. **Notifications and Slack** (rides on issue #66): run started/finished/failed, approval requested, approval granted. Approval links deep-link into the run.
8. **Agent and MCP.** The infra agent's tool list becomes `listRunnable(user)`, so "deploy a preview env for billing-core" resolves to the same governed action a button would. Permission-aware by construction.
9. **New-member onboarding.** On workspace join, the first dashboard visit shows the workspace's pinned "getting started" capabilities (a `pinned: boolean` on audience).

## 5. Non-goals for the first cut

- No generic policy DSL, no CEL/Rego, no per-field permissions.
- No per-user allow-lists in the UI beyond the escape hatch.
- No delegated "admin of some workspaces" platform role.
- No IdP group sync (design the roster so it can be synced later).

## 6. Decisions (Drew, 2026-09-16)

| # | Question | Decision |
|---|---|---|
| Q1 | Team principal | New `team-members` roster collection (team entity ↔ Better-Auth id). Manual roster now, IdP/GitHub sync later. |
| Q2 | Default posture | Open by default; per-workspace `selfServicePosture = restricted` switch. |
| Q3 | Dormant permissions/roles/user-workspace-roles system | Delete it. |
| Q4 | Cross-workspace Actions and run ownership | Actions get `visibility` shared/public like Templates. A run's `workspace` is the workspace it was run from; `triggeredBy` (already on `action-runs`) is the executor. No ownership concept beyond that. `action-runs.delete` (currently `false`) becomes: the `triggeredBy` user, or an owner/admin of the run's workspace, or platform admin. Read stays workspace-scoped. |
| Q5 | Named approvers | Yes, Phase 3. |
| Q6 | Contextual entity-page actions | Yes, Phase 2. |
| Q7 | Who edits audience settings | Workspace owner/admin **and** platform admin. |
| Q8 | Per-user grants | Roles + teams in the UI; `audience.run.users` exists only as an API/admin-panel escape hatch. |
| Q9 | Tracking | One GitHub epic + one issue per phase (created 2026-09-16, see §8). |

Note on `triggeredBy`: it is a relationship to `users` (Payload id). The delete rule must compare against `user.id`, not the Better-Auth id used by the workspace-membership helpers. Do not mix them (issue #63 bug class).

## 7. Phased plan

Each phase is independently shippable and lands as its own PR(s). Phases 1 and 2 can run in parallel worktrees once Phase 0 merges.

**Phase 0: foundation (small)**
- Add `audience` group to `Actions` (visibility, sharedWith, run.mode/roles/teams/users) with `run.mode = everyone` default so nothing changes behaviourally.
- `lib/access/capabilities.ts` with `canRun` and `listRunnable`; unit tests first.
- Gate `action-runs.create` through `canRun`; `/self-service` hides or explains non-runnable actions.
- Delete the dormant permissions system (Q3).
- Verification: vitest for the resolver, agent-browser on `/self-service` as member vs admin.

**Phase 1: dashboard feed + unified hub**
- Replace `DashboardQuickActions` with a live "For you" feed from `listRunnable`.
- Fold Templates and Launch Templates into `/self-service` and into `listRunnable`.
- Workspace page "Self-service" tab.

**Phase 2: teams + contextual actions**
- `team-members` roster collection + admin UI on the team entity page.
- `audience.run.teams` and `entityOwnersOnly` resolve through the roster.
- `targets` on Actions; entity page "Run on this entity" menu.
- Scorecard rule `remediationAction` link.

**Phase 3: approvals + posture**
- `approve.policy = named`, approvers by team/user, any-one vs all; runs park in `awaiting_approval`, surfaced in `DashboardAttention`.
- Workspace `selfServicePosture` switch and audience editor UI in the authoring form.
- Notifications for approvals and run outcomes (depends on #66).

**Phase 4: other entry points**
- Search indexing, agent/MCP tool listing from `listRunnable`, Slack delivery, onboarding pins.

Ordering rationale: Phase 0 makes every later surface trustworthy because the UI and the server agree on one resolver. Phase 1 is the visible win with the least new modelling. Teams come before approvals because named approvers need a roster.

Phase 0 additions from Q4: `action-runs.delete` opened to executor / workspace owner-admin / platform admin; `Actions.audience.visibility` + `sharedWith` included so `listRunnable` can span workspaces from the start.

Each phase gets its own detailed plan file (`docs/plans/2026-09-XX-self-service-phase-N-*.md`) with exact file paths and verification steps before code starts, per the project workflow.

## 8. Tracking

Epic #132. Phases: #127 (P0), #128 (P1), #129 (P2), #130 (P3), #131 (P4).
