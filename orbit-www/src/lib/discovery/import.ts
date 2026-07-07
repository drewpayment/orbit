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
  /** Set when the proposal was intentionally not imported (e.g. graphql). */
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
}

/**
 * `api-schemas` only supports these two schema types (see APISchemas.ts). The
 * `detectApiSpecs` detector can additionally emit 'graphql'; those proposals are
 * skipped on import rather than writing an invalid enum value — the proposal row
 * still lives in the review queue for visibility.
 */
const SUPPORTED_API_SCHEMA_TYPES = new Set(['openapi', 'asyncapi'])

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
  if (discovery.status === 'imported' && discovery.importedRef?.id) {
    return {
      imported: true,
      ref: { collection: discovery.importedRef.collection || 'apps', id: discovery.importedRef.id },
    }
  }

  const workspaceId = relId(discovery.workspace)
  if (!workspaceId) return { imported: false, skippedReason: 'missing-workspace' }

  const proposal = asRecord(discovery.proposal)
  const { owner, name: repoName, url, defaultBranch } = discovery.repo

  let appId = await findRepoApp(payload, workspaceId, owner, repoName)
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
          owner,
          name: repoName,
          ...(url ? { url } : {}),
          ...(installationId ? { installationId } : {}),
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
      importedRef: { collection: 'apps', id: appId },
    },
  })

  return { imported: true, ref: { collection: 'apps', id: appId } }
}

/**
 * Import an API proposal into an `api-schemas` row, letting the existing
 * projection emit the `api` entity + `exposes-api` relation. graphql proposals
 * are skipped (unsupported schemaType). Idempotent: an existing api-schemas row
 * for the same workspace + repositoryPath (+ App when known) is linked, not
 * duplicated.
 */
export async function importDiscoveredApi(
  payload: Payload,
  discovery: DiscoveredEntity,
  opts: ImportOptions = {},
): Promise<ImportResult> {
  if (discovery.status === 'imported' && discovery.importedRef?.id) {
    return {
      imported: true,
      ref: {
        collection: discovery.importedRef.collection || 'api-schemas',
        id: discovery.importedRef.id,
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
  const { owner, name: repoName } = discovery.repo
  const appId = await findRepoApp(payload, workspaceId, owner, repoName)

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
        schemaType: schemaType as 'openapi' | 'asyncapi',
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
      importedRef: { collection: 'api-schemas', id: schemaId },
    },
  })

  return { imported: true, ref: { collection: 'api-schemas', id: schemaId } }
}

/** Dispatch a discovery row to the importer for its kind. */
export async function importDiscovery(
  payload: Payload,
  discovery: DiscoveredEntity,
  opts: ImportOptions = {},
): Promise<ImportResult> {
  switch (discovery.detectedKind) {
    case 'service':
      return importDiscoveredService(payload, discovery)
    case 'api':
      return importDiscoveredApi(payload, discovery, opts)
    default:
      return { imported: false, skippedReason: `unknown-kind:${String(discovery.detectedKind)}` }
  }
}
