import type { Payload } from 'payload'
import {
  isWorkspaceMember,
  isWorkspaceAdminOrOwner,
  getMemberWorkspaceIds,
} from '@/lib/access/workspace-access'

/**
 * Catalog entity authorization — the SINGLE server-side source of truth for
 * "can this user create / manage / delete this entity" (Catalog Entity CRUD,
 * docs/plans/2026-07-02-catalog-entity-crud.md, WP1). The collection `access`
 * rules, the authoring server actions, and the server-computed UI `canManage`
 * flags all route through these functions.
 *
 * Policy (PM decisions 1–4):
 *  - create / manage = platform admin, OR an active workspace member (ANY role)
 *    of the entity's workspace. A null workspace (global entity) ⇒ platform
 *    admin only.
 *  - delete = the entity is MANUAL (`source.type === 'manual'`) AND the caller
 *    is a platform admin or a workspace owner/admin. Projected entities are not
 *    deletable anywhere — deleting them means deleting their source.
 *
 * IMPORTANT: `workspace-members.user` holds a **Better-Auth** id, so every
 * membership lookup here takes `betterAuthId` — NEVER a Payload `user.id`.
 * Comparing the Payload doc id against `workspace-members.user` was the latent
 * access bug this feature fixes.
 */

/**
 * True if `betterAuthId` may create an entity in `workspaceId`. Platform admins
 * may create anywhere (incl. global); a null `workspaceId` is global and so is
 * platform-admin-only.
 */
export async function canCreateEntity(
  payload: Payload,
  betterAuthId: string | null | undefined,
  isPlatformAdmin: boolean,
  workspaceId: string | null,
): Promise<boolean> {
  if (isPlatformAdmin) return true
  if (!workspaceId || !betterAuthId) return false
  return isWorkspaceMember(payload, betterAuthId, workspaceId)
}

/**
 * True if `betterAuthId` may edit `entity`. Same rule as create against the
 * entity's own workspace (active membership, any role; global ⇒ admin only).
 */
export async function canManageEntity(
  payload: Payload,
  betterAuthId: string | null | undefined,
  isPlatformAdmin: boolean,
  entity: { workspaceId: string | null },
): Promise<boolean> {
  return canCreateEntity(payload, betterAuthId, isPlatformAdmin, entity.workspaceId)
}

/**
 * True if `betterAuthId` may delete `entity`. Requires the entity to be manual
 * AND the caller to be a platform admin or workspace owner/admin. Projected
 * entities (`sourceType !== 'manual'`) are never deletable — even for admins.
 */
export async function canDeleteEntity(
  payload: Payload,
  betterAuthId: string | null | undefined,
  isPlatformAdmin: boolean,
  entity: { workspaceId: string | null; sourceType: string },
): Promise<boolean> {
  if (entity.sourceType !== 'manual') return false
  if (isPlatformAdmin) return true
  if (!entity.workspaceId || !betterAuthId) return false
  return isWorkspaceAdminOrOwner(payload, betterAuthId, entity.workspaceId)
}

/**
 * Workspace ids the user is an active member of (any role) — the set they can
 * create/manage entities in. Reuses the shared membership helper. Returns [] for
 * a missing id.
 */
export async function getManageableWorkspaceIds(
  payload: Payload,
  betterAuthId: string | null | undefined,
): Promise<string[]> {
  if (!betterAuthId) return []
  return getMemberWorkspaceIds(payload, betterAuthId)
}

/**
 * True if `entityId` references an existing catalog entity of kind `team`. Used
 * to validate an `owner` pointer before persisting it — ownership is keyed to a
 * team entity (the Cortex/Backstage pattern), so a non-team or missing id is
 * rejected. Missing rows (findByID throws) are treated as invalid.
 */
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
