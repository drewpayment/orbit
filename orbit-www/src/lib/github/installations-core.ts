import type { Payload } from 'payload'

/**
 * Pure, Payload-agnostic core for the Platform Admin "GitHub Installations"
 * page (WP9). Keeps the token-health math (expiry) and the doc→view projection
 * out of the server-action/session glue so they can be unit-tested against a
 * FakePayload without a real database or a live session.
 *
 * The projection NEVER carries the encrypted `installationToken` field — the
 * admin UI has no use for it and it must not cross the server/client boundary.
 */

export type InstallationStatus = 'active' | 'suspended' | 'refresh_failed' | 'needs_reconnect'

export interface AdminInstallationWorkspace {
  id: string
  name: string
}

export interface AdminInstallationView {
  id: string
  installationId: string
  accountLogin: string
  status: InstallationStatus
  tokenExpiresAt: string | null
  /** Computed server-side against `now`; true when the token is at/past expiry. */
  tokenExpired: boolean
  repositorySelection: 'all' | 'selected'
  selectedRepositoryCount: number
  allowedWorkspaces: AdminInstallationWorkspace[]
  lastFailureReason: string | null
  updatedAt: string | null
}

/** Slim shape the refresh-poll returns so the client can watch for the flip. */
export interface InstallationRefreshState {
  status: InstallationStatus
  tokenExpiresAt: string | null
  tokenExpired: boolean
}

/**
 * True when the token is missing, unparseable, or at/past its expiry. A null or
 * malformed timestamp is treated as expired (fail-loud for the admin view).
 */
export function isTokenExpired(
  tokenExpiresAt: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!tokenExpiresAt) return true
  const exp = new Date(tokenExpiresAt).getTime()
  if (Number.isNaN(exp)) return true
  return exp <= now.getTime()
}

/** Map a raw github-installations doc (allowedWorkspaces populated at depth ≥1). */
export function toAdminInstallationView(
  doc: Record<string, unknown>,
  now: Date = new Date(),
): AdminInstallationView {
  const tokenExpiresAt = typeof doc.tokenExpiresAt === 'string' ? doc.tokenExpiresAt : null

  const selected = Array.isArray(doc.selectedRepositories) ? doc.selectedRepositories : []

  const allowedRaw = Array.isArray(doc.allowedWorkspaces) ? doc.allowedWorkspaces : []
  const allowedWorkspaces: AdminInstallationWorkspace[] = allowedRaw.map((w) => {
    if (w && typeof w === 'object') {
      const ws = w as Record<string, unknown>
      const id = String(ws.id)
      const name = typeof ws.name === 'string' && ws.name ? ws.name : id
      return { id, name }
    }
    // Unpopulated relationship (depth 0): only the id is known.
    return { id: String(w), name: String(w) }
  })

  return {
    id: String(doc.id),
    installationId: String(doc.installationId ?? ''),
    accountLogin: typeof doc.accountLogin === 'string' ? doc.accountLogin : String(doc.installationId ?? ''),
    status: (doc.status as InstallationStatus) ?? 'active',
    tokenExpiresAt,
    tokenExpired: isTokenExpired(tokenExpiresAt, now),
    repositorySelection: (doc.repositorySelection as 'all' | 'selected') ?? 'all',
    selectedRepositoryCount: selected.length,
    allowedWorkspaces,
    lastFailureReason: typeof doc.lastFailureReason === 'string' ? doc.lastFailureReason : null,
    updatedAt: typeof doc.updatedAt === 'string' ? doc.updatedAt : null,
  }
}

/**
 * Order for the admin list: anything needing attention (non-active status OR an
 * expired token) sorts to the top, then alphabetically by account login. This
 * puts the exact failure Drew hit — an expired token with no visible signal —
 * first in the list.
 */
export function sortInstallations(views: AdminInstallationView[]): AdminInstallationView[] {
  const needsAttention = (v: AdminInstallationView) => v.status !== 'active' || v.tokenExpired
  return [...views].sort((a, b) => {
    const aa = needsAttention(a) ? 0 : 1
    const bb = needsAttention(b) ? 0 : 1
    if (aa !== bb) return aa - bb
    return a.accountLogin.localeCompare(b.accountLogin)
  })
}

/**
 * Load every github-installations doc and project to the admin view, unhealthy
 * first. `overrideAccess` is deliberate: the caller (server action) has already
 * enforced platform-admin, and this is a system-level operational list.
 */
export async function listInstallationsAdminCore(
  payload: Payload,
  now: Date = new Date(),
): Promise<AdminInstallationView[]> {
  const result = await payload.find({
    collection: 'github-installations',
    limit: 500,
    depth: 1, // populate allowedWorkspaces so we can show names
    overrideAccess: true,
  })
  const views = result.docs.map((doc) => toAdminInstallationView(doc as unknown as Record<string, unknown>, now))
  return sortInstallations(views)
}

/**
 * Count the Apps that reference a GitHub installation via
 * `repository.installationId` (a TEXT field holding the numeric GitHub id as a
 * string). Surfaced in the Remove-connection confirm dialog so an admin sees
 * how many Apps keep their data but lose GitHub access at the next token use.
 */
export async function countAppsForInstallation(
  payload: Payload,
  numericInstallationId: string,
): Promise<number> {
  const res = await payload.find({
    collection: 'apps',
    where: { 'repository.installationId': { equals: numericInstallationId } },
    limit: 0, // totalDocs only; we don't need the rows
    depth: 0,
    overrideAccess: true,
  })
  return res.totalDocs
}

export interface DeleteInstallationResult {
  ok: boolean
  error?: string
  /** Apps that referenced the installation at delete time (for the toast). */
  appCount: number
}

/**
 * Remove a GitHub installation: count referencing Apps, cancel the token
 * refresh workflow (best-effort — a not-found/closed workflow is ignored), then
 * delete the doc. Apps keep their rows but lose GitHub access at their next
 * token use; the app itself must still be uninstalled on GitHub (the UI links
 * to it — we cannot uninstall server-side). `cancelRefresh` is injected so the
 * core stays Temporal-free and unit-testable.
 */
export async function deleteInstallationCore(
  payload: Payload,
  docId: string,
  cancelRefresh: () => Promise<void>,
): Promise<DeleteInstallationResult> {
  let doc: Record<string, unknown>
  try {
    doc = (await payload.findByID({
      collection: 'github-installations',
      id: docId,
      depth: 0,
      overrideAccess: true,
    })) as unknown as Record<string, unknown>
  } catch {
    return { ok: false, error: 'Installation not found', appCount: 0 }
  }

  const numericId = String(doc.installationId ?? '')
  const appCount = numericId ? await countAppsForInstallation(payload, numericId) : 0

  // Best-effort: a dead/closed/never-started workflow must not block deletion.
  try {
    await cancelRefresh()
  } catch {
    // ignore — the workflow may already be gone
  }

  try {
    await payload.delete({ collection: 'github-installations', id: docId, overrideAccess: true })
  } catch {
    return { ok: false, error: 'Failed to delete installation', appCount }
  }

  return { ok: true, appCount }
}

/**
 * Re-read one installation and return just its refresh-relevant state so the
 * client can poll for the token-expiry flip after triggering a refresh.
 */
export async function getInstallationRefreshStateCore(
  payload: Payload,
  docId: string,
  now: Date = new Date(),
): Promise<InstallationRefreshState> {
  const doc = (await payload.findByID({
    collection: 'github-installations',
    id: docId,
    depth: 0,
    overrideAccess: true,
  })) as unknown as Record<string, unknown>

  const tokenExpiresAt = typeof doc.tokenExpiresAt === 'string' ? doc.tokenExpiresAt : null
  return {
    status: (doc.status as InstallationStatus) ?? 'active',
    tokenExpiresAt,
    tokenExpired: isTokenExpired(tokenExpiresAt, now),
  }
}
