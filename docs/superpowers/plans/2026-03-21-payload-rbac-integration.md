# Payload RBAC Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Payload's access control hooks enforce workspace-scoped RBAC instead of bypassing them with `overrideAccess: true`.

**Architecture:** Add a `betterAuthId` field to the Payload `users` collection so access hooks can match `req.user.betterAuthId` against `workspace-members.user` (which stores Better Auth IDs). Open the auth strategy to all users, gate admin panel via `access.admin`, and replace `overrideAccess: true` in workspace server actions with `user: payloadUser, overrideAccess: false`.

**Tech Stack:** Payload CMS 3.x, Better Auth, MongoDB, Next.js 15, Vitest

**Spec:** `docs/superpowers/specs/2026-03-21-payload-rbac-integration-design.md`

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `orbit-www/src/collections/Users.ts` | Payload user schema + auth config | Add `betterAuthId` field, add `access.admin` gate |
| `orbit-www/src/lib/payload-better-auth-strategy.ts` | BA→Payload auth bridge | Remove role gate, lazy-populate `betterAuthId` |
| `orbit-www/src/lib/access/workspace-access.ts` | Shared workspace RBAC helpers | **New file** |
| `orbit-www/src/collections/Workspaces.ts` | Workspace schema + hooks | Replace access hooks, add `overrideAccess: true` to hierarchy hooks, update `afterChange` ownership hook |
| `orbit-www/src/collections/WorkspaceMembers.ts` | Workspace membership schema | Replace access hooks |
| `orbit-www/src/lib/auth/session.ts` | Server-side session helpers | Add `getPayloadUserFromSession()` |
| `orbit-www/src/app/(frontend)/workspaces/actions.ts` | Workspace server actions | Migrate to `user: payloadUser, overrideAccess: false` |
| `orbit-www/src/lib/access/__tests__/workspace-access.test.ts` | Unit tests for RBAC helpers | **New file** |
| `orbit-www/src/lib/auth/__tests__/session.test.ts` | Unit tests for session helper | **New file** |

---

### Task 1: Add `betterAuthId` field to Users collection

**Files:**
- Modify: `orbit-www/src/collections/Users.ts`

- [ ] **Step 1: Add the `betterAuthId` field**

Add after the `role` field (line 63) in the `fields` array:

```typescript
{
  name: 'betterAuthId',
  type: 'text',
  unique: true,
  index: true,
  admin: {
    position: 'sidebar',
    readOnly: true,
    description: 'Better Auth user ID — auto-populated on first login',
  },
},
```

- [ ] **Step 2: Add `access.admin` gate**

Add an `access` property to the Users collection config (before `auth` at line 10):

```typescript
access: {
  admin: ({ req }) => {
    const role = (req.user as any)?.role
    return role === 'super_admin' || role === 'admin'
  },
},
```

- [ ] **Step 3: Regenerate Payload types**

Run: `cd orbit-www && pnpm generate:types`

This ensures `betterAuthId` appears in the generated `payload-types.ts`, eliminating the need for `as any` casts when accessing `req.user.betterAuthId` in access hooks.

- [ ] **Step 4: Verify the dev server starts without errors**

Run: `cd orbit-www && bun run dev` (check for startup errors in terminal)
Expected: No errors related to Users collection

- [ ] **Step 5: Commit**

```bash
git add orbit-www/src/collections/Users.ts orbit-www/src/payload-types.ts
git commit -m "feat(auth): add betterAuthId field and access.admin gate to Users collection"
```

---

### Task 2: Open auth strategy to all users + lazy-populate `betterAuthId`

**Files:**
- Modify: `orbit-www/src/lib/payload-better-auth-strategy.ts`

- [ ] **Step 1: Remove the ADMIN_ROLES gate and add `betterAuthId` population**

Replace the entire file content:

```typescript
import type { AuthStrategy, AuthStrategyFunctionArgs, AuthStrategyResult } from 'payload'
import { auth } from '@/lib/auth'

/**
 * Custom Payload AuthStrategy that validates Better Auth sessions.
 * All authenticated users get req.user populated.
 * Admin panel access is gated separately via Users.access.admin.
 */
async function authenticate({ headers, payload }: AuthStrategyFunctionArgs): Promise<AuthStrategyResult> {
  try {
    const session = await auth.api.getSession({ headers })

    if (!session?.user?.email) {
      return { user: null }
    }

    const betterAuthId = session.user.id
    const result = await payload.find({
      collection: 'users',
      where: { email: { equals: session.user.email } },
      limit: 1,
      overrideAccess: true,
    })

    let payloadUser = result.docs[0]
    if (!payloadUser) {
      console.warn(`[better-auth-strategy] No Payload user found for email: ${session.user.email}`)
      return { user: null }
    }

    // Lazy-populate betterAuthId on first authentication
    if (!payloadUser.betterAuthId && betterAuthId) {
      try {
        payloadUser = await payload.update({
          collection: 'users',
          id: payloadUser.id,
          data: { betterAuthId },
          overrideAccess: true,
          context: { skipApprovalHook: true },
        })
      } catch (error) {
        console.error('[better-auth-strategy] Failed to populate betterAuthId:', error)
      }
    }

    return {
      user: {
        ...payloadUser,
        collection: 'users',
        _strategy: 'better-auth',
      },
    }
  } catch (error) {
    console.error('[better-auth-strategy] Authentication error:', error)
    return { user: null }
  }
}

export const betterAuthStrategy: AuthStrategy = {
  name: 'better-auth',
  authenticate,
}
```

- [ ] **Step 2: Verify the dev server starts and login works**

Run: `cd orbit-www && bun run dev`
Check: Login to the app at `http://localhost:3000/login` — should still work.
Check: Navigate to `/admin` — should still be accessible for admin-role users.

- [ ] **Step 3: Verify `betterAuthId` was populated in MongoDB**

```bash
docker exec orbit-mongo mongosh --quiet --eval 'use("orbit-www"); JSON.stringify(db.users.find({},{email:1,betterAuthId:1,_id:0}).toArray())'
```

Expected: The logged-in user's `betterAuthId` field should now be populated.

- [ ] **Step 4: Commit**

```bash
git add orbit-www/src/lib/payload-better-auth-strategy.ts
git commit -m "feat(auth): open strategy to all users and lazy-populate betterAuthId"
```

---

### Task 3: Create workspace access helpers

**Files:**
- Create: `orbit-www/src/lib/access/workspace-access.ts`
- Create: `orbit-www/src/lib/access/__tests__/workspace-access.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `orbit-www/src/lib/access/__tests__/workspace-access.test.ts`:

```typescript
/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock payload
const mockFind = vi.fn()
const mockPayload = { find: mockFind } as any

// Import after mocks are set up
const { getWorkspaceMembership, isWorkspaceMember, isWorkspaceAdminOrOwner, getAdminOrOwnerWorkspaceIds } = await import('../workspace-access')

describe('workspace-access helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getWorkspaceMembership', () => {
    it('returns membership doc when user is a member', async () => {
      const memberDoc = { id: 'm1', role: 'member', workspace: 'ws1', user: 'ba-user-1' }
      mockFind.mockResolvedValue({ docs: [memberDoc] })

      const result = await getWorkspaceMembership(mockPayload, 'ba-user-1', 'ws1')
      expect(result).toEqual(memberDoc)
      expect(mockFind).toHaveBeenCalledWith({
        collection: 'workspace-members',
        where: {
          and: [
            { workspace: { equals: 'ws1' } },
            { user: { equals: 'ba-user-1' } },
            { status: { equals: 'active' } },
          ],
        },
        limit: 1,
        overrideAccess: true,
      })
    })

    it('returns null when user is not a member', async () => {
      mockFind.mockResolvedValue({ docs: [] })

      const result = await getWorkspaceMembership(mockPayload, 'ba-user-2', 'ws1')
      expect(result).toBeNull()
    })
  })

  describe('isWorkspaceMember', () => {
    it('returns true when user is a member', async () => {
      mockFind.mockResolvedValue({ docs: [{ id: 'm1', role: 'member' }] })
      expect(await isWorkspaceMember(mockPayload, 'ba-user-1', 'ws1')).toBe(true)
    })

    it('returns false when user is not a member', async () => {
      mockFind.mockResolvedValue({ docs: [] })
      expect(await isWorkspaceMember(mockPayload, 'ba-user-2', 'ws1')).toBe(false)
    })
  })

  describe('isWorkspaceAdminOrOwner', () => {
    it('returns true for owner', async () => {
      mockFind.mockResolvedValue({ docs: [{ id: 'm1', role: 'owner' }] })
      expect(await isWorkspaceAdminOrOwner(mockPayload, 'ba-user-1', 'ws1')).toBe(true)
    })

    it('returns true for admin', async () => {
      mockFind.mockResolvedValue({ docs: [{ id: 'm1', role: 'admin' }] })
      expect(await isWorkspaceAdminOrOwner(mockPayload, 'ba-user-1', 'ws1')).toBe(true)
    })

    it('returns false for member', async () => {
      mockFind.mockResolvedValue({ docs: [{ id: 'm1', role: 'member' }] })
      expect(await isWorkspaceAdminOrOwner(mockPayload, 'ba-user-1', 'ws1')).toBe(false)
    })

    it('returns false for non-member', async () => {
      mockFind.mockResolvedValue({ docs: [] })
      expect(await isWorkspaceAdminOrOwner(mockPayload, 'ba-user-2', 'ws1')).toBe(false)
    })
  })

  describe('getAdminOrOwnerWorkspaceIds', () => {
    it('returns workspace IDs where user is owner or admin', async () => {
      mockFind.mockResolvedValue({
        docs: [
          { workspace: 'ws1', role: 'owner' },
          { workspace: 'ws2', role: 'admin' },
        ],
      })

      const ids = await getAdminOrOwnerWorkspaceIds(mockPayload, 'ba-user-1')
      expect(ids).toEqual(['ws1', 'ws2'])
    })

    it('returns empty array when user has no admin/owner roles', async () => {
      mockFind.mockResolvedValue({ docs: [] })
      const ids = await getAdminOrOwnerWorkspaceIds(mockPayload, 'ba-user-1')
      expect(ids).toEqual([])
    })

    it('handles workspace as object (populated relationship)', async () => {
      mockFind.mockResolvedValue({
        docs: [
          { workspace: { id: 'ws1' }, role: 'owner' },
        ],
      })

      const ids = await getAdminOrOwnerWorkspaceIds(mockPayload, 'ba-user-1')
      expect(ids).toEqual(['ws1'])
    })
  })

  describe('getOwnerWorkspaceIds', () => {
    it('returns workspace IDs where user is owner only', async () => {
      mockFind.mockResolvedValue({
        docs: [{ workspace: 'ws1', role: 'owner' }],
      })
      const { getOwnerWorkspaceIds } = await import('../workspace-access')
      const ids = await getOwnerWorkspaceIds(mockPayload, 'ba-user-1')
      expect(ids).toEqual(['ws1'])
      // Verify it filters by owner role specifically
      expect(mockFind).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            and: expect.arrayContaining([
              { role: { equals: 'owner' } },
            ]),
          }),
        })
      )
    })
  })

  describe('getMemberWorkspaceIds', () => {
    it('returns all workspace IDs where user is active member', async () => {
      mockFind.mockResolvedValue({
        docs: [
          { workspace: 'ws1', role: 'owner' },
          { workspace: 'ws2', role: 'member' },
        ],
      })
      const { getMemberWorkspaceIds } = await import('../workspace-access')
      const ids = await getMemberWorkspaceIds(mockPayload, 'ba-user-1')
      expect(ids).toEqual(['ws1', 'ws2'])
    })
  })

  describe('isSuperAdmin', () => {
    it('returns true for super_admin role', () => {
      const { isSuperAdmin } = require('../workspace-access')
      expect(isSuperAdmin({ role: 'super_admin' })).toBe(true)
    })

    it('returns false for admin role', () => {
      const { isSuperAdmin } = require('../workspace-access')
      expect(isSuperAdmin({ role: 'admin' })).toBe(false)
    })

    it('returns false for null user', () => {
      const { isSuperAdmin } = require('../workspace-access')
      expect(isSuperAdmin(null)).toBe(false)
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd orbit-www && pnpm exec vitest run src/lib/access/__tests__/workspace-access.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `orbit-www/src/lib/access/workspace-access.ts`:

```typescript
import type { Payload } from 'payload'

/**
 * Look up a user's workspace membership.
 * Uses overrideAccess: true because this is a system-level authorization query.
 */
export async function getWorkspaceMembership(
  payload: Payload,
  betterAuthId: string,
  workspaceId: string,
) {
  const result = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: workspaceId } },
        { user: { equals: betterAuthId } },
        { status: { equals: 'active' } },
      ],
    },
    limit: 1,
    overrideAccess: true,
  })

  return result.docs[0] ?? null
}

/**
 * Check if a user is a member of a workspace.
 */
export async function isWorkspaceMember(
  payload: Payload,
  betterAuthId: string,
  workspaceId: string,
): Promise<boolean> {
  const membership = await getWorkspaceMembership(payload, betterAuthId, workspaceId)
  return membership !== null
}

/**
 * Check if a user is an admin or owner of a workspace.
 */
export async function isWorkspaceAdminOrOwner(
  payload: Payload,
  betterAuthId: string,
  workspaceId: string,
): Promise<boolean> {
  const membership = await getWorkspaceMembership(payload, betterAuthId, workspaceId)
  if (!membership) return false
  return membership.role === 'owner' || membership.role === 'admin'
}

/**
 * Get all workspace IDs where the user is an owner or admin.
 * Used by access hooks that return Where constraints.
 */
export async function getAdminOrOwnerWorkspaceIds(
  payload: Payload,
  betterAuthId: string,
): Promise<string[]> {
  const result = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { user: { equals: betterAuthId } },
        { status: { equals: 'active' } },
        { role: { in: ['owner', 'admin'] } },
      ],
    },
    limit: 1000,
    overrideAccess: true,
  })

  return result.docs.map((doc) => {
    const ws = doc.workspace
    return typeof ws === 'string' ? ws : ws.id
  })
}

/**
 * Like getAdminOrOwnerWorkspaceIds but only returns workspaces where user is owner.
 * Used by delete access hooks.
 */
export async function getOwnerWorkspaceIds(
  payload: Payload,
  betterAuthId: string,
): Promise<string[]> {
  const result = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { user: { equals: betterAuthId } },
        { status: { equals: 'active' } },
        { role: { equals: 'owner' } },
      ],
    },
    limit: 1000,
    overrideAccess: true,
  })

  return result.docs.map((doc) => {
    const ws = doc.workspace
    return typeof ws === 'string' ? ws : ws.id
  })
}

/**
 * Get all workspace IDs where the user is any active member.
 * Used by read access hooks.
 */
export async function getMemberWorkspaceIds(
  payload: Payload,
  betterAuthId: string,
): Promise<string[]> {
  const result = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { user: { equals: betterAuthId } },
        { status: { equals: 'active' } },
      ],
    },
    limit: 1000,
    overrideAccess: true,
  })

  return result.docs.map((doc) => {
    const ws = doc.workspace
    return typeof ws === 'string' ? ws : ws.id
  })
}

/**
 * Check if the user is a platform super_admin.
 */
export function isSuperAdmin(user: any): boolean {
  return user?.role === 'super_admin'
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd orbit-www && pnpm exec vitest run src/lib/access/__tests__/workspace-access.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add orbit-www/src/lib/access/workspace-access.ts orbit-www/src/lib/access/__tests__/workspace-access.test.ts
git commit -m "feat(auth): add workspace RBAC access helpers with tests"
```

---

### Task 4: Replace access hooks on Workspaces collection

**Files:**
- Modify: `orbit-www/src/collections/Workspaces.ts`

- [ ] **Step 1: Replace access hooks**

Replace the `access` block (lines 10-20) with:

```typescript
access: {
  // Public read — allows workspace discovery and join pages
  read: () => true,
  // Any authenticated user can create workspaces
  create: ({ req: { user } }) => !!user,
  // Platform admins or workspace owners/admins
  update: async ({ req }) => {
    if (!req.user) return false
    if (isSuperAdmin(req.user)) return true
    const betterAuthId = (req.user as any).betterAuthId
    if (!betterAuthId) return false
    const ids = await getAdminOrOwnerWorkspaceIds(req.payload, betterAuthId)
    if (ids.length === 0) return false
    return { id: { in: ids } }
  },
  // Platform admins or workspace owners only (not admins — extra safety)
  delete: async ({ req }) => {
    if (!req.user) return false
    if (isSuperAdmin(req.user)) return true
    const betterAuthId = (req.user as any).betterAuthId
    if (!betterAuthId) return false
    const ids = await getOwnerWorkspaceIds(req.payload, betterAuthId)
    if (ids.length === 0) return false
    return { id: { in: ids } }
  },
},
```

Add imports at the top of the file:

```typescript
import { getAdminOrOwnerWorkspaceIds, getOwnerWorkspaceIds, isSuperAdmin } from '@/lib/access/workspace-access'
```

- [ ] **Step 2: Add `overrideAccess: true` to hierarchy sync hooks**

In the `beforeValidate` hook, add `overrideAccess: true` to all `req.payload.findByID` calls (lines 160, 197, 220). Example for line 160:

```typescript
const parent = await req.payload.findByID({
  collection: 'workspaces',
  id: currentParentId,
  overrideAccess: true,
})
```

In the `afterChange` hook, add `overrideAccess: true` to all `payload.findByID` and `payload.update` calls (lines 300, 313, 331, 344, 368, 376, 395, 403). Example for line 300:

```typescript
const prevParent = await payload.findByID({
  collection: 'workspaces',
  id: previousParent,
  depth: 0,
  overrideAccess: true,
})
```

And for the update calls, add `overrideAccess: true`:

```typescript
await payload.update({
  collection: 'workspaces',
  id: previousParent,
  data: { childWorkspaces: updatedChildren },
  overrideAccess: true,
  context: { skipHierarchySync: true },
})
```

- [ ] **Step 3: Update the `afterChange` ownership hook to use `betterAuthId`**

Replace lines 248-272 (the ownership bootstrap section of `afterChange`):

```typescript
// When a workspace is created, automatically add the creator as owner
if (operation === 'create' && user) {
  try {
    const betterAuthId = (user as any).betterAuthId
    if (betterAuthId) {
      await payload.create({
        collection: 'workspace-members',
        data: {
          workspace: doc.id,
          user: betterAuthId,
          role: 'owner',
          status: 'active',
          requestedAt: new Date().toISOString(),
          approvedAt: new Date().toISOString(),
        },
        overrideAccess: true,
      })
    }
  } catch (error) {
    console.error('Error auto-adding workspace owner:', error)
  }
}
```

- [ ] **Step 4: Remove the `getMongoClient` import if no longer used**

Check if `getMongoClient` is used elsewhere in the file. If not, remove the import on line 2.

- [ ] **Step 5: Verify the dev server starts without errors**

Run: `cd orbit-www && bun run dev`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add orbit-www/src/collections/Workspaces.ts
git commit -m "feat(auth): replace Workspaces access hooks with workspace-scoped RBAC"
```

---

### Task 5: Replace access hooks on WorkspaceMembers collection

**Files:**
- Modify: `orbit-www/src/collections/WorkspaceMembers.ts`

- [ ] **Step 1: Replace access hooks**

Replace the `access` block (lines 9-18) with:

```typescript
access: {
  // Members can read memberships for their workspaces
  read: async ({ req }) => {
    if (!req.user) return false
    if (isSuperAdmin(req.user)) return true
    const betterAuthId = (req.user as any).betterAuthId
    if (!betterAuthId) return false
    const ids = await getMemberWorkspaceIds(req.payload, betterAuthId)
    if (ids.length === 0) return false
    return { workspace: { in: ids } }
  },
  // Only workspace owners/admins can invite members
  create: async ({ req, data }) => {
    if (!req.user) return false
    if (isSuperAdmin(req.user)) return true
    const workspaceId = data?.workspace
    if (!workspaceId) return false
    const betterAuthId = (req.user as any).betterAuthId
    if (!betterAuthId) return false
    return isWorkspaceAdminOrOwner(req.payload, betterAuthId, workspaceId as string)
  },
  // Only workspace owners/admins can change roles
  update: async ({ req, id }) => {
    if (!req.user) return false
    if (isSuperAdmin(req.user)) return true
    const betterAuthId = (req.user as any).betterAuthId
    if (!betterAuthId) return false
    // Look up which workspace this membership belongs to
    if (!id) return false
    const member = await req.payload.findByID({
      collection: 'workspace-members',
      id,
      overrideAccess: true,
      depth: 0,
    })
    const wsId = typeof member.workspace === 'string' ? member.workspace : member.workspace?.id
    if (!wsId) return false
    return isWorkspaceAdminOrOwner(req.payload, betterAuthId, wsId)
  },
  // Only workspace owners/admins can remove members
  delete: async ({ req, id }) => {
    if (!req.user) return false
    if (isSuperAdmin(req.user)) return true
    const betterAuthId = (req.user as any).betterAuthId
    if (!betterAuthId) return false
    if (!id) return false
    const member = await req.payload.findByID({
      collection: 'workspace-members',
      id,
      overrideAccess: true,
      depth: 0,
    })
    const wsId = typeof member.workspace === 'string' ? member.workspace : member.workspace?.id
    if (!wsId) return false
    return isWorkspaceAdminOrOwner(req.payload, betterAuthId, wsId)
  },
},
```

Add imports at the top of the file:

```typescript
import { isSuperAdmin, isWorkspaceAdminOrOwner, getMemberWorkspaceIds } from '@/lib/access/workspace-access'
```

- [ ] **Step 2: Verify the dev server starts without errors**

Run: `cd orbit-www && bun run dev`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add orbit-www/src/collections/WorkspaceMembers.ts
git commit -m "feat(auth): replace WorkspaceMembers access hooks with workspace-scoped RBAC"
```

---

### Task 6: Add `getPayloadUserFromSession()` helper

**Files:**
- Modify: `orbit-www/src/lib/auth/session.ts`

- [ ] **Step 1: Add the helper function**

Add to the end of `orbit-www/src/lib/auth/session.ts`:

```typescript
import { getPayload } from 'payload'
import config from '@payload-config'

/**
 * Get the authenticated Payload user from the current Better Auth session.
 * Returns the Payload user document with betterAuthId populated, or null.
 * Use this in server actions to pass `user` to Payload local API calls.
 */
export async function getPayloadUserFromSession() {
  const reqHeaders = await headers()
  const session = await auth.api.getSession({ headers: reqHeaders })

  if (!session?.user?.email) return null

  const payload = await getPayload({ config })

  const result = await payload.find({
    collection: 'users',
    where: { email: { equals: session.user.email } },
    limit: 1,
    overrideAccess: true,
  })

  const payloadUser = result.docs[0]
  if (!payloadUser) return null

  return {
    ...payloadUser,
    collection: 'users' as const,
    _strategy: 'better-auth',
  }
}
```

- [ ] **Step 2: Verify the dev server starts without errors**

Run: `cd orbit-www && bun run dev`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add orbit-www/src/lib/auth/session.ts
git commit -m "feat(auth): add getPayloadUserFromSession() helper for server actions"
```

---

### Task 7: Migrate workspace server actions

**Files:**
- Modify: `orbit-www/src/app/(frontend)/workspaces/actions.ts`

- [ ] **Step 1: Update imports**

Replace the imports at the top of the file:

```typescript
'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { revalidatePath } from 'next/cache'
import { getBetterAuthUserByEmail, getBetterAuthUsers } from '@/lib/data/cached-queries'
import { getPayloadUserFromSession } from '@/lib/auth/session'
```

Remove the `headers` and `auth` imports — they're no longer needed since `getPayloadUserFromSession()` handles session resolution.

- [ ] **Step 2: Migrate `getWorkspaceMembers`**

Replace the function to use `user` + `overrideAccess: false`:

```typescript
export async function getWorkspaceMembers(workspaceId: string) {
  try {
    const payloadUser = await getPayloadUserFromSession()
    if (!payloadUser) {
      return { success: false, error: 'Not authenticated', members: [] }
    }

    const payload = await getPayload({ config })

    const membersResult = await payload.find({
      collection: 'workspace-members',
      where: {
        workspace: { equals: workspaceId },
        status: { equals: 'active' },
      },
      limit: 100,
      sort: '-createdAt',
      user: payloadUser,
      overrideAccess: false,
    })

    // Batch-fetch Better Auth user details for all members
    const userIds = membersResult.docs
      .map((m) => (typeof m.user === 'string' ? m.user : ''))
      .filter(Boolean)
    const baUsers = await getBetterAuthUsers(userIds)
    const userMap = new Map(baUsers.map((u) => [u.id, u]))

    return {
      success: true,
      members: membersResult.docs.map((member) => {
        const baUserId = typeof member.user === 'string' ? member.user : ''
        const baUser = userMap.get(baUserId)
        return {
          id: member.id,
          workspaceId: typeof member.workspace === 'string' ? member.workspace : member.workspace.id,
          userId: baUserId,
          userEmail: baUser?.email || '',
          userName: baUser?.name || baUser?.email || '',
          userAvatar: baUser?.image || undefined,
          role: member.role,
          status: member.status,
          joinedAt: member.approvedAt || member.createdAt,
        }
      }),
    }
  } catch (error) {
    console.error('Failed to fetch workspace members:', error)
    return { success: false, error: 'Failed to fetch workspace members', members: [] }
  }
}
```

- [ ] **Step 3: Migrate `inviteWorkspaceMember`**

```typescript
export async function inviteWorkspaceMember(
  workspaceId: string,
  email: string,
  role: 'owner' | 'admin' | 'member'
) {
  try {
    const payloadUser = await getPayloadUserFromSession()
    if (!payloadUser) {
      return { success: false, error: 'Not authenticated' }
    }

    const payload = await getPayload({ config })

    // Find user by email in Better Auth user collection
    const baUser = await getBetterAuthUserByEmail(email)
    if (!baUser) {
      return { success: false, error: 'User not found with that email address' }
    }

    // Check if user is already a member (system query — overrideAccess: true)
    const existingMember = await payload.find({
      collection: 'workspace-members',
      where: {
        and: [
          { workspace: { equals: workspaceId } },
          { user: { equals: baUser.id } },
        ],
      },
      limit: 1,
      overrideAccess: true,
    })

    if (existingMember.docs.length > 0) {
      return { success: false, error: 'User is already a member of this workspace' }
    }

    // Create membership — access hook checks if current user is owner/admin
    await payload.create({
      collection: 'workspace-members',
      data: {
        workspace: workspaceId,
        user: baUser.id,
        role,
        status: 'active',
        requestedAt: new Date().toISOString(),
        approvedAt: new Date().toISOString(),
      },
      user: payloadUser,
      overrideAccess: false,
    })

    revalidatePath('/workspaces')
    revalidatePath('/admin/workspaces')

    return { success: true }
  } catch (error) {
    console.error('Failed to invite member:', error)
    return { success: false, error: 'Failed to invite member' }
  }
}
```

- [ ] **Step 4: Migrate `updateMemberRole`**

```typescript
export async function updateMemberRole(
  memberId: string,
  newRole: 'owner' | 'admin' | 'member'
) {
  try {
    const payloadUser = await getPayloadUserFromSession()
    if (!payloadUser) {
      return { success: false, error: 'Not authenticated' }
    }

    const payload = await getPayload({ config })

    await payload.update({
      collection: 'workspace-members',
      id: memberId,
      data: { role: newRole },
      user: payloadUser,
      overrideAccess: false,
    })

    revalidatePath('/workspaces')
    revalidatePath('/admin/workspaces')

    return { success: true }
  } catch (error) {
    console.error('Failed to update member role:', error)
    return { success: false, error: 'Failed to update member role' }
  }
}
```

- [ ] **Step 5: Migrate `removeMember`**

```typescript
export async function removeMember(memberId: string) {
  try {
    const payloadUser = await getPayloadUserFromSession()
    if (!payloadUser) {
      return { success: false, error: 'Not authenticated' }
    }

    const payload = await getPayload({ config })

    await payload.delete({
      collection: 'workspace-members',
      id: memberId,
      user: payloadUser,
      overrideAccess: false,
    })

    revalidatePath('/workspaces')
    revalidatePath('/admin/workspaces')

    return { success: true }
  } catch (error) {
    console.error('Failed to remove member:', error)
    return { success: false, error: 'Failed to remove member' }
  }
}
```

- [ ] **Step 6: Migrate `createWorkspace`**

Remove the manual membership creation — the `afterChange` hook handles it:

```typescript
export async function createWorkspace(data: {
  name: string
  slug: string
  description?: string
}) {
  try {
    const payloadUser = await getPayloadUserFromSession()
    if (!payloadUser) {
      return { success: false, error: 'Not authenticated' }
    }

    const payload = await getPayload({ config })

    // Check for duplicate slug
    const existing = await payload.find({
      collection: 'workspaces',
      where: { slug: { equals: data.slug } },
      limit: 1,
    })

    if (existing.docs.length > 0) {
      return { success: false, error: 'A workspace with this slug already exists' }
    }

    // Create workspace — afterChange hook auto-adds creator as owner
    const workspace = await payload.create({
      collection: 'workspaces',
      data: {
        name: data.name,
        slug: data.slug,
        description: data.description || null,
      },
      user: payloadUser,
      overrideAccess: false,
    })

    revalidatePath('/workspaces')
    revalidatePath('/admin/workspaces')

    return {
      success: true,
      workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug },
    }
  } catch (error) {
    console.error('Failed to create workspace:', error)
    return { success: false, error: 'Failed to create workspace' }
  }
}
```

- [ ] **Step 7: Migrate `updateWorkspaceSettings`**

```typescript
export async function updateWorkspaceSettings(
  workspaceId: string,
  data: { name: string; description?: string; slug?: string }
) {
  try {
    const payloadUser = await getPayloadUserFromSession()
    if (!payloadUser) {
      return { success: false, error: 'Not authenticated' }
    }

    const payload = await getPayload({ config })

    await payload.update({
      collection: 'workspaces',
      id: workspaceId,
      data: {
        name: data.name,
        description: data.description || null,
        ...(data.slug && { slug: data.slug }),
      },
      user: payloadUser,
      overrideAccess: false,
    })

    revalidatePath('/workspaces')
    revalidatePath('/admin/workspaces')

    return { success: true }
  } catch (error) {
    console.error('Failed to update workspace settings:', error)
    return { success: false, error: 'Failed to update workspace settings' }
  }
}
```

- [ ] **Step 8: Migrate `deleteWorkspace`**

**Important:** Delete the workspace FIRST (which enforces owner-only access), THEN clean up members. This prevents a race condition where members are deleted but the workspace delete fails due to authorization.

```typescript
export async function deleteWorkspace(workspaceId: string) {
  try {
    const payloadUser = await getPayloadUserFromSession()
    if (!payloadUser) {
      return { success: false, error: 'Not authenticated' }
    }

    const payload = await getPayload({ config })

    // Delete the workspace FIRST — access hook checks if user is owner
    await payload.delete({
      collection: 'workspaces',
      id: workspaceId,
      user: payloadUser,
      overrideAccess: false,
    })

    // Then clean up workspace members (system operation — overrideAccess: true)
    const membersResult = await payload.find({
      collection: 'workspace-members',
      where: { workspace: { equals: workspaceId } },
      limit: 1000,
      overrideAccess: true,
    })

    await Promise.all(
      membersResult.docs.map((member) =>
        payload.delete({
          collection: 'workspace-members',
          id: member.id,
          overrideAccess: true,
        })
      )
    )

    revalidatePath('/workspaces')
    revalidatePath('/admin/workspaces')

    return { success: true }
  } catch (error) {
    console.error('Failed to delete workspace:', error)
    return { success: false, error: 'Failed to delete workspace' }
  }
}
```

- [ ] **Step 9: Commit**

```bash
git add orbit-www/src/app/(frontend)/workspaces/actions.ts
git commit -m "feat(auth): migrate workspace actions to use Payload RBAC instead of overrideAccess"
```

---

### Task 8: Browser verification with agent-browser

**Files:** None (verification only)

- [ ] **Step 1: Verify login and workspace page loads**

Use `agent-browser` to navigate to `http://localhost:3000/login`, log in, and navigate to `/admin/workspaces`. Verify the page loads and existing workspaces are visible.

- [ ] **Step 2: Create a new workspace and verify owner membership**

Click "Create Workspace", fill in a name, submit. Verify:
- Workspace appears in the list
- Member count shows 1
- Clicking "Manage Members" shows the creator as owner

- [ ] **Step 3: Invite a member and verify**

Open Manage Members on the new workspace, invite an existing user. Verify:
- Member appears in the list
- Success toast shown

- [ ] **Step 4: Verify Payload admin panel access**

Navigate to `http://localhost:3000/admin`. Verify admin-role users can still access it.

- [ ] **Step 5: Commit verification results**

```bash
git commit --allow-empty -m "test: verify Payload RBAC integration via agent-browser"
```

---

### Task 9: Update the admin workspaces page to pass user context

**Files:**
- Modify: `orbit-www/src/app/(frontend)/admin/workspaces/page.tsx`

The server page component queries workspaces and workspace-members. Now that access hooks are enforced, these queries need user context.

- [ ] **Step 1: Read the current page and update queries**

The page at `orbit-www/src/app/(frontend)/admin/workspaces/page.tsx` calls `payload.find({ collection: 'workspaces' })` and `payload.find({ collection: 'workspace-members' })`. Since `workspaces.read` is `() => true`, that query works without auth. But `workspace-members.read` now requires membership.

For the admin page specifically, use `overrideAccess: true` on the member count query since this is an admin view that needs to show counts for all workspaces:

```typescript
const membersResult = await payload.find({
  collection: 'workspace-members',
  where: {
    workspace: { equals: workspace.id },
    status: { equals: 'active' },
  },
  limit: 0,
  overrideAccess: true, // Admin page needs full visibility
})
```

- [ ] **Step 2: Verify the admin workspaces page loads correctly**

Navigate to `/admin/workspaces` and verify workspace cards show correct member counts.

- [ ] **Step 3: Commit**

```bash
git add orbit-www/src/app/(frontend)/admin/workspaces/page.tsx
git commit -m "fix(auth): ensure admin workspaces page has access to member counts"
```

---

## Known Follow-ups (Out of Scope)

These files also query workspace-members and will need migration in a follow-up:

- `orbit-www/src/app/(frontend)/workspaces/[slug]/actions.ts` — Contains `requestJoinWorkspace` which uses `overrideAccess: true`. Currently unaffected since it already uses `overrideAccess: true` explicitly, but should be migrated to the new pattern.
- `orbit-www/src/app/(frontend)/workspaces/[slug]/page.tsx` — Server component that queries workspace-members for display. Uses server-side rendering where `req.user` may not be populated via the strategy. May need `overrideAccess: true` explicitly since it's a read-only display page.
- Remaining collections (`apps`, `templates`, `api-schemas`, `knowledge-*`, `kafka-*`, etc.) — See spec rollout section.
