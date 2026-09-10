'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { revalidatePath } from 'next/cache'
import type { Where } from 'payload'
import { getCurrentUser, getPayloadUserFromSession } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/access/workspace-access'
import { canManageTemplateDefinitions } from '@/lib/templates/authz'
import type { ValidationResult } from '@/lib/scaffolder/validate'
import { validateTemplateDefinition } from './authoring-actions'
import type {
  TemplateDefinition as TemplateDefinitionDoc,
  TemplateDefinitionVersion,
  ActionRun,
} from '@/payload-types'

/**
 * Server actions backing the Phase 2 authoring UI surfaces — the template
 * list page (Task 8) and the editor shell's version/validation/publish-gate
 * panels (Task 14).
 *
 * Kept separate from `authoring-actions.ts` (Task 8's core CRUD + run
 * actions) purely to keep two parallel workstreams off the same file. The
 * conventions are identical and deliberately duplicated rather than
 * cross-imported: a `'use server'` module may only export async functions, so
 * the small private helpers below cannot be shared across the boundary.
 * Resolve the session user, gate through `lib/templates/authz.ts` BEFORE
 * every read and write, then use `overrideAccess: true` — the gate here IS
 * the source of truth.
 *
 * Two of these are the ONLY writers of the publish gate's inputs:
 * {@link markVersionValidated} stamps `validatedAt` and
 * {@link recordSuccessfulDryRun} stamps `dryRunRunId`. Without them
 * `lib/scaffolder/versions.ts`'s `publishVersion` gate could never be
 * satisfied by any UI path. Both re-derive every fact from persisted data
 * rather than trusting what the client claims, and `publishVersion` then
 * re-verifies all of it independently.
 */

type PayloadClient = Awaited<ReturnType<typeof getPayload>>

/** Extract a relationship id whether it arrived as a string or a populated doc. */
function relId(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value === 'object' && 'id' in (value as Record<string, unknown>)) {
    return String((value as { id: unknown }).id)
  }
  return null
}

/** Resolve + assert the session user; throws when unauthenticated. */
async function requireUserId(): Promise<string> {
  const uid = (await getCurrentUser())?.id
  if (!uid) throw new Error('Not authenticated')
  return uid
}

/** Whether the current session belongs to a platform admin (super_admin/admin). */
async function currentUserIsPlatformAdmin(): Promise<boolean> {
  return isPlatformAdmin(await getPayloadUserFromSession())
}

async function loadDefinitionOrThrow(
  payload: PayloadClient,
  id: string,
): Promise<TemplateDefinitionDoc> {
  try {
    return await payload.findByID({
      collection: 'template-definitions',
      id,
      depth: 0,
      overrideAccess: true,
    })
  } catch {
    throw new Error('Template definition not found')
  }
}


/**
 * A lean projection of a `template-definitions` row for the list page. The
 * full doc is deliberately NOT handed to the client: `fixtures` can contain
 * arbitrary author-supplied sample inputs (including values an author pasted
 * from a real system), and none of it is needed to render a catalog row.
 */
export interface TemplateListItem {
  id: string
  name: string
  slug: string
  title: string | null
  description: string | null
  status: 'draft' | 'published' | 'deprecated'
  visibility: 'workspace' | 'shared' | 'public'
  workspaceId: string
  workspaceName: string
  owner: string | null
  targetKind: string | null
  usageCount: number
  lastDryRunAt: string | null
  updatedAt: string
  /** True when the session user created this definition (drives the "mine" filter). */
  mine: boolean
  /** The definition's current version id, when it has one. */
  currentVersionId: string | null
}

function toListItem(
  definition: TemplateDefinitionDoc,
  workspaceNames: Map<string, string>,
  uid: string,
): TemplateListItem {
  const workspaceId = relId(definition.workspace) ?? ''
  return {
    id: definition.id,
    name: definition.name,
    slug: definition.slug,
    title: definition.title ?? null,
    description: definition.description ?? null,
    status: definition.status,
    visibility: definition.visibility,
    workspaceId,
    workspaceName: workspaceNames.get(workspaceId) ?? 'Unknown workspace',
    owner: definition.owner ?? null,
    targetKind: definition.targetKind ?? null,
    usageCount: definition.usageCount ?? 0,
    lastDryRunAt: definition.lastDryRunAt ?? null,
    updatedAt: definition.updatedAt,
    mine: relId(definition.createdBy) === uid,
    currentVersionId: relId(definition.currentVersion),
  }
}

async function workspaceNameMap(
  payload: PayloadClient,
  workspaceIds: string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(workspaceIds.filter(Boolean))]
  if (ids.length === 0) return new Map()
  const result = await payload.find({
    collection: 'workspaces',
    where: { id: { in: ids } },
    limit: 1000,
    depth: 0,
    overrideAccess: true,
  })
  return new Map(result.docs.map((w) => [w.id, w.name]))
}

/**
 * Workspaces the caller may AUTHOR templates in (owner/admin) — the "New
 * template" CTA gate and the create form's workspace picker. Mirrors
 * `self-service/actions.ts`'s `getManageableActionWorkspaces` exactly.
 */
export async function getManageableTemplateWorkspaces(): Promise<{ id: string; name: string }[]> {
  const payload = await getPayload({ config })
  const uid = (await getCurrentUser())?.id
  if (!uid) return []

  if (await currentUserIsPlatformAdmin()) {
    const all = await payload.find({
      collection: 'workspaces',
      sort: 'name',
      limit: 1000,
      depth: 0,
      overrideAccess: true,
    })
    return all.docs.map((w) => ({ id: w.id, name: w.name }))
  }

  const memberships = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { user: { equals: uid } },
        { role: { in: ['owner', 'admin'] } },
        { status: { equals: 'active' } },
      ],
    },
    limit: 1000,
    depth: 0,
    overrideAccess: true,
  })

  const workspaceIds = [
    ...new Set(memberships.docs.map((m) => relId(m.workspace)).filter((v): v is string => !!v)),
  ]
  if (workspaceIds.length === 0) return []

  const wsResult = await payload.find({
    collection: 'workspaces',
    where: { id: { in: workspaceIds } },
    sort: 'name',
    limit: 1000,
    depth: 0,
    overrideAccess: true,
  })
  return wsResult.docs.map((w) => ({ id: w.id, name: w.name }))
}

/** Workspace ids the caller is an active member of (any role). */
async function memberWorkspaceIds(payload: PayloadClient, uid: string): Promise<string[]> {
  const memberships = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [{ user: { equals: uid } }, { status: { equals: 'active' } }],
    },
    limit: 1000,
    depth: 0,
    overrideAccess: true,
  })
  return [
    ...new Set(memberships.docs.map((m) => relId(m.workspace)).filter((v): v is string => !!v)),
  ]
}

/**
 * PUBLISHED templates the caller may run — the "Run" tab of
 * `/self-service/templates`. Scoped to the caller's active memberships (a
 * platform admin sees every workspace's published templates), never to a
 * client-supplied workspace id.
 */
export async function listRunnableTemplates(): Promise<TemplateListItem[]> {
  const payload = await getPayload({ config })
  const uid = (await getCurrentUser())?.id
  if (!uid) return []
  const isAdmin = await currentUserIsPlatformAdmin()

  const and: Where[] = [{ status: { equals: 'published' } }]
  if (!isAdmin) {
    const ids = await memberWorkspaceIds(payload, uid)
    if (ids.length === 0) return []
    and.push({ workspace: { in: ids } })
  }

  const result = await payload.find({
    collection: 'template-definitions',
    where: { and },
    sort: '-updatedAt',
    limit: 200,
    depth: 0,
    overrideAccess: true,
  })

  const names = await workspaceNameMap(payload, result.docs.map((d) => relId(d.workspace) ?? ''))
  return result.docs.map((d) => toListItem(d, names, uid))
}

export interface ListAuthorableTemplatesInput {
  /** Only definitions the caller created. Applied in the QUERY, not after the row cap. */
  mine?: boolean
}

/**
 * Templates the caller may MANAGE — the "Drafts" tab. Scoped to workspaces
 * where the caller is owner/admin, so drafts are never visible to plain
 * members (design §3.2).
 *
 * Published definitions are included deliberately: they are the only rows
 * that carry a Deprecate affordance, and the Run tab links to `/run`, so
 * excluding them here would leave a published template with no reachable
 * management screen at all.
 */
export async function listAuthorableTemplates(
  input: ListAuthorableTemplatesInput = {},
): Promise<TemplateListItem[]> {
  const payload = await getPayload({ config })
  const uid = (await getCurrentUser())?.id
  if (!uid) return []
  const isAdmin = await currentUserIsPlatformAdmin()

  const and: Where[] = []
  if (input.mine) and.push({ createdBy: { equals: uid } })
  if (!isAdmin) {
    const manageable = await getManageableTemplateWorkspaces()
    if (manageable.length === 0) return []
    and.push({ workspace: { in: manageable.map((w) => w.id) } })
  }

  const result = await payload.find({
    collection: 'template-definitions',
    // A platform admin listing everything has no clauses at all; `{ and: [] }`
    // is not a valid Payload where, so omit it entirely in that case.
    where: and.length > 0 ? { and } : {},
    sort: '-updatedAt',
    limit: 200,
    depth: 0,
    overrideAccess: true,
  })

  const names = await workspaceNameMap(payload, result.docs.map((d) => relId(d.workspace) ?? ''))
  return result.docs.map((d) => toListItem(d, names, uid))
}

/** A version-history row for the editor's Versions panel. */
export interface TemplateVersionSummary {
  id: string
  versionNumber: number
  changeNote: string | null
  validatedAt: string | null
  dryRunRunId: string | null
  createdAt: string
  isCurrent: boolean
  definitionJson: unknown
}

/**
 * Version history for a definition, newest first. Manage-gated — version
 * bodies are draft content and must not leak to plain members.
 */
export async function listTemplateDefinitionVersions(
  definitionId: string,
): Promise<TemplateVersionSummary[]> {
  const payload = await getPayload({ config })
  const uid = await requireUserId()
  const isAdmin = await currentUserIsPlatformAdmin()

  const definition = await loadDefinitionOrThrow(payload, definitionId)
  if (!(await canManageTemplateDefinitions(payload, uid, relId(definition.workspace), isAdmin))) {
    return []
  }

  const currentVersionId = relId(definition.currentVersion)
  const result = await payload.find({
    collection: 'template-definition-versions',
    where: { definition: { equals: definitionId } },
    sort: '-versionNumber',
    limit: 100,
    depth: 0,
    overrideAccess: true,
  })

  return result.docs.map((v) => ({
    id: v.id,
    versionNumber: v.versionNumber,
    changeNote: v.changeNote ?? null,
    validatedAt: v.validatedAt ?? null,
    dryRunRunId: relId(v.dryRunRunId),
    createdAt: v.createdAt,
    isCurrent: v.id === currentVersionId,
    definitionJson: v.definitionJson,
  }))
}

/**
 * Runs static validation against a version's PERSISTED `definitionJson` and
 * stamps `validatedAt` when it passes (clearing it when it does not).
 *
 * This is the only writer of `validatedAt`, which `publishVersion`'s gate
 * requires — without it the publish gate could never be satisfied. It
 * deliberately re-reads the stored document rather than accepting a
 * definition from the client: a client that could pass its own JSON here
 * could stamp a version as validated while persisting something else.
 * Manage-gated.
 */
export async function markVersionValidated(versionId: string): Promise<ValidationResult> {
  const payload = await getPayload({ config })
  const uid = await requireUserId()
  const isAdmin = await currentUserIsPlatformAdmin()

  let version: TemplateDefinitionVersion
  try {
    version = await payload.findByID({
      collection: 'template-definition-versions',
      id: versionId,
      depth: 0,
      overrideAccess: true,
    })
  } catch {
    throw new Error('Template version not found')
  }

  const definitionId = relId(version.definition)
  if (!definitionId) throw new Error('Template version has no parent definition')
  const definition = await loadDefinitionOrThrow(payload, definitionId)
  if (!(await canManageTemplateDefinitions(payload, uid, relId(definition.workspace), isAdmin))) {
    throw new Error('You do not have permission to author templates in this workspace.')
  }

  const result = await validateTemplateDefinition(version.definitionJson)

  await payload.update({
    collection: 'template-definition-versions',
    id: versionId,
    data: { validatedAt: result.ok ? new Date().toISOString() : null },
    overrideAccess: true,
  })

  revalidatePath(`/self-service/templates/${definitionId}/edit`)
  return result
}

/**
 * Records a succeeded dry run against the version it ran, satisfying half of
 * the publish gate. Called by the dry-run panel once polling observes a
 * terminal `succeeded`; every claim the client makes is re-verified here
 * (the run exists, is a dry run, succeeded, and belongs to THIS version), and
 * `publishVersion` re-verifies all of it again independently. A client cannot
 * fake a passing gate by calling this with an arbitrary run id.
 * Manage-gated.
 */
export async function recordSuccessfulDryRun(
  versionId: string,
  runId: string,
): Promise<{ recorded: boolean }> {
  const payload = await getPayload({ config })
  const uid = await requireUserId()
  const isAdmin = await currentUserIsPlatformAdmin()

  let version: TemplateDefinitionVersion
  try {
    version = await payload.findByID({
      collection: 'template-definition-versions',
      id: versionId,
      depth: 0,
      overrideAccess: true,
    })
  } catch {
    throw new Error('Template version not found')
  }

  const definitionId = relId(version.definition)
  if (!definitionId) throw new Error('Template version has no parent definition')
  const definition = await loadDefinitionOrThrow(payload, definitionId)
  if (!(await canManageTemplateDefinitions(payload, uid, relId(definition.workspace), isAdmin))) {
    throw new Error('You do not have permission to author templates in this workspace.')
  }

  let run: ActionRun
  try {
    run = await payload.findByID({ collection: 'action-runs', id: runId, depth: 0, overrideAccess: true })
  } catch {
    throw new Error('Run not found')
  }

  if (run.dryRun !== true) return { recorded: false }
  if (run.status !== 'succeeded') return { recorded: false }
  if (relId(run.templateVersion) !== versionId) return { recorded: false }

  await payload.update({
    collection: 'template-definition-versions',
    id: versionId,
    data: { dryRunRunId: runId },
    overrideAccess: true,
  })

  revalidatePath(`/self-service/templates/${definitionId}/edit`)
  return { recorded: true }
}
