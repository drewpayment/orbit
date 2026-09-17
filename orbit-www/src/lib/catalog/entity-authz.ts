import type { Payload } from 'payload'
import { can, ALL_ROLES, MANAGE_ROLES } from '@/lib/authz/policy'
import { workspaceIdsFor } from '@/lib/authz/membership'

/**
 * Catalog entity authorization (Catalog Entity CRUD, WP1), expressed over the
 * shared policy in `@/lib/authz/policy`. Reachable from collections, so no
 * `server-only` and no Actor here: callers pass `betterAuthId` +
 * `isPlatformAdmin` (from `principalOf(req.user)` or the Actor).
 *
 *  - create / manage = platform admin, OR any active member of the entity's
 *    workspace. A null workspace (global entity) ⇒ platform admin only.
 *  - delete = MANUAL entity AND platform admin or workspace owner/admin.
 *    Projected entities are never deletable.
 */

const principal = (betterAuthId: string | null | undefined, isPlatformAdmin: boolean) => ({
  payloadId: null,
  betterAuthId: betterAuthId ?? null,
  isPlatformAdmin,
})

export async function canCreateEntity(
  payload: Payload,
  betterAuthId: string | null | undefined,
  isPlatformAdmin: boolean,
  workspaceId: string | null,
): Promise<boolean> {
  const d = await can(payload, principal(betterAuthId, isPlatformAdmin), 'create', {
    kind: 'doc',
    workspaceId,
    roles: ALL_ROLES,
  })
  return d.allowed
}

export async function canManageEntity(
  payload: Payload,
  betterAuthId: string | null | undefined,
  isPlatformAdmin: boolean,
  entity: { workspaceId: string | null },
): Promise<boolean> {
  return canCreateEntity(payload, betterAuthId, isPlatformAdmin, entity.workspaceId)
}

export async function canDeleteEntity(
  payload: Payload,
  betterAuthId: string | null | undefined,
  isPlatformAdmin: boolean,
  entity: { workspaceId: string | null; sourceType: string },
): Promise<boolean> {
  if (entity.sourceType !== 'manual') return false
  const d = await can(payload, principal(betterAuthId, isPlatformAdmin), 'delete', {
    kind: 'doc',
    workspaceId: entity.workspaceId,
    roles: MANAGE_ROLES,
  })
  return d.allowed
}

/** Workspace ids the user is an active member of. `[]` for a missing id. */
export async function getManageableWorkspaceIds(
  payload: Payload,
  betterAuthId: string | null | undefined,
): Promise<string[]> {
  if (!betterAuthId) return []
  return workspaceIdsFor(payload, betterAuthId, 'member')
}

/** True if `entityId` is an existing catalog entity of kind `team`. */
export async function isTeamEntity(payload: Payload, entityId: string): Promise<boolean> {
  try {
    const entity = await payload.findByID({
      collection: 'catalog-entities',
      id: entityId,
      depth: 0,
      overrideAccess: true,
    })
    return entity?.kind === 'team'
  } catch {
    return false
  }
}
