import type { Access, Where } from 'payload'

/**
 * Workspace-scoped access for the Self-Service actions collections (IDP refocus
 * P3). Same model as the scorecards collections: the tenant boundary is the
 * caller's active workspace memberships. Authoring Actions is owner/admin;
 * RUNNING an action (creating an action-run) is open to any active member.
 *
 * NOTE: this mirrors src/collections/scorecards/access.ts — a future cleanup
 * could promote these to one shared module.
 */

export const workspaceScopedRead: Access = async ({ req: { user, payload } }) => {
  if (!user) return false
  if (user.collection === 'users') return true
  const memberships = await payload.find({
    collection: 'workspace-members',
    where: { user: { equals: user.id }, status: { equals: 'active' } },
    limit: 1000,
    overrideAccess: true,
  })
  const workspaceIds = memberships.docs.map((m) =>
    String(typeof m.workspace === 'string' ? m.workspace : m.workspace.id),
  )
  return { workspace: { in: workspaceIds } } as Where
}

/** Create allowed for any active member of the target workspace (data.workspace). */
export const workspaceScopedMemberCreate: Access = async ({ req: { user, payload }, data }) => {
  if (!user) return false
  if (user.collection === 'users') return true
  const workspaceId =
    typeof data?.workspace === 'string' ? data.workspace : data?.workspace?.id
  if (!workspaceId) return false
  const members = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: workspaceId } },
        { user: { equals: user.id } },
        { status: { equals: 'active' } },
      ],
    },
    limit: 1,
    overrideAccess: true,
  })
  return members.docs.length > 0
}

/** Create gated on owner/admin of the target workspace (for authoring Actions). */
export const workspaceScopedManageCreate: Access = async ({ req: { user, payload }, data }) => {
  if (!user) return false
  if (user.collection === 'users') return true
  const workspaceId =
    typeof data?.workspace === 'string' ? data.workspace : data?.workspace?.id
  if (!workspaceId) return false
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
    limit: 1,
    overrideAccess: true,
  })
  return members.docs.length > 0
}

export const workspaceScopedMutate =
  (slug: string, roles: string[]): Access =>
  async ({ req: { user, payload }, id }) => {
    if (!user || !id) return false
    if (user.collection === 'users') return true
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = await payload.findByID({ collection: slug as any, id, overrideAccess: true })
    const workspaceId =
      typeof doc.workspace === 'string' ? doc.workspace : doc.workspace?.id
    if (!workspaceId) return false
    const members = await payload.find({
      collection: 'workspace-members',
      where: {
        and: [
          { workspace: { equals: workspaceId } },
          { user: { equals: user.id } },
          { role: { in: roles } },
          { status: { equals: 'active' } },
        ],
      },
      overrideAccess: true,
    })
    return members.docs.length > 0
  }
