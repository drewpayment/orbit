import type { Access, Where } from 'payload'

/**
 * Workspace-scoped access for the Automations collection (IDP refocus P4).
 *
 * Mirrors the scorecards/actions access model: the tenant boundary is the
 * caller's active workspace memberships. Authoring an Automation (the "when X,
 * do Y" rule) is a privileged config change, so create/update/delete are gated
 * on workspace owner/admin — the same Option A choice P2/P3 made. There is no
 * member-create path: automations are management config, not a self-service run.
 *
 * NOTE: this mirrors src/collections/actions/access.ts and
 * src/collections/scorecards/access.ts — a future cleanup could promote these
 * to one shared module.
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

/** Create gated on owner/admin of the target workspace (data.workspace). */
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

/** Update/delete gated on owner/admin of the automation's workspace. */
export const workspaceScopedManageMutate: Access = async ({ req: { user, payload }, id }) => {
  if (!user || !id) return false
  if (user.collection === 'users') return true
  const doc = await payload.findByID({ collection: 'automations', id, overrideAccess: true })
  const workspaceId = typeof doc.workspace === 'string' ? doc.workspace : doc.workspace?.id
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
