import 'server-only'
import type { Payload } from 'payload'
import { can, ALL_ROLES, MANAGE_ROLES } from '@/lib/authz/policy'

/**
 * @deprecated Phase C shim. Call `authorize()` / `check()` from `@/lib/authz`
 * directly; this file is deleted once its consumers are migrated (#135).
 *
 * `userId` is the caller's Better-Auth id; `isPayloadAdmin` is
 * `actor.isPlatformAdmin`. Policy: manage = owner/admin, run = any member.
 */

const principal = (userId: string | null | undefined, isPlatformAdmin: boolean) => ({
  payloadId: null,
  betterAuthId: userId ?? null,
  isPlatformAdmin,
})

/** May the user define/edit Actions in this workspace? (owner/admin) */
export async function canManageActions(
  payload: Payload,
  userId: string | undefined | null,
  workspaceId: string | undefined | null,
  isPayloadAdmin = false,
): Promise<boolean> {
  if (isPayloadAdmin) return true
  if (!userId || !workspaceId) return false
  return (await can(payload, principal(userId, false), 'manage', { kind: 'workspace', id: workspaceId, roles: MANAGE_ROLES })).allowed
}

/** May the user run Actions in this workspace? (any active member) */
export async function canRunActions(
  payload: Payload,
  userId: string | undefined | null,
  workspaceId: string | undefined | null,
  isPayloadAdmin = false,
): Promise<boolean> {
  if (isPayloadAdmin) return true
  if (!userId || !workspaceId) return false
  return (await can(payload, principal(userId, false), 'create', { kind: 'workspace', id: workspaceId, roles: ALL_ROLES })).allowed
}

/** May the user approve a run gated by `policy`? */
export async function canApproveActionRun(
  payload: Payload,
  userId: string | undefined | null,
  workspaceId: string | undefined | null,
  policy: 'none' | 'workspace-admin' | 'platform-admin',
  isPayloadAdmin = false,
): Promise<boolean> {
  if (policy === 'none') return true
  if (isPayloadAdmin) return true
  if (policy === 'platform-admin') return false
  return canManageActions(payload, userId, workspaceId, false)
}
