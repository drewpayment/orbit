import type { Access, Payload, Where } from 'payload'
import { isPlatformAdmin } from '@/lib/access/workspace-access'
import { workspaceIdsFor, type MembershipScope, type WorkspaceRole } from './membership'
import { can, principalOf, type Principal } from './policy'

/**
 * Payload `Access` adapters over the policy in `./policy.ts`.
 *
 * Collections import from `@/lib/authz/payload` (NOT from `@/lib/authz`, whose
 * index pulls in `next/headers` via the Actor and would break scripts that load
 * `payload.config.ts`). `@/lib/access/collection-access` re-exports the original
 * five factories from here with unchanged signatures.
 *
 * Every adapter: `!user` ⇒ false first; platform admin ⇒ allow; membership keyed
 * on the Better-Auth id; ownership keyed on the Payload id; missing ids ⇒ deny,
 * never throw. Read adapters return `Where` filters, never fetch-then-filter.
 *
 * Internal writeback paths (server actions, `/api/internal/**`, Temporal) run
 * with `overrideAccess: true` and bypass all of this.
 */

/** Normalize a relationship value (`string` id or populated `{ id }`) to its id. */
export function relationId(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (typeof value === 'object' && 'id' in (value as Record<string, unknown>)) {
    const id = (value as { id?: unknown }).id
    return typeof id === 'string' ? id : typeof id === 'number' ? String(id) : null
  }
  return null
}

/** Platform admin or deny. For system/global collections and system rows. */
export const adminOnly: Access = ({ req: { user } }) => isPlatformAdmin(user)

/**
 * Any authenticated user. Use ONLY for org-wide, non-tenant reference data
 * (catalog read surface, provider/pattern definitions, launch templates). The
 * name exists so `grep authenticatedOnly` lists every such decision.
 */
export const authenticatedOnly: Access = ({ req: { user } }) => !!user

/** No end-user access; rows are written by system paths with overrideAccess. */
export const denyAll: Access = () => false

/** A `Where` that matches nothing (Payload treats `in: []` inconsistently across adapters). */
export const NOTHING: Where = { id: { equals: '__authz_no_match__' } }

/** Resolve the workspace id a create is bound to from the incoming `data`. */
export type DataWorkspaceResolver = (args: {
  data: unknown
  payload: Payload
}) => string | null | Promise<string | null>

/** Resolve the workspace id an existing doc belongs to. */
export type DocWorkspaceResolver = (args: {
  doc: unknown
  payload: Payload
}) => string | null | Promise<string | null>

/**
 * One hop of an indirect workspace join for reads. The first hop's `field`
 * defaults to `'workspace'`; each later hop's `field` defaults to the previous
 * hop's `on`. The final hop's `on` is the field on the target collection.
 *
 * Deployments (deployment.app → apps.workspace):
 *   via: [{ collection: 'apps', on: 'app' }]
 * PageLinks (link.fromPage → pages.knowledgeSpace → spaces.workspace):
 *   via: [{ collection: 'knowledge-spaces', on: 'knowledgeSpace' },
 *         { collection: 'knowledge-pages', on: 'fromPage' }]
 */
export interface ReadHop {
  collection: string
  /** Field on `collection` that points at the previous set (default: see above). */
  field?: string
  /** Field on the next hop / target doc that points at this collection. */
  on: string
  /** Page size for the hop query (default 1000). */
  limit?: number
}

export interface WorkspaceScopedReadOptions {
  /** Single workspace relationship field (default `'workspace'`). */
  field?: string
  /** OR the filter across several workspace fields (overrides `field`). */
  fields?: string[]
  /** Membership set: `'member'` (default), `'manage'` (owner/admin), `'owner'`. */
  scope?: MembershipScope
  /** Indirect join: resolve member workspaces through parent collections. */
  via?: ReadHop[]
  /** Also match rows whose workspace field is unset (built-in / global rows). */
  includeGlobal?: boolean
  /** Extra OR branches (visibility, sharedWith, ownership …). */
  extend?: (ctx: { principal: Principal; workspaceIds: string[] }) => Where[]
  /** What an unauthenticated caller may read (default: nothing). */
  anonymous?: Where
  /** Platform admins read everything (default true). */
  adminBypass?: boolean
}

/**
 * Read filter: platform admin ⇒ `true`; otherwise a `Where` limiting results to
 * the caller's workspaces (direct field, OR over fields, or via parent hops),
 * optionally extended with global rows and custom OR branches.
 */
export function workspaceScopedRead(options: WorkspaceScopedReadOptions = {}): Access {
  const {
    field = 'workspace',
    fields,
    scope = 'member',
    via,
    includeGlobal = false,
    extend,
    anonymous,
    adminBypass = true,
  } = options
  const targetFields = fields && fields.length > 0 ? fields : [field]

  return async ({ req: { user, payload } }) => {
    if (!user) return anonymous ?? false
    if (adminBypass && isPlatformAdmin(user)) return true
    const principal = principalOf(user)!
    const workspaceIds = principal.betterAuthId
      ? await workspaceIdsFor(payload, principal.betterAuthId, scope)
      : []

    const branches: Where[] = []

    if (via && via.length > 0) {
      if (workspaceIds.length === 0) {
        branches.push(NOTHING)
      } else {
        let ids = workspaceIds
        let matchField = 'workspace'
        let onField = via[via.length - 1].on
        for (const hop of via) {
          matchField = hop.field ?? matchField
          const rows = await payload.find({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            collection: hop.collection as any,
            where: { [matchField]: { in: ids } },
            limit: hop.limit ?? 1000,
            depth: 0,
            overrideAccess: true,
          })
          ids = rows.docs.map((d) => String((d as { id: unknown }).id))
          matchField = hop.on
          onField = hop.on
          if (ids.length === 0) break
        }
        branches.push(ids.length > 0 ? { [onField]: { in: ids } } : NOTHING)
      }
    } else if (targetFields.length === 1) {
      branches.push({ [targetFields[0]]: { in: workspaceIds } })
    } else {
      branches.push(...targetFields.map((f) => ({ [f]: { in: workspaceIds } }) as Where))
    }

    if (includeGlobal) branches.push({ [field]: { exists: false } })
    if (extend) branches.push(...extend({ principal, workspaceIds }))

    return branches.length === 1 ? branches[0] : ({ or: branches } as Where)
  }
}

export interface CreateAccessOptions {
  /** Workspace relationship field on the incoming doc (default `'workspace'`). */
  field?: string
  /** Resolve the target workspace from `data` (indirect relations). */
  resolveWorkspace?: DataWorkspaceResolver
  /** Deny outright when this returns false (e.g. `data.isBuiltIn`). Runs before the admin bypass. */
  guard?: (data: unknown) => boolean
}

function createAccess(roles: readonly string[] | null, options: CreateAccessOptions): Access {
  const { field = 'workspace', resolveWorkspace, guard } = options
  return async ({ req: { user, payload }, data }) => {
    if (!user) return false
    if (guard && !guard(data)) return false
    if (isPlatformAdmin(user)) return true
    const principal = principalOf(user)!
    const workspaceId = resolveWorkspace
      ? await resolveWorkspace({ data, payload })
      : relationId((data as Record<string, unknown> | undefined)?.[field])
    if (!workspaceId) return false
    const decision = await can(payload, principal, 'create', {
      kind: 'workspace',
      id: workspaceId,
      roles: (roles as readonly WorkspaceRole[] | null) ?? undefined,
    })
    return decision.allowed
  }
}

/** Create allowed for any active member of the target workspace named in `data`. */
export function memberCreate(options: CreateAccessOptions = {}): Access {
  return createAccess(null, options)
}

/** Create allowed only for an active member holding one of `roles`. */
/** `roles` is `string[]` for source compatibility; values must be workspace roles. */
export function manageCreate(roles: readonly string[], options: CreateAccessOptions = {}): Access {
  return createAccess(roles, options)
}

export interface DocMutateOptions {
  /** Workspace relationship field on the loaded doc (default `'workspace'`). */
  field?: string
  /** Resolve the doc's workspace via a parent relation (indirect). */
  resolveWorkspace?: DocWorkspaceResolver
  /**
   * A `relationTo: 'users'` field on the doc (e.g. `author`, `createdBy`). Its
   * owner is allowed regardless of workspace role. Compared on the Payload id.
   */
  ownerField?: string
  /** Deny outright when this returns false (e.g. built-in rows, projected rows). Runs before the admin bypass. */
  guard?: (doc: Record<string, unknown>) => boolean
  /** Depth for the doc load (default 0). */
  depth?: number
}

/**
 * Update/delete gate: load the doc, resolve its workspace, require one of
 * `roles` (or ownership via `ownerField`). Tenant identity is immutable for
 * non-admin callers: an update that moves the doc to another workspace is denied.
 */
export function docWorkspaceMutate(
  slug: string,
  roles: readonly string[],
  options: DocMutateOptions = {},
): Access {
  const { field = 'workspace', resolveWorkspace, ownerField, guard, depth = 0 } = options
  return async ({ req: { user, payload }, id, data }) => {
    if (!user || !id) return false
    const principal = principalOf(user)!

    // Guards apply to everyone, including admins (built-in rows are immutable).
    let doc: Record<string, unknown> | null = null
    if (guard || !principal.isPlatformAdmin) {
      try {
        doc = (await payload.findByID({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          collection: slug as any,
          id: id as string,
          depth,
          overrideAccess: true,
        })) as Record<string, unknown>
      } catch {
        return false
      }
      if (guard && !guard(doc)) return false
    }
    if (principal.isPlatformAdmin) return true

    const workspaceId = resolveWorkspace
      ? await resolveWorkspace({ doc, payload })
      : relationId(doc![field])

    if (!resolveWorkspace && workspaceId && data && Object.prototype.hasOwnProperty.call(data, field)) {
      const requested = relationId((data as Record<string, unknown>)[field])
      if (!requested || requested !== workspaceId) return false
    }

    const decision = await can(payload, principal, 'update', {
      kind: 'doc',
      workspaceId,
      ownerPayloadId: ownerField ? relationId(doc![ownerField]) : null,
      roles: roles as readonly WorkspaceRole[],
    })
    return decision.allowed
  }
}
