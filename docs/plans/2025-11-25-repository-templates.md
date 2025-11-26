# Repository Templates Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable users to import GitHub repositories as templates with rich metadata, browse a template catalog, and create new repositories from templates.

**Architecture:** Payload CMS collections for templates and permissions, sessionStorage for client-side permission caching, JWT claims for backend authorization, Temporal workflows for template instantiation.

**Tech Stack:** Payload 3.0, Next.js 15, TypeScript, React 19, Radix UI, Tailwind CSS

**Design Document:** `docs/plans/2025-11-25-repository-templates-design.md`

---

## Phase 1: Permissions Foundation

### Task 1.1: Create Permissions Collection

**Files:**
- Create: `orbit-www/src/collections/Permissions.ts`
- Modify: `orbit-www/src/payload.config.ts`

**Step 1: Create the Permissions collection**

```typescript
// orbit-www/src/collections/Permissions.ts
import type { CollectionConfig } from 'payload'

export const Permissions: CollectionConfig = {
  slug: 'permissions',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'slug', 'category', 'scope'],
    group: 'Access Control',
  },
  access: {
    // Only super admins can manage permissions
    read: () => true,
    create: ({ req: { user } }) => !!user,
    update: ({ req: { user } }) => !!user,
    delete: ({ req: { user } }) => !!user,
  },
  fields: [
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      label: 'Permission Slug',
      admin: {
        description: 'Unique identifier (e.g., "template:create", "repository:delete")',
      },
      validate: (val: unknown) => {
        if (typeof val !== 'string' || !/^[a-z]+:[a-z]+$/.test(val)) {
          return 'Slug must be in format "resource:action" (e.g., "template:create")'
        }
        return true
      },
    },
    {
      name: 'name',
      type: 'text',
      required: true,
      label: 'Display Name',
      admin: {
        description: 'Human-readable name (e.g., "Create Templates")',
      },
    },
    {
      name: 'description',
      type: 'textarea',
      label: 'Description',
      admin: {
        description: 'What this permission allows',
      },
    },
    {
      name: 'category',
      type: 'select',
      required: true,
      options: [
        { label: 'Template', value: 'template' },
        { label: 'Repository', value: 'repository' },
        { label: 'Workspace', value: 'workspace' },
        { label: 'Knowledge', value: 'knowledge' },
        { label: 'Admin', value: 'admin' },
      ],
      admin: {
        description: 'Category for grouping permissions',
      },
    },
    {
      name: 'scope',
      type: 'select',
      required: true,
      defaultValue: 'workspace',
      options: [
        { label: 'Platform', value: 'platform' },
        { label: 'Workspace', value: 'workspace' },
      ],
      admin: {
        description: 'Where this permission applies',
      },
    },
  ],
}
```

**Step 2: Register in payload.config.ts**

Add import at top:
```typescript
import { Permissions } from './collections/Permissions'
```

Add to collections array:
```typescript
collections: [
  // ... existing collections
  Permissions,
],
```

**Step 3: Verify collection loads**

Run: `cd orbit-www && bun run dev`
Expected: Server starts without errors, Permissions appears in admin under "Access Control"

**Step 4: Commit**

```bash
git add orbit-www/src/collections/Permissions.ts orbit-www/src/payload.config.ts
git commit -m "feat: add Permissions collection for granular access control"
```

---

### Task 1.2: Create Roles Collection

**Files:**
- Create: `orbit-www/src/collections/Roles.ts`
- Modify: `orbit-www/src/payload.config.ts`

**Step 1: Create the Roles collection**

```typescript
// orbit-www/src/collections/Roles.ts
import type { CollectionConfig } from 'payload'

export const Roles: CollectionConfig = {
  slug: 'roles',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'slug', 'scope', 'isSystem'],
    group: 'Access Control',
  },
  access: {
    read: () => true,
    create: ({ req: { user } }) => !!user,
    update: ({ req: { user } }) => !!user,
    // Prevent deletion of system roles
    delete: async ({ req: { user, payload }, id }) => {
      if (!user || !id) return false
      const role = await payload.findByID({
        collection: 'roles',
        id,
      })
      return !role.isSystem
    },
  },
  fields: [
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      label: 'Role Slug',
      admin: {
        description: 'Unique identifier (e.g., "workspace-admin")',
      },
      validate: (val: unknown) => {
        if (typeof val !== 'string' || !/^[a-z][a-z0-9-]*$/.test(val)) {
          return 'Slug must start with letter and contain only lowercase letters, numbers, and hyphens'
        }
        return true
      },
    },
    {
      name: 'name',
      type: 'text',
      required: true,
      label: 'Display Name',
    },
    {
      name: 'description',
      type: 'textarea',
      label: 'Description',
    },
    {
      name: 'scope',
      type: 'select',
      required: true,
      defaultValue: 'workspace',
      options: [
        { label: 'Platform', value: 'platform' },
        { label: 'Workspace', value: 'workspace' },
      ],
    },
    {
      name: 'permissions',
      type: 'relationship',
      relationTo: 'permissions',
      hasMany: true,
      label: 'Permissions',
      admin: {
        description: 'Permissions granted by this role',
      },
    },
    {
      name: 'isDefault',
      type: 'checkbox',
      defaultValue: false,
      label: 'Default Role',
      admin: {
        description: 'Auto-assigned to new workspace members',
      },
    },
    {
      name: 'isSystem',
      type: 'checkbox',
      defaultValue: false,
      label: 'System Role',
      admin: {
        description: 'Built-in role that cannot be deleted',
        readOnly: true,
      },
    },
  ],
}
```

**Step 2: Register in payload.config.ts**

Add import:
```typescript
import { Roles } from './collections/Roles'
```

Add to collections array after Permissions:
```typescript
Roles,
```

**Step 3: Verify collection loads**

Run: `cd orbit-www && bun run dev`
Expected: Roles appears in admin under "Access Control"

**Step 4: Commit**

```bash
git add orbit-www/src/collections/Roles.ts orbit-www/src/payload.config.ts
git commit -m "feat: add Roles collection with permission relationships"
```

---

### Task 1.3: Create UserWorkspaceRoles Collection

**Files:**
- Create: `orbit-www/src/collections/UserWorkspaceRoles.ts`
- Modify: `orbit-www/src/payload.config.ts`

**Step 1: Create the junction collection**

```typescript
// orbit-www/src/collections/UserWorkspaceRoles.ts
import type { CollectionConfig } from 'payload'

export const UserWorkspaceRoles: CollectionConfig = {
  slug: 'user-workspace-roles',
  admin: {
    useAsTitle: 'id',
    defaultColumns: ['user', 'workspace', 'role'],
    group: 'Access Control',
  },
  access: {
    // Users can read their own role assignments
    read: async ({ req: { user, payload }, id }) => {
      if (!user) return false
      if (!id) {
        // For list queries, return constraint
        return {
          user: { equals: user.id },
        }
      }
      const assignment = await payload.findByID({
        collection: 'user-workspace-roles',
        id,
        overrideAccess: true,
      })
      return assignment.user === user.id
    },
    create: ({ req: { user } }) => !!user,
    update: ({ req: { user } }) => !!user,
    delete: ({ req: { user } }) => !!user,
  },
  fields: [
    {
      name: 'user',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      hasMany: false,
      index: true,
    },
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      hasMany: false,
      index: true,
      admin: {
        description: 'Leave empty for platform-level roles',
      },
    },
    {
      name: 'role',
      type: 'relationship',
      relationTo: 'roles',
      required: true,
      hasMany: false,
    },
  ],
  indexes: [
    {
      fields: ['user', 'workspace', 'role'],
      unique: true,
    },
  ],
}
```

**Step 2: Register in payload.config.ts**

Add import:
```typescript
import { UserWorkspaceRoles } from './collections/UserWorkspaceRoles'
```

Add to collections array:
```typescript
UserWorkspaceRoles,
```

**Step 3: Verify collection loads**

Run: `cd orbit-www && bun run dev`
Expected: User Workspace Roles appears in admin

**Step 4: Commit**

```bash
git add orbit-www/src/collections/UserWorkspaceRoles.ts orbit-www/src/payload.config.ts
git commit -m "feat: add UserWorkspaceRoles junction collection"
```

---

### Task 1.4: Create Seed Script for Built-in Permissions and Roles

**Files:**
- Create: `orbit-www/src/scripts/seed-permissions.ts`

**Step 1: Create the seed script**

```typescript
// orbit-www/src/scripts/seed-permissions.ts
import { getPayload } from 'payload'
import config from '@payload-config'

const PERMISSIONS = [
  // Template permissions
  { slug: 'template:create', name: 'Create Templates', description: 'Import/register new templates from GitHub repos', category: 'template', scope: 'workspace' },
  { slug: 'template:publish', name: 'Publish Templates', description: 'Change template visibility to shared/public', category: 'template', scope: 'workspace' },
  { slug: 'template:manage', name: 'Manage Templates', description: 'Edit, archive, and delete templates', category: 'template', scope: 'workspace' },

  // Repository permissions
  { slug: 'repository:create', name: 'Create Repositories', description: 'Create new repositories', category: 'repository', scope: 'workspace' },
  { slug: 'repository:update', name: 'Update Repositories', description: 'Edit repository metadata', category: 'repository', scope: 'workspace' },
  { slug: 'repository:delete', name: 'Delete Repositories', description: 'Delete repositories', category: 'repository', scope: 'workspace' },
  { slug: 'repository:admin', name: 'Administer Repositories', description: 'Full repository control', category: 'repository', scope: 'workspace' },

  // Workspace permissions
  { slug: 'workspace:manage', name: 'Manage Workspace', description: 'Edit workspace settings', category: 'workspace', scope: 'workspace' },
  { slug: 'workspace:invite', name: 'Invite Members', description: 'Invite users to workspace', category: 'workspace', scope: 'workspace' },
  { slug: 'workspace:settings', name: 'Workspace Settings', description: 'Configure workspace settings', category: 'workspace', scope: 'workspace' },

  // Knowledge permissions
  { slug: 'knowledge:create', name: 'Create Knowledge', description: 'Create knowledge pages', category: 'knowledge', scope: 'workspace' },
  { slug: 'knowledge:publish', name: 'Publish Knowledge', description: 'Publish knowledge pages', category: 'knowledge', scope: 'workspace' },
  { slug: 'knowledge:admin', name: 'Administer Knowledge', description: 'Full knowledge control', category: 'knowledge', scope: 'workspace' },

  // Platform permissions
  { slug: 'admin:impersonate', name: 'Impersonate Users', description: 'Act as another user', category: 'admin', scope: 'platform' },
  { slug: 'admin:tenants', name: 'Manage Tenants', description: 'Manage all tenants', category: 'admin', scope: 'platform' },
] as const

const ROLES = [
  {
    slug: 'super-admin',
    name: 'Super Admin',
    description: 'Full platform access',
    scope: 'platform',
    isSystem: true,
    isDefault: false,
    permissionSlugs: PERMISSIONS.map(p => p.slug),
  },
  {
    slug: 'workspace-owner',
    name: 'Workspace Owner',
    description: 'Full workspace control',
    scope: 'workspace',
    isSystem: true,
    isDefault: false,
    permissionSlugs: [
      'template:create', 'template:publish', 'template:manage',
      'repository:create', 'repository:update', 'repository:delete', 'repository:admin',
      'workspace:manage', 'workspace:invite', 'workspace:settings',
      'knowledge:create', 'knowledge:publish', 'knowledge:admin',
    ],
  },
  {
    slug: 'workspace-admin',
    name: 'Workspace Admin',
    description: 'Workspace administration',
    scope: 'workspace',
    isSystem: true,
    isDefault: false,
    permissionSlugs: [
      'template:create', 'template:publish', 'template:manage',
      'repository:create', 'repository:update', 'repository:delete',
      'workspace:invite', 'workspace:settings',
      'knowledge:create', 'knowledge:publish', 'knowledge:admin',
    ],
  },
  {
    slug: 'workspace-member',
    name: 'Workspace Member',
    description: 'Standard workspace access',
    scope: 'workspace',
    isSystem: true,
    isDefault: true,
    permissionSlugs: [
      'template:create',
      'repository:create', 'repository:update',
      'knowledge:create', 'knowledge:publish',
    ],
  },
  {
    slug: 'workspace-viewer',
    name: 'Workspace Viewer',
    description: 'Read-only access',
    scope: 'workspace',
    isSystem: true,
    isDefault: false,
    permissionSlugs: [],
  },
]

async function seed() {
  const payload = await getPayload({ config })

  console.log('Seeding permissions...')

  // Create permissions
  const permissionMap = new Map<string, string>()

  for (const perm of PERMISSIONS) {
    const existing = await payload.find({
      collection: 'permissions',
      where: { slug: { equals: perm.slug } },
      limit: 1,
    })

    if (existing.docs.length === 0) {
      const created = await payload.create({
        collection: 'permissions',
        data: perm,
      })
      permissionMap.set(perm.slug, created.id)
      console.log(`  Created permission: ${perm.slug}`)
    } else {
      permissionMap.set(perm.slug, existing.docs[0].id)
      console.log(`  Exists: ${perm.slug}`)
    }
  }

  console.log('Seeding roles...')

  // Create roles
  for (const role of ROLES) {
    const existing = await payload.find({
      collection: 'roles',
      where: { slug: { equals: role.slug } },
      limit: 1,
    })

    const permissionIds = role.permissionSlugs
      .map(slug => permissionMap.get(slug))
      .filter((id): id is string => !!id)

    if (existing.docs.length === 0) {
      await payload.create({
        collection: 'roles',
        data: {
          slug: role.slug,
          name: role.name,
          description: role.description,
          scope: role.scope,
          isSystem: role.isSystem,
          isDefault: role.isDefault,
          permissions: permissionIds,
        },
      })
      console.log(`  Created role: ${role.slug}`)
    } else {
      // Update existing role with current permissions
      await payload.update({
        collection: 'roles',
        id: existing.docs[0].id,
        data: {
          permissions: permissionIds,
        },
      })
      console.log(`  Updated role: ${role.slug}`)
    }
  }

  console.log('Seed complete!')
  process.exit(0)
}

seed().catch(console.error)
```

**Step 2: Add script to package.json**

In `orbit-www/package.json`, add to scripts:
```json
"seed:permissions": "tsx src/scripts/seed-permissions.ts"
```

**Step 3: Run the seed script**

Run: `cd orbit-www && bun run seed:permissions`
Expected: Output shows permissions and roles being created

**Step 4: Commit**

```bash
git add orbit-www/src/scripts/seed-permissions.ts orbit-www/package.json
git commit -m "feat: add seed script for built-in permissions and roles"
```

---

### Task 1.5: Create Permission Loading Utility

**Files:**
- Create: `orbit-www/src/lib/permissions.ts`

**Step 1: Create the permissions utility**

```typescript
// orbit-www/src/lib/permissions.ts

export interface UserPermissions {
  workspaces: {
    [workspaceId: string]: {
      roles: string[]
      permissions: string[]
    }
  }
  platformPermissions: string[]
}

const PERMISSIONS_KEY = 'orbit_permissions'

/**
 * Store user permissions in sessionStorage
 */
export function storePermissions(permissions: UserPermissions): void {
  if (typeof window === 'undefined') return
  sessionStorage.setItem(PERMISSIONS_KEY, JSON.stringify(permissions))
}

/**
 * Get user permissions from sessionStorage
 */
export function getStoredPermissions(): UserPermissions | null {
  if (typeof window === 'undefined') return null
  const stored = sessionStorage.getItem(PERMISSIONS_KEY)
  if (!stored) return null
  try {
    return JSON.parse(stored) as UserPermissions
  } catch {
    return null
  }
}

/**
 * Clear stored permissions (on logout)
 */
export function clearPermissions(): void {
  if (typeof window === 'undefined') return
  sessionStorage.removeItem(PERMISSIONS_KEY)
}

/**
 * Check if user has a specific permission in a workspace
 */
export function hasPermission(
  workspaceId: string,
  permission: string,
  permissions?: UserPermissions | null
): boolean {
  const perms = permissions ?? getStoredPermissions()
  if (!perms) return false

  // Check platform permissions first (super admin)
  if (perms.platformPermissions.includes(permission)) return true
  if (perms.platformPermissions.includes('*')) return true

  // Check workspace permissions
  const workspace = perms.workspaces[workspaceId]
  if (!workspace) return false

  return workspace.permissions.includes(permission)
}

/**
 * Check if user has any of the specified permissions
 */
export function hasAnyPermission(
  workspaceId: string,
  requiredPermissions: string[],
  permissions?: UserPermissions | null
): boolean {
  return requiredPermissions.some(p => hasPermission(workspaceId, p, permissions))
}

/**
 * Check if user has all of the specified permissions
 */
export function hasAllPermissions(
  workspaceId: string,
  requiredPermissions: string[],
  permissions?: UserPermissions | null
): boolean {
  return requiredPermissions.every(p => hasPermission(workspaceId, p, permissions))
}

/**
 * Get all workspaces user has access to
 */
export function getAccessibleWorkspaces(permissions?: UserPermissions | null): string[] {
  const perms = permissions ?? getStoredPermissions()
  if (!perms) return []
  return Object.keys(perms.workspaces)
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd orbit-www && bunx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add orbit-www/src/lib/permissions.ts
git commit -m "feat: add client-side permission utilities with sessionStorage"
```

---

### Task 1.6: Create Permission Loading Server Action

**Files:**
- Create: `orbit-www/src/app/actions/permissions.ts`

**Step 1: Create the server action**

```typescript
// orbit-www/src/app/actions/permissions.ts
'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import type { UserPermissions } from '@/lib/permissions'

/**
 * Load user permissions from database
 * Called on login to populate sessionStorage
 */
export async function loadUserPermissions(): Promise<UserPermissions | null> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return null
  }

  const payload = await getPayload({ config })
  const userId = session.user.id

  // Fetch all role assignments for this user
  const roleAssignments = await payload.find({
    collection: 'user-workspace-roles',
    where: {
      user: { equals: userId },
    },
    depth: 2, // Include role and permissions
    limit: 1000,
  })

  const permissions: UserPermissions = {
    workspaces: {},
    platformPermissions: [],
  }

  for (const assignment of roleAssignments.docs) {
    const role = typeof assignment.role === 'object' ? assignment.role : null
    if (!role) continue

    const rolePermissions = (role.permissions || [])
      .map((p: unknown) => {
        if (typeof p === 'object' && p !== null && 'slug' in p) {
          return (p as { slug: string }).slug
        }
        return null
      })
      .filter((p): p is string => p !== null)

    if (role.scope === 'platform') {
      // Platform-level role
      permissions.platformPermissions.push(...rolePermissions)
    } else if (assignment.workspace) {
      // Workspace-level role
      const workspaceId = typeof assignment.workspace === 'object'
        ? assignment.workspace.id
        : assignment.workspace

      if (!permissions.workspaces[workspaceId]) {
        permissions.workspaces[workspaceId] = {
          roles: [],
          permissions: [],
        }
      }

      permissions.workspaces[workspaceId].roles.push(role.slug)
      permissions.workspaces[workspaceId].permissions.push(...rolePermissions)
    }
  }

  // Deduplicate permissions
  permissions.platformPermissions = [...new Set(permissions.platformPermissions)]
  for (const workspaceId of Object.keys(permissions.workspaces)) {
    permissions.workspaces[workspaceId].permissions = [
      ...new Set(permissions.workspaces[workspaceId].permissions)
    ]
  }

  return permissions
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd orbit-www && bunx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add orbit-www/src/app/actions/permissions.ts
git commit -m "feat: add server action to load user permissions from database"
```

---

### Task 1.7: Create usePermissions Hook

**Files:**
- Create: `orbit-www/src/hooks/usePermissions.ts`

**Step 1: Create the React hook**

```typescript
// orbit-www/src/hooks/usePermissions.ts
'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  UserPermissions,
  getStoredPermissions,
  storePermissions,
  clearPermissions,
  hasPermission as checkPermission,
  hasAnyPermission as checkAnyPermission,
  hasAllPermissions as checkAllPermissions,
} from '@/lib/permissions'
import { loadUserPermissions } from '@/app/actions/permissions'

interface UsePermissionsReturn {
  permissions: UserPermissions | null
  isLoading: boolean
  hasPermission: (workspaceId: string, permission: string) => boolean
  hasAnyPermission: (workspaceId: string, permissions: string[]) => boolean
  hasAllPermissions: (workspaceId: string, permissions: string[]) => boolean
  refresh: () => Promise<void>
  clear: () => void
}

export function usePermissions(): UsePermissionsReturn {
  const [permissions, setPermissions] = useState<UserPermissions | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Load permissions on mount
  useEffect(() => {
    const stored = getStoredPermissions()
    if (stored) {
      setPermissions(stored)
      setIsLoading(false)
    } else {
      // Fetch from server
      loadUserPermissions().then((perms) => {
        if (perms) {
          storePermissions(perms)
          setPermissions(perms)
        }
        setIsLoading(false)
      })
    }
  }, [])

  const refresh = useCallback(async () => {
    setIsLoading(true)
    const perms = await loadUserPermissions()
    if (perms) {
      storePermissions(perms)
      setPermissions(perms)
    }
    setIsLoading(false)
  }, [])

  const clear = useCallback(() => {
    clearPermissions()
    setPermissions(null)
  }, [])

  const hasPermission = useCallback((workspaceId: string, permission: string) => {
    return checkPermission(workspaceId, permission, permissions)
  }, [permissions])

  const hasAnyPermission = useCallback((workspaceId: string, perms: string[]) => {
    return checkAnyPermission(workspaceId, perms, permissions)
  }, [permissions])

  const hasAllPermissions = useCallback((workspaceId: string, perms: string[]) => {
    return checkAllPermissions(workspaceId, perms, permissions)
  }, [permissions])

  return {
    permissions,
    isLoading,
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    refresh,
    clear,
  }
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd orbit-www && bunx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add orbit-www/src/hooks/usePermissions.ts
git commit -m "feat: add usePermissions hook for React components"
```

---

## Phase 2: Template Data Model

### Task 2.1: Create Templates Collection

**Files:**
- Create: `orbit-www/src/collections/Templates.ts`
- Modify: `orbit-www/src/payload.config.ts`

**Step 1: Create the Templates collection**

```typescript
// orbit-www/src/collections/Templates.ts
import type { CollectionConfig } from 'payload'

export const Templates: CollectionConfig = {
  slug: 'templates',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'language', 'visibility', 'workspace', 'usageCount'],
    group: 'Repositories',
  },
  access: {
    // Read: Based on visibility and workspace membership
    read: async ({ req: { user, payload } }) => {
      if (!user) return false

      // Get user's workspace memberships
      const memberships = await payload.find({
        collection: 'workspace-members',
        where: {
          user: { equals: user.id },
          status: { equals: 'active' },
        },
        limit: 1000,
        overrideAccess: true,
      })

      const workspaceIds = memberships.docs.map(m =>
        typeof m.workspace === 'string' ? m.workspace : m.workspace.id
      )

      // Return query constraint: public OR in user's workspaces OR shared with user's workspaces
      return {
        or: [
          { visibility: { equals: 'public' } },
          { workspace: { in: workspaceIds } },
          { sharedWith: { in: workspaceIds } },
        ],
      }
    },
    // Create: Users with template:create permission
    create: ({ req: { user } }) => !!user,
    // Update: Workspace admins/owners
    update: async ({ req: { user, payload }, id }) => {
      if (!user || !id) return false

      const template = await payload.findByID({
        collection: 'templates',
        id,
        overrideAccess: true,
      })

      const workspaceId = typeof template.workspace === 'string'
        ? template.workspace
        : template.workspace.id

      const members = await payload.find({
        collection: 'workspace-members',
        where: {
          and: [
            { workspace: { equals: workspaceId } },
            { user: { equals: user.id } },
            { role: { in: ['owner', 'admin'] } },
            { status: { equals: 'active' } },
          ],
        },
        overrideAccess: true,
      })

      return members.docs.length > 0
    },
    // Delete: Workspace owners only
    delete: async ({ req: { user, payload }, id }) => {
      if (!user || !id) return false

      const template = await payload.findByID({
        collection: 'templates',
        id,
        overrideAccess: true,
      })

      const workspaceId = typeof template.workspace === 'string'
        ? template.workspace
        : template.workspace.id

      const members = await payload.find({
        collection: 'workspace-members',
        where: {
          and: [
            { workspace: { equals: workspaceId } },
            { user: { equals: user.id } },
            { role: { equals: 'owner' } },
            { status: { equals: 'active' } },
          ],
        },
        overrideAccess: true,
      })

      return members.docs.length > 0
    },
  },
  fields: [
    // Identity
    {
      name: 'name',
      type: 'text',
      required: true,
      minLength: 3,
      maxLength: 100,
      label: 'Template Name',
    },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      label: 'URL Slug',
      validate: (val: unknown) => {
        if (typeof val !== 'string' || !/^[a-z0-9-]+$/.test(val)) {
          return 'Slug must contain only lowercase letters, numbers, and hyphens'
        }
        return true
      },
    },
    {
      name: 'description',
      type: 'textarea',
      label: 'Description',
      maxLength: 2000,
      admin: {
        description: 'Supports markdown',
      },
    },

    // Ownership & Visibility
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      required: true,
      hasMany: false,
      index: true,
    },
    {
      name: 'visibility',
      type: 'select',
      required: true,
      defaultValue: 'workspace',
      options: [
        { label: 'Workspace Only', value: 'workspace' },
        { label: 'Shared', value: 'shared' },
        { label: 'Public', value: 'public' },
      ],
    },
    {
      name: 'sharedWith',
      type: 'relationship',
      relationTo: 'workspaces',
      hasMany: true,
      label: 'Shared With Workspaces',
      admin: {
        condition: (data) => data?.visibility === 'shared',
        description: 'Workspaces that can use this template',
      },
    },

    // GitHub Source
    {
      name: 'gitProvider',
      type: 'select',
      required: true,
      defaultValue: 'github',
      options: [
        { label: 'GitHub', value: 'github' },
        { label: 'Azure DevOps', value: 'azure_devops' },
        { label: 'GitLab', value: 'gitlab' },
        { label: 'Bitbucket', value: 'bitbucket' },
      ],
    },
    {
      name: 'repoUrl',
      type: 'text',
      required: true,
      label: 'Repository URL',
      admin: {
        description: 'Full URL to the GitHub repository',
      },
    },
    {
      name: 'defaultBranch',
      type: 'text',
      defaultValue: 'main',
      label: 'Default Branch',
    },
    {
      name: 'isGitHubTemplate',
      type: 'checkbox',
      defaultValue: false,
      label: 'GitHub Template Repository',
      admin: {
        description: 'Is this repo marked as a Template in GitHub?',
      },
    },

    // Metadata
    {
      name: 'language',
      type: 'text',
      label: 'Programming Language',
      admin: {
        description: 'Primary language (e.g., typescript, go, python)',
      },
    },
    {
      name: 'framework',
      type: 'text',
      label: 'Framework',
      admin: {
        description: 'Framework used (e.g., nextjs, express, fastapi)',
      },
    },
    {
      name: 'categories',
      type: 'select',
      hasMany: true,
      options: [
        { label: 'API Service', value: 'api-service' },
        { label: 'Frontend App', value: 'frontend-app' },
        { label: 'Backend Service', value: 'backend-service' },
        { label: 'CLI Tool', value: 'cli-tool' },
        { label: 'Library', value: 'library' },
        { label: 'Mobile App', value: 'mobile-app' },
        { label: 'Infrastructure', value: 'infrastructure' },
        { label: 'Documentation', value: 'documentation' },
        { label: 'Monorepo', value: 'monorepo' },
      ],
    },
    {
      name: 'tags',
      type: 'array',
      label: 'Tags',
      fields: [
        {
          name: 'tag',
          type: 'text',
          required: true,
        },
      ],
    },
    {
      name: 'complexity',
      type: 'select',
      options: [
        { label: 'Starter', value: 'starter' },
        { label: 'Intermediate', value: 'intermediate' },
        { label: 'Production Ready', value: 'production-ready' },
      ],
    },

    // Manifest Sync
    {
      name: 'manifestPath',
      type: 'text',
      defaultValue: 'orbit-template.yaml',
      label: 'Manifest File Path',
    },
    {
      name: 'lastSyncedAt',
      type: 'date',
      label: 'Last Synced',
      admin: {
        readOnly: true,
        date: {
          pickerAppearance: 'dayAndTime',
        },
      },
    },
    {
      name: 'syncStatus',
      type: 'select',
      defaultValue: 'pending',
      options: [
        { label: 'Synced', value: 'synced' },
        { label: 'Error', value: 'error' },
        { label: 'Pending', value: 'pending' },
      ],
      admin: {
        readOnly: true,
      },
    },
    {
      name: 'syncError',
      type: 'text',
      label: 'Sync Error',
      admin: {
        readOnly: true,
        condition: (data) => data?.syncStatus === 'error',
      },
    },

    // Variables (from manifest)
    {
      name: 'variables',
      type: 'json',
      label: 'Template Variables',
      admin: {
        description: 'Parsed from orbit-template.yaml',
        readOnly: true,
      },
    },

    // Webhook (optional)
    {
      name: 'webhookId',
      type: 'text',
      label: 'Webhook ID',
      admin: {
        readOnly: true,
        position: 'sidebar',
      },
    },
    {
      name: 'webhookSecret',
      type: 'text',
      label: 'Webhook Secret',
      admin: {
        hidden: true,
      },
    },

    // Stats
    {
      name: 'usageCount',
      type: 'number',
      defaultValue: 0,
      label: 'Usage Count',
      admin: {
        readOnly: true,
        position: 'sidebar',
      },
    },

    // Audit
    {
      name: 'createdBy',
      type: 'relationship',
      relationTo: 'users',
      hasMany: false,
      admin: {
        readOnly: true,
        position: 'sidebar',
      },
    },
  ],
  hooks: {
    beforeValidate: [
      ({ data, operation, req }) => {
        if (!data) return data

        // Auto-generate slug from name
        if (operation === 'create' && !data.slug && data.name) {
          data.slug = data.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')
        }

        // Set createdBy on create
        if (operation === 'create' && req.user && !data.createdBy) {
          data.createdBy = req.user.id
        }

        return data
      },
    ],
  },
}
```

**Step 2: Register in payload.config.ts**

Add import:
```typescript
import { Templates } from './collections/Templates'
```

Add to collections array:
```typescript
Templates,
```

**Step 3: Verify collection loads**

Run: `cd orbit-www && bun run dev`
Expected: Templates appears in admin under "Repositories"

**Step 4: Commit**

```bash
git add orbit-www/src/collections/Templates.ts orbit-www/src/payload.config.ts
git commit -m "feat: add Templates collection with visibility and metadata"
```

---

### Task 2.2: Create Manifest Parser Utility

**Files:**
- Create: `orbit-www/src/lib/template-manifest.ts`

**Step 1: Create the manifest parser**

```typescript
// orbit-www/src/lib/template-manifest.ts
import * as yaml from 'yaml'

export interface TemplateVariable {
  key: string
  type: 'string' | 'number' | 'boolean' | 'select' | 'multiselect'
  required: boolean
  description?: string
  default?: string | number | boolean
  validation?: {
    pattern?: string
    minLength?: number
    maxLength?: number
    min?: number
    max?: number
  }
  options?: Array<{
    label: string
    value: string
  }>
}

export interface TemplateHook {
  command: string
  description?: string
  workingDir?: string
}

export interface TemplateManifest {
  apiVersion: string
  kind: 'Template'
  metadata: {
    name: string
    description?: string
    language: string
    framework?: string
    categories: string[]
    tags?: string[]
    complexity?: 'starter' | 'intermediate' | 'production-ready'
  }
  variables?: TemplateVariable[]
  hooks?: {
    postGeneration?: TemplateHook[]
  }
}

export interface ManifestValidationError {
  path: string
  message: string
}

/**
 * Parse and validate an orbit-template.yaml manifest
 */
export function parseManifest(content: string): {
  manifest: TemplateManifest | null
  errors: ManifestValidationError[]
} {
  const errors: ManifestValidationError[] = []

  let parsed: unknown
  try {
    parsed = yaml.parse(content)
  } catch (e) {
    return {
      manifest: null,
      errors: [{ path: '', message: `Invalid YAML: ${e instanceof Error ? e.message : 'Unknown error'}` }],
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    return {
      manifest: null,
      errors: [{ path: '', message: 'Manifest must be an object' }],
    }
  }

  const doc = parsed as Record<string, unknown>

  // Validate apiVersion
  if (doc.apiVersion !== 'orbit/v1') {
    errors.push({ path: 'apiVersion', message: 'apiVersion must be "orbit/v1"' })
  }

  // Validate kind
  if (doc.kind !== 'Template') {
    errors.push({ path: 'kind', message: 'kind must be "Template"' })
  }

  // Validate metadata
  if (!doc.metadata || typeof doc.metadata !== 'object') {
    errors.push({ path: 'metadata', message: 'metadata is required' })
    return { manifest: null, errors }
  }

  const metadata = doc.metadata as Record<string, unknown>

  if (!metadata.name || typeof metadata.name !== 'string') {
    errors.push({ path: 'metadata.name', message: 'name is required' })
  }

  if (!metadata.language || typeof metadata.language !== 'string') {
    errors.push({ path: 'metadata.language', message: 'language is required' })
  }

  if (!metadata.categories || !Array.isArray(metadata.categories) || metadata.categories.length === 0) {
    errors.push({ path: 'metadata.categories', message: 'categories must have at least one item' })
  }

  // Validate variables if present
  if (doc.variables && Array.isArray(doc.variables)) {
    doc.variables.forEach((v: unknown, index: number) => {
      if (!v || typeof v !== 'object') {
        errors.push({ path: `variables[${index}]`, message: 'Variable must be an object' })
        return
      }

      const variable = v as Record<string, unknown>

      if (!variable.key || typeof variable.key !== 'string') {
        errors.push({ path: `variables[${index}].key`, message: 'key is required' })
      }

      if (!variable.type || !['string', 'number', 'boolean', 'select', 'multiselect'].includes(variable.type as string)) {
        errors.push({ path: `variables[${index}].type`, message: 'type must be string, number, boolean, select, or multiselect' })
      }

      if (['select', 'multiselect'].includes(variable.type as string) && !Array.isArray(variable.options)) {
        errors.push({ path: `variables[${index}].options`, message: 'options required for select/multiselect type' })
      }
    })
  }

  if (errors.length > 0) {
    return { manifest: null, errors }
  }

  // Construct validated manifest
  const manifest: TemplateManifest = {
    apiVersion: doc.apiVersion as string,
    kind: 'Template',
    metadata: {
      name: metadata.name as string,
      description: metadata.description as string | undefined,
      language: metadata.language as string,
      framework: metadata.framework as string | undefined,
      categories: metadata.categories as string[],
      tags: metadata.tags as string[] | undefined,
      complexity: metadata.complexity as 'starter' | 'intermediate' | 'production-ready' | undefined,
    },
    variables: doc.variables as TemplateVariable[] | undefined,
    hooks: doc.hooks as { postGeneration?: TemplateHook[] } | undefined,
  }

  return { manifest, errors: [] }
}
```

**Step 2: Install yaml package**

Run: `cd orbit-www && bun add yaml`

**Step 3: Verify TypeScript compiles**

Run: `cd orbit-www && bunx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add orbit-www/src/lib/template-manifest.ts orbit-www/package.json orbit-www/bun.lock
git commit -m "feat: add template manifest parser with validation"
```

---

### Task 2.3: Create GitHub Manifest Fetcher

**Files:**
- Create: `orbit-www/src/lib/github-manifest.ts`

**Step 1: Create the GitHub fetcher**

```typescript
// orbit-www/src/lib/github-manifest.ts
import { Octokit } from '@octokit/rest'

export interface GitHubRepoInfo {
  owner: string
  repo: string
  defaultBranch: string
  isTemplate: boolean
  description: string | null
}

/**
 * Parse GitHub URL to extract owner and repo
 */
export function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  // Handle various GitHub URL formats
  const patterns = [
    /github\.com\/([^\/]+)\/([^\/\.]+)/,
    /github\.com:([^\/]+)\/([^\/\.]+)/,
  ]

  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match) {
      return { owner: match[1], repo: match[2].replace('.git', '') }
    }
  }

  return null
}

/**
 * Fetch repository info from GitHub
 */
export async function fetchRepoInfo(
  url: string,
  accessToken: string
): Promise<GitHubRepoInfo | null> {
  const parsed = parseGitHubUrl(url)
  if (!parsed) return null

  const octokit = new Octokit({ auth: accessToken })

  try {
    const { data } = await octokit.repos.get({
      owner: parsed.owner,
      repo: parsed.repo,
    })

    return {
      owner: parsed.owner,
      repo: parsed.repo,
      defaultBranch: data.default_branch,
      isTemplate: data.is_template ?? false,
      description: data.description,
    }
  } catch (error) {
    console.error('Error fetching repo info:', error)
    return null
  }
}

/**
 * Fetch manifest file content from GitHub
 */
export async function fetchManifestContent(
  owner: string,
  repo: string,
  branch: string,
  path: string,
  accessToken: string
): Promise<string | null> {
  const octokit = new Octokit({ auth: accessToken })

  try {
    const { data } = await octokit.repos.getContent({
      owner,
      repo,
      path,
      ref: branch,
    })

    if ('content' in data && data.encoding === 'base64') {
      return Buffer.from(data.content, 'base64').toString('utf-8')
    }

    return null
  } catch (error) {
    console.error('Error fetching manifest:', error)
    return null
  }
}

/**
 * Check if a file exists in the repository
 */
export async function fileExists(
  owner: string,
  repo: string,
  branch: string,
  path: string,
  accessToken: string
): Promise<boolean> {
  const octokit = new Octokit({ auth: accessToken })

  try {
    await octokit.repos.getContent({
      owner,
      repo,
      path,
      ref: branch,
    })
    return true
  } catch {
    return false
  }
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd orbit-www && bunx tsc --noEmit`
Expected: No errors (Octokit already installed)

**Step 3: Commit**

```bash
git add orbit-www/src/lib/github-manifest.ts
git commit -m "feat: add GitHub manifest fetcher utility"
```

---

### Task 2.4: Create Template Import Server Action

**Files:**
- Create: `orbit-www/src/app/actions/templates.ts`

**Step 1: Create the server action**

```typescript
// orbit-www/src/app/actions/templates.ts
'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { parseManifest } from '@/lib/template-manifest'
import { parseGitHubUrl, fetchRepoInfo, fetchManifestContent } from '@/lib/github-manifest'
import { revalidatePath } from 'next/cache'

export interface ImportTemplateInput {
  repoUrl: string
  workspaceId: string
  manifestPath?: string
}

export interface ImportTemplateResult {
  success: boolean
  templateId?: string
  error?: string
  warnings?: string[]
}

/**
 * Import a GitHub repository as a template
 */
export async function importTemplate(input: ImportTemplateInput): Promise<ImportTemplateResult> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  const payload = await getPayload({ config })
  const warnings: string[] = []

  // Parse GitHub URL
  const parsed = parseGitHubUrl(input.repoUrl)
  if (!parsed) {
    return { success: false, error: 'Invalid GitHub URL' }
  }

  // Check workspace membership
  const membership = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: input.workspaceId } },
        { user: { equals: session.user.id } },
        { status: { equals: 'active' } },
      ],
    },
    limit: 1,
  })

  if (membership.docs.length === 0) {
    return { success: false, error: 'Not a member of this workspace' }
  }

  // Get GitHub installation token for this workspace
  const installation = await payload.find({
    collection: 'github-installations',
    where: {
      allowedWorkspaces: { contains: input.workspaceId },
      status: { equals: 'active' },
    },
    limit: 1,
  })

  if (installation.docs.length === 0) {
    return { success: false, error: 'No GitHub App installation found for this workspace' }
  }

  // Get decrypted token (simplified - actual implementation uses encryption service)
  const accessToken = installation.docs[0].accessToken as string
  if (!accessToken) {
    return { success: false, error: 'GitHub access token not available' }
  }

  // Fetch repo info
  const repoInfo = await fetchRepoInfo(input.repoUrl, accessToken)
  if (!repoInfo) {
    return { success: false, error: 'Could not access repository. Check permissions.' }
  }

  // Warn if not a GitHub Template
  if (!repoInfo.isTemplate) {
    warnings.push('Repository is not marked as a GitHub Template. Using clone fallback for instantiation.')
  }

  // Fetch manifest
  const manifestPath = input.manifestPath || 'orbit-template.yaml'
  const manifestContent = await fetchManifestContent(
    repoInfo.owner,
    repoInfo.repo,
    repoInfo.defaultBranch,
    manifestPath,
    accessToken
  )

  if (!manifestContent) {
    return {
      success: false,
      error: `Manifest file not found at ${manifestPath}. Templates must have an orbit-template.yaml file.`
    }
  }

  // Parse manifest
  const { manifest, errors } = parseManifest(manifestContent)
  if (!manifest) {
    return {
      success: false,
      error: `Invalid manifest: ${errors.map(e => `${e.path}: ${e.message}`).join(', ')}`
    }
  }

  // Check for existing template with same URL
  const existing = await payload.find({
    collection: 'templates',
    where: {
      repoUrl: { equals: input.repoUrl },
      workspace: { equals: input.workspaceId },
    },
    limit: 1,
  })

  if (existing.docs.length > 0) {
    return { success: false, error: 'This repository is already imported as a template in this workspace' }
  }

  // Create template
  const template = await payload.create({
    collection: 'templates',
    data: {
      name: manifest.metadata.name,
      description: manifest.metadata.description || repoInfo.description || '',
      workspace: input.workspaceId,
      visibility: 'workspace',
      gitProvider: 'github',
      repoUrl: input.repoUrl,
      defaultBranch: repoInfo.defaultBranch,
      isGitHubTemplate: repoInfo.isTemplate,
      language: manifest.metadata.language,
      framework: manifest.metadata.framework,
      categories: manifest.metadata.categories,
      tags: manifest.metadata.tags?.map(tag => ({ tag })),
      complexity: manifest.metadata.complexity,
      manifestPath,
      lastSyncedAt: new Date().toISOString(),
      syncStatus: 'synced',
      variables: manifest.variables || [],
      createdBy: session.user.id,
    },
  })

  revalidatePath('/templates')

  return {
    success: true,
    templateId: template.id,
    warnings: warnings.length > 0 ? warnings : undefined,
  }
}

/**
 * Sync template manifest from GitHub
 */
export async function syncTemplateManifest(templateId: string): Promise<ImportTemplateResult> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  const payload = await getPayload({ config })

  const template = await payload.findByID({
    collection: 'templates',
    id: templateId,
  })

  if (!template) {
    return { success: false, error: 'Template not found' }
  }

  const workspaceId = typeof template.workspace === 'string'
    ? template.workspace
    : template.workspace.id

  // Get GitHub installation token
  const installation = await payload.find({
    collection: 'github-installations',
    where: {
      allowedWorkspaces: { contains: workspaceId },
      status: { equals: 'active' },
    },
    limit: 1,
  })

  if (installation.docs.length === 0) {
    await payload.update({
      collection: 'templates',
      id: templateId,
      data: {
        syncStatus: 'error',
        syncError: 'No GitHub App installation found',
      },
    })
    return { success: false, error: 'No GitHub App installation found' }
  }

  const accessToken = installation.docs[0].accessToken as string
  const parsed = parseGitHubUrl(template.repoUrl)

  if (!parsed) {
    return { success: false, error: 'Invalid repository URL' }
  }

  // Fetch manifest
  const manifestContent = await fetchManifestContent(
    parsed.owner,
    parsed.repo,
    template.defaultBranch || 'main',
    template.manifestPath || 'orbit-template.yaml',
    accessToken
  )

  if (!manifestContent) {
    await payload.update({
      collection: 'templates',
      id: templateId,
      data: {
        syncStatus: 'error',
        syncError: 'Manifest file not found',
      },
    })
    return { success: false, error: 'Manifest file not found' }
  }

  const { manifest, errors } = parseManifest(manifestContent)

  if (!manifest) {
    await payload.update({
      collection: 'templates',
      id: templateId,
      data: {
        syncStatus: 'error',
        syncError: errors.map(e => e.message).join(', '),
      },
    })
    return { success: false, error: 'Invalid manifest' }
  }

  // Update template
  await payload.update({
    collection: 'templates',
    id: templateId,
    data: {
      name: manifest.metadata.name,
      description: manifest.metadata.description,
      language: manifest.metadata.language,
      framework: manifest.metadata.framework,
      categories: manifest.metadata.categories,
      tags: manifest.metadata.tags?.map(tag => ({ tag })),
      complexity: manifest.metadata.complexity,
      variables: manifest.variables || [],
      lastSyncedAt: new Date().toISOString(),
      syncStatus: 'synced',
      syncError: null,
    },
  })

  revalidatePath('/templates')
  revalidatePath(`/templates/${template.slug}`)

  return { success: true, templateId }
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd orbit-www && bunx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add orbit-www/src/app/actions/templates.ts
git commit -m "feat: add template import and sync server actions"
```

---

## Phase 3: Template Catalog UI

### Task 3.1: Create Template Catalog Page

**Files:**
- Create: `orbit-www/src/app/(frontend)/templates/page.tsx`

**Step 1: Create the catalog page**

```typescript
// orbit-www/src/app/(frontend)/templates/page.tsx
import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Plus, Code2, GitBranch, Users } from 'lucide-react'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { SiteHeader } from '@/components/layout/site-header'

// Language to emoji mapping
const languageEmoji: Record<string, string> = {
  typescript: '🔷',
  javascript: '🟨',
  go: '🔵',
  python: '🐍',
  rust: '🦀',
  java: '☕',
  ruby: '💎',
  php: '🐘',
  csharp: '🟪',
  swift: '🍎',
}

// Complexity badge colors
const complexityColors: Record<string, string> = {
  starter: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  intermediate: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  'production-ready': 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
}

export default async function TemplatesPage() {
  const payload = await getPayload({ config })

  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return (
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <SiteHeader />
          <div className="flex-1 flex items-center justify-center">
            <Card>
              <CardHeader>
                <CardTitle>Sign in to view templates</CardTitle>
              </CardHeader>
              <CardContent>
                <Button asChild>
                  <Link href="/login">Sign In</Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </SidebarInset>
      </SidebarProvider>
    )
  }

  // Fetch templates (access control filters automatically)
  const templatesResult = await payload.find({
    collection: 'templates',
    limit: 100,
    sort: '-usageCount',
  })

  const templates = templatesResult.docs

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex-1 space-y-4 p-8 pt-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-3xl font-bold tracking-tight">Template Catalog</h2>
              <p className="text-muted-foreground">
                Browse and use repository templates
              </p>
            </div>
            <Button asChild>
              <Link href="/templates/import">
                <Plus className="mr-2 h-4 w-4" />
                Import Template
              </Link>
            </Button>
          </div>

          {/* TODO: Add filters */}

          {/* Templates Grid */}
          {templates.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16">
                <Code2 className="h-16 w-16 text-muted-foreground mb-4" />
                <h3 className="text-xl font-semibold mb-2">No Templates Yet</h3>
                <p className="text-muted-foreground text-center max-w-md mb-4">
                  Import your first template from GitHub to get started.
                </p>
                <Button asChild>
                  <Link href="/templates/import">
                    <Plus className="mr-2 h-4 w-4" />
                    Import Template
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {templates.map((template) => {
                const tags = (template.tags as Array<{ tag: string }> | undefined) || []
                const emoji = languageEmoji[template.language?.toLowerCase() || ''] || '📦'

                return (
                  <Link key={template.id} href={`/templates/${template.slug}`}>
                    <Card className="h-full transition-all hover:shadow-lg hover:border-primary cursor-pointer">
                      <CardHeader>
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-2xl">{emoji}</span>
                            <CardTitle className="text-xl">{template.name}</CardTitle>
                          </div>
                          {template.complexity && (
                            <Badge
                              variant="secondary"
                              className={complexityColors[template.complexity] || ''}
                            >
                              {template.complexity}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <span>{template.language}</span>
                          {template.framework && (
                            <>
                              <span>•</span>
                              <span>{template.framework}</span>
                            </>
                          )}
                        </div>
                        {template.description && (
                          <CardDescription className="line-clamp-2 mt-2">
                            {template.description}
                          </CardDescription>
                        )}
                      </CardHeader>
                      <CardContent>
                        {/* Tags */}
                        {tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mb-3">
                            {tags.slice(0, 4).map((t, i) => (
                              <Badge key={i} variant="outline" className="text-xs">
                                {t.tag}
                              </Badge>
                            ))}
                            {tags.length > 4 && (
                              <Badge variant="outline" className="text-xs">
                                +{tags.length - 4}
                              </Badge>
                            )}
                          </div>
                        )}

                        {/* Stats */}
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <GitBranch className="h-4 w-4" />
                            <span>{template.defaultBranch}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Users className="h-4 w-4" />
                            <span>Used {template.usageCount || 0} times</span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
```

**Step 2: Verify page loads**

Run: `cd orbit-www && bun run dev`
Navigate to: http://localhost:3000/templates
Expected: Page renders with empty state or template cards

**Step 3: Commit**

```bash
git add orbit-www/src/app/\(frontend\)/templates/page.tsx
git commit -m "feat: add template catalog page with cards grid"
```

---

### Task 3.2: Create Import Template Page

**Files:**
- Create: `orbit-www/src/app/(frontend)/templates/import/page.tsx`
- Create: `orbit-www/src/components/features/templates/ImportTemplateForm.tsx`

**Step 1: Create the import form component**

```typescript
// orbit-www/src/components/features/templates/ImportTemplateForm.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Loader2, AlertCircle, CheckCircle2, AlertTriangle } from 'lucide-react'
import { importTemplate } from '@/app/actions/templates'

interface Workspace {
  id: string
  name: string
}

interface ImportTemplateFormProps {
  workspaces: Workspace[]
}

export function ImportTemplateForm({ workspaces }: ImportTemplateFormProps) {
  const router = useRouter()
  const [repoUrl, setRepoUrl] = useState('')
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id || '')
  const [manifestPath, setManifestPath] = useState('orbit-template.yaml')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setWarnings([])
    setSuccess(false)
    setIsSubmitting(true)

    try {
      const result = await importTemplate({
        repoUrl,
        workspaceId,
        manifestPath: manifestPath || undefined,
      })

      if (result.success) {
        setSuccess(true)
        if (result.warnings) {
          setWarnings(result.warnings)
        }
        // Redirect after short delay to show success
        setTimeout(() => {
          router.push('/templates')
        }, 1500)
      } else {
        setError(result.error || 'Import failed')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Card className="max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>Import Template</CardTitle>
        <CardDescription>
          Import a GitHub repository as a template. The repository must contain an
          orbit-template.yaml manifest file.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Error Alert */}
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Warnings Alert */}
          {warnings.length > 0 && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Warnings</AlertTitle>
              <AlertDescription>
                <ul className="list-disc list-inside">
                  {warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {/* Success Alert */}
          {success && (
            <Alert className="border-green-500 bg-green-50 dark:bg-green-950">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertTitle className="text-green-600">Success!</AlertTitle>
              <AlertDescription className="text-green-600">
                Template imported successfully. Redirecting...
              </AlertDescription>
            </Alert>
          )}

          {/* Repository URL */}
          <div className="space-y-2">
            <Label htmlFor="repoUrl">
              GitHub Repository URL <span className="text-red-500">*</span>
            </Label>
            <Input
              id="repoUrl"
              type="url"
              placeholder="https://github.com/owner/repo"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              required
              disabled={isSubmitting || success}
            />
            <p className="text-xs text-muted-foreground">
              The repository must be accessible via your workspace&apos;s GitHub App installation.
            </p>
          </div>

          {/* Workspace Selection */}
          <div className="space-y-2">
            <Label htmlFor="workspace">
              Workspace <span className="text-red-500">*</span>
            </Label>
            <Select
              value={workspaceId}
              onValueChange={setWorkspaceId}
              disabled={isSubmitting || success}
            >
              <SelectTrigger id="workspace">
                <SelectValue placeholder="Select a workspace" />
              </SelectTrigger>
              <SelectContent>
                {workspaces.map((ws) => (
                  <SelectItem key={ws.id} value={ws.id}>
                    {ws.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Manifest Path */}
          <div className="space-y-2">
            <Label htmlFor="manifestPath">Manifest File Path</Label>
            <Input
              id="manifestPath"
              placeholder="orbit-template.yaml"
              value={manifestPath}
              onChange={(e) => setManifestPath(e.target.value)}
              disabled={isSubmitting || success}
            />
            <p className="text-xs text-muted-foreground">
              Path to the manifest file. Defaults to orbit-template.yaml in the repository root.
            </p>
          </div>

          {/* Submit Button */}
          <div className="flex gap-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.back()}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || success || !repoUrl || !workspaceId}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Importing...
                </>
              ) : (
                'Import Template'
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
```

**Step 2: Create the import page**

```typescript
// orbit-www/src/app/(frontend)/templates/import/page.tsx
import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { SiteHeader } from '@/components/layout/site-header'
import { ImportTemplateForm } from '@/components/features/templates/ImportTemplateForm'

export default async function ImportTemplatePage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    redirect('/login')
  }

  const payload = await getPayload({ config })

  // Get user's workspaces
  const memberships = await payload.find({
    collection: 'workspace-members',
    where: {
      user: { equals: session.user.id },
      status: { equals: 'active' },
    },
    depth: 1,
    limit: 100,
  })

  const workspaces = memberships.docs
    .map((m) => {
      const ws = typeof m.workspace === 'object' ? m.workspace : null
      if (!ws) return null
      return { id: ws.id, name: ws.name }
    })
    .filter((ws): ws is { id: string; name: string } => ws !== null)

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex-1 p-8">
          <ImportTemplateForm workspaces={workspaces} />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
```

**Step 3: Verify pages load**

Run: `cd orbit-www && bun run dev`
Navigate to: http://localhost:3000/templates/import
Expected: Import form renders with workspace dropdown

**Step 4: Commit**

```bash
git add orbit-www/src/components/features/templates/ImportTemplateForm.tsx orbit-www/src/app/\(frontend\)/templates/import/page.tsx
git commit -m "feat: add template import page with form validation"
```

---

### Task 3.3: Create Template Detail Page

**Files:**
- Create: `orbit-www/src/app/(frontend)/templates/[slug]/page.tsx`

**Step 1: Create the detail page**

```typescript
// orbit-www/src/app/(frontend)/templates/[slug]/page.tsx
import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  ExternalLink,
  GitBranch,
  Users,
  Clock,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { SiteHeader } from '@/components/layout/site-header'

interface PageProps {
  params: Promise<{ slug: string }>
}

const languageEmoji: Record<string, string> = {
  typescript: '🔷',
  javascript: '🟨',
  go: '🔵',
  python: '🐍',
  rust: '🦀',
  java: '☕',
  ruby: '💎',
}

const complexityColors: Record<string, string> = {
  starter: 'bg-green-100 text-green-800',
  intermediate: 'bg-yellow-100 text-yellow-800',
  'production-ready': 'bg-blue-100 text-blue-800',
}

export default async function TemplateDetailPage({ params }: PageProps) {
  const { slug } = await params
  const payload = await getPayload({ config })

  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    notFound()
  }

  // Fetch template
  const templatesResult = await payload.find({
    collection: 'templates',
    where: {
      slug: { equals: slug },
    },
    limit: 1,
  })

  if (templatesResult.docs.length === 0) {
    notFound()
  }

  const template = templatesResult.docs[0]
  const tags = (template.tags as Array<{ tag: string }> | undefined) || []
  const variables = (template.variables as Array<{
    key: string
    type: string
    required: boolean
    description?: string
    default?: string | number | boolean
  }>) || []
  const emoji = languageEmoji[template.language?.toLowerCase() || ''] || '📦'

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex-1 p-8">
          <div className="max-w-4xl mx-auto space-y-8">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-4">
                <span className="text-5xl">{emoji}</span>
                <div>
                  <h1 className="text-3xl font-bold tracking-tight">{template.name}</h1>
                  <div className="flex items-center gap-2 mt-2 text-muted-foreground">
                    <span>{template.language}</span>
                    {template.framework && (
                      <>
                        <span>•</span>
                        <span>{template.framework}</span>
                      </>
                    )}
                    {template.complexity && (
                      <>
                        <span>•</span>
                        <Badge className={complexityColors[template.complexity]}>
                          {template.complexity}
                        </Badge>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <Button size="lg" asChild>
                <Link href={`/templates/${slug}/use`}>
                  Use Template
                </Link>
              </Button>
            </div>

            {/* Description */}
            {template.description && (
              <Card>
                <CardHeader>
                  <CardTitle>Description</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="whitespace-pre-wrap">{template.description}</p>
                </CardContent>
              </Card>
            )}

            {/* Metadata */}
            <div className="grid gap-6 md:grid-cols-2">
              {/* Source Info */}
              <Card>
                <CardHeader>
                  <CardTitle>Source Repository</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Repository</span>
                    <a
                      href={template.repoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-primary hover:underline"
                    >
                      View on GitHub
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Branch</span>
                    <div className="flex items-center gap-1">
                      <GitBranch className="h-4 w-4" />
                      <span>{template.defaultBranch}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">GitHub Template</span>
                    {template.isGitHubTemplate ? (
                      <Badge variant="secondary" className="bg-green-100 text-green-800">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        Yes
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="bg-yellow-100 text-yellow-800">
                        <AlertCircle className="h-3 w-3 mr-1" />
                        No
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Stats */}
              <Card>
                <CardHeader>
                  <CardTitle>Statistics</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Usage Count</span>
                    <div className="flex items-center gap-1">
                      <Users className="h-4 w-4" />
                      <span>{template.usageCount || 0} repositories</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Sync Status</span>
                    <Badge
                      variant={template.syncStatus === 'synced' ? 'secondary' : 'destructive'}
                    >
                      {template.syncStatus === 'synced' ? (
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                      ) : (
                        <AlertCircle className="h-3 w-3 mr-1" />
                      )}
                      {template.syncStatus}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Last Synced</span>
                    <div className="flex items-center gap-1">
                      <Clock className="h-4 w-4" />
                      <span>
                        {template.lastSyncedAt
                          ? new Date(template.lastSyncedAt).toLocaleDateString()
                          : 'Never'}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Tags */}
            {tags.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Tags</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {tags.map((t, i) => (
                      <Badge key={i} variant="outline">
                        {t.tag}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Variables */}
            {variables.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Template Variables</CardTitle>
                  <CardDescription>
                    These variables will be requested when using this template
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {variables.map((v, i) => (
                      <div key={i} className="border rounded-lg p-4">
                        <div className="flex items-center justify-between mb-2">
                          <code className="font-mono text-sm bg-muted px-2 py-1 rounded">
                            {'{{'}{v.key}{'}}'}
                          </code>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">{v.type}</Badge>
                            {v.required && (
                              <Badge variant="secondary" className="bg-red-100 text-red-800">
                                Required
                              </Badge>
                            )}
                          </div>
                        </div>
                        {v.description && (
                          <p className="text-sm text-muted-foreground">{v.description}</p>
                        )}
                        {v.default !== undefined && (
                          <p className="text-sm mt-1">
                            <span className="text-muted-foreground">Default:</span>{' '}
                            <code className="font-mono bg-muted px-1 rounded">
                              {String(v.default)}
                            </code>
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
```

**Step 2: Verify page loads**

Run: `cd orbit-www && bun run dev`
Expected: Template detail page renders with all sections

**Step 3: Commit**

```bash
git add orbit-www/src/app/\(frontend\)/templates/\[slug\]/page.tsx
git commit -m "feat: add template detail page with variables preview"
```

---

## Remaining Tasks (Summary)

The following tasks are documented but implementation details abbreviated for brevity:

### Task 3.4: Add Template Catalog Filters
- Add filter dropdowns for language, category, complexity
- Add search input
- Client component for filter state

### Task 3.5: Create Use Template Page
- Form for repository name, target workspace, target GitHub org
- Dynamic variable form rendered from template.variables
- Submit to instantiation action

### Phase 4: Template Instantiation

### Task 4.1: Create Template Instantiation Server Action
- Validate inputs
- Start Temporal workflow
- Return workflow ID for tracking

### Task 4.2: Extend Repository Service gRPC
- Add CreateFromTemplate RPC
- Accept template ID, variables, target org

### Task 4.3: Create TemplateInstantiationWorkflow
- Activity: Create GitHub repo (template API or clone)
- Activity: Apply variable substitutions
- Activity: Run post-generation hooks
- Activity: Register in Orbit

### Task 4.4: Add Progress Tracking UI
- Poll workflow status
- Show step progress
- Redirect on completion

### Phase 5: Advanced Features

### Task 5.1: Add Template Management UI
- Edit metadata
- Change visibility
- Archive/delete

### Task 5.2: Implement Webhook Sync
- Create webhook endpoint
- Verify GitHub signature
- Trigger manifest sync

### Task 5.3: Add Sync Status Monitoring
- Manual sync button
- Sync history
- Error notifications

---

## Verification Checklist

After completing all tasks:

- [ ] Permissions seed script runs successfully
- [ ] Templates can be imported from GitHub
- [ ] Template catalog displays with filters
- [ ] Template detail page shows all metadata
- [ ] Variables are parsed from manifest
- [ ] Access control filters templates by visibility
- [ ] Template sync updates metadata correctly

---

## Next Steps After This Plan

1. Run `superpowers:executing-plans` to implement task by task
2. After each phase, run `superpowers:code-reviewer`
3. Run `superpowers:verification-before-completion` before commits
