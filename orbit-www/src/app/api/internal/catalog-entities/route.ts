export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { validateInternalApiKey } from '@/lib/auth/internal-api-auth'
import { slugify, uniqueSlug } from '@/lib/catalog/entity-crud'
import { ENTITY_KINDS, type EntityKind } from '@/collections/catalog/constants'

/**
 * POST /api/internal/catalog-entities
 *
 * Lets a Temporal scaffolder run register a catalog entity for its output via
 * the `catalog:entity:register` action (see temporal-workflows'
 * PayloadCatalogEntityClient / CatalogEntityRegister action). This is the
 * server-side implementation of the contract that client proposed — see its
 * doc comment for the Go-side shape.
 *
 * Body (JSON):
 *   {
 *     workspaceId: string,
 *     kind: string,           // one of ENTITY_KINDS
 *     name: string,
 *     owner?: string,         // free-text team/user label; NOT resolved to a
 *                              // catalog-entities relation (that field expects
 *                              // a `team`-kind entity id, which a scaffolder
 *                              // run has no way to know) — stored in
 *                              // metadata.owner instead.
 *     links?: [{ title: string, url: string }],
 *     source: { type: string, sourceId: string },
 *   }
 *
 * `source.type` must be one of the CatalogEntities `source.type` select
 * options (kept in SOURCE_TYPES below, mirroring
 * collections/catalog/CatalogEntities.ts).
 *
 * Idempotency: a row already registered for the same
 * (workspace, source.type, source.sourceId, name) is returned as-is rather
 * than duplicated — a Temporal activity retry of catalog:entity:register is
 * safe to re-run.
 *
 * Auth: X-API-Key, same convention as the templates finalize route.
 *
 * Response: 200 { entityId: string }.
 */

// Mirrors the `source.type` select options in
// collections/catalog/CatalogEntities.ts — keep in sync.
const SOURCE_TYPES = [
  'manual',
  'apps',
  'api-schemas',
  'kafka',
  'sync',
  'scan',
  'template',
  'scaffolder-run',
] as const
type SourceType = (typeof SOURCE_TYPES)[number]

interface CatalogEntityLinkInput {
  title?: unknown
  url?: unknown
}

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

  const requiredStrings = ['workspaceId', 'kind', 'name']
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
  const kind = body.kind as string
  const name = body.name as string
  const sourceType = source.type as string
  const sourceId = source.sourceId as string
  const owner = isNonEmptyString(body.owner) ? (body.owner as string) : undefined

  if (!(ENTITY_KINDS as readonly string[]).includes(kind)) {
    return NextResponse.json(
      { error: `kind must be one of: ${ENTITY_KINDS.join(', ')}` },
      { status: 400 },
    )
  }
  if (!(SOURCE_TYPES as readonly string[]).includes(sourceType)) {
    return NextResponse.json(
      { error: `source.type must be one of: ${SOURCE_TYPES.join(', ')}` },
      { status: 400 },
    )
  }

  let links: { label: string; url: string; type: 'other' }[] | undefined
  if (body.links !== undefined) {
    if (!Array.isArray(body.links)) {
      return NextResponse.json({ error: 'links must be an array' }, { status: 400 })
    }
    for (const l of body.links as CatalogEntityLinkInput[]) {
      if (!isNonEmptyString(l?.title) || !isNonEmptyString(l?.url)) {
        return NextResponse.json({ error: 'each link needs a title and a url' }, { status: 400 })
      }
    }
    const rawLinks = body.links as { title: string; url: string }[]
    links = rawLinks.length > 0
      ? rawLinks.map((l) => ({ label: l.title, url: l.url, type: 'other' as const }))
      : undefined
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
      // Mirrors the templates finalize route: only translate a "not found"
      // lookup failure into a 404; any other failure stays a 500 below.
      if (err instanceof Error && err.message.toLowerCase().includes('not found')) {
        return NextResponse.json({ error: 'workspace not found' }, { status: 404 })
      }
      throw err
    }

    const existing = await payload.find({
      collection: 'catalog-entities',
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
      return NextResponse.json({ entityId: String(existing.docs[0].id) })
    }

    const slugBase = slugify(name) || kind
    const slugCandidates = await payload.find({
      collection: 'catalog-entities',
      where: {
        and: [{ workspace: { equals: workspaceId } }, { slug: { contains: slugBase } }],
      },
      limit: 1000,
      depth: 0,
      overrideAccess: true,
    })
    const taken = slugCandidates.docs.map((d) => d.slug).filter((s): s is string => Boolean(s))
    const slug = uniqueSlug(slugBase, taken)

    const entity = await payload.create({
      collection: 'catalog-entities',
      data: {
        name,
        slug,
        kind: kind as EntityKind,
        workspace: workspaceId,
        source: { type: sourceType as SourceType, sourceId },
        ...(links ? { links } : {}),
        ...(owner ? { metadata: { owner } } : {}),
      },
      overrideAccess: true,
    })

    return NextResponse.json({ entityId: String(entity.id) })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
