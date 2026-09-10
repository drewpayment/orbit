export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { validateInternalApiKey } from '@/lib/auth/internal-api-auth'
import { slugify, uniqueSlug } from '@/lib/catalog/entity-crud'

/**
 * POST /api/internal/api-schemas
 *
 * Lets a Temporal scaffolder run register a spec-first API schema via the
 * `api:schema:register` action (see temporal-workflows'
 * PayloadApiSchemaClient / ApiSchemaRegister action). Mirrors
 * `/api/internal/catalog-entities`'s contract and idempotency shape.
 *
 * Body (JSON):
 *   {
 *     workspaceId: string,   // the run's own workspace (rc.WorkspaceID) —
 *                              never a template-author-supplied input
 *     userId: string,        // the run's initiating user (rc.UserID);
 *                              required because api-schemas.createdBy and
 *                              api-schema-versions.createdBy have no default
 *                              outside a request context
 *     name: string,
 *     schemaType: 'openapi' | 'graphql' | 'proto',
 *     content: string,       // the starter spec text
 *     description?: string,
 *     visibility?: 'private' | 'workspace' | 'public',  // default 'workspace'
 *     source: { type: string, sourceId: string },
 *   }
 *
 * `source.type` must be one of the APISchemas `source.type` select options
 * (kept in SOURCE_TYPES below, mirroring collections/api-catalog/APISchemas.ts).
 *
 * Idempotency: a row already registered for the same
 * (workspace, source.type, source.sourceId, name) is returned as-is (200)
 * rather than duplicated — a Temporal activity retry of api:schema:register
 * is safe to re-run. A fresh create returns 201.
 *
 * Cross-run duplicates: source.sourceId is the Temporal run id, so a
 * DIFFERENT run (e.g. re-running the same published template with the same
 * serviceName) never matches the idempotency check above. If a row with the
 * same canonical slug or the same name already exists in the workspace and
 * was not created by this run, this route responds 409
 * `{ error, code: 'ALREADY_EXISTS', slug }` instead of creating a second
 * row — no silent duplication, no auto-suffixed slug across runs.
 *
 * Content hashing: the created api-schema-versions row is NOT given an
 * explicit contentHash here — APISchemaVersions.ts's own beforeValidate hook
 * computes it (`sha256(rawContent)`) whenever contentHash is unset, so this
 * route reuses that logic instead of reimplementing it.
 *
 * Auth: X-API-Key, same convention as catalog-entities.
 *
 * A missing workspace returns 422, NOT 404: PayloadApiSchemaClient
 * special-cases HTTP 404 to mean "this route isn't deployed yet"
 * (ErrApiSchemasAPINotImplemented) — a 404 for "workspace not found" would
 * be misread as that sentinel.
 */

// Mirrors the `schemaType` options api:schema:register is allowed to write.
// APISchemas.ts additionally allows 'asyncapi', which this action does not
// produce (design §4.1: openapi / graphql / proto are the three spec-first
// starter contract styles).
const REGISTERABLE_SCHEMA_TYPES = ['openapi', 'graphql', 'proto'] as const
type RegisterableSchemaType = (typeof REGISTERABLE_SCHEMA_TYPES)[number]

// Mirrors the `source.type` select options on APISchemas.ts's new `source`
// group — keep in sync.
const SOURCE_TYPES = ['manual', 'scaffolder-run'] as const
type SourceType = (typeof SOURCE_TYPES)[number]

const VISIBILITIES = ['private', 'workspace', 'public'] as const
type Visibility = (typeof VISIBILITIES)[number]

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== ''
}

export async function POST(request: NextRequest) {
  const authError = validateInternalApiKey(request.headers.get('X-API-Key'))
  if (authError) return authError

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const requiredStrings = ['workspaceId', 'userId', 'name', 'schemaType', 'content']
  for (const field of requiredStrings) {
    if (!isNonEmptyString(body[field])) {
      return NextResponse.json({ error: `${field} required` }, { status: 400 })
    }
  }

  const source = body.source as { type?: unknown; sourceId?: unknown } | undefined
  if (!source || typeof source !== 'object') {
    return NextResponse.json({ error: 'source required' }, { status: 400 })
  }
  if (!isNonEmptyString(source.type)) {
    return NextResponse.json({ error: 'source.type required' }, { status: 400 })
  }
  if (!isNonEmptyString(source.sourceId)) {
    return NextResponse.json({ error: 'source.sourceId required' }, { status: 400 })
  }

  const workspaceId = body.workspaceId as string
  const userId = body.userId as string
  const name = body.name as string
  const schemaType = body.schemaType as string
  const content = body.content as string
  const description = isNonEmptyString(body.description) ? (body.description as string) : undefined
  const sourceType = source.type as string
  const sourceId = source.sourceId as string

  if (!(REGISTERABLE_SCHEMA_TYPES as readonly string[]).includes(schemaType)) {
    return NextResponse.json(
      { error: `schemaType must be one of: ${REGISTERABLE_SCHEMA_TYPES.join(', ')}` },
      { status: 400 },
    )
  }
  if (!(SOURCE_TYPES as readonly string[]).includes(sourceType)) {
    return NextResponse.json(
      { error: `source.type must be one of: ${SOURCE_TYPES.join(', ')}` },
      { status: 400 },
    )
  }

  let visibility: Visibility = 'workspace'
  if (body.visibility !== undefined) {
    if (!(VISIBILITIES as readonly string[]).includes(body.visibility as string)) {
      return NextResponse.json(
        { error: `visibility must be one of: ${VISIBILITIES.join(', ')}` },
        { status: 400 },
      )
    }
    visibility = body.visibility as Visibility
  }

  try {
    const payload = await getPayload({ config: configPromise })

    try {
      await payload.findByID({
        collection: 'workspaces',
        id: workspaceId,
        depth: 0,
        overrideAccess: true,
      })
    } catch (err) {
      // NOT a 404: the Go client reserves HTTP 404 to mean "this route isn't
      // implemented" (ErrApiSchemasAPINotImplemented). Only translate a
      // "not found" lookup failure into a 422; any other failure stays a 500
      // below.
      if (err instanceof Error && err.message.toLowerCase().includes('not found')) {
        return NextResponse.json({ error: 'workspace not found' }, { status: 422 })
      }
      throw err
    }

    const existing = await payload.find({
      collection: 'api-schemas',
      where: {
        and: [
          { workspace: { equals: workspaceId } },
          { 'source.type': { equals: sourceType } },
          { 'source.sourceId': { equals: sourceId } },
          { name: { equals: name } },
        ],
      },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    if (existing.docs.length > 0) {
      const schemaId = String(existing.docs[0].id)
      const versions = await payload.find({
        collection: 'api-schema-versions',
        where: { and: [{ schema: { equals: schemaId } }, { versionNumber: { equals: 1 } }] },
        limit: 1,
        depth: 0,
        overrideAccess: true,
      })
      return NextResponse.json(
        {
          schemaId,
          versionId: versions.docs.length > 0 ? String(versions.docs[0].id) : '',
          slug: String(existing.docs[0].slug ?? ''),
        },
        { status: 200 },
      )
    }

    const slugBase = slugify(name) || (schemaType as RegisterableSchemaType)

    // Cross-run duplicate detection (design decision, see PR discussion on
    // duplicate `api-schemas` rows from re-running a published template):
    // the idempotency check above only matches within the SAME run (it keys
    // on source.sourceId, which is the Temporal run id) so a Temporal retry
    // of this action is safe to re-run. But a *different* run registering
    // the same logical schema (e.g. re-running a template with the same
    // serviceName) must NOT silently create a second row — it must fail
    // loudly. A row is treated as "the same schema" when it already has the
    // exact same canonical slug OR the exact same name in this workspace,
    // as long as it wasn't created by this run (that case is already
    // handled above as a same-run retry).
    const conflictCandidates = await payload.find({
      collection: 'api-schemas',
      where: {
        and: [
          { workspace: { equals: workspaceId } },
          { or: [{ slug: { equals: slugBase } }, { name: { equals: name } }] },
        ],
      },
      limit: 10,
      depth: 0,
      overrideAccess: true,
    })
    const conflict = conflictCandidates.docs.find((d) => {
      const docSource = (d as { source?: { type?: string; sourceId?: string } }).source
      return docSource?.sourceId !== sourceId || docSource?.type !== sourceType
    })
    if (conflict) {
      const conflictSlug = String(conflict.slug ?? slugBase)
      return NextResponse.json(
        {
          error: `API schema "${conflictSlug}" already exists in this workspace`,
          code: 'ALREADY_EXISTS',
          slug: conflictSlug,
        },
        { status: 409 },
      )
    }

    const slugCandidates = await payload.find({
      collection: 'api-schemas',
      where: {
        and: [{ workspace: { equals: workspaceId } }, { slug: { contains: slugBase } }],
      },
      limit: 1000,
      depth: 0,
      overrideAccess: true,
    })
    const taken = slugCandidates.docs.map((d) => d.slug).filter((s): s is string => Boolean(s))
    const slug = uniqueSlug(slugBase, taken)

    const schema = await payload.create({
      collection: 'api-schemas',
      data: {
        name,
        slug,
        description: description ?? '',
        workspace: workspaceId,
        visibility,
        schemaType: schemaType as RegisterableSchemaType,
        rawContent: content,
        status: 'draft',
        createdBy: userId,
        source: { type: sourceType as SourceType, sourceId },
        latestVersionNumber: 1,
      },
      overrideAccess: true,
    })

    // Deliberately no `contentHash` here — APISchemaVersions.ts's own
    // beforeValidate hook computes sha256(rawContent) whenever contentHash is
    // unset, so this route reuses that logic rather than reimplementing it.
    const version = await payload.create({
      collection: 'api-schema-versions',
      data: {
        schema: schema.id,
        workspace: workspaceId,
        version: 'v1',
        versionNumber: 1,
        rawContent: content,
        releaseNotes: 'Initial version',
        createdBy: userId,
      },
      overrideAccess: true,
    })

    return NextResponse.json(
      { schemaId: String(schema.id), versionId: String(version.id), slug },
      { status: 201 },
    )
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
