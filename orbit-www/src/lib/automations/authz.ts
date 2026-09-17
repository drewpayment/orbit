import 'server-only'
import type { Payload } from 'payload'
import { can, MANAGE_ROLES } from '@/lib/authz/policy'

/**
 * @deprecated Phase C shim over `@/lib/authz`; deleted once consumers migrate
 * (#135). Managing automations = workspace owner/admin. `userId` is the
 * Better-Auth id.
 */
export async function canManageAutomations(
  payload: Payload,
  userId: string | undefined | null,
  workspaceId: string | undefined | null,
  isPayloadAdmin = false,
): Promise<boolean> {
  if (isPayloadAdmin) return true
  if (!userId || !workspaceId) return false
  const d = await can(
    payload,
    { payloadId: null, betterAuthId: userId, isPlatformAdmin: false },
    'manage',
    { kind: 'workspace', id: workspaceId, roles: MANAGE_ROLES },
  )
  return d.allowed
}
