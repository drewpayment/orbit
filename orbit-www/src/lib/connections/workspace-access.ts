import type { Payload, Where } from 'payload'
import { memberWorkspaceIds, type Actor } from '@/lib/authz'

/**
 * Source-control connections (GitHub App installations, Azure DevOps
 * git-connections) are platform-managed credentials shared into workspaces via
 * `allowedWorkspaces`. Both collections are admin-only, so the repo-browsing
 * server actions read them with `overrideAccess: true`; this is the gate that
 * stands in for collection access: the caller must be an active member of at
 * least one workspace the connection was granted to (platform admins pass).
 *
 * A connection with no `allowedWorkspaces` has been granted to nobody.
 */

function workspaceIdsOf(allowedWorkspaces: unknown): string[] {
  if (!Array.isArray(allowedWorkspaces)) return []
  return allowedWorkspaces
    .map((w) => (typeof w === 'string' ? w : w && typeof w === 'object' && 'id' in w ? String((w as { id: unknown }).id) : ''))
    .filter(Boolean)
}

export async function actorMayUseSource(actor: Actor, allowedWorkspaces: unknown): Promise<boolean> {
  if (actor.isPlatformAdmin) return true
  const allowed = workspaceIdsOf(allowedWorkspaces)
  if (allowed.length === 0) return false
  const mine = new Set(await memberWorkspaceIds('member', actor))
  return allowed.some((id) => mine.has(id))
}

/**
 * Is the GitHub App installation `ref` granted to `workspaceId`?
 *
 * `ref` is whatever an app stores in `repository.installationId`: either the
 * `github-installations` Payload id (what the repo picker hands out) or the
 * numeric GitHub installation id. Both resolve to the same doc; the doc's
 * `allowedWorkspaces` must contain the workspace. Never throws; a malformed or
 * unknown ref is simply not allowed.
 */
export async function installationAllowedForWorkspace(
  payload: Payload,
  ref: unknown,
  workspaceId: string | null | undefined,
): Promise<boolean> {
  if (ref === null || ref === undefined || ref === '' || !workspaceId) return false
  const value = String(ref)
  const byRef: Where[] = []
  if (/^[0-9a-f]{24}$/i.test(value)) byRef.push({ id: { equals: value } })
  if (/^\d+$/.test(value)) byRef.push({ installationId: { equals: Number(value) } })
  if (byRef.length === 0) return false
  try {
    const found = await payload.find({
      collection: 'github-installations',
      where: { and: [{ or: byRef }, { allowedWorkspaces: { contains: workspaceId } }] },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    return found.docs.length > 0
  } catch {
    return false
  }
}
