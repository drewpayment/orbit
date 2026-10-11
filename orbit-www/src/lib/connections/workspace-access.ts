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

export {
  findInstallationByRef,
  resolveInstallationForWorkspace,
  installationAllowedForWorkspace,
  type ResolvedInstallation,
} from './installation-access'
