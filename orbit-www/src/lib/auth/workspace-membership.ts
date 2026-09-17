import type { Payload } from 'payload'
import { membershipRole } from '@/lib/authz/membership'

/**
 * @deprecated Phase C shim. Use `authorize('read', { kind: 'workspace', id })`
 * from `@/lib/authz`; deleted once consumers migrate (#135).
 */
export class WorkspaceMembershipError extends Error {
  constructor(message = 'Not a member of this workspace') {
    super(message)
    this.name = 'WorkspaceMembershipError'
  }
}

/** Assert `betterAuthId` is an active member of `workspaceId`, else throw. */
export async function requireWorkspaceMembership(
  payload: Payload,
  betterAuthId: string,
  workspaceId: string,
): Promise<void> {
  const role = await membershipRole(payload, betterAuthId, workspaceId)
  if (!role) throw new WorkspaceMembershipError()
}

export async function checkWorkspaceMembership(
  payload: Payload,
  betterAuthId: string,
  workspaceId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireWorkspaceMembership(payload, betterAuthId, workspaceId)
    return { ok: true }
  } catch {
    return { ok: false, error: 'Not a member of this workspace' }
  }
}
