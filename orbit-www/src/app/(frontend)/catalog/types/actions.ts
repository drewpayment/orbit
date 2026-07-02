'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { getCurrentUser } from '@/lib/auth/session'
import { getCurrentWorkspaceId } from '@/lib/workspace'
import { canManageScorecards } from '@/lib/scorecards/authz'
import { ENTITY_KINDS, type EntityKind } from '@/collections/catalog/constants'
import { listEntityTypes, mergeEntityType, type EntityTypeDefinition } from '@/lib/catalog/entity-types'
import {
  sanitiseRequiredMetadata,
  sanitiseRequiredRelations,
  validateEntityTypeForm,
  type SaveEntityTypeInput,
} from '@/components/features/catalog/EntityTypeFormLogic'
import type { EntityType } from '@/payload-types'

type Payload = Awaited<ReturnType<typeof getPayload>>

/**
 * The types home + per-kind editor server actions (Entity Scores & Golden
 * Paths, docs/plans/2026-07-01-entity-scores-and-golden-paths.md).
 *
 * `entity-types` is a per-(workspace, kind) row, so these actions resolve a
 * single "current" workspace via `lib/workspace.ts` — the same helper the rest
 * of the app uses for workspace-scoped settings surfaces — rather than
 * aggregating across every workspace the user belongs to (contrast with
 * `scorecards/actions.ts`, which lists scorecards across all memberships since
 * a scorecard's own `workspace` field disambiguates each card).
 *
 * `canManageScorecards` (lib/scorecards/authz.ts) is reused verbatim for the
 * owner/admin gate: authoring entity-type definitions is the identical
 * workspace-owner/admin privilege as authoring scorecards, so this is not a
 * new policy, just the existing one applied to a sibling collection.
 */

function isEntityKind(value: string): value is EntityKind {
  return (ENTITY_KINDS as readonly string[]).includes(value)
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface EntityTypeListItem extends EntityTypeDefinition {
  /** True when a workspace row exists for this kind — false means pure defaults. */
  isCustomized: boolean
}

export interface EntityTypesHome {
  workspaceId: string | null
  /** Whether the current user may author entity-type definitions in this workspace. */
  canManage: boolean
  items: EntityTypeListItem[]
}

const EMPTY_HOME: EntityTypesHome = { workspaceId: null, canManage: false, items: [] }

/**
 * The types home: every {@link ENTITY_KINDS} entry resolved to its definition
 * (a stored row merged over the built-in default, or the pure default) for
 * the caller's current workspace, plus whether each kind has been customized.
 */
export async function getEntityTypesHome(userId?: string): Promise<EntityTypesHome> {
  const payload = await getPayload({ config })
  const uid = userId ?? (await getCurrentUser())?.id
  if (!uid) return EMPTY_HOME

  const workspaceId = await getCurrentWorkspaceId()
  if (!workspaceId) return EMPTY_HOME

  const [definitions, rowsResult, canManage] = await Promise.all([
    listEntityTypes(payload, workspaceId),
    payload.find({
      collection: 'entity-types',
      where: { workspace: { equals: workspaceId } },
      limit: 1000,
      depth: 0,
      overrideAccess: true,
    }),
    canManageScorecards(payload, uid, workspaceId),
  ])

  const definedKinds = new Set(rowsResult.docs.map((row) => row.kind))
  const items: EntityTypeListItem[] = definitions.map((def) => ({
    ...def,
    isCustomized: definedKinds.has(def.kind),
  }))

  return { workspaceId, canManage, items }
}

export interface EntityTypeDetail {
  workspaceId: string
  kind: EntityKind
  /** Whether the current user may edit this definition. */
  canManage: boolean
  definition: EntityTypeDefinition
  /** True when a workspace row exists for this kind — false means pure defaults. */
  isCustomized: boolean
}

/**
 * Detail for one kind's definition, for the `[kind]` view/edit page. Returns
 * `null` for an unrecognised kind or when there's no session/workspace
 * (caller → notFound()).
 */
export async function getEntityTypeDetail(
  userId: string | undefined,
  kind: string,
): Promise<EntityTypeDetail | null> {
  if (!isEntityKind(kind)) return null

  const payload = await getPayload({ config })
  const uid = userId ?? (await getCurrentUser())?.id
  if (!uid) return null

  const workspaceId = await getCurrentWorkspaceId()
  if (!workspaceId) return null

  const [rowsResult, canManage] = await Promise.all([
    payload.find({
      collection: 'entity-types',
      where: { and: [{ workspace: { equals: workspaceId } }, { kind: { equals: kind } }] },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    }),
    canManageScorecards(payload, uid, workspaceId),
  ])

  const stored = (rowsResult.docs[0] as EntityType | undefined) ?? null
  const definition = mergeEntityType(stored, kind)

  return { workspaceId, kind, canManage, definition, isCustomized: !!stored }
}

// ---------------------------------------------------------------------------
// Writes — RBAC-gated on workspace owner/admin, mirroring scorecards/actions.ts
// (the check IS the authz; the Payload mutation runs with overrideAccess).
// ---------------------------------------------------------------------------

/** Throw unless `userId` may author entity types in the current workspace. */
async function requireManage(payload: Payload): Promise<{ userId: string; workspaceId: string }> {
  const userId = (await getCurrentUser())?.id
  if (!userId) throw new Error('Not authenticated')

  const workspaceId = await getCurrentWorkspaceId()
  if (!workspaceId) throw new Error('No workspace access')

  if (!(await canManageScorecards(payload, userId, workspaceId))) {
    throw new Error('You do not have permission to manage entity types in this workspace.')
  }

  return { userId, workspaceId }
}

/**
 * Create-or-update the (workspace, kind) `entity-types` row. `input` is
 * expected to already be the sanitised {@link SaveEntityTypeInput} shape
 * (built client-side via `buildSaveEntityTypeInput`); relation/metadata rows
 * are re-sanitised here too — server actions never trust client-shaped input.
 */
export async function saveEntityType(input: SaveEntityTypeInput): Promise<{ id: string }> {
  const payload = await getPayload({ config })
  const { workspaceId } = await requireManage(payload)

  if (!isEntityKind(input.kind)) throw new Error('Unknown entity kind.')
  const formError = validateEntityTypeForm({ displayName: input.displayName })
  if (formError) throw new Error(formError)

  const data = {
    workspace: workspaceId,
    kind: input.kind,
    displayName: input.displayName.trim(),
    description: input.description?.trim() || undefined,
    baseValue: input.baseValue,
    scoringWeight: input.scoringWeight,
    goldenPath: {
      summary: input.goldenPath.summary?.trim() || undefined,
      docsUrl: input.goldenPath.docsUrl?.trim() || undefined,
      requiredRelations: sanitiseRequiredRelations(
        input.goldenPath.requiredRelations.map((r) => ({
          relationType: r.relationType,
          direction: r.direction,
          targetKind: r.targetKind ?? '',
          min: String(r.min),
        })),
      ),
      requiredMetadata: sanitiseRequiredMetadata(
        input.goldenPath.requiredMetadata.map((m) => ({ path: m.path, label: m.label ?? '' })),
      ),
    },
  }

  const existing = await payload.find({
    collection: 'entity-types',
    where: { and: [{ workspace: { equals: workspaceId } }, { kind: { equals: input.kind } }] },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })

  if (existing.docs[0]) {
    const updated = await payload.update({
      collection: 'entity-types',
      id: existing.docs[0].id,
      data,
      overrideAccess: true,
    })
    return { id: updated.id }
  }

  const created = await payload.create({
    collection: 'entity-types',
    data,
    overrideAccess: true,
  })
  return { id: created.id }
}
