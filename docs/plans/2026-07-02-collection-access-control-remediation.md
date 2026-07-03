# Collection Access-Control Remediation (GitHub issue #63)

**Date:** 2026-07-02
**Status:** Implemented on `fix/63-collection-access-control` — QA validated (all 13 UAC PASS, zero must-fix findings). Final scope grew beyond the original 27 files: +4 kafka files with a `user?.collection` variant, +16 WP4 files including the RBAC privilege-escalation chain (Roles/Permissions/UserWorkspaceRoles `!!user` writes + `loadUserPermissions` trusting them), +Deployments/KnowledgeSpaces create gaps.
**Owner:** PM session (Claude) directing engineer + QA agents

## Problem

PR #62 fixed a broken access pattern on `catalog-entities`/`catalog-relations`; the
same two bugs exist verbatim in 27 more files, and 10 further collections carry
bug 2 alone:

1. **Bug 1 — universal admin bypass.** `if (user.collection === 'users') return true`
   was meant as a Payload-admin bypass, but `users` is the ONLY auth collection
   (`payload.config.ts` registers no other), so every authenticated Better-Auth
   user short-circuits to full read/update/delete. `kafka/KafkaServiceAccounts.ts`
   has the guard *inverted* (`!== 'users'`) — a no-op that never denies.
2. **Bug 2 — wrong identity in membership checks.** Fallback queries filter
   `workspace-members.user: { equals: user.id }` with the Payload doc id, but that
   TEXT field stores the **Better-Auth id** (`WorkspaceMembers.ts:75`, rows created
   with `user: betterAuthId` in `Workspaces.ts:279`). The query always returns
   nothing. Today correctness is carried entirely by bug 1; fixing bug 1 alone
   would lock members out — both must be fixed together.

Impact: the direct Payload REST/GraphQL API is effectively tenant-unbounded for
any logged-in user across apps, API schemas, Kafka, scorecards, actions, and
automations. (The UI is safe: server actions scope by workspace and run with
`overrideAccess`.) The 10 bug-2-only collections are the inverse failure —
broken *closed*: legitimate members get nothing via the direct API.

## Fix reference (proven in PR #62)

- `orbit-www/src/lib/access/workspace-access.ts` — correct membership helpers,
  all keyed on `betterAuthId`; `isPlatformAdmin(user)` = `user.role` ∈
  `super_admin`/`admin`.
- `orbit-www/src/lib/catalog/entity-authz.ts` + `collections/catalog/CatalogEntities.ts`
  — the collection-access shape to replicate.
- Test pattern: pure Vitest with a hand-rolled `makePayload(members)` mock
  (`src/lib/catalog/entity-authz.test.ts`, `src/lib/access/__tests__/workspace-access.test.ts`).

## User Acceptance Criteria (UAC)

The work is DONE only when every criterion below holds:

- **UAC-1** `grep -rn "collection === 'users'\|collection !== 'users'" orbit-www/src/collections/` returns **zero** matches.
- **UAC-2** No access rule queries `workspace-members` with a Payload `user.id`.
  Every membership lookup in access code passes `user.betterAuthId`. Grep guard:
  no `user: { equals: user.id }` (or equivalent) against `workspace-members`
  anywhere under `src/collections/`.
- **UAC-3** The only privilege bypass in collection access is `isPlatformAdmin(user)`
  (role-based). A user with `role: 'user'` gets **no** bypass anywhere.
- **UAC-4** Unauthenticated requests (`!user`) are denied every operation on every
  affected collection.
- **UAC-5** An authenticated non-member of workspace W cannot: read W-scoped docs
  (read filter excludes them), create docs bound to W (`data.workspace`
  validated), or update/delete W's docs — on every affected collection.
- **UAC-6** An active member of W retains the collection's *intended* semantics:
  workspace-filtered read; mutations gated by the same role lists the code
  intended before the fix (see policy matrix). No collection's read scope is
  broadened.
- **UAC-7** System/global collections and system-written rows are platform-admin
  only from the user-facing API: BifrostConfig, KafkaTopicPolicies,
  KafkaTopicSharePolicies (all ops); Archetype-B writes (metrics/activity/
  lag/lineage/snapshots/etc.); KafkaApplicationQuotas writes.
- **UAC-8** KafkaServiceAccounts: inverted no-op guard removed; create/update
  require workspace **owner/admin** (workspace resolved via the referenced
  application/virtualCluster); delete stays `false` (soft-delete via revoke).
- **UAC-9** Internal writeback paths are untouched: no changes to server actions,
  `/api/internal/**` X-API-Key routes, or any `overrideAccess: true` call sites.
- **UAC-10** All fixed access logic routes through ONE shared library
  (`src/lib/access/collection-access.ts`); the three duplicated
  `{scorecards,actions,automations}/access.ts` modules are thin re-exports of it
  (import sites unchanged) or their importers point at the library directly.
- **UAC-11** Vitest unit tests (makePayload mock pattern) cover, at minimum:
  role-based admin bypass grants; `role: 'user'` gets NO bypass (bug-1 regression
  guard); membership queries assert the exact where-shape uses the Better-Auth id
  (bug-2 regression guard); member vs non-member outcomes; role gating
  (owner/admin vs member); indirect workspace resolution (parent-relation
  collections); null/missing `data.workspace` on create ⇒ deny (admin excepted
  only where policy says global-admin-only).
- **UAC-12** `pnpm exec vitest run` (frontend suite), `make lint-frontend`, and a
  production typecheck of orbit-www all pass.
- **UAC-13** The 10 bug-2-only collections (KnowledgePages, Templates, Launches,
  DeploymentGenerators, CloudAccounts, LLMProviders, AgentTools,
  AgentToolVersions, AgentRuns, PendingApprovals) use the shared library and
  work for legitimate members.

Out of scope (tracked separately): the 3 server-component `user.id` call sites
(`catalog/apis/[id]/page.tsx:46`, `agent/page.tsx:38`, `workspaces/actions.ts:96`)
— broken-closed UI bugs, follow-up issue to be filed at ship time. Go-layer #50
is unchanged.

## Policy matrix (PM decisions)

| Collection(s) | read | create | update | delete |
|---|---|---|---|---|
| scorecards suite (8 colls via `scorecards/access.ts`), actions suite (2), automations (1) | admin ∪ member-workspaces filter | preserve intended role (manage-create = owner/admin of `data.workspace`; member-create = active member) | preserve intended role list on doc's workspace | same |
| Apps, PatternInstances, KafkaApplications, KafkaSchemas, KafkaTopics | admin ∪ member filter | **active member of `data.workspace`** (was `!!user` — gap closed) | intended roles (e.g. owner/admin/member) | intended roles (e.g. owner/admin) |
| APISchemas | preserve visibility semantics (public/workspace/private), membership fixed; verify `createdBy` comparison semantics (relationship to users ⇒ `user.id` is correct — do not blindly change) | active member of `data.workspace` | intended | intended |
| APISchemaVersions | admin ∪ member filter (denormalized `workspace`) | active member of `data.workspace` | platform admin only (was system-only intent) | platform admin only |
| KafkaApplicationRequests | preserve `or` shape (own requests ∪ member workspaces), identities fixed | active member of `data.workspace` | intended | requester-only preserved |
| KafkaTopicShares | admin ∪ member filter over `ownerWorkspace`/`targetWorkspace` | preserve manage-create role on `data.ownerWorkspace` | intended | intended |
| KafkaLineageEdge | `or` over `sourceWorkspace`/`targetWorkspace`, identities fixed | platform admin | platform admin | platform admin |
| Archetype B (KafkaClientActivity, KafkaConsumerGroupLagHistory, KafkaConsumerGroups, KafkaLineageSnapshot, KafkaUsageMetrics, KafkaSchemaVersions, KafkaVirtualClusters, KafkaOffsetCheckpoints, HealthChecks) | admin ∪ member filter (indirect: resolve via parent — OffsetCheckpoints via virtualCluster→application→workspace; HealthChecks via app→workspace) | platform admin (system rows come via overrideAccess) | platform admin (or keep hard `false` where already `false`) | preserve (admin / `false`) |
| BifrostConfig, KafkaTopicPolicies, KafkaTopicSharePolicies | platform admin only (all ops; preserve `delete: false` on BifrostConfig). Workspace-scoping the two Policies collections is a product follow-up, NOT this PR | | | |
| KafkaApplicationQuotas | owner/admin-of-workspace filter (as intended), identities fixed | platform admin | platform admin | platform admin |
| KafkaServiceAccounts | admin ∪ member filter, workspace resolved via application/virtualCluster | **owner/admin** of resolved workspace | owner/admin | `false` (unchanged) |
| WP4 ten collections | keep each file's intended shape; swap identity to `betterAuthId` via shared helpers | same | same | same |

Cross-cutting rules:
- `!user` ⇒ `false`, always, first line.
- Missing/`null` `data.workspace` on create ⇒ deny for non-admins (catalog "global ⇒ admin-only" rule).
- Missing `user.betterAuthId` (pre-first-login edge) ⇒ treat as non-member; never throw.
- Read filters return `Where` objects (never fetch-all-then-filter); admin returns `true`.

## Work packages

- **WP1 (Opus)** — `src/lib/access/collection-access.ts`: composable access-rule
  factories built on `workspace-access.ts` (e.g. `workspaceScopedRead()`,
  `memberCreate()`, `manageCreate(roles)`, `docWorkspaceMutate(slug, roles,
  resolveWorkspace?)`, `adminOnly`, multi-field read filters, indirect resolvers).
  TDD: tests first (makePayload pattern), watch fail, implement. Rewrite the three
  shared `access.ts` modules on top. This unblocks WP2–4.
- **WP2 (Sonnet)** — the 19 `kafka/` files, per the matrix + archetype notes.
- **WP3 (Sonnet)** — Apps, HealthChecks, PatternInstances, APISchemas,
  APISchemaVersions.
- **WP4 (Sonnet)** — the 10 bug-2-only collections; verify-then-skip
  UserWorkspaceRoles.ts / PageLinks.ts (their `user` fields likely store Payload
  ids — confirm and do not change if so).
- **QA** — adversarial review against every UAC; grep audits; full test/lint/build.

## Verification

1. UAC-1/2 grep audits (commands in UAC).
2. `cd orbit-www && pnpm exec vitest run` — all green.
3. `make lint-frontend` — clean.
4. `cd orbit-www && pnpm exec tsc --noEmit` — clean.
5. QA agent adversarial pass: for each archetype, walk a non-member / member /
   owner / platform-admin / anonymous matrix through the new closures.
