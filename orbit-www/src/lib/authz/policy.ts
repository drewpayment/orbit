import type { Payload } from 'payload'
import { isPlatformAdmin } from '@/lib/access/workspace-access'
import { membershipRole, type WorkspaceRole } from './membership'

/**
 * The policy: the single place that says who may do what.
 *
 * Security model (cross-cutting, non-negotiable, inherited from issue #63):
 *  - No principal ⇒ deny, always, first line.
 *  - The ONLY privilege bypass is platform admin (`users.role` ∈ super_admin/admin).
 *  - Workspace decisions key on the Better-Auth id (`workspace-members.user`);
 *    ownership decisions key on the Payload id (`relationTo: 'users'` fields).
 *    A `Principal` carries both by name so a rule cannot pick the wrong one by
 *    accident. A missing Better-Auth id is a non-member, never an error.
 *
 * NOTE: no `server-only` import here — reachable from `payload.config.ts`.
 */

export const ALL_ROLES: readonly WorkspaceRole[] = ['owner', 'admin', 'member']
export const MANAGE_ROLES: readonly WorkspaceRole[] = ['owner', 'admin']
export const OWNER_ROLES: readonly WorkspaceRole[] = ['owner']

export type Verb = 'read' | 'create' | 'update' | 'delete' | 'manage'

/** Roles a verb needs by default. Collections may pass explicit roles instead. */
export function defaultRoles(verb: Verb): readonly WorkspaceRole[] {
  return verb === 'read' || verb === 'create' ? ALL_ROLES : MANAGE_ROLES
}

/**
 * Whoever is asking. Built from an `Actor` (server code) or from Payload's
 * `req.user` (collection access rules) via `principalOf`.
 */
export type Principal = {
  payloadId: string | null
  betterAuthId: string | null
  isPlatformAdmin: boolean
}

/** Shape an Actor or a Payload `req.user` into a Principal; null when unauthenticated. */
export function principalOf(user: unknown): Principal | null {
  if (!user || typeof user !== 'object') return null
  const u = user as Record<string, unknown>
  // Actor shape (lib/authz/actor.ts)
  if (typeof u.payloadId === 'string' && typeof u.betterAuthId === 'string') {
    return {
      payloadId: u.payloadId,
      betterAuthId: u.betterAuthId,
      isPlatformAdmin: u.isPlatformAdmin === true,
    }
  }
  // Payload req.user shape (users doc)
  const betterAuthId = typeof u.betterAuthId === 'string' && u.betterAuthId.length > 0 ? u.betterAuthId : null
  const payloadId = typeof u.id === 'string' || typeof u.id === 'number' ? String(u.id) : null
  return { payloadId, betterAuthId, isPlatformAdmin: isPlatformAdmin(user) }
}

export type Resource =
  | { kind: 'platform' }
  | {
      kind: 'workspace'
      id: string
      /** Roles that satisfy the verb; defaults to `defaultRoles(verb)`. */
      roles?: readonly WorkspaceRole[]
    }
  | {
      /**
       * A document inside a workspace. `ownerPayloadId` (from a `relationTo:
       * 'users'` field such as `author`/`createdBy`) grants the owner regardless
       * of workspace role.
       */
      kind: 'doc'
      workspaceId: string | null
      ownerPayloadId?: string | null
      roles?: readonly WorkspaceRole[]
    }

export type Decision = { allowed: boolean; reason: string }

const allow = (reason: string): Decision => ({ allowed: true, reason })
const deny = (reason: string): Decision => ({ allowed: false, reason })

/** Evaluate the policy. Never throws; a lookup failure is a deny. */
export async function can(
  payload: Payload,
  principal: Principal | null,
  verb: Verb,
  resource: Resource,
): Promise<Decision> {
  if (!principal) return deny('unauthenticated')
  if (principal.isPlatformAdmin) return allow('platform admin')

  switch (resource.kind) {
    case 'platform':
      return deny('platform admin required')

    case 'workspace':
      return workspaceDecision(payload, principal, resource.id, resource.roles ?? defaultRoles(verb))

    case 'doc': {
      if (resource.ownerPayloadId && principal.payloadId && resource.ownerPayloadId === principal.payloadId) {
        return allow('owner of the document')
      }
      if (!resource.workspaceId) return deny('global resource; platform admin required')
      return workspaceDecision(payload, principal, resource.workspaceId, resource.roles ?? defaultRoles(verb))
    }
  }
}

async function workspaceDecision(
  payload: Payload,
  principal: Principal,
  workspaceId: string,
  roles: readonly WorkspaceRole[],
): Promise<Decision> {
  if (!principal.betterAuthId) return deny('no membership identity')
  let role: WorkspaceRole | null
  try {
    role = await membershipRole(payload, principal.betterAuthId, workspaceId)
  } catch {
    return deny('membership lookup failed')
  }
  if (!role) return deny('not a member of this workspace')
  if (!roles.includes(role)) return deny(`requires workspace ${roles.join(' or ')}; you are ${role}`)
  return allow(`workspace ${role}`)
}
