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
    collection: 'user-workspace-roles' as any,
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

    const rolePermissions = ((role as any).permissions || [])
      .map((p: any) => {
        if (typeof p === 'object' && p !== null && 'slug' in p) {
          return (p as { slug: string }).slug
        }
        return null
      })
      .filter((p: string | null): p is string => p !== null)

    if ((role as any).scope === 'platform') {
      // Platform-level role
      permissions.platformPermissions.push(...rolePermissions)
    } else if ((assignment as any).workspace) {
      // Workspace-level role
      const workspaceId = typeof (assignment as any).workspace === 'object'
        ? (assignment as any).workspace.id
        : (assignment as any).workspace

      if (!permissions.workspaces[workspaceId]) {
        permissions.workspaces[workspaceId] = {
          roles: [],
          permissions: [],
        }
      }

      permissions.workspaces[workspaceId].roles.push((role as any).slug)
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
