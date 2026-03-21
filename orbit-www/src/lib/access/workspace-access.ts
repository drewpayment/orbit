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
