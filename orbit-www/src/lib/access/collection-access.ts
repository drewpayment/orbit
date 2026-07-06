import type { Access, Payload, Where } from 'payload'
import {
  isPlatformAdmin,
  isWorkspaceMember,
  getWorkspaceMembership,
  getMemberWorkspaceIds,
  getAdminOrOwnerWorkspaceIds,
} from './workspace-access'

/**
 * Composable Payload `Access` factories — the SINGLE source of truth for
 * workspace-scoped collection access (Collection Access-Control Remediation,
 * docs/plans/2026-07-02-collection-access-control-remediation.md, issue #63).
 * Built on the membership helpers in `./workspace-access`, all of which key on
 * the caller's **Better-Auth** id.
 *
 * Security model (cross-cutting, non-negotiable):
 *  - `!user` ⇒ `false`, always, first line.
 *  - The ONLY privilege bypass is `isPlatformAdmin(user)` (role ∈
 *    super_admin/admin). A `users`-collection account with `role: 'user'` gets
 *    NO bypass — the `user.collection === 'users'` short-circuit was the bug.
 *  - Every `workspace-members` lookup passes `user.betterAuthId` (a TEXT field
 *    holding the Better-Auth id), NEVER the Payload `user.id`. A missing
 *    `betterAuthId` (pre-first-login edge) is treated as a non-member and never
 *    throws.
 *  - Read factories return `Where` filters (never fetch-all-then-filter); admin
 *    returns `true`. Create/mutate resolve the target workspace and deny when it
 *    is missing/null for non-admins.
 *
 * Internal writeback paths (server actions, `/api/internal/**`, Temporal) run
 * with `overrideAccess: true` and bypass every factory here.
 */

/** The Better-Auth id a membership query must key on; null when unavailable. */
function betterAuthIdOf(user: unknown): string | null {
  const id = (user as { betterAuthId?: unknown } | null | undefined)?.betterAuthId
  return typeof id === 'string' && id.length > 0 ? id : null
}

/** Normalize a relationship value (`string` id or populated `{ id }`) to its id. */
function relationId(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value === 'object' && 'id' in (value as Record<string, unknown>)) {
    const id = (value as { id?: unknown }).id
    return typeof id === 'string' ? id : null
  }
  return null
}

/** True if `betterAuthId` is an active member of `workspaceId` with one of `roles`. */
async function hasWorkspaceRole(
  payload: Payload,
  betterAuthId: string,
  workspaceId: string,
  roles: string[],
): Promise<boolean> {
  const membership = await getWorkspaceMembership(payload, betterAuthId, workspaceId)
  if (!membership) return false
  return roles.includes(membership.role as string)
}

/**
 * Resolves the workspace id a create is bound to from the incoming `data`.
 * Defaults to reading a direct relationship field; pass a custom resolver for
 * indirect relations (resolve via a parent record with `payload`).
 */
export type DataWorkspaceResolver = (args: {
  data: unknown
  payload: Payload
}) => string | null | Promise<string | null>

/**
 * Resolves the workspace id an existing doc belongs to. Defaults to a direct
 * `workspace` field; pass a custom resolver for indirect relations (e.g.
 * KafkaOffsetCheckpoints: virtualCluster → application → workspace).
 */
export type DocWorkspaceResolver = (args: {
  doc: unknown
  payload: Payload
}) => string | null | Promise<string | null>

/** Platform admin or deny. Use for system/global collections and system rows. */
export const adminOnly: Access = ({ req: { user } }) => isPlatformAdmin(user)

export interface WorkspaceScopedReadOptions {
  /** Single workspace relationship field (default `'workspace'`). */
  field?: string
  /** OR the filter across several workspace fields (overrides `field`). */
  fields?: string[]
  /**
   * Which membership set the caller reads: `'member'` (any active role,
   * default) or `'manage'` (owner/admin workspaces only).
   */
  scope?: 'member' | 'manage'
}

/**
 * Read filter: platform admin ⇒ `true`; otherwise a `Where` limiting results to
 * the caller's workspaces. Supports a custom field, an OR over multiple fields,
 * and a role-restricted (`manage`) variant.
 */
export function workspaceScopedRead(options: WorkspaceScopedReadOptions = {}): Access {
  const { field = 'workspace', fields, scope = 'member' } = options
  const targetFields = fields && fields.length > 0 ? fields : [field]
  return async ({ req: { user, payload } }) => {
    if (!user) return false
    if (isPlatformAdmin(user)) return true
    const betterAuthId = betterAuthIdOf(user)
    const ids = betterAuthId
      ? scope === 'manage'
        ? await getAdminOrOwnerWorkspaceIds(payload, betterAuthId)
        : await getMemberWorkspaceIds(payload, betterAuthId)
      : []
    if (targetFields.length === 1) {
      return { [targetFields[0]]: { in: ids } } as Where
    }
    return { or: targetFields.map((f) => ({ [f]: { in: ids } })) } as Where
  }
}

export interface CreateAccessOptions {
  /** Workspace relationship field on the incoming doc (default `'workspace'`). */
  field?: string
  /** Resolve the target workspace from `data` (indirect relations). */
  resolveWorkspace?: DataWorkspaceResolver
}

function createAccess(roles: string[] | null, options: CreateAccessOptions): Access {
  const { field = 'workspace', resolveWorkspace } = options
  return async ({ req: { user, payload }, data }) => {
    if (!user) return false
    if (isPlatformAdmin(user)) return true
    const betterAuthId = betterAuthIdOf(user)
    if (!betterAuthId) return false
    const workspaceId = resolveWorkspace
      ? await resolveWorkspace({ data, payload })
      : relationId((data as Record<string, unknown> | undefined)?.[field])
    if (!workspaceId) return false
    return roles === null
      ? isWorkspaceMember(payload, betterAuthId, workspaceId)
      : hasWorkspaceRole(payload, betterAuthId, workspaceId, roles)
  }
}

/**
 * Create allowed for any active member (any role) of the target workspace named
 * in `data`. Missing/null workspace ⇒ deny unless platform admin.
 */
export function memberCreate(options: CreateAccessOptions = {}): Access {
  return createAccess(null, options)
}

/**
 * Create allowed only for an active member of the target workspace holding one
 * of `roles` (e.g. `['owner', 'admin']`). Missing/null workspace ⇒ deny unless
 * platform admin.
 */
export function manageCreate(roles: string[], options: CreateAccessOptions = {}): Access {
  return createAccess(roles, options)
}

export interface DocMutateOptions {
  /** Workspace relationship field on the loaded doc (default `'workspace'`). */
  field?: string
  /** Resolve the doc's workspace via a parent relation (indirect). */
  resolveWorkspace?: DocWorkspaceResolver
}

/**
 * Update/delete gate: platform admin ⇒ allow; otherwise load the doc (depth 0,
 * overrideAccess), resolve its workspace, and require active membership with one
 * of `roles`. Supply `resolveWorkspace` for docs whose workspace lives on a
 * parent record. A missing doc/workspace ⇒ deny.
 */
export function docWorkspaceMutate(
  slug: string,
  roles: string[],
  options: DocMutateOptions = {},
): Access {
  const { field = 'workspace', resolveWorkspace } = options
  return async ({ req: { user, payload }, id }) => {
    if (!user || !id) return false
    if (isPlatformAdmin(user)) return true
    const betterAuthId = betterAuthIdOf(user)
    if (!betterAuthId) return false
    let doc: Record<string, unknown>
    try {
      doc = (await payload.findByID({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        collection: slug as any,
        id: id as string,
        depth: 0,
        overrideAccess: true,
      })) as Record<string, unknown>
    } catch {
      return false
    }
    const workspaceId = resolveWorkspace
      ? await resolveWorkspace({ doc, payload })
      : relationId(doc[field])
    if (!workspaceId) return false
    return hasWorkspaceRole(payload, betterAuthId, workspaceId, roles)
  }
}
