'use server'

import { getPayload } from 'payload'
import type { Where } from 'payload'
import config from '@payload-config'
import { revalidatePath } from 'next/cache'
import { getPayloadUserFromSession } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/access/workspace-access'
import {
  canCreateEntity,
  canManageEntity,
  canDeleteEntity,
  getManageableWorkspaceIds,
  isTeamEntity,
} from '@/lib/catalog/entity-authz'
import {
  slugify,
  uniqueSlug,
  validateCreateInput,
  validateUpdatePatch,
  validateRelationInput,
  type CreateEntityInput,
  type UpdateEntityPatch,
  type RelationInput,
  type EntityFormOptions,
  type EntityOption,
} from '@/lib/catalog/entity-crud'
import type { EntityKind } from '@/collections/catalog/constants'
import type { CatalogEntity } from '@/payload-types'

/**
 * Catalog entity + relation authoring server actions (Catalog Entity CRUD,
 * docs/plans/2026-07-02-catalog-entity-crud.md, WP1).
 *
 * These are the primary write gate. Every mutation resolves the session,
 * enforces RBAC through `lib/catalog/entity-authz` (the single source of truth),
 * and then writes with `overrideAccess: true`. Identity comes from the session
 * (Better-Auth id + Payload role) — never from client-supplied ids. Validation
 * reuses the pure `lib/catalog/entity-crud` validators.
 */

type Payload = Awaited<ReturnType<typeof getPayload>>

interface CatalogSession {
  payload: Payload
  betterAuthId: string | undefined
  isAdmin: boolean
}

/** Resolve the caller's session or throw. */
async function requireSession(): Promise<CatalogSession> {
  const user = await getPayloadUserFromSession()
  if (!user) throw new Error('Not authenticated')
  const payload = await getPayload({ config })
  return {
    payload,
    betterAuthId: user.betterAuthId ?? undefined,
    isAdmin: isPlatformAdmin(user),
  }
}

/** Resolve a relationship value (populated or raw id) to its id, or null. */
function refId(ref: unknown): string | null {
  if (!ref) return null
  if (typeof ref === 'string') return ref
  if (typeof ref === 'object' && 'id' in (ref as Record<string, unknown>)) {
    return String((ref as { id: string }).id)
  }
  return null
}

/** Where-clause fragment matching a specific workspace, or the global (no-workspace) set. */
function workspaceClause(workspaceId: string | null): Where {
  return workspaceId ? { workspace: { equals: workspaceId } } : { workspace: { exists: false } }
}

/**
 * Compute a slug for `name` unique within its workspace scope (a null workspace
 * scopes against global entities). `excludeId` omits the entity being renamed
 * from the collision set.
 */
async function resolveUniqueSlug(
  payload: Payload,
  workspaceId: string | null,
  name: string,
  excludeId?: string,
): Promise<string> {
  const base = slugify(name) || 'entity'
  const existing = await payload.find({
    collection: 'catalog-entities',
    where: { and: [workspaceClause(workspaceId), { slug: { contains: base } }] },
    limit: 1000,
    depth: 0,
    overrideAccess: true,
  })
  const taken = existing.docs
    .filter((d) => d.id !== excludeId)
    .map((d) => d.slug)
    .filter((s): s is string => Boolean(s))
  return uniqueSlug(base, taken)
}

/** Revalidate the catalog + (when known) the owning workspace landing page. */
async function revalidateCatalog(payload: Payload, workspaceId: string | null, entityId?: string) {
  revalidatePath('/catalog')
  if (entityId) revalidatePath(`/catalog/${entityId}`)
  if (workspaceId) {
    try {
      const ws = await payload.findByID({
        collection: 'workspaces',
        id: workspaceId,
        depth: 0,
        overrideAccess: true,
      })
      if (ws?.slug) revalidatePath(`/workspaces/${ws.slug}`)
    } catch {
      // best-effort — a missing workspace just means no workspace page to revalidate.
    }
  }
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

/** Create a manual catalog entity. RBAC: platform admin or member of the target workspace. */
export async function createCatalogEntity(input: CreateEntityInput): Promise<{ id: string }> {
  const { payload, betterAuthId, isAdmin } = await requireSession()

  const validationError = validateCreateInput(input)
  if (validationError) throw new Error(validationError)

  const workspaceId = input.workspaceId ?? null
  if (!(await canCreateEntity(payload, betterAuthId, isAdmin, workspaceId))) {
    throw new Error('You do not have permission to create an entity here.')
  }

  // A supplied owner must reference an existing team entity (null/undefined = none).
  if (input.ownerId && !(await isTeamEntity(payload, input.ownerId))) {
    throw new Error('Owner must reference an existing team entity.')
  }

  const slug = await resolveUniqueSlug(payload, workspaceId, input.name)

  const created = await payload.create({
    collection: 'catalog-entities',
    data: {
      name: input.name.trim(),
      slug,
      kind: input.kind,
      source: { type: 'manual' as const },
      ...(workspaceId ? { workspace: workspaceId } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.lifecycle ? { lifecycle: input.lifecycle } : {}),
      ...(input.tier ? { tier: input.tier } : {}),
      ...(input.ownerId ? { owner: input.ownerId } : {}),
      ...(input.links ? { links: input.links } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    },
    overrideAccess: true,
  })

  await revalidateCatalog(payload, workspaceId, created.id)
  return { id: created.id }
}

/** Edit an entity. RBAC: manage rights on its workspace. Enforces field ownership. */
export async function updateCatalogEntity(id: string, patch: UpdateEntityPatch): Promise<void> {
  const { payload, betterAuthId, isAdmin } = await requireSession()

  const existing = (await payload.findByID({
    collection: 'catalog-entities',
    id,
    depth: 0,
    overrideAccess: true,
  })) as CatalogEntity

  const workspaceId = refId(existing.workspace)
  if (!(await canManageEntity(payload, betterAuthId, isAdmin, { workspaceId }))) {
    throw new Error('You do not have permission to edit this entity.')
  }

  const sourceType = existing.source?.type ?? 'manual'
  const validationError = validateUpdatePatch(sourceType, patch)
  if (validationError) throw new Error(validationError)

  // A supplied owner must reference an existing team entity. A null ownerId
  // (clearing the owner) is allowed and skips this check.
  if (patch.ownerId && !(await isTeamEntity(payload, patch.ownerId))) {
    throw new Error('Owner must reference an existing team entity.')
  }

  // Identity edits are only reachable for manual entities (validateUpdatePatch
  // rejects them for projected ones). A rename recomputes a unique slug.
  let nameFields: { name?: string; slug?: string | null } = {}
  if (patch.name !== undefined) {
    const name = patch.name.trim()
    const base = slugify(name)
    const slug =
      base === existing.slug ? existing.slug : await resolveUniqueSlug(payload, workspaceId, name, id)
    nameFields = { name, slug }
  }

  await payload.update({
    collection: 'catalog-entities',
    id,
    data: {
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.lifecycle !== undefined ? { lifecycle: patch.lifecycle } : {}),
      ...(patch.tier !== undefined ? { tier: patch.tier } : {}),
      ...(patch.ownerId !== undefined ? { owner: patch.ownerId } : {}),
      ...(patch.links !== undefined ? { links: patch.links } : {}),
      ...(patch.metadata !== undefined ? { metadata: patch.metadata } : {}),
      ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
      ...nameFields,
    },
    overrideAccess: true,
  })

  await revalidateCatalog(payload, workspaceId, id)
}

/** Delete a manual entity and every relation touching it. RBAC: owner/admin (or platform admin). */
export async function deleteCatalogEntity(id: string): Promise<void> {
  const { payload, betterAuthId, isAdmin } = await requireSession()

  const existing = (await payload.findByID({
    collection: 'catalog-entities',
    id,
    depth: 0,
    overrideAccess: true,
  })) as CatalogEntity

  const workspaceId = refId(existing.workspace)
  const sourceType = existing.source?.type ?? 'manual'
  if (!(await canDeleteEntity(payload, betterAuthId, isAdmin, { workspaceId, sourceType }))) {
    throw new Error('You do not have permission to delete this entity.')
  }

  // Cascade: remove relations referencing this entity in either direction, and
  // null out any owner pointers to it (deleting a team entity must not leave
  // dangling owner refs on the entities it owned). No skipAutomationEmit — an
  // ownership change is a real entity change worth emitting, and there is no
  // recursion risk (nulling owner triggers no owner-driven write back here).
  await payload.delete({
    collection: 'catalog-relations',
    where: { or: [{ from: { equals: id } }, { to: { equals: id } }] },
    overrideAccess: true,
  })
  await payload.update({
    collection: 'catalog-entities',
    where: { owner: { equals: id } },
    data: { owner: null },
    overrideAccess: true,
  })
  await payload.delete({
    collection: 'catalog-entities',
    id,
    overrideAccess: true,
  })

  await revalidateCatalog(payload, workspaceId)
}

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

/**
 * Create a typed relation `from --(type)--> to`. RBAC: manage rights on the
 * `from` entity. Validates the type + from≠to, dedupes on (workspace, from, to,
 * type), and derives the relation's workspace from the `from` entity.
 */
export async function createCatalogRelation(
  input: RelationInput,
): Promise<{ id: string }> {
  const { payload, betterAuthId, isAdmin } = await requireSession()

  const validationError = validateRelationInput(input)
  if (validationError) throw new Error(validationError)

  let fromEntity: CatalogEntity
  try {
    fromEntity = (await payload.findByID({
      collection: 'catalog-entities',
      id: input.fromId,
      depth: 0,
      overrideAccess: true,
    })) as CatalogEntity
  } catch {
    throw new Error('The source entity no longer exists.')
  }

  const workspaceId = refId(fromEntity.workspace)
  if (!(await canManageEntity(payload, betterAuthId, isAdmin, { workspaceId }))) {
    throw new Error('You do not have permission to add relations to this entity.')
  }

  // The target must exist (org-wide — any authenticated user can relate to any entity).
  try {
    await payload.findByID({
      collection: 'catalog-entities',
      id: input.toId,
      depth: 0,
      overrideAccess: true,
    })
  } catch {
    throw new Error('The target entity no longer exists.')
  }

  // Dedupe on (workspace, from, to, type).
  const duplicate = await payload.find({
    collection: 'catalog-relations',
    where: {
      and: [
        workspaceClause(workspaceId),
        { from: { equals: input.fromId } },
        { to: { equals: input.toId } },
        { type: { equals: input.type } },
      ],
    },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  if (duplicate.docs.length > 0) {
    throw new Error('That relation already exists.')
  }

  const created = await payload.create({
    collection: 'catalog-relations',
    data: {
      from: input.fromId,
      to: input.toId,
      type: input.type,
      source: { type: 'manual' as const },
      ...(workspaceId ? { workspace: workspaceId } : {}),
    },
    overrideAccess: true,
  })

  revalidatePath(`/catalog/${input.fromId}`)
  revalidatePath(`/catalog/${input.toId}`)
  await revalidateCatalog(payload, workspaceId)
  return { id: created.id }
}

/** Delete a MANUAL relation. RBAC: manage rights on the `from` entity's workspace. */
export async function deleteCatalogRelation(id: string): Promise<void> {
  const { payload, betterAuthId, isAdmin } = await requireSession()

  const relation = await payload.findByID({
    collection: 'catalog-relations',
    id,
    depth: 0,
    overrideAccess: true,
  })

  if ((relation.source?.type ?? 'manual') !== 'manual') {
    throw new Error('Only manual relations can be removed.')
  }

  const fromId = refId(relation.from)
  let workspaceId: string | null = refId(relation.workspace)
  if (fromId) {
    try {
      const fromEntity = (await payload.findByID({
        collection: 'catalog-entities',
        id: fromId,
        depth: 0,
        overrideAccess: true,
      })) as CatalogEntity
      workspaceId = refId(fromEntity.workspace)
    } catch {
      // fall back to the relation's own workspace
    }
  }

  if (!(await canManageEntity(payload, betterAuthId, isAdmin, { workspaceId }))) {
    throw new Error('You do not have permission to remove this relation.')
  }

  await payload.delete({
    collection: 'catalog-relations',
    id,
    overrideAccess: true,
  })

  const toId = refId(relation.to)
  if (fromId) revalidatePath(`/catalog/${fromId}`)
  if (toId) revalidatePath(`/catalog/${toId}`)
  await revalidateCatalog(payload, workspaceId)
}

// ---------------------------------------------------------------------------
// Form options + pickers
// ---------------------------------------------------------------------------

/** Map a (depth-1) catalog entity to a picker option. */
function toEntityOption(entity: CatalogEntity): EntityOption {
  const ws = entity.workspace
  const workspaceName = ws && typeof ws === 'object' ? ws.name : null
  return {
    id: entity.id,
    name: entity.name,
    kind: entity.kind as EntityKind,
    workspaceName,
  }
}

/**
 * Options for the create/edit form: workspaces the caller may author in, whether
 * they can create global entities, and team entities (for the owner picker)
 * grouped by workspace plus the global set.
 */
export async function getEntityFormOptions(): Promise<EntityFormOptions> {
  const { payload, betterAuthId, isAdmin } = await requireSession()

  let workspaces: { id: string; name: string }[] = []
  if (isAdmin) {
    const all = await payload.find({
      collection: 'workspaces',
      limit: 1000,
      depth: 0,
      overrideAccess: true,
      sort: 'name',
    })
    workspaces = all.docs.map((w) => ({ id: w.id, name: w.name }))
  } else {
    const ids = await getManageableWorkspaceIds(payload, betterAuthId)
    if (ids.length > 0) {
      const ws = await payload.find({
        collection: 'workspaces',
        where: { id: { in: ids } },
        limit: 1000,
        depth: 0,
        overrideAccess: true,
        sort: 'name',
      })
      workspaces = ws.docs.map((w) => ({ id: w.id, name: w.name }))
    }
  }

  const teamsByWorkspace: Record<string, EntityOption[]> = {}
  const wsIds = workspaces.map((w) => w.id)
  if (wsIds.length > 0) {
    const teams = await payload.find({
      collection: 'catalog-entities',
      where: { and: [{ kind: { equals: 'team' } }, { workspace: { in: wsIds } }] },
      limit: 1000,
      depth: 1,
      overrideAccess: true,
      sort: 'name',
    })
    for (const team of teams.docs as CatalogEntity[]) {
      const wsId = refId(team.workspace)
      if (!wsId) continue
      ;(teamsByWorkspace[wsId] ??= []).push(toEntityOption(team))
    }
  }

  let globalTeams: EntityOption[] = []
  if (isAdmin) {
    const gt = await payload.find({
      collection: 'catalog-entities',
      where: { and: [{ kind: { equals: 'team' } }, { workspace: { exists: false } }] },
      limit: 1000,
      depth: 0,
      overrideAccess: true,
      sort: 'name',
    })
    globalTeams = (gt.docs as CatalogEntity[]).map(toEntityOption)
  }

  return {
    workspaces,
    canCreateGlobal: isAdmin,
    teamsByWorkspace,
    globalTeams,
  }
}

/**
 * Org-wide entity search for relation/owner pickers (limit 20). Any authenticated
 * user may search; results carry the workspace name for display.
 */
export async function searchEntitiesForPicker(
  query: string,
  opts?: { kind?: EntityKind; excludeId?: string },
): Promise<EntityOption[]> {
  const { payload } = await requireSession()

  const conditions: Where[] = []
  const trimmed = query?.trim()
  if (trimmed) conditions.push({ name: { contains: trimmed } })
  if (opts?.kind) conditions.push({ kind: { equals: opts.kind } })
  if (opts?.excludeId) conditions.push({ id: { not_equals: opts.excludeId } })

  const where: Where =
    conditions.length === 0 ? {} : conditions.length === 1 ? conditions[0] : { and: conditions }

  const res = await payload.find({
    collection: 'catalog-entities',
    where,
    limit: 20,
    depth: 1,
    sort: 'name',
    overrideAccess: true,
  })

  return (res.docs as CatalogEntity[]).map(toEntityOption)
}
