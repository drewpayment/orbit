import { createHash } from 'node:crypto'
import type { Payload } from 'payload'
import type { DiscoveredEntity } from '@/payload-types'

/**
 * Import lib for Catalog Discovery (Phase 1,
 * docs/plans/2026-07-06-catalog-discovery.md).
 *
 * Turns an approved / Tier-1 `discovered-entities` proposal into a source row
 * (`apps` for services, `api-schemas` for APIs) and records the link back on
 * the discovery row (`status: 'imported'`, `importedRef`). The existing catalog
 * projection layer then emits the entity/relation, so this lib only writes
 * source rows and stays idempotent — re-importing an already-imported proposal
 * (or a repo that already has an App / spec) is a no-op link, which is what lets
 * manual edits on previously imported entities survive a re-scan (AC-5).
 *
 * All writes use `overrideAccess: true`: the caller is either the internal
 * ingest route (no user) or a server action that has already done its own RBAC.
 */

export interface ImportResult {
  imported: boolean
  /** Set when the proposal was intentionally not imported (e.g. an unsupported schema type). */
  skippedReason?: string
  ref?: { collection: string; id: string }
}

export interface ImportOptions {
  /**
   * Payload `users` id recorded as `api-schemas.createdBy` — a required field on
   * that collection with no default when there is no request user. Supplied by
   * the approve server action (WP5). Tier-1 service auto-import in the ingest
   * route never needs it (apps has no `createdBy`, and Tier 1 is service-only).
   */
  actorUserId?: string
  /**
   * Assign a GLOBAL (workspace-less) proposal to this workspace on approval,
   * then run the NORMAL apps/api-schemas import path in it (WP8). Ignored for a
   * proposal that already has a workspace. Platform-admin gated by the caller.
   */
  assignWorkspaceId?: string
}

/**
 * `api-schemas` supports these schema types (see APISchemas.ts `schemaType`
 * select). Any other value the `detectApiSpecs` detector could theoretically
 * emit is skipped on import rather than writing an invalid enum value — the
 * proposal row still lives in the review queue for visibility.
 */
const SUPPORTED_API_SCHEMA_TYPES = new Set(['openapi', 'asyncapi', 'graphql'])

function relId(v: unknown): string | undefined {
  if (typeof v === 'string') return v
  if (v && typeof v === 'object' && 'id' in v) return String((v as { id: unknown }).id)
  return undefined
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/**
 * A valid, workspace+path-unique `api-schemas.slug`. The collection's
 * beforeValidate hook auto-generates a slug from name, but the generated create
 * type still requires the field; deriving it here (with a stable hash suffix)
 * also avoids the global-slug-uniqueness collision two same-named specs would hit.
 */
function apiSchemaSlug(name: string, workspaceId: string, specPath: string): string {
  const suffix = createHash('sha1').update(`${workspaceId}:${specPath}`).digest('hex').slice(0, 8)
  const base = slugify(name) || 'api'
  return `${base}-${suffix}`
}

/**
 * Re-scan idempotency key. Mirrors the doc-comment on the discovered-entities
 * collection: `sha1(installationId:owner/name:path:detectedKind)`.
 *
 * @param ownerRepo the `owner/name` slug (e.g. `acme/billing`).
 */
export function computeDedupeKey(
  installationId: string,
  ownerRepo: string,
  path: string,
  detectedKind: string,
): string {
  return createHash('sha1')
    .update(`${installationId}:${ownerRepo}:${path}:${detectedKind}`)
    .digest('hex')
}

/**
 * Provider attribution resolved from a discovery row, ready to copy onto the
 * created `apps` row's `repository` group (WI4, docs/plans/2026-07-09-ado-import-parity.md).
 */
interface ProviderInfo {
  provider?: 'github' | 'azure-devops'
  connection?: string
  /** GitHub owner or ADO organization — never the ADO project. */
  owner: string
  /** ADO project (the middle org/project/repo segment). Absent for GitHub. */
  project?: string
}

/**
 * Resolve provider/connection/owner/project for a discovery row.
 *
 * GitHub rows (`installation` set): `discovery.repo.owner` is already the true
 * GitHub owner — passed through, `provider: 'github'` set explicitly (preferred
 * over the absent-provider legacy invariant).
 *
 * ADO rows (`connection` set): the scanner stores the ADO *project* name in
 * `discovery.repo.owner` (there is no org field on discovered-entities — see
 * DiscoveredEntities.ts `repo` group) — the true org lives on the linked
 * `git-connections.organization`, so the connection doc must be resolved to
 * reconstruct `apps.repository.owner`. `discovery.repo.owner` becomes `project`.
 *
 * Neither linkage, or the connection doc is missing/unresolvable: fails soft —
 * no provider fields, `owner` falls back to `discovery.repo.owner` verbatim
 * (matches pre-ADO-parity behavior; never throws).
 */
async function resolveProviderInfo(
  payload: Payload,
  discovery: DiscoveredEntity,
): Promise<ProviderInfo> {
  const installationId = relId(discovery.installation)
  if (installationId) {
    return { provider: 'github', owner: discovery.repo.owner }
  }

  const connectionId = relId(discovery.connection)
  if (connectionId) {
    try {
      const conn = await payload.findByID({
        collection: 'git-connections',
        id: connectionId,
        depth: 0,
        overrideAccess: true,
      })
      const organization = (conn as { organization?: string } | null)?.organization
      if (typeof organization === 'string' && organization.length > 0) {
        return {
          provider: 'azure-devops',
          connection: connectionId,
          owner: organization,
          project: discovery.repo.owner,
        }
      }
      console.error('[discovery/import] git-connections row missing organization', { connectionId })
    } catch (err) {
      console.error('[discovery/import] failed to resolve git-connections for ADO owner', {
        connectionId,
        err,
      })
    }
  }

  return { owner: discovery.repo.owner }
}

/** Find the App that represents a repo in a workspace (Phase 1: repo-scoped). */
async function findRepoApp(
  payload: Payload,
  workspaceId: string,
  owner: string,
  name: string,
): Promise<string | undefined> {
  const res = await payload.find({
    collection: 'apps',
    where: {
      and: [
        { workspace: { equals: workspaceId } },
        { 'repository.owner': { equals: owner } },
        { 'repository.name': { equals: name } },
      ],
    },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  return res.docs.length > 0 ? String(res.docs[0].id) : undefined
}

/**
 * Import a service proposal into an `apps` row. Phase 1 apps are repo-scoped, so
 * a root-path service maps to the repo's App: if one already exists we link to
 * it (no-op, leaving its manual edits untouched); otherwise we create it with
 * `origin.type: 'discovered'`.
 */
export async function importDiscoveredService(
  payload: Payload,
  discovery: DiscoveredEntity,
): Promise<ImportResult> {
  if (discovery.status === 'imported' && discovery.importedRef?.docId) {
    return {
      imported: true,
      ref: { collection: discovery.importedRef.collectionSlug || 'apps', id: discovery.importedRef.docId },
    }
  }

  const workspaceId = relId(discovery.workspace)
  if (!workspaceId) return { imported: false, skippedReason: 'missing-workspace' }

  const proposal = asRecord(discovery.proposal)
  const { name: repoName, url, defaultBranch } = discovery.repo
  const providerInfo = await resolveProviderInfo(payload, discovery)

  let appId = await findRepoApp(payload, workspaceId, providerInfo.owner, repoName)
  if (!appId) {
    const installationId = relId(discovery.installation)
    const buildConfig = asRecord(proposal.buildConfig)
    const created = await payload.create({
      collection: 'apps',
      overrideAccess: true,
      data: {
        workspace: workspaceId,
        name: (proposal.name as string) || repoName,
        ...(typeof proposal.description === 'string' ? { description: proposal.description } : {}),
        repository: {
          owner: providerInfo.owner,
          name: repoName,
          ...(url ? { url } : {}),
          ...(installationId ? { installationId } : {}),
          ...(providerInfo.provider ? { provider: providerInfo.provider } : {}),
          ...(providerInfo.connection ? { connection: providerInfo.connection } : {}),
          ...(providerInfo.project ? { project: providerInfo.project } : {}),
          ...(defaultBranch ? { branch: defaultBranch } : {}),
        },
        origin: { type: 'discovered' },
        ...(Object.keys(buildConfig).length > 0 ? { buildConfig } : {}),
        ...(proposal.healthConfig ? { healthConfig: proposal.healthConfig } : {}),
        syncEnabled: false,
        status: 'unknown',
      },
    })
    appId = String(created.id)
  }

  await payload.update({
    collection: 'discovered-entities',
    id: discovery.id,
    overrideAccess: true,
    data: {
      status: 'imported',
      importedRef: { collectionSlug: 'apps', docId: appId },
    },
  })

  return { imported: true, ref: { collection: 'apps', id: appId } }
}

/**
 * Import an API proposal into an `api-schemas` row, letting the existing
 * projection emit the `api` entity + `exposes-api` relation. A proposal with a
 * schema type `api-schemas` does not support is skipped rather than written as
 * an invalid enum value. Idempotent: an existing api-schemas row for the same
 * workspace + repositoryPath (+ App when known) is linked, not duplicated.
 */
export async function importDiscoveredApi(
  payload: Payload,
  discovery: DiscoveredEntity,
  opts: ImportOptions = {},
): Promise<ImportResult> {
  if (discovery.status === 'imported' && discovery.importedRef?.docId) {
    return {
      imported: true,
      ref: {
        collection: discovery.importedRef.collectionSlug || 'api-schemas',
        id: discovery.importedRef.docId,
      },
    }
  }

  const proposal = asRecord(discovery.proposal)
  const schemaType = proposal.schemaType
  if (typeof schemaType !== 'string' || !SUPPORTED_API_SCHEMA_TYPES.has(schemaType)) {
    return { imported: false, skippedReason: `unsupported-schema-type:${String(schemaType)}` }
  }

  const rawContent = proposal.rawContent
  if (typeof rawContent !== 'string' || rawContent.length === 0) {
    // Filename-only (medium-confidence) proposal — no spec content was fetched,
    // so there is nothing to persist as an api-schemas row.
    return { imported: false, skippedReason: 'missing-raw-content' }
  }

  const workspaceId = relId(discovery.workspace)
  if (!workspaceId) return { imported: false, skippedReason: 'missing-workspace' }

  const specPath =
    typeof proposal.specPath === 'string' ? proposal.specPath : discovery.path || ''
  const { name: repoName } = discovery.repo
  // api-schemas carries no provider/connection fields of its own — repo
  // attribution lives entirely on the linked App, so only the lookup owner
  // needs the ADO org (not the discovered project) to find the right App.
  const providerInfo = await resolveProviderInfo(payload, discovery)
  const appId = await findRepoApp(payload, workspaceId, providerInfo.owner, repoName)

  const existing = await payload.find({
    collection: 'api-schemas',
    where: {
      and: [
        { workspace: { equals: workspaceId } },
        { repositoryPath: { equals: specPath } },
        ...(appId ? [{ repository: { equals: appId } }] : []),
      ],
    },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })

  let schemaId: string
  if (existing.docs.length > 0) {
    schemaId = String(existing.docs[0].id)
  } else {
    // `api-schemas.createdBy` is required and has no default outside a request
    // context. An API import only ever runs from the approve action (which has
    // the acting member) — Tier-1 auto-import is service-only — so a create with
    // no actor means a caller wired us up wrong; skip rather than write a bad row.
    if (!opts.actorUserId) {
      return { imported: false, skippedReason: 'missing-actor' }
    }
    const name =
      (proposal.name as string) || (proposal.specTitle as string) || specPath || 'api'
    const created = await payload.create({
      collection: 'api-schemas',
      overrideAccess: true,
      data: {
        name,
        slug: apiSchemaSlug(name, workspaceId, specPath),
        workspace: workspaceId,
        visibility: 'workspace',
        status: 'draft',
        schemaType: schemaType as 'openapi' | 'asyncapi' | 'graphql',
        rawContent,
        repositoryPath: specPath,
        ...(appId ? { repository: appId } : {}),
        createdBy: opts.actorUserId,
      },
    })
    schemaId = String(created.id)
  }

  await payload.update({
    collection: 'discovered-entities',
    id: discovery.id,
    overrideAccess: true,
    data: {
      status: 'imported',
      importedRef: { collectionSlug: 'api-schemas', docId: schemaId },
    },
  })

  return { imported: true, ref: { collection: 'api-schemas', id: schemaId } }
}

/**
 * Import a GLOBAL (workspace-less) proposal directly into a `catalog-entities`
 * row (WP8). Unlike the workspace path, a global import bypasses apps/api-schemas
 * (both are workspace-bound) and writes the catalog entity itself, kind
 * `service`/`api` from `detectedKind`, `source: { type: 'scan', sourceId:
 * dedupeKey }`. The build/spec details the workspace path would carry on an
 * apps/api-schemas row are folded into `metadata` so a later assign-to-workspace
 * re-import (Phase 2 follow-up) has them. Idempotent on (source.type,
 * source.sourceId): an existing scan-sourced entity for this dedupeKey is linked,
 * never duplicated.
 */
export async function importDiscoveredGlobalEntity(
  payload: Payload,
  discovery: DiscoveredEntity,
): Promise<ImportResult> {
  if (discovery.status === 'imported' && discovery.importedRef?.docId) {
    return {
      imported: true,
      ref: {
        collection: discovery.importedRef.collectionSlug || 'catalog-entities',
        id: discovery.importedRef.docId,
      },
    }
  }

  const kind = discovery.detectedKind
  if (kind !== 'service' && kind !== 'api') {
    return { imported: false, skippedReason: `unknown-kind:${String(kind)}` }
  }

  const proposal = asRecord(discovery.proposal)
  const sourceId = discovery.dedupeKey

  // Idempotent link: reuse an existing scan-sourced entity for this dedupeKey.
  const existing = await payload.find({
    collection: 'catalog-entities',
    where: {
      and: [{ 'source.type': { equals: 'scan' } }, { 'source.sourceId': { equals: sourceId } }],
    },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })

  let entityId: string
  if (existing.docs.length > 0) {
    entityId = String(existing.docs[0].id)
  } else {
    const { name: repoName, url, defaultBranch } = discovery.repo
    const name = (proposal.name as string) || repoName || 'entity'
    const buildConfig = asRecord(proposal.buildConfig)
    // catalog-entities has no dedicated provider/connection/project fields
    // (WI4 scope: do not widen this collection's schema) — `metadata` is
    // already freeform JSON storing repo linkage, so provider attribution
    // folds into `metadata.repo` alongside owner/name/url/defaultBranch.
    const providerInfo = await resolveProviderInfo(payload, discovery)
    const metadata: Record<string, unknown> = {
      repo: {
        owner: providerInfo.owner,
        name: repoName,
        ...(url ? { url } : {}),
        ...(defaultBranch ? { defaultBranch } : {}),
        ...(providerInfo.provider ? { provider: providerInfo.provider } : {}),
        ...(providerInfo.connection ? { connection: providerInfo.connection } : {}),
        ...(providerInfo.project ? { project: providerInfo.project } : {}),
      },
      path: discovery.path ?? '',
      ...(typeof proposal.schemaType === 'string' ? { schemaType: proposal.schemaType } : {}),
      ...(typeof proposal.specPath === 'string' ? { specPath: proposal.specPath } : {}),
      ...(Object.keys(buildConfig).length > 0 ? { buildConfig } : {}),
    }
    const created = await payload.create({
      collection: 'catalog-entities',
      overrideAccess: true,
      data: {
        name,
        // Global slug uniqueness is enforced in the projection layer, not by a DB
        // constraint; a dedupeKey suffix keeps two same-named global scans distinct.
        slug: `${slugify(name) || 'entity'}-${sourceId.slice(0, 8)}`,
        kind,
        ...(typeof proposal.description === 'string' ? { description: proposal.description } : {}),
        source: { type: 'scan', sourceId },
        metadata,
      },
    })
    entityId = String(created.id)
  }

  await payload.update({
    collection: 'discovered-entities',
    id: discovery.id,
    overrideAccess: true,
    data: {
      status: 'imported',
      importedRef: { collectionSlug: 'catalog-entities', docId: entityId },
    },
  })

  return { imported: true, ref: { collection: 'catalog-entities', id: entityId } }
}

/**
 * Dispatch a discovery row to the importer for its kind and scope. A global
 * (workspace-less) proposal imports as a global catalog entity, UNLESS
 * `opts.assignWorkspaceId` is set — then the row is first assigned that
 * workspace and imported through the normal apps/api-schemas path (WP8).
 */
export async function importDiscovery(
  payload: Payload,
  discovery: DiscoveredEntity,
  opts: ImportOptions = {},
): Promise<ImportResult> {
  let row = discovery

  // Assign-to-workspace: a global proposal an admin routes into a workspace.
  // Persist the workspace, then fall through to the normal workspace import.
  if (opts.assignWorkspaceId && !relId(row.workspace)) {
    await payload.update({
      collection: 'discovered-entities',
      id: row.id,
      overrideAccess: true,
      data: { workspace: opts.assignWorkspaceId },
    })
    row = { ...row, workspace: opts.assignWorkspaceId } as DiscoveredEntity
  }

  // Global proposal with no assignment → direct global catalog entity.
  if (!relId(row.workspace)) {
    return importDiscoveredGlobalEntity(payload, row)
  }

  switch (row.detectedKind) {
    case 'service':
      return importDiscoveredService(payload, row)
    case 'api':
      return importDiscoveredApi(payload, row, opts)
    default:
      return { imported: false, skippedReason: `unknown-kind:${String(row.detectedKind)}` }
  }
}
