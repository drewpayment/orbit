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

**Gate admin panel access separately** via `admin.access` in `payload.config.ts`:

```typescript
admin: {
  user: Users.slug,
  access: ({ user }) => {
    const role = user?.role
    return role === 'super_admin' || role === 'admin'
  },
}
```

This cleanly separates "is authenticated" (strategy) from "can access admin panel" (config).

**Files changed:**
- `orbit-www/src/lib/payload-better-auth-strategy.ts` — Remove role gate
- `orbit-www/src/payload.config.ts` — Add `admin.access` function

### 3. Access Control Hooks

#### Shared utility: `orbit-www/src/lib/access/workspace-access.ts`

Helper functions used by collection access hooks:

- `getWorkspaceMembership(user, workspaceId)` — Queries `workspace-members` where `user` equals `req.user.betterAuthId` and `workspace` equals the workspace ID. Returns the membership doc or null.
- `isWorkspaceMember(user, workspaceId)` — Boolean shorthand.
- `isWorkspaceAdminOrOwner(user, workspaceId)` — Checks role is `owner` or `admin`.

#### Workspaces collection

| Operation | Rule |
|-----------|------|
| `read` | Any authenticated user (discover workspaces) |
| `create` | Any authenticated user |
| `update` | Workspace owners/admins only — returns `{ id: { in: allowedIds } }` filter |
| `delete` | Workspace owners/admins only — returns `{ id: { in: allowedIds } }` filter |

For `update`/`delete`, the access hook queries all `workspace-members` for the user's `betterAuthId` where role is `owner` or `admin`, collects the workspace IDs, and returns a Payload `where` constraint.

#### WorkspaceMembers collection

| Operation | Rule |
|-----------|------|
| `read` | Members of the workspace (scoped via `where` constraint) |
| `create` | Owners/admins of the target workspace (reads `data.workspace` from hook args) |
| `update` | Owners/admins of the membership's workspace |
| `delete` | Owners/admins of the membership's workspace |

**Files changed:**
- `orbit-www/src/lib/access/workspace-access.ts` — New file
- `orbit-www/src/collections/Workspaces.ts` — Replace access hooks
- `orbit-www/src/collections/WorkspaceMembers.ts` — Replace access hooks

### 4. Server Action Migration

#### New helper: `getPayloadUserFromSession()`

Added to `orbit-www/src/lib/auth/session.ts`:

1. Calls `auth.api.getSession({ headers: await headers() })`
2. Looks up the Payload user by email (with `overrideAccess: true` — legitimate for the auth lookup itself)
3. Returns the Payload user doc with `betterAuthId` populated

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
})
```

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

#### Special case: ownership bootstrapping

When creating a workspace, the creator must be added as `owner` of the new workspace. But the `workspace-members.create` access hook requires the user to already be an owner/admin. This chicken-and-egg is resolved by using `overrideAccess: true` specifically for the "add creator as owner" step — the one legitimate use of override. This mirrors the existing `afterChange` hook on the Workspaces collection.

### 5. Testing & Verification

**Unit tests** for access hook helpers:
- `isWorkspaceMember` with member/non-member
- `isWorkspaceAdminOrOwner` with each role

**Integration tests** for server actions:
- Unauthenticated requests rejected
- Non-members can't update/delete workspaces or manage members
- Members can read but not manage
- Admins/owners can manage members and settings
- Only owners can delete
- Creating a workspace bootstraps ownership

**Browser verification** via `agent-browser`:
- Create workspace, verify owner membership
- Invite member, verify appears in list
- Admin panel accessible only to admin-role users

**Regression:** Verify Payload admin panel is still gated to `super_admin`/`admin` users.

## Rollout

This spec covers workspace collections only. Once proven, the same pattern applies to other collections:

1. Add access hooks using the shared workspace-access helpers
2. Update server actions to pass `user: payloadUser` instead of `overrideAccess: true`
3. Test

Collections for future migration: `apps`, `templates`, `api-schemas`, `knowledge-spaces`, `knowledge-pages`, `registry-images`, `kafka-*`, etc.

## Files Summary

| File | Change |
|------|--------|
| `src/collections/Users.ts` | Add `betterAuthId` field |
| `src/lib/payload-better-auth-strategy.ts` | Remove role gate, populate `betterAuthId` |
| `src/payload.config.ts` | Add `admin.access` function |
| `src/lib/access/workspace-access.ts` | New — shared RBAC helpers |
| `src/collections/Workspaces.ts` | Replace access hooks |
| `src/collections/WorkspaceMembers.ts` | Replace access hooks |
| `src/lib/auth/session.ts` | Add `getPayloadUserFromSession()` |
| `src/app/(frontend)/workspaces/actions.ts` | Migrate to `user:` pattern |

## Decisions Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| How to bridge BA/Payload identity | Store `betterAuthId` on Payload user | Smallest change, no data migration on workspace-members, keeps BA as authoritative identity |
| How to handle admin panel access | `admin.access` config function | Clean separation of "is authenticated" vs "can access admin panel" |
| Rollout scope | Workspace collections only | Prove the pattern before migrating ~40+ actions across all collections |
| Access control model | Workspace-scoped roles via membership table | Pushes authorization to the data layer where it can't be accidentally bypassed |
