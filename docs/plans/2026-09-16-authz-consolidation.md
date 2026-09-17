# Authorization consolidation: one identity, one policy module

**Date:** 2026-09-16
**Status:** Approved 2026-09-17 (decisions in §5). Blocks self-service RBAC Phase 0 (#127). Tracked in GitHub (§6).
**Inputs:** full authz decision-point audit of orbit-www (2026-09-16), issue #69, `docs/plans/2026-09-16-self-service-rbac-and-discovery.md`.

---

## 1. Why the disconnects keep appearing

Every bug found so far (issue #63, #69, and the new ones below) has the same shape: code compares a Payload `users.id` against `workspace-members.user`, which stores the Better-Auth id. That happens because the codebase has **two "current user" helpers whose `.id` means different things**, and **seven different ways of expressing "is this user allowed"**, so each new feature re-derives identity and policy by hand and gets one of them wrong.

### 1.1 Identity: two helpers, two ids

| Helper | Returns | `.id` is |
|---|---|---|
| `getCurrentUser()` (`lib/auth/session.ts`) | Better-Auth session user | Better-Auth id |
| `getPayloadUserFromSession()` (`lib/auth/session.ts`) | Payload `users` doc | Payload id (`.betterAuthId` holds the other) |
| `betterAuthStrategy` (`lib/payload-better-auth-strategy.ts`) | Payload `req.user` for collection access | Payload id |

Callers of the second helper that then query workspace membership with `.id` are the entire bug list:

- `app/(frontend)/catalog/apis/[id]/page.tsx:46` (#69)
- `app/(frontend)/agent/page.tsx` (#69, renders zero workspaces)
- `app/(frontend)/workspaces/actions.ts:96` (#69)
- `app/api/agent/[runId]/stream/route.ts:78` (#69, gate always false)
- `collections/UserWorkspaceRoles.ts:18,26` (new; dormant collection)
- `app/actions/permissions.ts:30` (new; dormant system)

All under-grant rather than over-grant, which is why they have survived. Callers of the first helper are consistently correct.

Counts: 38 files use `getCurrentUser`, 53 use `getPayloadUserFromSession`, 74 use `getSession` directly.

### 1.2 Policy: seven expressions of one rule

| # | Where | What it is |
|---|---|---|
| 1 | `lib/access/collection-access.ts` + `workspace-access.ts` | Sanctioned factories. ~30 collections use them. |
| 2 | ~18 collections with inline `access` closures | Hand-rolled, mostly for indirect joins (page→space→workspace etc.). |
| 3 | `lib/actions/authz.ts`, `lib/automations/authz.ts`, `lib/scorecards/authz.ts` | Three copy-pasted `hasWorkspaceRole` implementations, independent of #1. |
| 4 | `lib/catalog/entity-authz.ts` | Fourth reimplementation, built on `workspace-access.ts`. |
| 5 | 63 files querying `collection: 'workspace-members'` directly | Ad hoc inline checks inside server actions, pages, routes. |
| 6 | `lib/auth/internal-api-auth.ts` | Shared-secret header for `/api/internal/**` (62 routes, all covered). |
| 7 | `lib/grpc/svc-auth-token.ts` + Go `svcauth` | HS256 JWT with `sub`/`wid`/`adm` claims. |

Rows 6 and 7 are different actors (services, not users) and stay separate. Rows 2 to 5 must collapse into row 1.

### 1.3 Other findings

- `overrideAccess: true` appears in 128 files under `src/app`. The audit found no case that lacked a prior session check, but nothing enforces that; the pattern is "check something by hand, then bypass Payload entirely", which is exactly what lets rows 3 to 5 exist.
- The dormant `permissions` / `roles` / `user-workspace-roles` system has zero consumers and carries bug 1.1 itself.
- 45 fields are relationships to `users` (Payload id) and one field, `workspace-members.user`, is a text field holding a Better-Auth id. That single field is the only reason the Better-Auth id ever leaves the session boundary.
- Client gating: `usePlatformAdmin` reads `role` from the Better-Auth client session. Fine, but it is a second source for "is admin" next to `isPlatformAdmin(user)`.

## 2. Target state

One principle: **the Better-Auth id exists only at the session boundary. Inside the app there is one `Actor`, one policy module, and Payload relationships everywhere.**

```
orbit-www/src/lib/authz/
  actor.ts       getActor() / requireActor()   – the ONLY way to obtain the current user on the server
  membership.ts  membership lookups, request-cached, keyed on Actor (not on a bare id)
  policy.ts      can(actor, verb, resource)     – the ONLY place policy lives
  payload.ts     access-function adapters for collections (replaces collection-access.ts factories, same signatures)
  server.ts      authorize(verb, resource) for server actions and API routes → throws AuthzError (403)
  index.ts
```

### 2.1 Actor

```ts
type Actor = {
  payloadId: string          // users.id
  betterAuthId: string       // users.betterAuthId; used ONLY by membership.ts and svc-auth-token.ts
  email: string
  role: 'super_admin' | 'admin' | 'user'
  isPlatformAdmin: boolean
  user: User & { collection: 'users' }   // pass to payload.local calls as `user`
}
```

No bare `.id`. Any code that wants an id has to pick `payloadId` or `betterAuthId` by name, which makes the 1.1 bug class unwritable. `getActor()` is wrapped in React `cache()` so a request resolves the session and the users doc once. `getCurrentUser`, `getPayloadUserFromSession`, and direct `getSession` use outside `lib/authz` and `lib/auth` are banned by lint.

### 2.2 Policy

```ts
type Verb = 'read' | 'create' | 'update' | 'delete' | 'manage' | 'run' | 'approve'
type Resource =
  | { kind: 'workspace'; id: string }
  | { kind: 'doc'; collection: CollectionSlug; workspaceId: string; ownerPayloadId?: string }
  | { kind: 'capability'; capability: Action | Template | LaunchTemplate; entity?: CatalogEntity }   // self-service RBAC lands here
  | { kind: 'platform' }

can(actor, verb, resource): Promise<Decision>   // { allowed: boolean; reason: string }
```

Rules today are simple and stay simple: platform admin allows everything; `read`/`create`/`run` need active membership; `update`/`delete`/`manage` need owner/admin; `delete` of a workspace needs owner; `approve` per the capability's approval policy. `reason` is user-facing and is what the self-service UI shows for non-runnable items.

### 2.3 Payload adapters

`collection-access.ts` keeps its exported names and signatures (`adminOnly`, `workspaceScopedRead`, `memberCreate`, `manageCreate`, `docWorkspaceMutate`) but becomes a thin re-export of `lib/authz/payload.ts`, so the ~30 conforming collections do not change. The ~18 inline collections migrate to the adapters, adding a `resolveWorkspace` for the indirect joins where needed (the factories already support this).

### 2.4 Server actions and routes

`authorize('manage', { kind: 'workspace', id })` replaces every inline `workspace-members` query. Server actions keep using `overrideAccess: true` for the data call after `authorize`, which is the established pattern, but the check before it is now uniform and lint-enforced.

### 2.5 The one data change

`workspace-members.user` becomes a relationship to `users` (Payload id). After this, `betterAuthId` is used in exactly two places: resolving the Actor from the session, and minting the service JWT `sub`. Migration is an idempotent reconciler: for each membership, look up `users.betterAuthId = user`, write the Payload id to a new `userRef` field, verify counts, cut the access layer over, then drop the old field. Dry-run prints unmatched rows (Better-Auth-only accounts; `ensurePayloadUser` self-heal means these should be zero but the dry run proves it).

This step is the only one with downtime or rollback considerations. It can be deferred: with 2.1 to 2.4 done, the mixed key is confined to `membership.ts`. It is still worth doing, because until then every new membership query written outside the module is a latent 1.1 bug, and Payload populate/joins on members cannot work.

### 2.6 What does not change

- Better-Auth stays the session and credential authority. Roles and status stay on the Payload `users` doc and mirrored into the session as today.
- `/api/internal/**` shared-secret auth and the gRPC svc-auth JWT stay as they are; they are different actors.
- No Better-Auth `organization` plugin migration. It would move workspaces, members, and teams into Better-Auth's own tables next to 45 Payload relationships and a Payload admin panel that cannot see them. Its access-control statements idea is good and 2.2 borrows it, but the data should stay in Payload. Revisit only if SSO group sync becomes the primary membership source.

## 3. Phases

Each phase is its own PR, adversarially reviewed, and leaves the app fully working. A and B can run in parallel worktrees; C depends on A; D depends on B; E is last.

**A. Actor + identity fixes (small, unblocks everything)**
- `lib/authz/actor.ts` with `getActor`/`requireActor`, request-cached. Tests.
- Fix the six 1.1 sites by switching them to `requireActor().betterAuthId` (one-line swaps). Closes #69 items 1 and 2.
- Lint: `no-restricted-imports` for `getCurrentUser`/`getPayloadUserFromSession`/`getSession` outside `lib/authz` and `lib/auth`; `no-restricted-syntax` for `collection: 'workspace-members'` outside `lib/authz`. Initially as warnings with a baseline count; flipped to errors at the end of D.
- agent-browser: `/agent` shows workspaces, agent stream loads, catalog API page renders.

**B. Policy module + collection adapters**
- `lib/authz/policy.ts`, `membership.ts`, `payload.ts`. `collection-access.ts` becomes re-exports. Full matrix test (member/admin/owner/none/platform-admin × verbs).
- Migrate the 18 inline collections to adapters. Closes #69 item 3 (PageLinks, AgentToolVersions tests) as part of the same PR. Decide #69 item 4 (Kafka policy collections) here.
- Delete the dormant system: `Permissions.ts`, `Roles.ts`, `UserWorkspaceRoles.ts`, `seed-roles.ts`, `app/actions/permissions.ts`, `lib/permissions.ts`, `hooks/usePermissions.ts`, config registrations, generated types.

**C. Server actions and routes onto `authorize()`**
- Replace `lib/actions/authz.ts`, `lib/automations/authz.ts`, `lib/scorecards/authz.ts`, `lib/catalog/entity-authz.ts` with thin wrappers over `can()`, then inline them away.
- Migrate the 63 direct `workspace-members` query sites and the 34 non-internal API routes. Mechanical; a good fit for parallel subagents split by feature area (kafka, templates/launches, catalog, agent, workspaces/settings).
- `usePlatformAdmin` stays but is documented as UI-only; server decides.

**D. Lint to error + CI gate**
- Flip the Phase A rules to errors; add a vitest that greps for the banned patterns as a belt-and-braces check.

**E. `workspace-members.user` → relationship (data migration)**
- No production data exists yet (one dev user), so this is a schema change plus a small idempotent script (`scripts/migrate-workspace-member-user-ref.ts`, `--dry-run` supported) that maps `users.betterAuthId` → Payload id for existing rows. No downtime process needed.
- After cutover, `membership.ts` compares `payloadId`; `betterAuthId` disappears from policy code. The invite/join flow in `WorkspaceMembers` and the members UI write the relationship.

Then self-service RBAC Phase 0 (#127) is a new `Resource` kind and a new `Verb` pair in `policy.ts`, not a new subsystem.

## 4. Effort and ordering against the self-service epic

| Phase | Size | Blocks |
|---|---|---|
| A | 1 PR, ~1 day | nothing; ship first |
| B | 1 to 2 PRs, ~2 days | #127 |
| C | 4 to 5 PRs in parallel worktrees, ~2 days wall clock | nothing hard; #128/#129 should be written against `authorize()` so C should land first |
| D | 1 PR, hours | — |
| E | 1 PR + a prod migration window | can slip after #127 |

Recommendation: A and B before #127. C in parallel with #127. D right after C. E when convenient, before #129 (team roster should be built on Payload ids from day one).

## 5. Decisions needed

| # | Question | Recommendation |
|---|---|---|
| D1 | Do the `workspace-members.user` data migration (Phase E)? | **Yes** (Drew, 2026-09-17). No prod data exists, so it is a schema flip plus a dev script. |
| D2 | Accept "authorize then `overrideAccess: true`" as the server-action pattern? | **Yes.** Revisit after C. |
| D3 | Kafka topic-policy collections (#69 item 4)? | **Platform-only**, drop the dead `workspace` field in B. |
| D4 | Fresh branch off main? | **Yes**: `chore/authz-consolidation` (Phase A), later phases on their own branches. |

## 6. Tracking

Epic #138. Phases: #133 (A), #134 (B), #135 (C), #136 (D), #137 (E). Self-service #127 is blocked by A and B.

## 7. Phase A checklist (exact paths)

- [x] `orbit-www/src/lib/authz/actor.ts` — `Actor` type, `getActor()` (React `cache`), `requireActor()` (throws `UnauthenticatedError`). Built on `ensurePayloadUser` + `auth.api.getSession` with `disableCookieCache: true`, deactivated → null.
- [x] `orbit-www/src/lib/authz/index.ts` — exports.
- [x] `orbit-www/src/lib/authz/__tests__/actor.test.ts` — session null, deactivated, self-heal path, `payloadId` ≠ `betterAuthId`, cache dedupe.
- [x] Fix sites (findings differed from #69's description on two of them):
  - `orbit-www/src/app/(frontend)/agent/page.tsx` — Payload id passed to membership query. Fixed → `actor.betterAuthId`.
  - `orbit-www/src/app/api/agent/[runId]/stream/route.ts` — same. Fixed.
  - `orbit-www/src/app/(frontend)/catalog/apis/[id]/page.tsx` — membership query was already correct (it used `getCurrentUser`), but the *creator* check compared a Better-Auth id to the `createdBy` relationship, and the Better-Auth id was passed down as `userId` into `restoreVersion`, which writes it to `createdBy`/`lastEditedBy` relationships. Fixed → `actor.payloadId` for both.
  - `orbit-www/src/app/(frontend)/workspaces/actions.ts:96` — **not a bug**: `user` there is the Better-Auth user looked up by email, so `.id` is the Better-Auth id. Left as is (Phase C migrates it anyway).
  - (`UserWorkspaceRoles.ts`, `app/actions/permissions.ts` are deleted in B, not fixed)
- [x] `orbit-www/eslint.config.mjs` (baseline 2026-09-16: 149 `no-restricted-imports` + 155 `no-restricted-syntax` warnings across 156 files) — `no-restricted-imports` (session helpers outside `src/lib/authz`, `src/lib/auth`) and `no-restricted-syntax` (`collection: 'workspace-members'` outside `src/lib/authz`, `src/lib/access`, `src/collections/WorkspaceMembers.ts`) as **warn**; record baseline count in the PR.
- [x] Verification: vitest for actor (11 tests); `bunx tsc --noEmit` 0 errors; agent-browser on `/agent` (apps + runs listed), stream route returns 200 `: connected`, `/catalog/apis/[id]` renders with Edit. **Caveat**: the seeded dev user's Payload `_id` equals its `betterAuthId`, so the id bugs never reproduced locally and the browser pass only proves no regression; the unit tests carry the id distinction. A second user with distinct ids should be seeded before Phase C verification.
