import type { Access, FieldAccess } from 'payload'
import { isPlatformAdmin } from '@/lib/access/workspace-access'
import { coMemberBetterAuthIds, workspaceIdsFor } from './membership'

/**
 * Access rules for the `users` collection.
 *
 * Payload fills any missing create/read/update/delete with "any authenticated
 * user", and `role` / `status` had no field access, so a logged-in user could
 * PATCH /api/users/<self> {role:'super_admin'}. These rules mirror the policy
 * matrix of the platform Users page (app/(frontend)/platform/users/policy.ts):
 *
 *   - a super_admin manages anyone and is the only one who can grant admin /
 *     super_admin or delete users;
 *   - an admin manages regular users only and may only assign role `user`;
 *   - a regular user may edit their own non-privileged fields.
 *
 * Server-side flows (setup, register, invite, self-heal, platform actions,
 * approval hook) use the Local API with its default `overrideAccess: true`, so
 * none of this applies to them.
 */

type Roleish = { id?: unknown; role?: unknown } | null | undefined

const sameId = (a: unknown, b: unknown) => a != null && b != null && String(a) === String(b)

const isSuperAdmin = (user: Roleish) => user?.role === 'super_admin'

/** Can this admin/super_admin manage a target with `targetRole`? (policy.canManageTarget) */
function canManage(actor: Roleish, targetRole: unknown): boolean {
  if (isSuperAdmin(actor)) return true
  if (actor?.role === 'admin') return (targetRole ?? 'user') === 'user'
  return false
}

export const usersCreate: Access = ({ req: { user } }) => isPlatformAdmin(user)

export const usersDelete: Access = ({ req: { user } }) => isSuperAdmin(user)

export const usersUpdate: Access = async ({ req: { user, payload }, id }) => {
  if (!user || !id) return false
  if (isSuperAdmin(user)) return true
  // Self-edits are allowed here; privileged fields are blocked per field below.
  if (sameId(user.id, id)) return true
  if (user.role !== 'admin') return false
  try {
    const target = await payload.findByID({ collection: 'users', id, depth: 0, overrideAccess: true })
    return canManage(user, target.role)
  } catch {
    return false
  }
}

/**
 * Read scope. Workspace UIs populate author / assignee / member names through
 * `relationTo: 'users'` fields, and Payload applies this read rule to those
 * populations, so a self-only rule would blank every author name. Instead a
 * user may read themselves and the people they share an active workspace with
 * (never other tenants). Privileged fields are further limited by
 * `adminOrSelfFieldRead`.
 */
// Accepted limits: the co-member set is recomputed per request (uncached) and
// capped at 10k membership docs by coMemberBetterAuthIds. Follow-up: cache per
// request / move to a join once workspaces outgrow that.
export const usersRead: Access = async ({ req: { user, payload } }) => {
  if (!user) return false
  if (isPlatformAdmin(user)) return true
  const self = { id: { equals: String(user.id) } }
  const betterAuthId = (user as { betterAuthId?: string | null }).betterAuthId
  if (!betterAuthId) return self
  const workspaceIds = await workspaceIdsFor(payload, betterAuthId, 'member')
  const coMembers = await coMemberBetterAuthIds(payload, workspaceIds)
  if (coMembers.length === 0) return self
  return { or: [self, { betterAuthId: { in: coMembers } }] }
}

/** Field write reserved for super_admin (email, betterAuthId: identity keys). */
export const superAdminFieldWrite: FieldAccess = ({ req: { user } }) => isSuperAdmin(user)

/** Field read: the doc's owner or a platform admin (approval/privilege metadata). */
export const adminOrSelfFieldRead: FieldAccess = ({ req: { user }, id, doc }) => {
  if (!user) return false
  if (isPlatformAdmin(user)) return true
  return sameId(user.id, id ?? (doc as Roleish)?.id)
}

/**
 * Field write on update for privilege / approval fields (`role`, `status`,
 * `betterAuthId`, ...). Nobody edits their own; super_admin edits anyone; an
 * admin edits regular users only. Pass `assignsRole` for the `role` field so an
 * admin can only assign `user` (policy.canAssignRole).
 */
export function privilegedFieldUpdate(options: { assignsRole?: boolean } = {}): FieldAccess {
  return ({ req: { user }, id, doc, siblingData }) => {
    if (!user) return false
    if (isSuperAdmin(user)) return true
    if (user.role !== 'admin') return false
    if (sameId(user.id, id ?? (doc as Roleish)?.id)) return false
    if (!canManage(user, (doc as Roleish)?.role)) return false
    if (options.assignsRole) {
      const next = (siblingData as { role?: unknown } | undefined)?.role
      return next === undefined || next === 'user'
    }
    return true
  }
}

/** Field write on create (the collection `create` rule already requires a platform admin). */
export function privilegedFieldCreate(options: { assignsRole?: boolean } = {}): FieldAccess {
  return ({ req: { user }, siblingData }) => {
    if (!user) return false
    if (isSuperAdmin(user)) return true
    if (user.role !== 'admin') return false
    if (options.assignsRole) {
      const next = (siblingData as { role?: unknown } | undefined)?.role
      return next === undefined || next === 'user'
    }
    return true
  }
}
