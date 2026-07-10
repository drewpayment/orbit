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

/**
 * Deterministic Temporal workflow id for an Azure DevOps (git-connections)
 * catalog scan (WP11). Keyed on the git-connections doc id so "Scan" is
 * idempotent under USE_EXISTING, and namespaced (`-ado-`) so it never collides
 * with a numeric GitHub installation scan id.
 */
export function catalogScanAdoWorkflowId(connectionId: string): string {
  return `catalog-scan-ado-${connectionId}`
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
  /**
   * The row the proposal was imported into — the "View imported" affordance's
   * link target (WI: import traceability). `collectionSlug` maps to a detail
   * route in the UI (`apps` → /apps, `catalog-entities` → /catalog, `api-schemas`
   * → /catalog/apis); absent when the import was skipped.
   */
  ref?: { collectionSlug: string; docId: string }
}

export interface ApproveOptions {
  /**
   * Assign every GLOBAL (workspace-less) row in this batch to this workspace and
   * import it through the normal apps/api-schemas path (WP8). Workspace rows in
   * the same batch ignore it. Platform-admin only (enforced here).
   */
  assignWorkspaceId?: string
}

/**
 * Approve rows: for each id, load the row, authorize the caller for *that row's*
 * scope, then run the importer with the acting member as the `api-schemas`
 * actor. Authorization (AC-7):
 *  - workspace row → platform admin OR an active member of that workspace;
 *  - global row (no workspace) → platform admin ONLY.
 * A global row imports as a global catalog entity, unless `assignWorkspaceId` is
 * set (admin routing it into a workspace). A row the caller can't reach fails
 * that single id (`forbidden`) rather than the whole batch; import skips (e.g.
 * `unsupported-schema-type:graphql`) surface as `skippedReason`.
 */
export async function approveDiscoveriesCore(
  payload: Payload,
  betterAuthId: string,
  actorUserId: string,
  isAdmin: boolean,
  ids: string[],
  opts: ApproveOptions = {},
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
    const allowed = workspaceId
      ? isAdmin || (await isMemberCached(payload, betterAuthId, workspaceId, memberOf))
      : isAdmin // global rows: platform admin only
    if (!allowed) {
      results.push({ id, imported: false, skippedReason: 'forbidden' })
      continue
    }

    // assignWorkspaceId only applies to a global row an admin is routing into a
    // workspace; workspace rows import normally regardless.
    const importOpts =
      !workspaceId && opts.assignWorkspaceId
        ? { actorUserId, assignWorkspaceId: opts.assignWorkspaceId }
        : { actorUserId }
    const result = await importDiscovery(payload, row, importOpts)
    results.push({
      id,
      imported: result.imported,
      ...(result.skippedReason ? { skippedReason: result.skippedReason } : {}),
      ...(result.ref ? { ref: { collectionSlug: result.ref.collection, docId: result.ref.id } } : {}),
    })
  }

  return results
}

/**
 * Rows with no workspace (global proposals), matching the optional status/kind
 * filter, sorted for the review queue. Platform admin only — a non-admin gets an
 * empty list (AC-7 for the global queue).
 */
export async function listGlobalDiscoveriesCore(
  payload: Payload,
  isAdmin: boolean,
  filter: DiscoveryFilter = {},
): Promise<DiscoveredEntity[]> {
  if (!isAdmin) return []

  const and: Where[] = [{ workspace: { exists: false } }]
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

export interface IgnoreResult {
  id: string
  ignored: boolean
  /** Set when the row could not be ignored (e.g. `forbidden`, `not-found`). */
  reason?: string
}

/**
 * Ignore rows; sets `status: 'ignored'` so a re-scan will not resurrect the
 * proposal (the ingest route never revives an ignored row). Authorization
 * mirrors approve: workspace row → platform admin OR active member; global row →
 * platform admin only. Already-imported rows are left as-is.
 */
export async function ignoreDiscoveriesCore(
  payload: Payload,
  betterAuthId: string,
  isAdmin: boolean,
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
    const allowed = workspaceId
      ? isAdmin || (await isMemberCached(payload, betterAuthId, workspaceId, memberOf))
      : isAdmin // global rows: platform admin only
    if (!allowed) {
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

export type RenameResult = { ok: true } | { ok: false; reason: string }

const MAX_PROPOSAL_NAME_LENGTH = 120

/**
 * Rename a single proposal (Phase 3, `docs/plans/2026-07-10-graphql-schema-import.md`):
 * Drew chose inline rename over an approve-time confirm dialog, since a real org
 * scan produces ~200+ proposals and per-approve friction is unacceptable. The
 * edited name is written onto `proposal.name`, so both single and bulk approve
 * import with it (`buildProposal`/the importers already read `proposal.name`
 * first).
 *
 * Authorization mirrors `approveDiscoveriesCore`: workspace row → platform admin
 * OR an active member of that workspace; global row → platform admin only.
 * `actorUserId` isn't written anywhere (there's no "renamed by" field), but is
 * kept in the signature so the `'use server'` wrapper resolves the caller
 * identically to `approveDiscoveries`.
 */
export async function renameDiscoveryCore(
  payload: Payload,
  betterAuthId: string,
  actorUserId: string,
  isAdmin: boolean,
  id: string,
  name: string,
): Promise<RenameResult> {
  void actorUserId

  let row: DiscoveredEntity
  try {
    row = (await payload.findByID({
      collection: 'discovered-entities',
      id,
      depth: 0,
      overrideAccess: true,
    })) as DiscoveredEntity
  } catch {
    return { ok: false, reason: 'not-found' }
  }

  const workspaceId = relId(row.workspace)
  const allowed = workspaceId
    ? isAdmin || (await isMemberCached(payload, betterAuthId, workspaceId, new Map()))
    : isAdmin // global rows: platform admin only
  if (!allowed) {
    return { ok: false, reason: 'forbidden' }
  }

  if (row.status !== 'proposed') {
    return { ok: false, reason: 'invalid-status' }
  }

  const trimmed = name.trim()
  if (!trimmed || trimmed.length > MAX_PROPOSAL_NAME_LENGTH) {
    return { ok: false, reason: 'invalid-name' }
  }

  const proposal = (row.proposal && typeof row.proposal === 'object' && !Array.isArray(row.proposal)
    ? row.proposal
    : {}) as Record<string, unknown>

  await payload.update({
    collection: 'discovered-entities',
    id,
    overrideAccess: true,
    data: { proposal: { ...proposal, name: trimmed } },
  })

  return { ok: true }
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

/**
 * Start a GLOBAL installation scan (WP8): platform admin only, empty workspaceId
 * so the workflow produces workspace-less proposals. Returns the started scan, or
 * null when the starter reported a transient Temporal failure.
 */
export async function startInstallationScanCore(
  isAdmin: boolean,
  installationId: number | string,
  start: CatalogScanStarter,
): Promise<{ started: StartedScan | null }> {
  if (!isAdmin) throw new Error('Platform admin required')
  const id = String(installationId)
  const workflowId = await start({ installationId: id, workspaceId: '' })
  return { started: workflowId ? { installationId: id, workflowId } : null }
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
