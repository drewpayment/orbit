import type { Payload, Where } from 'payload'
import type { DiscoveredEntity } from '@/payload-types'
import { getWorkspaceMembership } from '@/lib/access/workspace-access'
import { importDiscovery } from './import'

/**
 * Testable core for the Catalog Discovery server actions (Phase 1,
 * docs/plans/2026-07-06-catalog-discovery.md).
 *
 * The `'use server'` wrappers in `app/actions/discovery.ts` resolve the session
 * (Better-Auth id for RBAC, Payload `users` id as the import actor) and the
 * Temporal client, then delegate the RBAC + dispatch decisions here. Keeping the
 * logic in a session/Temporal-free module lets it be unit-tested with the same
 * FakePayload pattern used by `import.test.ts` / `route.test.ts`.
 *
 * Every mutation runs `overrideAccess: true`: the membership check in each
 * function IS the authz (AC-7), so the underlying Payload write is trusted only
 * after it passes. Membership is keyed on the caller's **Better-Auth id**
 * (`workspace-members.user` is a TEXT field holding that id) — never the Payload
 * `users` id (the recurring tenant-isolation gotcha).
 */

/**
 * Deterministic Temporal workflow id for a catalog scan. Keyed on the NUMERIC
 * GitHub installation id (the `github-installations.installationId` value, as a
 * string) so a "Scan now" is idempotent under USE_EXISTING. Owned here (not in
 * the Temporal client) so it stays unit-testable without pulling the Temporal
 * SDK into the test graph; `lib/temporal/client.ts` imports it.
 */
export function catalogScanWorkflowId(installationId: string): string {
  return `catalog-scan-${installationId}`
}

/** Normalize a relationship value (`string` id or populated `{ id }`) to its id. */
function relId(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value === 'object' && 'id' in (value as Record<string, unknown>)) {
    return String((value as { id: unknown }).id)
  }
  return null
}

export interface DiscoveryFilter {
  status?: DiscoveredEntity['status']
  kind?: DiscoveredEntity['detectedKind']
}

/**
 * Stable review-queue ordering: by repository (`owner/name`), then by in-repo
 * path so a monorepo's proposals group under their repo header in the UI.
 */
export function sortDiscoveries(rows: DiscoveredEntity[]): DiscoveredEntity[] {
  return [...rows].sort((a, b) => {
    const ra = `${a.repo?.owner ?? ''}/${a.repo?.name ?? ''}`
    const rb = `${b.repo?.owner ?? ''}/${b.repo?.name ?? ''}`
    return ra.localeCompare(rb) || (a.path ?? '').localeCompare(b.path ?? '')
  })
}

/**
 * Rows in `workspaceId` matching the optional status/kind filter, sorted for the
 * review queue. Non-members get an empty list (never another workspace's rows).
 */
export async function listDiscoveriesCore(
  payload: Payload,
  betterAuthId: string,
  workspaceId: string,
  filter: DiscoveryFilter = {},
): Promise<DiscoveredEntity[]> {
  if (!betterAuthId || !workspaceId) return []
  const membership = await getWorkspaceMembership(payload, betterAuthId, workspaceId)
  if (!membership) return []

  const and: Where[] = [{ workspace: { equals: workspaceId } }]
  if (filter.status) and.push({ status: { equals: filter.status } })
  if (filter.kind) and.push({ detectedKind: { equals: filter.kind } })

  const res = await payload.find({
    collection: 'discovered-entities',
    where: { and },
    limit: 1000,
    depth: 0,
    overrideAccess: true,
  })
  return sortDiscoveries(res.docs as DiscoveredEntity[])
}

export interface ApproveResult {
  id: string
  imported: boolean
  /** Per-row reason the import was skipped (surfaced inline in the UI). */
  skippedReason?: string
}

/**
 * Approve rows: for each id, load the row, verify the caller is an active member
 * of *that row's* workspace, then run the importer with the acting member as the
 * `api-schemas` actor. A row the caller can't reach (missing / other workspace)
 * fails that single id (`forbidden`) rather than the whole batch. Import skips
 * (e.g. `unsupported-schema-type:graphql`) surface as `skippedReason`.
 */
export async function approveDiscoveriesCore(
  payload: Payload,
  betterAuthId: string,
  actorUserId: string,
  ids: string[],
): Promise<ApproveResult[]> {
  const results: ApproveResult[] = []
  const memberOf = new Map<string, boolean>()

  for (const id of ids) {
    let row: DiscoveredEntity
    try {
      row = (await payload.findByID({
        collection: 'discovered-entities',
        id,
        depth: 0,
        overrideAccess: true,
      })) as DiscoveredEntity
    } catch {
      results.push({ id, imported: false, skippedReason: 'not-found' })
      continue
    }

    const workspaceId = relId(row.workspace)
    if (!workspaceId || !(await isMemberCached(payload, betterAuthId, workspaceId, memberOf))) {
      results.push({ id, imported: false, skippedReason: 'forbidden' })
      continue
    }

    const result = await importDiscovery(payload, row, { actorUserId })
    results.push({
      id,
      imported: result.imported,
      ...(result.skippedReason ? { skippedReason: result.skippedReason } : {}),
    })
  }

  return results
}

export interface IgnoreResult {
  id: string
  ignored: boolean
  /** Set when the row could not be ignored (e.g. `forbidden`, `not-found`). */
  reason?: string
}

/**
 * Ignore rows: member-gated per row's workspace; sets `status: 'ignored'` so a
 * re-scan will not resurrect the proposal (the ingest route never revives an
 * ignored row). Already-imported rows are left as-is.
 */
export async function ignoreDiscoveriesCore(
  payload: Payload,
  betterAuthId: string,
  ids: string[],
): Promise<IgnoreResult[]> {
  const results: IgnoreResult[] = []
  const memberOf = new Map<string, boolean>()

  for (const id of ids) {
    let row: DiscoveredEntity
    try {
      row = (await payload.findByID({
        collection: 'discovered-entities',
        id,
        depth: 0,
        overrideAccess: true,
      })) as DiscoveredEntity
    } catch {
      results.push({ id, ignored: false, reason: 'not-found' })
      continue
    }

    const workspaceId = relId(row.workspace)
    if (!workspaceId || !(await isMemberCached(payload, betterAuthId, workspaceId, memberOf))) {
      results.push({ id, ignored: false, reason: 'forbidden' })
      continue
    }
    if (row.status === 'imported') {
      results.push({ id, ignored: false, reason: 'already-imported' })
      continue
    }

    await payload.update({
      collection: 'discovered-entities',
      id,
      overrideAccess: true,
      data: { status: 'ignored' },
    })
    results.push({ id, ignored: true })
  }

  return results
}

export interface StartedScan {
  installationId: string
  workflowId: string
}

/** Starts one catalog-scan workflow; returns its id, or null on a real failure. */
export type CatalogScanStarter = (input: {
  installationId: string
  workspaceId: string
}) => Promise<string | null>

/**
 * Start a catalog scan for every installation the workspace can scan. Gated on
 * active membership (throws for non-members — AC-7). Passes the NUMERIC
 * installation id (as string) to the workflow; a starter that returns null
 * (transient Temporal failure) is skipped, not fatal, so one bad installation
 * doesn't block the others.
 */
export async function startWorkspaceScanCore(
  payload: Payload,
  betterAuthId: string,
  workspaceId: string,
  installations: { installationId: number | string }[],
  start: CatalogScanStarter,
): Promise<{ started: StartedScan[] }> {
  const membership = await getWorkspaceMembership(payload, betterAuthId, workspaceId)
  if (!membership) throw new Error('Not a member of this workspace')

  const started: StartedScan[] = []
  for (const inst of installations) {
    const installationId = String(inst.installationId)
    const workflowId = await start({ installationId, workspaceId })
    if (workflowId) started.push({ installationId, workflowId })
  }
  return { started }
}

async function isMemberCached(
  payload: Payload,
  betterAuthId: string,
  workspaceId: string,
  cache: Map<string, boolean>,
): Promise<boolean> {
  const cached = cache.get(workspaceId)
  if (cached !== undefined) return cached
  const membership = await getWorkspaceMembership(payload, betterAuthId, workspaceId)
  const ok = membership !== null
  cache.set(workspaceId, ok)
  return ok
}
