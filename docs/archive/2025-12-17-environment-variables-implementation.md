# Environment Variables Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable users to configure environment variables for builds and deployments, with workspace-level defaults and app-level overrides, encrypted at rest.

**Architecture:** New `EnvironmentVariables` Payload collection with encrypted values. Workspace settings page for managing workspace-level vars. App detail page section for viewing inherited vars and creating overrides. Server action resolves effective variables at build time.

**Tech Stack:** Payload CMS collection, React components with shadcn/ui, existing `lib/encryption` module, server actions

---

## Phase 1: Core Collection & Encryption

### Task 1: Create EnvironmentVariables Collection

**Files:**
- Create: `orbit-www/src/collections/EnvironmentVariables.ts`

**Step 1: Create the collection file**

```typescript
// orbit-www/src/collections/EnvironmentVariables.ts
import type { CollectionConfig } from 'payload'
import { encrypt } from '@/lib/encryption'

// Helper function to get workspace IDs for a user
async function getWorkspaceIdsForUser(
  payload: any,
  userId: string
): Promise<string[]> {
  const members = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [{ user: { equals: userId } }, { status: { equals: 'active' } }],
    },
    overrideAccess: true,
    limit: 100,
  })

  return members.docs.map((m: any) =>
    typeof m.workspace === 'string' ? m.workspace : m.workspace.id
  )
}

// Helper to check if user is admin/owner of workspace
async function isWorkspaceAdmin(
  payload: any,
  userId: string,
  workspaceId: string
): Promise<boolean> {
  const members = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: workspaceId } },
        { user: { equals: userId } },
        { role: { in: ['owner', 'admin'] } },
        { status: { equals: 'active' } },
      ],
    },
    overrideAccess: true,
  })
  return members.docs.length > 0
}

export const EnvironmentVariables: CollectionConfig = {
  slug: 'environment-variables',
  admin: {
    useAsTitle: 'name',
    group: 'Settings',
    defaultColumns: ['name', 'workspace', 'app', 'useInBuilds', 'useInDeployments', 'updatedAt'],
  },
  access: {
    read: async ({ req: { user, payload }, id }) => {
      if (!user) return false
      if (!id) {
        // List view - filter by workspace membership
        const workspaceIds = await getWorkspaceIdsForUser(payload, user.id)
        if (workspaceIds.length === 0) {
          return { id: { equals: 'nonexistent-id-to-return-empty-results' } }
        }
        return { workspace: { in: workspaceIds } }
      }
      return true
    },
    create: async ({ req: { user, payload }, data }) => {
      if (!user || !data?.workspace) return false
      const workspaceId =
        typeof data.workspace === 'string' ? data.workspace : data.workspace.id
      return isWorkspaceAdmin(payload, user.id, workspaceId)
    },
    update: async ({ req: { user, payload }, id }) => {
      if (!user || !id) return false
      const envVar = await payload.findByID({
        collection: 'environment-variables',
        id,
        overrideAccess: true,
      })
      if (!envVar?.workspace) return false
      const workspaceId =
        typeof envVar.workspace === 'string' ? envVar.workspace : envVar.workspace.id
      return isWorkspaceAdmin(payload, user.id, workspaceId)
    },
    delete: async ({ req: { user, payload }, id }) => {
      if (!user || !id) return false
      const envVar = await payload.findByID({
        collection: 'environment-variables',
        id,
        overrideAccess: true,
      })
      if (!envVar?.workspace) return false
      const workspaceId =
        typeof envVar.workspace === 'string' ? envVar.workspace : envVar.workspace.id
      return isWorkspaceAdmin(payload, user.id, workspaceId)
    },
  },
  hooks: {
    beforeChange: [
      ({ data, originalDoc }) => {
        // Encrypt value if it's new or changed (not already encrypted)
        if (data.value && !data.value.includes(':')) {
          data.value = encrypt(data.value)
        }
        return data
      },
    ],
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      admin: {
        description: 'Variable name (e.g., TURSO_DATABASE_URL)',
      },
      validate: (value: string | null | undefined) => {
        if (!value) return 'Name is required'
        if (!/^[A-Z][A-Z0-9_]*$/.test(value)) {
          return 'Name must start with a letter and contain only uppercase letters, numbers, and underscores'
        }
        return true
      },
    },
    {
      name: 'value',
      type: 'text',
      required: true,
      admin: {
        description: 'Variable value (encrypted at rest)',
      },
      access: {
        // Never return encrypted value in normal API responses
        read: () => false,
      },
    },
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      required: true,
      index: true,
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'app',
      type: 'relationship',
      relationTo: 'apps',
      index: true,
      admin: {
        description: 'If set, this is an app-level override',
        position: 'sidebar',
      },
    },
    {
      name: 'useInBuilds',
      type: 'checkbox',
      defaultValue: true,
      admin: {
        description: 'Include this variable in container builds',
      },
    },
    {
      name: 'useInDeployments',
      type: 'checkbox',
      defaultValue: true,
      admin: {
        description: 'Include this variable in Kubernetes deployments',
      },
    },
    {
      name: 'description',
      type: 'textarea',
      admin: {
        description: 'Optional description for team members',
      },
    },
    {
      name: 'createdBy',
      type: 'relationship',
      relationTo: 'users',
      admin: {
        readOnly: true,
        position: 'sidebar',
      },
    },
  ],
  timestamps: true,
  indexes: [
    {
      fields: { workspace: 1, app: 1, name: 1 },
      options: { unique: true },
    },
  ],
}
```

**Step 2: Verify file compiles**

Run: `cd orbit-www && pnpm exec tsc --noEmit`
Expected: No errors related to EnvironmentVariables.ts

---

### Task 2: Register Collection in Payload Config

**Files:**
- Modify: `orbit-www/src/payload.config.ts`

**Step 1: Add import**

Add after line 29 (after `import { RegistryConfigs }`):
```typescript
import { EnvironmentVariables } from './collections/EnvironmentVariables'
```

**Step 2: Add to collections array**

Add after `RegistryConfigs,` in the collections array (around line 61):
```typescript
    EnvironmentVariables,
```

**Step 3: Regenerate types**

Run: `cd orbit-www && pnpm run generate:types`
Expected: `payload-types.ts` updated with EnvironmentVariable type

**Step 4: Commit**

```bash
git add orbit-www/src/collections/EnvironmentVariables.ts orbit-www/src/payload.config.ts orbit-www/src/payload-types.ts
git commit -m "feat(env-vars): add EnvironmentVariables collection with encryption"
```

---

## Phase 2: Server Actions

### Task 3: Create Environment Variables Server Actions

**Files:**
- Create: `orbit-www/src/app/actions/environment-variables.ts`

**Step 1: Create the actions file**

```typescript
// orbit-www/src/app/actions/environment-variables.ts
'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { encrypt, decrypt } from '@/lib/encryption'
import type { EnvironmentVariable } from '@/payload-types'

export interface EnvVarDisplay {
  id: string
  name: string
  description?: string | null
  useInBuilds: boolean
  useInDeployments: boolean
  source: 'workspace' | 'app'
  workspaceId: string
  appId?: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateEnvVarInput {
  name: string
  value: string
  workspaceId: string
  appId?: string
  useInBuilds?: boolean
  useInDeployments?: boolean
  description?: string
}

export interface UpdateEnvVarInput {
  value?: string
  useInBuilds?: boolean
  useInDeployments?: boolean
  description?: string
}

export interface BulkImportInput {
  workspaceId: string
  appId?: string
  variables: Array<{
    name: string
    value: string
  }>
  useInBuilds?: boolean
  useInDeployments?: boolean
}

// Helper to check admin access
async function checkWorkspaceAdmin(
  payload: any,
  userId: string,
  workspaceId: string
): Promise<boolean> {
  const members = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: workspaceId } },
        { user: { equals: userId } },
        { role: { in: ['owner', 'admin'] } },
        { status: { equals: 'active' } },
      ],
    },
    overrideAccess: true,
  })
  return members.docs.length > 0
}

/**
 * Get environment variables for a workspace (and optionally an app)
 */
export async function getEnvironmentVariables(
  workspaceId: string,
  appId?: string
): Promise<{ variables: EnvVarDisplay[]; error?: string }> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user?.id) {
    return { variables: [], error: 'Unauthorized' }
  }

  const payload = await getPayload({ config })

  try {
    // Get workspace-level variables
    const workspaceVars = await payload.find({
      collection: 'environment-variables',
      where: {
        and: [
          { workspace: { equals: workspaceId } },
          { app: { exists: false } },
        ],
      },
      sort: 'name',
      limit: 500,
    })

    const variables: EnvVarDisplay[] = workspaceVars.docs.map((v) => ({
      id: v.id,
      name: v.name,
      description: v.description,
      useInBuilds: v.useInBuilds ?? true,
      useInDeployments: v.useInDeployments ?? true,
      source: 'workspace' as const,
      workspaceId,
      appId: null,
      createdAt: v.createdAt,
      updatedAt: v.updatedAt,
    }))

    // If appId provided, get app overrides and merge
    if (appId) {
      const appVars = await payload.find({
        collection: 'environment-variables',
        where: {
          and: [
            { workspace: { equals: workspaceId } },
            { app: { equals: appId } },
          ],
        },
        sort: 'name',
        limit: 500,
      })

      // Add app-specific vars and mark overrides
      const workspaceVarNames = new Set(variables.map((v) => v.name))

      for (const appVar of appVars.docs) {
        if (workspaceVarNames.has(appVar.name)) {
          // Override workspace var
          const idx = variables.findIndex((v) => v.name === appVar.name)
          if (idx !== -1) {
            variables[idx] = {
              id: appVar.id,
              name: appVar.name,
              description: appVar.description,
              useInBuilds: appVar.useInBuilds ?? true,
              useInDeployments: appVar.useInDeployments ?? true,
              source: 'app',
              workspaceId,
              appId,
              createdAt: appVar.createdAt,
              updatedAt: appVar.updatedAt,
            }
          }
        } else {
          // App-specific var
          variables.push({
            id: appVar.id,
            name: appVar.name,
            description: appVar.description,
            useInBuilds: appVar.useInBuilds ?? true,
            useInDeployments: appVar.useInDeployments ?? true,
            source: 'app',
            workspaceId,
            appId,
            createdAt: appVar.createdAt,
            updatedAt: appVar.updatedAt,
          })
        }
      }

      // Sort by name
      variables.sort((a, b) => a.name.localeCompare(b.name))
    }

    return { variables }
  } catch (err) {
    console.error('Failed to get environment variables:', err)
    return { variables: [], error: 'Failed to load environment variables' }
  }
}

/**
 * Create a new environment variable
 */
export async function createEnvironmentVariable(
  input: CreateEnvVarInput
): Promise<{ success: boolean; id?: string; error?: string }> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user?.id) {
    return { success: false, error: 'Unauthorized' }
  }

  const payload = await getPayload({ config })

  // Check admin access
  const isAdmin = await checkWorkspaceAdmin(payload, session.user.id, input.workspaceId)
  if (!isAdmin) {
    return { success: false, error: 'Admin access required' }
  }

  try {
    const result = await payload.create({
      collection: 'environment-variables',
      data: {
        name: input.name.toUpperCase(),
        value: encrypt(input.value),
        workspace: input.workspaceId,
        app: input.appId || null,
        useInBuilds: input.useInBuilds ?? true,
        useInDeployments: input.useInDeployments ?? true,
        description: input.description || null,
        createdBy: session.user.id,
      },
    })

    return { success: true, id: result.id }
  } catch (err: any) {
    console.error('Failed to create environment variable:', err)
    if (err.message?.includes('duplicate key')) {
      return { success: false, error: 'A variable with this name already exists' }
    }
    return { success: false, error: 'Failed to create environment variable' }
  }
}

/**
 * Update an environment variable
 */
export async function updateEnvironmentVariable(
  id: string,
  input: UpdateEnvVarInput
): Promise<{ success: boolean; error?: string }> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user?.id) {
    return { success: false, error: 'Unauthorized' }
  }

  const payload = await getPayload({ config })

  try {
    // Get existing var to check access
    const existing = await payload.findByID({
      collection: 'environment-variables',
      id,
      overrideAccess: true,
    })

    if (!existing) {
      return { success: false, error: 'Variable not found' }
    }

    const workspaceId =
      typeof existing.workspace === 'string' ? existing.workspace : existing.workspace.id

    const isAdmin = await checkWorkspaceAdmin(payload, session.user.id, workspaceId)
    if (!isAdmin) {
      return { success: false, error: 'Admin access required' }
    }

    const updateData: Partial<EnvironmentVariable> = {}
    if (input.value !== undefined) {
      updateData.value = encrypt(input.value)
    }
    if (input.useInBuilds !== undefined) {
      updateData.useInBuilds = input.useInBuilds
    }
    if (input.useInDeployments !== undefined) {
      updateData.useInDeployments = input.useInDeployments
    }
    if (input.description !== undefined) {
      updateData.description = input.description
    }

    await payload.update({
      collection: 'environment-variables',
      id,
      data: updateData,
    })

    return { success: true }
  } catch (err) {
    console.error('Failed to update environment variable:', err)
    return { success: false, error: 'Failed to update environment variable' }
  }
}

/**
 * Delete an environment variable
 */
export async function deleteEnvironmentVariable(
  id: string
): Promise<{ success: boolean; error?: string }> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user?.id) {
    return { success: false, error: 'Unauthorized' }
  }

  const payload = await getPayload({ config })

  try {
    // Get existing var to check access
    const existing = await payload.findByID({
      collection: 'environment-variables',
      id,
      overrideAccess: true,
    })

    if (!existing) {
      return { success: false, error: 'Variable not found' }
    }

    const workspaceId =
      typeof existing.workspace === 'string' ? existing.workspace : existing.workspace.id

    const isAdmin = await checkWorkspaceAdmin(payload, session.user.id, workspaceId)
    if (!isAdmin) {
      return { success: false, error: 'Admin access required' }
    }

    await payload.delete({
      collection: 'environment-variables',
      id,
    })

    return { success: true }
  } catch (err) {
    console.error('Failed to delete environment variable:', err)
    return { success: false, error: 'Failed to delete environment variable' }
  }
}

/**
 * Bulk import variables from .env format
 */
export async function bulkImportEnvironmentVariables(
  input: BulkImportInput
): Promise<{ success: boolean; imported: number; errors: string[] }> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user?.id) {
    return { success: false, imported: 0, errors: ['Unauthorized'] }
  }

  const payload = await getPayload({ config })

  const isAdmin = await checkWorkspaceAdmin(payload, session.user.id, input.workspaceId)
  if (!isAdmin) {
    return { success: false, imported: 0, errors: ['Admin access required'] }
  }

  const errors: string[] = []
  let imported = 0

  for (const variable of input.variables) {
    try {
      await payload.create({
        collection: 'environment-variables',
        data: {
          name: variable.name.toUpperCase(),
          value: encrypt(variable.value),
          workspace: input.workspaceId,
          app: input.appId || null,
          useInBuilds: input.useInBuilds ?? true,
          useInDeployments: input.useInDeployments ?? true,
          createdBy: session.user.id,
        },
      })
      imported++
    } catch (err: any) {
      if (err.message?.includes('duplicate key')) {
        errors.push(`${variable.name}: already exists`)
      } else {
        errors.push(`${variable.name}: failed to create`)
      }
    }
  }

  return { success: errors.length === 0, imported, errors }
}

/**
 * Resolve effective environment variables for an app (used by build system)
 * This decrypts values - only call server-side!
 */
export async function resolveEnvironmentVariables(
  appId: string,
  usage: 'build' | 'deployment'
): Promise<Record<string, string>> {
  const payload = await getPayload({ config })

  // Get app to find workspace
  const app = await payload.findByID({
    collection: 'apps',
    id: appId,
    depth: 0,
    overrideAccess: true,
  })

  if (!app) {
    throw new Error('App not found')
  }

  const workspaceId = typeof app.workspace === 'string' ? app.workspace : app.workspace.id
  const usageField = usage === 'build' ? 'useInBuilds' : 'useInDeployments'

  // Get workspace-level vars
  const workspaceVars = await payload.find({
    collection: 'environment-variables',
    where: {
      and: [
        { workspace: { equals: workspaceId } },
        { app: { exists: false } },
        { [usageField]: { equals: true } },
      ],
    },
    limit: 500,
    overrideAccess: true,
  })

  // Get app-level overrides
  const appVars = await payload.find({
    collection: 'environment-variables',
    where: {
      and: [
        { app: { equals: appId } },
        { [usageField]: { equals: true } },
      ],
    },
    limit: 500,
    overrideAccess: true,
  })

  // Merge (app overrides workspace)
  const result: Record<string, string> = {}

  for (const v of workspaceVars.docs) {
    try {
      result[v.name] = decrypt(v.value)
    } catch (err) {
      console.error(`Failed to decrypt ${v.name}:`, err)
    }
  }

  for (const v of appVars.docs) {
    try {
      result[v.name] = decrypt(v.value)
    } catch (err) {
      console.error(`Failed to decrypt ${v.name}:`, err)
    }
  }

  return result
}

/**
 * Get decrypted value for a single variable (admin only)
 */
export async function getEnvironmentVariableValue(
  id: string
): Promise<{ value?: string; error?: string }> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user?.id) {
    return { error: 'Unauthorized' }
  }

  const payload = await getPayload({ config })

  try {
    const envVar = await payload.findByID({
      collection: 'environment-variables',
      id,
      overrideAccess: true,
    })

    if (!envVar) {
      return { error: 'Variable not found' }
    }

    const workspaceId =
      typeof envVar.workspace === 'string' ? envVar.workspace : envVar.workspace.id

    const isAdmin = await checkWorkspaceAdmin(payload, session.user.id, workspaceId)
    if (!isAdmin) {
      return { error: 'Admin access required' }
    }

    return { value: decrypt(envVar.value) }
  } catch (err) {
    console.error('Failed to get variable value:', err)
    return { error: 'Failed to decrypt value' }
  }
}
```

**Step 2: Verify file compiles**

Run: `cd orbit-www && pnpm exec tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add orbit-www/src/app/actions/environment-variables.ts
git commit -m "feat(env-vars): add server actions for CRUD and resolution"
```

---

### Task 4: Create .env Parser Utility

**Files:**
- Create: `orbit-www/src/lib/env-parser.ts`

**Step 1: Create the parser**

```typescript
// orbit-www/src/lib/env-parser.ts

export interface ParsedEnvVar {
  name: string
  value: string
}

export interface ParseResult {
  variables: ParsedEnvVar[]
  errors: string[]
}

/**
 * Parse .env file format into key-value pairs
 * Supports:
 * - KEY=value
 * - KEY="quoted value"
 * - KEY='single quoted'
 * - # comments
 * - export KEY=value
 * - Empty lines (ignored)
 */
export function parseEnvFile(content: string): ParseResult {
  const variables: ParsedEnvVar[] = []
  const errors: string[] = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1
    let line = lines[i].trim()

    // Skip empty lines and comments
    if (!line || line.startsWith('#')) {
      continue
    }

    // Remove 'export ' prefix if present
    if (line.startsWith('export ')) {
      line = line.slice(7).trim()
    }

    // Find the first = sign
    const eqIndex = line.indexOf('=')
    if (eqIndex === -1) {
      errors.push(`Line ${lineNum}: Missing '=' sign`)
      continue
    }

    const name = line.slice(0, eqIndex).trim()
    let value = line.slice(eqIndex + 1).trim()

    // Validate name
    if (!name) {
      errors.push(`Line ${lineNum}: Empty variable name`)
      continue
    }

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      errors.push(`Line ${lineNum}: Invalid variable name '${name}'`)
      continue
    }

    // Handle quoted values
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }

    // Handle escape sequences in double-quoted strings
    if (line.slice(eqIndex + 1).trim().startsWith('"')) {
      value = value
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\r/g, '\r')
        .replace(/\\\\/g, '\\')
        .replace(/\\"/g, '"')
    }

    variables.push({ name: name.toUpperCase(), value })
  }

  return { variables, errors }
}

/**
 * Format variables back to .env format
 */
export function formatEnvFile(variables: ParsedEnvVar[]): string {
  return variables
    .map(({ name, value }) => {
      // Quote values with spaces, newlines, or special chars
      if (/[\s"'#]/.test(value) || value.includes('\n')) {
        const escaped = value
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"')
          .replace(/\n/g, '\\n')
          .replace(/\r/g, '\\r')
          .replace(/\t/g, '\\t')
        return `${name}="${escaped}"`
      }
      return `${name}=${value}`
    })
    .join('\n')
}
```

**Step 2: Verify file compiles**

Run: `cd orbit-www && pnpm exec tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add orbit-www/src/lib/env-parser.ts
git commit -m "feat(env-vars): add .env file parser utility"
```

---

## Phase 3: Workspace Settings UI

### Task 5: Create Environment Variables Table Component

**Files:**
- Create: `orbit-www/src/components/features/env-vars/EnvironmentVariablesTable.tsx`

**Step 1: Create the component**

```typescript
// orbit-www/src/components/features/env-vars/EnvironmentVariablesTable.tsx
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Eye, EyeOff, Copy, MoreHorizontal, Pencil, Trash2, Check } from 'lucide-react'
import type { EnvVarDisplay } from '@/app/actions/environment-variables'
import { getEnvironmentVariableValue } from '@/app/actions/environment-variables'
import { toast } from 'sonner'

interface EnvironmentVariablesTableProps {
  variables: EnvVarDisplay[]
  showSource?: boolean
  onEdit: (variable: EnvVarDisplay) => void
  onDelete: (variable: EnvVarDisplay) => void
  onOverride?: (variable: EnvVarDisplay) => void
}

export function EnvironmentVariablesTable({
  variables,
  showSource = false,
  onEdit,
  onDelete,
  onOverride,
}: EnvironmentVariablesTableProps) {
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set())
  const [revealedValues, setRevealedValues] = useState<Record<string, string>>({})
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set())
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const toggleReveal = async (variable: EnvVarDisplay) => {
    const newRevealed = new Set(revealedIds)

    if (newRevealed.has(variable.id)) {
      newRevealed.delete(variable.id)
      setRevealedIds(newRevealed)
      return
    }

    // Fetch value if not already loaded
    if (!revealedValues[variable.id]) {
      setLoadingIds((prev) => new Set(prev).add(variable.id))
      const result = await getEnvironmentVariableValue(variable.id)
      setLoadingIds((prev) => {
        const next = new Set(prev)
        next.delete(variable.id)
        return next
      })

      if (result.error) {
        toast.error(result.error)
        return
      }

      setRevealedValues((prev) => ({ ...prev, [variable.id]: result.value || '' }))
    }

    newRevealed.add(variable.id)
    setRevealedIds(newRevealed)
  }

  const copyValue = async (variable: EnvVarDisplay) => {
    let value = revealedValues[variable.id]

    if (!value) {
      const result = await getEnvironmentVariableValue(variable.id)
      if (result.error) {
        toast.error(result.error)
        return
      }
      value = result.value || ''
    }

    await navigator.clipboard.writeText(value)
    setCopiedId(variable.id)
    toast.success('Copied to clipboard')
    setTimeout(() => setCopiedId(null), 2000)
  }

  if (variables.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No environment variables configured
      </div>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Value</TableHead>
          <TableHead className="w-[100px] text-center">Builds</TableHead>
          <TableHead className="w-[100px] text-center">Deploy</TableHead>
          {showSource && <TableHead className="w-[100px]">Source</TableHead>}
          <TableHead className="w-[80px]"></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {variables.map((variable) => {
          const isRevealed = revealedIds.has(variable.id)
          const isLoading = loadingIds.has(variable.id)
          const value = revealedValues[variable.id]

          return (
            <TableRow key={variable.id}>
              <TableCell className="font-mono text-sm">{variable.name}</TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <code className="text-sm bg-muted px-2 py-1 rounded max-w-[300px] truncate">
                    {isLoading ? 'Loading...' : isRevealed && value ? value : '••••••••••••'}
                  </code>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => toggleReveal(variable)}
                    disabled={isLoading}
                  >
                    {isRevealed ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => copyValue(variable)}
                  >
                    {copiedId === variable.id ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </TableCell>
              <TableCell className="text-center">
                {variable.useInBuilds ? (
                  <Badge variant="secondary">Yes</Badge>
                ) : (
                  <span className="text-muted-foreground">No</span>
                )}
              </TableCell>
              <TableCell className="text-center">
                {variable.useInDeployments ? (
                  <Badge variant="secondary">Yes</Badge>
                ) : (
                  <span className="text-muted-foreground">No</span>
                )}
              </TableCell>
              {showSource && (
                <TableCell>
                  <Badge variant={variable.source === 'app' ? 'default' : 'outline'}>
                    {variable.source === 'app' ? 'App' : 'Workspace'}
                  </Badge>
                </TableCell>
              )}
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {showSource && variable.source === 'workspace' && onOverride && (
                      <DropdownMenuItem onClick={() => onOverride(variable)}>
                        Override for this app
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onClick={() => onEdit(variable)}>
                      <Pencil className="h-4 w-4 mr-2" />
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => onDelete(variable)}
                      className="text-destructive"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
```

**Step 2: Verify file compiles**

Run: `cd orbit-www && pnpm exec tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add orbit-www/src/components/features/env-vars/EnvironmentVariablesTable.tsx
git commit -m "feat(env-vars): add environment variables table component"
```

---

### Task 6: Create Add/Edit Variable Modal

**Files:**
- Create: `orbit-www/src/components/features/env-vars/EnvironmentVariableModal.tsx`

**Step 1: Create the component**

```typescript
// orbit-www/src/components/features/env-vars/EnvironmentVariableModal.tsx
'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Eye, EyeOff } from 'lucide-react'
import type { EnvVarDisplay } from '@/app/actions/environment-variables'
import { getEnvironmentVariableValue } from '@/app/actions/environment-variables'

interface EnvironmentVariableModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  variable?: EnvVarDisplay | null
  onSave: (data: {
    name: string
    value: string
    description?: string
    useInBuilds: boolean
    useInDeployments: boolean
  }) => Promise<void>
  isOverride?: boolean
}

export function EnvironmentVariableModal({
  open,
  onOpenChange,
  variable,
  onSave,
  isOverride = false,
}: EnvironmentVariableModalProps) {
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [description, setDescription] = useState('')
  const [useInBuilds, setUseInBuilds] = useState(true)
  const [useInDeployments, setUseInDeployments] = useState(true)
  const [showValue, setShowValue] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loadingValue, setLoadingValue] = useState(false)

  const isEditing = !!variable && !isOverride

  useEffect(() => {
    if (open) {
      if (variable) {
        setName(variable.name)
        setDescription(variable.description || '')
        setUseInBuilds(variable.useInBuilds)
        setUseInDeployments(variable.useInDeployments)

        if (isEditing) {
          // Load current value for editing
          setLoadingValue(true)
          getEnvironmentVariableValue(variable.id).then((result) => {
            setLoadingValue(false)
            if (result.value) {
              setValue(result.value)
            }
          })
        } else {
          setValue('')
        }
      } else {
        // Reset form for new variable
        setName('')
        setValue('')
        setDescription('')
        setUseInBuilds(true)
        setUseInDeployments(true)
      }
      setShowValue(false)
    }
  }, [open, variable, isEditing])

  const handleSubmit = async () => {
    if (!name.trim() || (!isEditing && !value.trim())) {
      return
    }

    setSaving(true)
    try {
      await onSave({
        name: name.toUpperCase(),
        value,
        description: description || undefined,
        useInBuilds,
        useInDeployments,
      })
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  const title = isOverride
    ? `Override ${variable?.name}`
    : isEditing
    ? 'Edit Variable'
    : 'Add Environment Variable'

  const description_text = isOverride
    ? 'Create an app-specific value for this variable'
    : isEditing
    ? 'Update the environment variable'
    : 'Add a new environment variable'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description_text}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              placeholder="e.g., DATABASE_URL"
              value={name}
              onChange={(e) => setName(e.target.value.toUpperCase())}
              disabled={isEditing || isOverride}
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Uppercase letters, numbers, and underscores only
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="value">
              Value
              {isEditing && ' (leave blank to keep current)'}
            </Label>
            <div className="relative">
              <Input
                id="value"
                type={showValue ? 'text' : 'password'}
                placeholder={loadingValue ? 'Loading...' : isEditing ? '••••••••' : 'Enter value'}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                disabled={loadingValue}
                className="pr-10 font-mono"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-0 top-0 h-full px-3"
                onClick={() => setShowValue(!showValue)}
              >
                {showValue ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea
              id="description"
              placeholder="What is this variable used for?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          <div className="space-y-3">
            <Label>Use in</Label>
            <div className="flex items-center gap-6">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="useInBuilds"
                  checked={useInBuilds}
                  onCheckedChange={(checked) => setUseInBuilds(checked === true)}
                />
                <label
                  htmlFor="useInBuilds"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  Builds
                </label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="useInDeployments"
                  checked={useInDeployments}
                  onCheckedChange={(checked) => setUseInDeployments(checked === true)}
                />
                <label
                  htmlFor="useInDeployments"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  Deployments
                </label>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={saving || !name.trim() || (!isEditing && !value.trim())}
          >
            {saving ? 'Saving...' : isEditing ? 'Save Changes' : 'Add Variable'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

**Step 2: Commit**

```bash
git add orbit-www/src/components/features/env-vars/EnvironmentVariableModal.tsx
git commit -m "feat(env-vars): add environment variable add/edit modal"
```

---

### Task 7: Create Bulk Import Modal

**Files:**
- Create: `orbit-www/src/components/features/env-vars/BulkImportModal.tsx`

**Step 1: Create the component**

```typescript
// orbit-www/src/components/features/env-vars/BulkImportModal.tsx
'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { AlertCircle, CheckCircle2 } from 'lucide-react'
import { parseEnvFile, type ParsedEnvVar } from '@/lib/env-parser'

interface BulkImportModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImport: (
    variables: ParsedEnvVar[],
    options: { useInBuilds: boolean; useInDeployments: boolean }
  ) => Promise<{ imported: number; errors: string[] }>
}

export function BulkImportModal({
  open,
  onOpenChange,
  onImport,
}: BulkImportModalProps) {
  const [content, setContent] = useState('')
  const [useInBuilds, setUseInBuilds] = useState(true)
  const [useInDeployments, setUseInDeployments] = useState(true)
  const [parsedVars, setParsedVars] = useState<ParsedEnvVar[]>([])
  const [parseErrors, setParseErrors] = useState<string[]>([])
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ imported: number; errors: string[] } | null>(null)

  // Parse content on change
  useEffect(() => {
    if (content.trim()) {
      const { variables, errors } = parseEnvFile(content)
      setParsedVars(variables)
      setParseErrors(errors)
    } else {
      setParsedVars([])
      setParseErrors([])
    }
  }, [content])

  // Reset when modal opens
  useEffect(() => {
    if (open) {
      setContent('')
      setParsedVars([])
      setParseErrors([])
      setResult(null)
      setUseInBuilds(true)
      setUseInDeployments(true)
    }
  }, [open])

  const handleImport = async () => {
    if (parsedVars.length === 0) return

    setImporting(true)
    try {
      const importResult = await onImport(parsedVars, { useInBuilds, useInDeployments })
      setResult(importResult)

      if (importResult.errors.length === 0) {
        // Success - close after brief delay
        setTimeout(() => onOpenChange(false), 1500)
      }
    } finally {
      setImporting(false)
    }
  }

  const maskValue = (value: string) => {
    if (value.length <= 8) return '••••••••'
    return value.slice(0, 4) + '••••' + value.slice(-4)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Import Environment Variables</DialogTitle>
          <DialogDescription>
            Paste your .env file contents to import multiple variables at once
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="content">Paste .env contents</Label>
            <Textarea
              id="content"
              placeholder={`# Example format
DATABASE_URL=postgres://...
API_KEY="your-secret-key"
NODE_ENV=production`}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={8}
              className="font-mono text-sm"
            />
          </div>

          {/* Parse errors */}
          {parseErrors.length > 0 && (
            <div className="rounded-md bg-destructive/10 p-3">
              <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                <AlertCircle className="h-4 w-4" />
                Parse errors
              </div>
              <ul className="mt-2 text-sm text-destructive/80 list-disc list-inside">
                {parseErrors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Preview */}
          {parsedVars.length > 0 && (
            <div className="space-y-2">
              <Label>Preview ({parsedVars.length} variables)</Label>
              <ScrollArea className="h-[150px] rounded-md border">
                <div className="p-3 space-y-1">
                  {parsedVars.map((v, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between text-sm py-1"
                    >
                      <code className="font-mono">{v.name}</code>
                      <code className="text-muted-foreground font-mono text-xs">
                        {maskValue(v.value)}
                      </code>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}

          {/* Options */}
          <div className="space-y-3">
            <Label>Default settings for imported variables</Label>
            <div className="flex items-center gap-6">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="bulkUseInBuilds"
                  checked={useInBuilds}
                  onCheckedChange={(checked) => setUseInBuilds(checked === true)}
                />
                <label htmlFor="bulkUseInBuilds" className="text-sm">
                  Use in Builds
                </label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="bulkUseInDeployments"
                  checked={useInDeployments}
                  onCheckedChange={(checked) => setUseInDeployments(checked === true)}
                />
                <label htmlFor="bulkUseInDeployments" className="text-sm">
                  Use in Deployments
                </label>
              </div>
            </div>
          </div>

          {/* Import result */}
          {result && (
            <div
              className={`rounded-md p-3 ${
                result.errors.length === 0
                  ? 'bg-green-500/10 text-green-700'
                  : 'bg-yellow-500/10 text-yellow-700'
              }`}
            >
              <div className="flex items-center gap-2 font-medium">
                <CheckCircle2 className="h-4 w-4" />
                Imported {result.imported} of {parsedVars.length} variables
              </div>
              {result.errors.length > 0 && (
                <ul className="mt-2 text-sm list-disc list-inside">
                  {result.errors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleImport}
            disabled={importing || parsedVars.length === 0}
          >
            {importing
              ? 'Importing...'
              : `Import ${parsedVars.length} Variable${parsedVars.length !== 1 ? 's' : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

**Step 2: Create index file for easier imports**

Create: `orbit-www/src/components/features/env-vars/index.ts`

```typescript
// orbit-www/src/components/features/env-vars/index.ts
export { EnvironmentVariablesTable } from './EnvironmentVariablesTable'
export { EnvironmentVariableModal } from './EnvironmentVariableModal'
export { BulkImportModal } from './BulkImportModal'
```

**Step 3: Commit**

```bash
git add orbit-www/src/components/features/env-vars/
git commit -m "feat(env-vars): add bulk import modal and component index"
```

---

### Task 8: Create Workspace Settings Page for Environment Variables

**Files:**
- Create: `orbit-www/src/app/(frontend)/settings/environment/page.tsx`
- Create: `orbit-www/src/app/(frontend)/settings/environment/environment-settings-client.tsx`

**Step 1: Create the page file**

```typescript
// orbit-www/src/app/(frontend)/settings/environment/page.tsx
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { EnvironmentSettingsClient } from './environment-settings-client'

export default function EnvironmentSettingsPage() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col gap-4 p-8">
          <EnvironmentSettingsClient />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
```

**Step 2: Create the client component**

```typescript
// orbit-www/src/app/(frontend)/settings/environment/environment-settings-client.tsx
'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Key, Plus, Upload, AlertCircle } from 'lucide-react'
import {
  EnvironmentVariablesTable,
  EnvironmentVariableModal,
  BulkImportModal,
} from '@/components/features/env-vars'
import {
  getEnvironmentVariables,
  createEnvironmentVariable,
  updateEnvironmentVariable,
  deleteEnvironmentVariable,
  bulkImportEnvironmentVariables,
  type EnvVarDisplay,
} from '@/app/actions/environment-variables'
import type { ParsedEnvVar } from '@/lib/env-parser'
import { toast } from 'sonner'

interface Workspace {
  id: string
  name: string
  slug: string
}

export function EnvironmentSettingsClient() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [selectedWorkspace, setSelectedWorkspace] = useState<string>('')
  const [variables, setVariables] = useState<EnvVarDisplay[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [showAddModal, setShowAddModal] = useState(false)
  const [showBulkModal, setShowBulkModal] = useState(false)
  const [editingVar, setEditingVar] = useState<EnvVarDisplay | null>(null)

  // Load workspaces on mount
  useEffect(() => {
    loadWorkspaces()
  }, [])

  // Load variables when workspace changes
  useEffect(() => {
    if (selectedWorkspace) {
      loadVariables()
    }
  }, [selectedWorkspace])

  async function loadWorkspaces() {
    try {
      const res = await fetch('/api/workspaces/admin')
      const data = await res.json()

      if (data.workspaces) {
        setWorkspaces(data.workspaces)
        if (data.workspaces.length > 0) {
          setSelectedWorkspace(data.workspaces[0].id)
        }
      }
    } catch (err) {
      setError('Failed to load workspaces')
    } finally {
      setLoading(false)
    }
  }

  async function loadVariables() {
    if (!selectedWorkspace) return

    try {
      const result = await getEnvironmentVariables(selectedWorkspace)
      if (result.error) {
        setError(result.error)
      } else {
        setVariables(result.variables)
        setError(null)
      }
    } catch (err) {
      setError('Failed to load environment variables')
    }
  }

  async function handleSave(data: {
    name: string
    value: string
    description?: string
    useInBuilds: boolean
    useInDeployments: boolean
  }) {
    if (editingVar) {
      const result = await updateEnvironmentVariable(editingVar.id, {
        value: data.value || undefined,
        description: data.description,
        useInBuilds: data.useInBuilds,
        useInDeployments: data.useInDeployments,
      })

      if (result.success) {
        toast.success('Variable updated')
        loadVariables()
      } else {
        toast.error(result.error || 'Failed to update variable')
        throw new Error(result.error)
      }
    } else {
      const result = await createEnvironmentVariable({
        name: data.name,
        value: data.value,
        workspaceId: selectedWorkspace,
        description: data.description,
        useInBuilds: data.useInBuilds,
        useInDeployments: data.useInDeployments,
      })

      if (result.success) {
        toast.success('Variable created')
        loadVariables()
      } else {
        toast.error(result.error || 'Failed to create variable')
        throw new Error(result.error)
      }
    }
  }

  async function handleDelete(variable: EnvVarDisplay) {
    if (!confirm(`Delete "${variable.name}"? This cannot be undone.`)) {
      return
    }

    const result = await deleteEnvironmentVariable(variable.id)
    if (result.success) {
      toast.success('Variable deleted')
      loadVariables()
    } else {
      toast.error(result.error || 'Failed to delete variable')
    }
  }

  async function handleBulkImport(
    vars: ParsedEnvVar[],
    options: { useInBuilds: boolean; useInDeployments: boolean }
  ) {
    const result = await bulkImportEnvironmentVariables({
      workspaceId: selectedWorkspace,
      variables: vars,
      useInBuilds: options.useInBuilds,
      useInDeployments: options.useInDeployments,
    })

    if (result.imported > 0) {
      loadVariables()
    }

    return result
  }

  if (loading) {
    return <div>Loading...</div>
  }

  return (
    <>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Key className="h-6 w-6" />
            Environment Variables
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure environment variables for builds and deployments
          </p>
        </div>
        <div className="flex items-center gap-2">
          {workspaces.length > 1 && (
            <Select value={selectedWorkspace} onValueChange={setSelectedWorkspace}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Select workspace" />
              </SelectTrigger>
              <SelectContent>
                {workspaces.map((ws) => (
                  <SelectItem key={ws.id} value={ws.id}>
                    {ws.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button variant="outline" onClick={() => setShowBulkModal(true)}>
            <Upload className="h-4 w-4 mr-2" />
            Import .env
          </Button>
          <Button onClick={() => { setEditingVar(null); setShowAddModal(true) }}>
            <Plus className="h-4 w-4 mr-2" />
            Add Variable
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {workspaces.length === 0 && !error ? (
        <Alert className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>No Admin Access</AlertTitle>
          <AlertDescription>
            You need to be an admin or owner of a workspace to manage environment variables.
          </AlertDescription>
        </Alert>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Workspace Variables</CardTitle>
            <CardDescription>
              These variables are available to all apps in this workspace. Apps can override them with their own values.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EnvironmentVariablesTable
              variables={variables}
              onEdit={(v) => { setEditingVar(v); setShowAddModal(true) }}
              onDelete={handleDelete}
            />
          </CardContent>
        </Card>
      )}

      <EnvironmentVariableModal
        open={showAddModal}
        onOpenChange={setShowAddModal}
        variable={editingVar}
        onSave={handleSave}
      />

      <BulkImportModal
        open={showBulkModal}
        onOpenChange={setShowBulkModal}
        onImport={handleBulkImport}
      />
    </>
  )
}
```

**Step 3: Create API route for admin workspaces**

Create: `orbit-www/src/app/api/workspaces/admin/route.ts`

```typescript
// orbit-www/src/app/api/workspaces/admin/route.ts
import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() })

  if (!session?.user?.id) {
    return NextResponse.json({ workspaces: [] }, { status: 401 })
  }

  const payload = await getPayload({ config })

  try {
    // Get workspaces where user is admin/owner
    const memberships = await payload.find({
      collection: 'workspace-members',
      where: {
        and: [
          { user: { equals: session.user.id } },
          { role: { in: ['owner', 'admin'] } },
          { status: { equals: 'active' } },
        ],
      },
      depth: 1,
      limit: 100,
    })

    const workspaces = memberships.docs.map((m) => {
      const ws = m.workspace as any
      return {
        id: ws.id || ws,
        name: ws.name || 'Unknown',
        slug: ws.slug || '',
      }
    })

    return NextResponse.json({ workspaces })
  } catch (err) {
    console.error('Failed to get admin workspaces:', err)
    return NextResponse.json({ workspaces: [], error: 'Failed to load' }, { status: 500 })
  }
}
```

**Step 4: Commit**

```bash
git add orbit-www/src/app/(frontend)/settings/environment/ orbit-www/src/app/api/workspaces/admin/
git commit -m "feat(env-vars): add workspace settings page for environment variables"
```

---

## Phase 4: Build Integration

### Task 9: Integrate Environment Variables with Build Flow

**Files:**
- Modify: `orbit-www/src/app/actions/builds.ts`

**Step 1: Add import for resolveEnvironmentVariables**

Add after the existing imports (around line 8):
```typescript
import { resolveEnvironmentVariables } from '@/app/actions/environment-variables'
```

**Step 2: Call resolveEnvironmentVariables before starting build**

Find the section where buildEnv is set (around line 150-170, look for `buildEnv:` in the workflow params). Replace or add the resolution:

Add before the temporal workflow start (before the `await temporal.workflow.start` call):
```typescript
    // Resolve environment variables for this app
    const resolvedEnvVars = await resolveEnvironmentVariables(input.appId, 'build')

    // Merge with any explicitly passed buildEnv (explicit takes precedence)
    const finalBuildEnv = {
      ...resolvedEnvVars,
      ...(input.buildEnv || {}),
    }
```

Then update the workflow params to use `finalBuildEnv`:
```typescript
      buildEnv: finalBuildEnv,
```

**Step 3: Verify build compiles**

Run: `cd orbit-www && pnpm exec tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add orbit-www/src/app/actions/builds.ts
git commit -m "feat(env-vars): integrate environment variables with build workflow"
```

---

## Phase 5: App-Level UI

### Task 10: Add Environment Variables Section to App Detail Page

**Files:**
- Modify: `orbit-www/src/components/features/apps/AppDetail.tsx`
- Create: `orbit-www/src/components/features/apps/AppEnvironmentVariables.tsx`

**Step 1: Create the app env vars component**

```typescript
// orbit-www/src/components/features/apps/AppEnvironmentVariables.tsx
'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Key, Plus } from 'lucide-react'
import {
  EnvironmentVariablesTable,
  EnvironmentVariableModal,
} from '@/components/features/env-vars'
import {
  getEnvironmentVariables,
  createEnvironmentVariable,
  updateEnvironmentVariable,
  deleteEnvironmentVariable,
  type EnvVarDisplay,
} from '@/app/actions/environment-variables'
import { toast } from 'sonner'

interface AppEnvironmentVariablesProps {
  appId: string
  workspaceId: string
}

export function AppEnvironmentVariables({ appId, workspaceId }: AppEnvironmentVariablesProps) {
  const [variables, setVariables] = useState<EnvVarDisplay[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingVar, setEditingVar] = useState<EnvVarDisplay | null>(null)
  const [overrideVar, setOverrideVar] = useState<EnvVarDisplay | null>(null)

  useEffect(() => {
    loadVariables()
  }, [appId, workspaceId])

  async function loadVariables() {
    setLoading(true)
    const result = await getEnvironmentVariables(workspaceId, appId)
    setVariables(result.variables)
    setLoading(false)
  }

  async function handleSave(data: {
    name: string
    value: string
    description?: string
    useInBuilds: boolean
    useInDeployments: boolean
  }) {
    if (editingVar) {
      const result = await updateEnvironmentVariable(editingVar.id, {
        value: data.value || undefined,
        description: data.description,
        useInBuilds: data.useInBuilds,
        useInDeployments: data.useInDeployments,
      })

      if (result.success) {
        toast.success('Variable updated')
        loadVariables()
      } else {
        toast.error(result.error || 'Failed to update')
        throw new Error(result.error)
      }
    } else {
      // Creating new or override
      const result = await createEnvironmentVariable({
        name: data.name,
        value: data.value,
        workspaceId,
        appId, // App-level variable
        description: data.description,
        useInBuilds: data.useInBuilds,
        useInDeployments: data.useInDeployments,
      })

      if (result.success) {
        toast.success(overrideVar ? 'Override created' : 'Variable created')
        loadVariables()
      } else {
        toast.error(result.error || 'Failed to create')
        throw new Error(result.error)
      }
    }
  }

  async function handleDelete(variable: EnvVarDisplay) {
    if (!confirm(`Delete "${variable.name}"? This cannot be undone.`)) {
      return
    }

    const result = await deleteEnvironmentVariable(variable.id)
    if (result.success) {
      toast.success('Variable deleted')
      loadVariables()
    } else {
      toast.error(result.error || 'Failed to delete')
    }
  }

  function handleEdit(variable: EnvVarDisplay) {
    setEditingVar(variable)
    setOverrideVar(null)
    setShowModal(true)
  }

  function handleOverride(variable: EnvVarDisplay) {
    setEditingVar(null)
    setOverrideVar(variable)
    setShowModal(true)
  }

  function handleAdd() {
    setEditingVar(null)
    setOverrideVar(null)
    setShowModal(true)
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            Environment Variables
          </CardTitle>
        </CardHeader>
        <CardContent>Loading...</CardContent>
      </Card>
    )
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Key className="h-5 w-5" />
                Environment Variables
              </CardTitle>
              <CardDescription>
                Variables available for builds and deployments. Workspace variables are inherited.
              </CardDescription>
            </div>
            <Button size="sm" onClick={handleAdd}>
              <Plus className="h-4 w-4 mr-2" />
              Add Variable
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <EnvironmentVariablesTable
            variables={variables}
            showSource={true}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onOverride={handleOverride}
          />
        </CardContent>
      </Card>

      <EnvironmentVariableModal
        open={showModal}
        onOpenChange={setShowModal}
        variable={editingVar || overrideVar}
        onSave={handleSave}
        isOverride={!!overrideVar}
      />
    </>
  )
}
```

**Step 2: Add to AppDetail component**

In `orbit-www/src/components/features/apps/AppDetail.tsx`, add the import near the top:
```typescript
import { AppEnvironmentVariables } from './AppEnvironmentVariables'
```

Then add the component in the render, before the BuildSection (find `<BuildSection` and add above it):
```typescript
      {/* Environment Variables */}
      <AppEnvironmentVariables
        appId={app.id}
        workspaceId={typeof app.workspace === 'string' ? app.workspace : app.workspace.id}
      />
```

**Step 3: Commit**

```bash
git add orbit-www/src/components/features/apps/AppEnvironmentVariables.tsx orbit-www/src/components/features/apps/AppDetail.tsx
git commit -m "feat(env-vars): add environment variables section to app detail page"
```

---

## Phase 6: Testing & Verification

### Task 11: Manual Testing

**Step 1: Start dev environment**

Run: `cd orbit-www && bun run dev`

**Step 2: Test workspace-level variables**

1. Navigate to Settings → Environment (new page)
2. Select a workspace
3. Click "Add Variable"
4. Add: `TURSO_DATABASE_URL` with a test value
5. Check "Use in Builds" and "Use in Deployments"
6. Save
7. Verify it appears in the table
8. Click the eye icon to reveal the value
9. Click copy icon and verify clipboard

**Step 3: Test bulk import**

1. Click "Import .env"
2. Paste:
   ```
   TEST_VAR_1=value1
   TEST_VAR_2="value with spaces"
   # This is a comment
   TEST_VAR_3=value3
   ```
3. Verify preview shows 3 variables
4. Import and verify they appear in table

**Step 4: Test app-level variables**

1. Navigate to an app detail page
2. Find Environment Variables section
3. Verify workspace variables show with "Workspace" badge
4. Click "Override" on a workspace variable
5. Enter a new value and save
6. Verify it now shows "App" badge

**Step 5: Test build integration**

1. On an app with TURSO_DATABASE_URL configured
2. Click "Build Now"
3. Check build logs to verify variable was passed

**Step 6: Final commit**

```bash
git add -A
git commit -m "feat(env-vars): complete environment variables feature

- EnvironmentVariables collection with encryption
- Workspace settings page for managing workspace-level vars
- App detail section for viewing/overriding vars
- Bulk import from .env file format
- Build integration to resolve and pass vars to Railpack"
```

---

## Summary

| Phase | Tasks | Description |
|-------|-------|-------------|
| 1 | 1-2 | Core collection with encryption hooks |
| 2 | 3-4 | Server actions and .env parser |
| 3 | 5-8 | Workspace settings UI (table, modals, page) |
| 4 | 9 | Build integration |
| 5 | 10 | App detail page UI |
| 6 | 11 | Manual testing and verification |

**Total estimated tasks:** 11
**Key files created:** 10
**Key files modified:** 4
