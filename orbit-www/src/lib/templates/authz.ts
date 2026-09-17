import 'server-only'
import type { Payload } from 'payload'
import { can, ALL_ROLES, MANAGE_ROLES } from '@/lib/authz/policy'

/**
 * @deprecated Phase C shim over `@/lib/authz`; deleted once consumers migrate
 * (#135). `userId` is the Better-Auth id; `isPayloadAdmin` is
 * `actor.isPlatformAdmin`.
 *
 *   manage  → workspace owner/admin
 *   run     → any active member
 *   publish → owner/admin for `workspace` visibility; platform admin for
 *             `shared`/`public` (also enforced by the collection hook and
 *             `lib/scaffolder/versions.ts`).
 *   approve → owner/admin, or listed in the step's `approvers` by id/email.
 */

async function hasRole(payload: Payload, userId: string, workspaceId: string, roles: readonly ('owner' | 'admin' | 'member')[]) {
  const d = await can(
    payload,
    { payloadId: null, betterAuthId: userId, isPlatformAdmin: false },
    'manage',
    { kind: 'workspace', id: workspaceId, roles },
  )
  return d.allowed
}

export async function canManageTemplateDefinitions(
  payload: Payload,
  userId: string | undefined | null,
  workspaceId: string | undefined | null,
  isPayloadAdmin = false,
): Promise<boolean> {
  if (isPayloadAdmin) return true
  if (!userId || !workspaceId) return false
  return hasRole(payload, userId, workspaceId, MANAGE_ROLES)
}

export async function canRunTemplateDefinition(
  payload: Payload,
  userId: string | undefined | null,
  workspaceId: string | undefined | null,
  isPayloadAdmin = false,
): Promise<boolean> {
  if (isPayloadAdmin) return true
  if (!userId || !workspaceId) return false
  return hasRole(payload, userId, workspaceId, ALL_ROLES)
}

export async function canApproveScaffolderStep(
  payload: Payload,
  userId: string | undefined | null,
  userEmail: string | undefined | null,
  workspaceId: string | undefined | null,
  approvers: string[] | undefined | null,
  isPayloadAdmin = false,
): Promise<boolean> {
  if (isPayloadAdmin) return true
  if (!userId) return false
  const listed = (approvers ?? []).some(
    (a) => a === userId || (userEmail && a.toLowerCase() === userEmail.toLowerCase()),
  )
  if (listed) return true
  if (!workspaceId) return false
  return hasRole(payload, userId, workspaceId, MANAGE_ROLES)
}

export type TemplateVisibility = 'workspace' | 'shared' | 'public' | undefined | null

export async function canPublishTemplateDefinition(
  payload: Payload,
  userId: string | undefined | null,
  workspaceId: string | undefined | null,
  visibility: TemplateVisibility,
  isPayloadAdmin = false,
): Promise<boolean> {
  if (isPayloadAdmin) return true
  if (!userId || !workspaceId) return false
  if (!(await hasRole(payload, userId, workspaceId, MANAGE_ROLES))) return false
  return !(visibility === 'shared' || visibility === 'public')
}
