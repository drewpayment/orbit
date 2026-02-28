# Payload Admin SSO Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow admin users logged into Better Auth to seamlessly access the Payload admin panel at `/admin` without a second login, gated by a `role` field on the user record.

**Architecture:** Add a `role` field (`super_admin|admin|user`) to both Better Auth and Payload Users. Create a custom Payload `AuthStrategy` that validates the Better Auth session cookie and checks the role. Disable Payload's built-in login. Add admin links to the sidebar and user dropdown.

**Tech Stack:** Better Auth, Payload 3.0 AuthStrategy API, MongoDB, Next.js 15

---

### Task 1: Add `role` field to Better Auth config

**Files:**
- Modify: `orbit-www/src/lib/auth.ts`

**Step 1: Add role to user.additionalFields**

In `orbit-www/src/lib/auth.ts`, add the `role` field alongside the existing `status` field in `user.additionalFields`:

```typescript
      status: {
        type: "string",
        required: false,
        defaultValue: "pending",
        input: false,
      },
      role: {
        type: "string",
        required: false,
        defaultValue: "user",
        input: false,
      },
```

**Step 2: Verify the build compiles**

Run: `cd orbit-www && DOCKER_BUILD=1 bun run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add orbit-www/src/lib/auth.ts
git commit -m "feat: add role field to Better Auth user config"
```

---

### Task 2: Add `role` field to Payload Users collection

**Files:**
- Modify: `orbit-www/src/collections/Users.ts`

**Step 1: Add role select field**

Add the following field to the `fields` array in `orbit-www/src/collections/Users.ts`, after the existing `status` field:

```typescript
    {
      name: 'role',
      type: 'select',
      label: 'User Role',
      defaultValue: 'user',
      options: [
        { label: 'Super Admin', value: 'super_admin' },
        { label: 'Admin', value: 'admin' },
        { label: 'User', value: 'user' },
      ],
      admin: {
        position: 'sidebar',
        description: 'Super Admin and Admin can access the Payload admin panel.',
      },
    },
```

**Step 2: Verify the build compiles**

Run: `cd orbit-www && DOCKER_BUILD=1 bun run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add orbit-www/src/collections/Users.ts
git commit -m "feat: add role field to Payload Users collection"
```

---

### Task 3: Create the custom Better Auth AuthStrategy for Payload

**Files:**
- Create: `orbit-www/src/lib/payload-better-auth-strategy.ts`

**Step 1: Create the strategy file**

Create `orbit-www/src/lib/payload-better-auth-strategy.ts`:

```typescript
import type { AuthStrategy, AuthStrategyFunctionArgs, AuthStrategyResult } from 'payload'
import { auth } from '@/lib/auth'

const ADMIN_ROLES = ['super_admin', 'admin']

/**
 * Custom Payload AuthStrategy that validates Better Auth sessions.
 * Only allows users with super_admin or admin roles to access the Payload admin panel.
 */
async function authenticate({ headers, payload }: AuthStrategyFunctionArgs): Promise<AuthStrategyResult> {
  try {
    // Validate the Better Auth session from the request cookies
    const session = await auth.api.getSession({ headers })

    if (!session?.user?.email) {
      return { user: null }
    }

    // Check if the user has an admin role
    // The role is stored on the Better Auth user record
    const userRole = (session.user as any).role || 'user'
    if (!ADMIN_ROLES.includes(userRole)) {
      return { user: null }
    }

    // Find the matching Payload user by email
    const result = await payload.find({
      collection: 'users',
      where: { email: { equals: session.user.email } },
      limit: 1,
      overrideAccess: true,
    })

    const payloadUser = result.docs[0]
    if (!payloadUser) {
      console.warn(`[better-auth-strategy] No Payload user found for admin email: ${session.user.email}`)
      return { user: null }
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

**Step 2: Verify the build compiles**

Run: `cd orbit-www && DOCKER_BUILD=1 bun run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add orbit-www/src/lib/payload-better-auth-strategy.ts
git commit -m "feat: create Better Auth strategy for Payload admin SSO"
```

---

### Task 4: Wire the strategy into Users collection and disable local login

**Files:**
- Modify: `orbit-www/src/collections/Users.ts`

**Step 1: Import and register the strategy, disable local auth**

Update `orbit-www/src/collections/Users.ts`:

```typescript
import type { CollectionConfig } from 'payload'
import { userApprovalAfterChangeHook } from './hooks/userApprovalHook'
import { betterAuthStrategy } from '@/lib/payload-better-auth-strategy'

export const Users: CollectionConfig = {
  slug: 'users',
  admin: {
    useAsTitle: 'email',
  },
  auth: {
    disableLocalStrategy: true,
    strategies: [betterAuthStrategy],
  },
  hooks: {
    // ... existing hooks unchanged
  },
  fields: [
    // ... existing fields unchanged
  ],
}
```

Note: Change `auth: true` to `auth: { disableLocalStrategy: true, strategies: [betterAuthStrategy] }`.

**Step 2: Verify the build compiles**

Run: `cd orbit-www && DOCKER_BUILD=1 bun run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add orbit-www/src/collections/Users.ts
git commit -m "feat: wire Better Auth strategy into Payload, disable local login"
```

---

### Task 5: Update `isAdmin` access helper and `checkPlatformAdmin`

**Files:**
- Modify: `orbit-www/src/access/isAdmin.ts`
- Modify: `orbit-www/src/app/actions/platform.ts`

**Step 1: Replace the isAdmin stub with real role check**

Replace `orbit-www/src/access/isAdmin.ts` with:

```typescript
import type { Access } from 'payload'

/**
 * Payload access control: allows only super_admin and admin users.
 * Works with both the custom Better Auth strategy (where user comes from strategy)
 * and direct Payload user records.
 */
export const isAdmin: Access = ({ req: { user } }) => {
  if (!user) return false
  const role = (user as any).role
  return role === 'super_admin' || role === 'admin'
}
```

**Step 2: Simplify checkPlatformAdmin to use the role field**

Replace `orbit-www/src/app/actions/platform.ts` with:

```typescript
'use server'

import { auth } from '@/lib/auth'
import { headers } from 'next/headers'

/**
 * Check if the current user has platform admin privileges.
 * Uses the role field on the Better Auth user record.
 */
export async function checkPlatformAdmin(): Promise<{
  isAdmin: boolean
  userId?: string
}> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { isAdmin: false }
  }

  const role = (session.user as any).role || 'user'
  const isAdmin = role === 'super_admin' || role === 'admin'

  return { isAdmin, userId: session.user.id }
}
```

**Step 3: Verify the build compiles**

Run: `cd orbit-www && DOCKER_BUILD=1 bun run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add orbit-www/src/access/isAdmin.ts orbit-www/src/app/actions/platform.ts
git commit -m "feat: replace isAdmin stub with real role check, simplify checkPlatformAdmin"
```

---

### Task 6: Add Admin link to sidebar and user dropdown

**Files:**
- Modify: `orbit-www/src/components/app-sidebar.tsx`
- Modify: `orbit-www/src/components/nav-user.tsx`

**Step 1: Add Admin link to sidebar secondary nav**

In `orbit-www/src/components/app-sidebar.tsx`, add an admin nav item that's conditionally shown:

Import `Shield` from lucide-react (add to existing import), then add below `NavSecondary`:

```tsx
import {
  BookOpen,
  Building2,
  Command,
  FileCode,
  LayoutDashboard,
  LayoutTemplate,
  Layers,
  MessageSquare,
  RadioTower,
  Shield,
} from "lucide-react"
```

Add admin nav data:

```typescript
const navAdminData = [
  {
    title: "Admin Panel",
    url: "/admin",
    icon: Shield,
  },
]
```

In the JSX, add between `NavSecondary` and closing `</SidebarContent>`:

```tsx
        <NavSecondary items={navSecondaryData} className="mt-auto" />
        {isPlatformAdmin && (
          <NavSecondary items={navAdminData} />
        )}
```

**Step 2: Add Admin Panel item to user dropdown**

In `orbit-www/src/components/nav-user.tsx`:

1. Add `Shield` to the lucide-react import
2. Accept `isAdmin` prop
3. Add Admin Panel menu item

Update the component props:

```typescript
export function NavUser({
  user,
  isAdmin,
}: {
  user: {
    name: string
    email: string
    avatar: string
    initials?: string
  }
  isAdmin?: boolean
}) {
```

Add the Admin Panel menu item in the dropdown, after the Account group and before the Log out separator:

```tsx
            {isAdmin && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={() => router.push('/admin')}>
                    <Shield />
                    Admin Panel
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </>
            )}
```

**Step 3: Pass isAdmin to NavUser from AppSidebar**

In `orbit-www/src/components/app-sidebar.tsx`, update the NavUser call:

```tsx
        <NavUser user={user} isAdmin={isPlatformAdmin} />
```

**Step 4: Verify the build compiles**

Run: `cd orbit-www && DOCKER_BUILD=1 bun run build`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add orbit-www/src/components/app-sidebar.tsx orbit-www/src/components/nav-user.tsx
git commit -m "feat: add Admin Panel link to sidebar and user dropdown for admins"
```

---

### Task 7: Set existing admin user's role to super_admin

**Files:**
- Modify: `orbit-www/src/lib/auth.ts` (update birthright logic)

**Step 1: Update the databaseHooks to treat users without a role as super_admin (birthright)**

In `orbit-www/src/lib/auth.ts`, the existing `databaseHooks.session.create.before` already has birthright logic for the `status` field (no status = allow through). No changes needed there since users without a `role` field still log in fine — the role check only matters for Payload admin access.

However, we need to set the existing admin user's role in MongoDB. Create a one-time script or do it manually.

The simplest approach: update the Better Auth user record for the existing admin via a simple script that can be run once.

Create `orbit-www/src/scripts/set-admin-role.ts`:

```typescript
import { MongoClient } from 'mongodb'

async function main() {
  const email = process.argv[2]
  if (!email) {
    console.error('Usage: npx tsx src/scripts/set-admin-role.ts <email>')
    process.exit(1)
  }

  const client = new MongoClient(process.env.DATABASE_URI || 'mongodb://localhost:27017/orbit-www')
  await client.connect()
  const db = client.db()

  // Update Better Auth user
  const baResult = await db.collection('user').updateOne(
    { email },
    { $set: { role: 'super_admin' } },
  )
  console.log(`Better Auth user: ${baResult.modifiedCount ? 'updated' : 'not found'}`)

  // Update Payload user
  const plResult = await db.collection('users').updateOne(
    { email },
    { $set: { role: 'super_admin' } },
  )
  console.log(`Payload user: ${plResult.modifiedCount ? 'updated' : 'not found'}`)

  await client.close()
  console.log(`Done. ${email} is now super_admin.`)
}

main().catch(console.error)
```

**Step 2: Run the script for the existing admin**

Run: `cd orbit-www && npx tsx src/scripts/set-admin-role.ts drew.payment@gmail.com`
Expected: Both users updated

**Step 3: Commit**

```bash
git add orbit-www/src/scripts/set-admin-role.ts
git commit -m "feat: add script to set admin user role to super_admin"
```

---

### Task 8: Build verification and manual testing

**Step 1: Verify the build**

Run: `cd orbit-www && DOCKER_BUILD=1 bun run build`
Expected: Build succeeds with no errors

**Step 2: Start dev server and test**

Run: `cd orbit-www && bun run dev`

Test sequence:
1. Log in as admin user (drew.payment@gmail.com) at `/login`
2. **Expected**: Dashboard loads, sidebar shows "Admin Panel" link, user dropdown shows "Admin Panel" item
3. Click "Admin Panel" link
4. **Expected**: Payload admin panel loads at `/admin` without showing a login form — user is already authenticated via Better Auth
5. Verify you can navigate Payload admin (Users collection, etc.)

**Step 3: Test non-admin access**

1. Create a test user via `/signup` (will be `role: user` by default)
2. Approve the test user in Payload admin (set status to approved, check skip email verification)
3. Log in as the test user
4. **Expected**: No "Admin Panel" link in sidebar or dropdown
5. Navigate directly to `/admin`
6. **Expected**: Unauthorized / redirected away — non-admin cannot access

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: address issues found during integration testing"
```
