export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import type { Payload } from 'payload'
import configPromise from '@payload-config'
import type { DiscoveredEntity } from '@/payload-types'
import { validateInternalApiKey } from '@/lib/auth/internal-api-auth'
import { runDetectors, type Detection, type EvidenceBundle } from '@/lib/discovery/detectors'
import { computeDedupeKey, importDiscovery } from '@/lib/discovery/import'

/**
 * POST /api/internal/discovery/ingest
 *
 * The Go catalog-scan Temporal worker walks an installation's repos, fetches
 * the well-known files listed in `DISCOVERY_FETCH_PATTERNS` (keep the two lists
 * in sync — see the doc-comment there), and POSTs one evidence bundle per repo
 * scope here. This route runs the pure detectors, upserts `discovered-entities`
 * proposals keyed on `dedupeKey`, and auto-imports Tier-1 (`.orbit.yaml`)
 * detections. Approval of everything else happens later via the server actions.
 *
 * Auth: X-API-Key validated against ORBIT_INTERNAL_API_KEY (constant-time),
 * same guard as `POST /api/internal/catalog/upsert`.
 *
 * Body:
 *   {
 *     installationId: string,
 *     workspaceId: string,
 *     repo: { owner, name, url?, defaultBranch? },
 *     scanRunId?: string,
 *     bundle: { tree: string[], files: Record<path, content> }
 *   }
 *
 * The Go scanner may attach truncation telemetry to the bundle
 * (`skippedLarge` / `truncatedTree` / `truncatedSelection`); those extra fields
 * are tolerated and ignored here — only `tree` and `files` drive detection.
 * `installationId` is the numeric GitHub installation id serialized as a string
 * and is used verbatim in the dedupeKey.
 *
 * Response: { proposed, imported, skippedIgnored } counts (the workflow logs them).
 */

export interface IngestRepo {
  owner: string
  name: string
  url?: string
  defaultBranch?: string
}

export interface IngestBody {
  installationId: string
  workspaceId: string
  repo: IngestRepo
  scanRunId?: string
  bundle: EvidenceBundle
}

export interface IngestCounts {
  proposed: number
  imported: number
  skippedIgnored: number
}

function parseBody(raw: unknown): IngestBody | null {
  if (!raw || typeof raw !== 'object') return null
  const b = raw as Record<string, unknown>
  const repo = b.repo as Record<string, unknown> | undefined
  const bundle = b.bundle as Record<string, unknown> | undefined

  if (typeof b.installationId !== 'string' || b.installationId.length === 0) return null
  if (typeof b.workspaceId !== 'string' || b.workspaceId.length === 0) return null
  if (!repo || typeof repo.owner !== 'string' || typeof repo.name !== 'string') return null
  if (!repo.owner || !repo.name) return null
  if (
    !bundle ||
    !Array.isArray(bundle.tree) ||
    typeof bundle.files !== 'object' ||
    bundle.files === null ||
    Array.isArray(bundle.files)
  ) {
    return null
  }

  return {
    installationId: b.installationId,
    workspaceId: b.workspaceId,
    repo: {
      owner: repo.owner,
      name: repo.name,
      ...(typeof repo.url === 'string' ? { url: repo.url } : {}),
      ...(typeof repo.defaultBranch === 'string' ? { defaultBranch: repo.defaultBranch } : {}),
    },
    ...(typeof b.scanRunId === 'string' ? { scanRunId: b.scanRunId } : {}),
    bundle: {
      tree: (bundle.tree as unknown[]).filter((t): t is string => typeof t === 'string'),
      files: bundle.files as Record<string, string>,
    },
  }
}

/** A detection is Tier 1 (auto-import) iff the `.orbit.yaml` detector fired. */
function isTier1(detection: Detection): boolean {
  return detection.evidence.some((e) => e.detector === 'orbit-manifest')
}

/**
 * Build the persisted proposal, normalizing a fallen-back heuristic service name
 * to the repo name. `detectService` names a root-scope service literally
 * `'service'` when no build manifest gives one; the ingest side knows the real
 * repo name, so use it (handoff note from WP1).
 */
function buildProposal(detection: Detection, repoName: string): Record<string, unknown> {
  const base = detection.proposal ?? {}
  let name = (base.name as string) ?? detection.name
  if (detection.kind === 'service' && detection.path === '' && (!name || name === 'service')) {
    name = repoName
  }
  return { ...base, name }
}

/**
 * Core ingest logic, separated from the HTTP shell so it can be unit-tested with
 * an in-memory FakePayload (the dedupe / no-resurrect / Tier-1 matrix).
 */
export async function ingestScan(payload: Payload, body: IngestBody): Promise<IngestCounts> {
  const { installationId, workspaceId, repo, scanRunId, bundle } = body
  const detections = runDetectors(bundle)
  const ownerRepo = `${repo.owner}/${repo.name}`
  const nowIso = new Date().toISOString()

  let proposed = 0
  let imported = 0
  let skippedIgnored = 0

  for (const detection of detections) {
    const dedupeKey = computeDedupeKey(installationId, ownerRepo, detection.path, detection.kind)
    const found = await payload.find({
      collection: 'discovered-entities',
      where: { dedupeKey: { equals: dedupeKey } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    const existing = found.docs[0] as DiscoveredEntity | undefined

    // Ignored rows are never resurrected — only refresh liveness bookkeeping.
    if (existing && existing.status === 'ignored') {
      await payload.update({
        collection: 'discovered-entities',
        id: existing.id,
        overrideAccess: true,
        data: { lastSeenAt: nowIso, ...(scanRunId ? { scanRunId } : {}) },
      })
      skippedIgnored++
      continue
    }

    const proposal = buildProposal(detection, repo.name)

    let row: DiscoveredEntity
    if (!existing) {
      row = (await payload.create({
        collection: 'discovered-entities',
        overrideAccess: true,
        data: {
          workspace: workspaceId,
          installation: installationId,
          repo: {
            owner: repo.owner,
            name: repo.name,
            ...(repo.url ? { url: repo.url } : {}),
            ...(repo.defaultBranch ? { defaultBranch: repo.defaultBranch } : {}),
          },
          path: detection.path,
          detectedKind: detection.kind,
          confidence: detection.confidence,
          evidence: detection.evidence,
          proposal,
          status: 'proposed',
          dedupeKey,
          ...(scanRunId ? { scanRunId } : {}),
          lastSeenAt: nowIso,
        },
      })) as DiscoveredEntity
    } else if (existing.status === 'imported' || existing.status === 'approved') {
      // Already actioned — refresh liveness, keep evidence/proposal/status intact.
      await payload.update({
        collection: 'discovered-entities',
        id: existing.id,
        overrideAccess: true,
        data: { lastSeenAt: nowIso, ...(scanRunId ? { scanRunId } : {}) },
      })
      row = { ...existing, lastSeenAt: nowIso }
    } else {
      // proposed or stale — refresh evidence/proposal/confidence and (re)assert proposed.
      row = (await payload.update({
        collection: 'discovered-entities',
        id: existing.id,
        overrideAccess: true,
        data: {
          confidence: detection.confidence,
          evidence: detection.evidence,
          proposal,
          status: 'proposed',
          lastSeenAt: nowIso,
          ...(scanRunId ? { scanRunId } : {}),
        },
      })) as DiscoveredEntity
    }

    // Tier 1 (.orbit.yaml) auto-imports immediately; the row is kept as
    // `imported` for traceability.
    if (isTier1(detection) && row.status !== 'imported') {
      const res = await importDiscovery(payload, row)
      if (res.imported) row = { ...row, status: 'imported' }
    }

    if (row.status === 'imported') imported++
    else proposed++
  }

  return { proposed, imported, skippedIgnored }
}

export async function POST(request: NextRequest) {
  const authError = validateInternalApiKey(request.headers.get('X-API-Key'))
  if (authError) return authError

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const body = parseBody(raw)
  if (!body) {
    return NextResponse.json(
      {
        error:
          'Malformed body: expected { installationId, workspaceId, repo{owner,name}, bundle{tree,files} }',
      },
      { status: 400 },
    )
  }

  try {
    const payload = await getPayload({ config: configPromise })
    const counts = await ingestScan(payload, body)
    return NextResponse.json(counts)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
