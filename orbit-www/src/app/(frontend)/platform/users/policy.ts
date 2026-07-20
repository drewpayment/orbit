/**
 * Pure authorization helpers for platform user management.
 *
 * These encode the policy matrix from
 * docs/plans/2026-07-11-platform-user-management.md. They are intentionally
 * side-effect free so the matrix can be tested exhaustively; the last-super_admin
 * rule needs a live count and is enforced in the server actions, not here.
 */

export type UserRole = 'user' | 'admin' | 'super_admin'

/** Discriminated result returned by every server action (contract with the UI). */
export type ActionResult<T = void> = { ok: true; data?: T } | { ok: false; error: string }

/**
 * Can `actorRole` manage (edit / approve / deactivate / etc.) a target with
 * `targetRole`? An admin may only touch regular users; a super_admin may manage
 * anyone; a regular user manages nobody.
 */
export function canManageTarget(actorRole: UserRole, targetRole: UserRole): boolean {
  if (actorRole === 'super_admin') return true
  if (actorRole === 'admin') return targetRole === 'user'
  return false
}

/**
 * Can `actorRole` grant/assign `role` to a user? Only a super_admin may hand out
 * `admin` or `super_admin`; an admin may only assign `user`.
 */
export function canAssignRole(actorRole: UserRole, role: UserRole): boolean {
  if (actorRole === 'super_admin') return true
  if (actorRole === 'admin') return role === 'user'
  return false
}
