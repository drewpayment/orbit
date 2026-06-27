import type { Access, Where } from 'payload'

/**
 * Shared workspace-scoped access for the scorecards collections (IDP refocus P2).
 *
 * Same security model as apps/catalog-entities (the tenant boundary is the
 * caller's active workspace memberships), factored into one place because all
 * five scorecard collections carry a `workspace` relationship and use the
 * identical pattern. Payload admin users (user.collection === 'users') see/do
 * everything; the Temporal/eval writebacks run with overrideAccess.
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

export const workspaceScopedCreate: Access = ({ req: { user } }) => !!user

/**
 * Factory for update/delete: caller must be an active member of the doc's
 * workspace with one of `roles`.
 */
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
