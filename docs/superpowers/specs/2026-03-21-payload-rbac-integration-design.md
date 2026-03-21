# Better Auth + Payload RBAC Integration

**Date:** 2026-03-21
**Status:** Approved
**Scope:** Workspace collections (`workspaces`, `workspace-members`) — proving the pattern for incremental rollout to remaining collections.

## Problem

Server actions bypass Payload's access control by using `overrideAccess: true` on every Payload API call. This is because:

1. The `betterAuthStrategy` only authenticates `super_admin`/`admin` users — regular users get `req.user = null`
2. `workspace-members.user` stores Better Auth IDs, but `req.user.id` is a Payload document ID — they never match
3. Access hooks can't enforce workspace-scoped RBAC without a way to connect the requesting user to their workspace memberships

Authorization is handled ad-hoc in each server action rather than at the data layer, making it easy to accidentally bypass.

## Design

### 1. Identity Bridge

**Add `betterAuthId` field to the Payload `users` collection.**

- Type: `text`, unique, indexed
- Purpose: Links the Payload user document to the corresponding Better Auth user
- Population: Lazy — the auth strategy writes it on first authentication if empty

This allows access hooks to match `req.user.betterAuthId` against `workspace-members.user` (which stores BA IDs).

**Files changed:**
- `orbit-www/src/collections/Users.ts` — Add `betterAuthId` field
- `orbit-www/src/lib/payload-better-auth-strategy.ts` — Populate `betterAuthId` on authentication

### 2. Open Auth Strategy to All Users

**Remove the `ADMIN_ROLES` gate** in `payload-better-auth-strategy.ts`. Every valid Better Auth session resolves to a Payload `req.user`, regardless of role.

**Gate admin panel access separately** via `access.admin` on the Users collection (Payload 3.x places admin access on the auth collection, not the top-level config):

```typescript
// In collections/Users.ts
access: {
  admin: ({ req }) => {
    const role = req.user?.role
    return role === 'super_admin' || role === 'admin'
  },
  // ...other access hooks
}
```

This cleanly separates "is authenticated" (strategy) from "can access admin panel" (collection access).

**Files changed:**
- `orbit-www/src/lib/payload-better-auth-strategy.ts` — Remove role gate
- `orbit-www/src/collections/Users.ts` — Add `access.admin` function

### 3. Access Control Hooks

#### Shared utility: `orbit-www/src/lib/access/workspace-access.ts`

Helper functions used by collection access hooks:

- `getWorkspaceMembership(payload, betterAuthId, workspaceId)` — Queries `workspace-members` where `user` equals `betterAuthId` and `workspace` equals the workspace ID. Uses `overrideAccess: true` (system-level query). Returns the membership doc or null.
- `isWorkspaceMember(payload, betterAuthId, workspaceId)` — Boolean shorthand.
- `isWorkspaceAdminOrOwner(payload, betterAuthId, workspaceId)` — Checks role is `owner` or `admin`.
- `getAdminOrOwnerWorkspaceIds(payload, betterAuthId)` — Returns all workspace IDs where the user is an owner or admin. Used by `update`/`delete` access hooks that return `where` constraints.

**Platform role bypass:** All access helpers check `req.user.role` first — `super_admin` users bypass workspace-scoped checks entirely. This ensures platform admins can manage any workspace (e.g., from the Payload admin panel).

#### Workspaces collection

| Operation | Rule |
|-----------|------|
| `read` | `() => true` — Public/unauthenticated read (unchanged, allows workspace discovery/join pages) |
| `create` | Any authenticated user |
| `update` | Platform admins OR workspace owners/admins — returns `{ id: { in: allowedIds } }` filter |
| `delete` | Platform admins OR workspace owners only — returns `{ id: { in: allowedIds } }` filter |

For `update`/`delete`, the access hook calls `getAdminOrOwnerWorkspaceIds()`, collects the workspace IDs, and returns a Payload `where` constraint. Payload supports returning `boolean | Where` from access hooks.

**Note on delete:** Only workspace owners (not admins) can delete workspaces, providing an extra safety layer.

**Note on internal hooks:** The existing `beforeValidate` and `afterChange` hooks in `Workspaces.ts` perform hierarchy sync operations (parent/child workspace relationships). These internal Payload calls must use `overrideAccess: true` since they are system-level operations that traverse workspaces the user may not own. This is already partially the case and will be made explicit.

#### WorkspaceMembers collection

| Operation | Rule |
|-----------|------|
| `read` | Members of the workspace (scoped via `where` constraint on workspace IDs the user belongs to) |
| `create` | Owners/admins of the target workspace. Reads `data?.workspace` — if `data` is undefined, deny by default. |
| `update` | Owners/admins of the membership's workspace |
| `delete` | Owners/admins of the membership's workspace |

**Code example — `create` access hook:**

```typescript
create: async ({ req, data }) => {
  if (!req.user) return false

  // Platform admin bypass
  if (req.user.role === 'super_admin') return true

  // data.workspace is required to determine which workspace the invite targets
  const workspaceId = data?.workspace
  if (!workspaceId) return false

  const betterAuthId = req.user.betterAuthId
  if (!betterAuthId) return false

  return isWorkspaceAdminOrOwner(req.payload, betterAuthId, workspaceId as string)
}
```

**Files changed:**
- `orbit-www/src/lib/access/workspace-access.ts` — New file
- `orbit-www/src/collections/Workspaces.ts` — Replace access hooks, add `overrideAccess: true` to internal hierarchy sync calls
- `orbit-www/src/collections/WorkspaceMembers.ts` — Replace access hooks

### 4. Server Action Migration

#### New helper: `getPayloadUserFromSession()`

Added to `orbit-www/src/lib/auth/session.ts`:

1. Calls `auth.api.getSession({ headers: await headers() })`
2. Looks up the Payload user by email (with `overrideAccess: true` — legitimate for the auth lookup itself)
3. Returns the Payload user doc (typed as `User & { collection: 'users' }`) with `betterAuthId` populated, or `null`
4. If the Payload user exists but `betterAuthId` is missing (first-time auth), the strategy will have populated it during the same request — the helper queries after the strategy runs, so it will be present

#### Migration pattern

```typescript
// Before
await payload.create({
  collection: 'workspace-members',
  data: { ... },
  overrideAccess: true,
})

// After
const payloadUser = await getPayloadUserFromSession()
if (!payloadUser) return { error: 'Not authenticated' }
await payload.create({
  collection: 'workspace-members',
  data: { ... },
  user: payloadUser,
  overrideAccess: false,  // REQUIRED: local API defaults to true, must explicitly set false
})
```

**Critical:** Payload's local API defaults `overrideAccess` to `true`. Every migrated call must include `overrideAccess: false` alongside `user: payloadUser`, otherwise the user context is ignored and access hooks don't fire.

#### Actions migrated (all in `workspaces/actions.ts`)

| Action | Payload operation | Access rule enforced |
|--------|-------------------|---------------------|
| `getWorkspaceMembers` | `find` workspace-members | Must be workspace member |
| `inviteWorkspaceMember` | `create` workspace-member | Must be workspace owner/admin |
| `updateMemberRole` | `update` workspace-member | Must be workspace owner/admin |
| `removeMember` | `delete` workspace-member | Must be workspace owner/admin |
| `createWorkspace` | `create` workspace | Any authenticated user |
| `updateWorkspaceSettings` | `update` workspace | Must be workspace owner/admin |
| `deleteWorkspace` | `delete` workspace + members | Must be workspace owner/admin |

#### Ownership bootstrapping

When creating a workspace, the creator must be added as `owner`. The existing `afterChange` hook on the Workspaces collection already handles this (lines 248-272 of `Workspaces.ts`). The `createWorkspace` server action should **not** duplicate this logic. Instead:

- The `afterChange` hook remains the sole ownership bootstrap mechanism
- The hook uses `overrideAccess: true` for the membership creation (legitimate system-level operation)
- The `createWorkspace` action removes its manual membership creation and relies on the hook
- The hook is updated to use `req.user.betterAuthId` (from the Payload user) instead of doing a raw MongoDB lookup by email

### 5. Testing & Verification

**Unit tests** for access hook helpers:
- `isWorkspaceMember` with member/non-member
- `isWorkspaceAdminOrOwner` with each role
- `super_admin` bypass
- `data` nullability in create hooks

**Integration tests** for server actions:
- Unauthenticated requests rejected
- Non-members can't update/delete workspaces or manage members
- Members can read but not manage
- Admins/owners can manage members and settings
- Only owners can delete workspaces
- Creating a workspace bootstraps ownership via hook
- Platform super_admins can manage any workspace

**Browser verification** via `agent-browser`:
- Create workspace, verify owner membership
- Invite member, verify appears in list
- Admin panel accessible only to admin-role users

**Regression:** Verify Payload admin panel is still gated to `super_admin`/`admin` users.

## Rollout

This spec covers workspace collections only. Once proven, the same pattern applies to other collections:

1. Add access hooks using the shared workspace-access helpers
2. Update server actions to pass `user: payloadUser, overrideAccess: false` instead of `overrideAccess: true`
3. Test

Collections for future migration: `apps`, `templates`, `api-schemas`, `knowledge-spaces`, `knowledge-pages`, `registry-images`, `kafka-*`, etc.

## Files Summary

| File | Change |
|------|--------|
| `src/collections/Users.ts` | Add `betterAuthId` field, add `access.admin` gate |
| `src/lib/payload-better-auth-strategy.ts` | Remove role gate, populate `betterAuthId` |
| `src/lib/access/workspace-access.ts` | New — shared RBAC helpers with platform admin bypass |
| `src/collections/Workspaces.ts` | Replace access hooks, add `overrideAccess: true` to hierarchy sync hooks |
| `src/collections/WorkspaceMembers.ts` | Replace access hooks |
| `src/lib/auth/session.ts` | Add `getPayloadUserFromSession()` |
| `src/app/(frontend)/workspaces/actions.ts` | Migrate to `user: payloadUser, overrideAccess: false` pattern |

## Decisions Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| How to bridge BA/Payload identity | Store `betterAuthId` on Payload user | Smallest change, no data migration on workspace-members, keeps BA as authoritative identity |
| How to handle admin panel access | `access.admin` on Users collection | Payload 3.x places admin access on the auth collection, not top-level config |
| Rollout scope | Workspace collections only | Prove the pattern before migrating ~40+ actions across all collections |
| Access control model | Workspace-scoped roles via membership table | Pushes authorization to the data layer where it can't be accidentally bypassed |
| Platform admin bypass | `super_admin` bypasses workspace-scoped checks | Platform admins must be able to manage any workspace |
| Workspace delete | Owner-only (not admin) | Extra safety layer for destructive operation |
| Ownership bootstrap | `afterChange` hook (not server action) | Single source of truth, avoids duplicate membership creation |
| `overrideAccess` default | Must explicitly pass `false` | Payload local API defaults to `true`; without `false`, access hooks don't fire |
| Workspace read access | Public (unauthenticated) | Unchanged from current behavior, allows workspace discovery and join pages |
