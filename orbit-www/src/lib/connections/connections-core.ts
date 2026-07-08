import type { Payload } from 'payload'
import { decrypt as defaultDecrypt } from '@/lib/encryption'

/**
 * Testable core for the Platform Admin "Connections" page (WP11) — the
 * git-connections analogue of `lib/github/installations-core.ts`. Keeps the
 * doc→view projection, the create/update/delete plumbing, and the Azure DevOps
 * PAT validation out of the session/Temporal glue so they can be unit-tested
 * against a FakePayload with an injected `fetch`/`decrypt`.
 *
 * The projection NEVER carries the encrypted `credentials.pat` — the admin UI
 * only needs to know whether a PAT is set (`patSet`) to drive the write-only
 * edit affordance. The plaintext PAT is exposed solely to the Go worker via
 * `POST /api/internal/git-connections/token`.
 */

const DEFAULT_BASE_URL = 'https://dev.azure.com'

export type ConnectionStatus = 'active' | 'error'

export interface AdminConnectionWorkspace {
  id: string
  name: string
}

export interface AdminConnectionView {
  id: string
  name: string
  provider: string
  organization: string
  project: string
  baseUrl: string
  status: ConnectionStatus
  lastValidatedAt: string | null
  lastError: string | null
  /** Whether a PAT is stored — drives the "PAT set — enter to replace" UI. */
  patSet: boolean
  allowedWorkspaces: AdminConnectionWorkspace[]
  updatedAt: string | null
}

/** Map a raw git-connections doc (allowedWorkspaces populated at depth ≥1). */
export function toAdminConnectionView(doc: Record<string, unknown>): AdminConnectionView {
  const credentials = (doc.credentials ?? {}) as Record<string, unknown>
  const patSet = typeof credentials.pat === 'string' && credentials.pat.length > 0

  const allowedRaw = Array.isArray(doc.allowedWorkspaces) ? doc.allowedWorkspaces : []
  const allowedWorkspaces: AdminConnectionWorkspace[] = allowedRaw.map((w) => {
    if (w && typeof w === 'object') {
      const ws = w as Record<string, unknown>
      const id = String(ws.id)
      const name = typeof ws.name === 'string' && ws.name ? ws.name : id
      return { id, name }
    }
    return { id: String(w), name: String(w) }
  })

  return {
    id: String(doc.id),
    name: typeof doc.name === 'string' ? doc.name : '',
    provider: typeof doc.provider === 'string' ? doc.provider : 'azure-devops',
    organization: typeof doc.organization === 'string' ? doc.organization : '',
    project: typeof doc.project === 'string' ? doc.project : '',
    baseUrl: typeof doc.baseUrl === 'string' && doc.baseUrl ? doc.baseUrl : DEFAULT_BASE_URL,
    status: (doc.status as ConnectionStatus) ?? 'active',
    lastValidatedAt: typeof doc.lastValidatedAt === 'string' ? doc.lastValidatedAt : null,
    lastError: typeof doc.lastError === 'string' ? doc.lastError : null,
    patSet,
    allowedWorkspaces,
    updatedAt: typeof doc.updatedAt === 'string' ? doc.updatedAt : null,
  }
}

/**
 * Load every git-connections doc and project to the PAT-less admin view, sorted
 * by name. `overrideAccess` is deliberate: the caller (server action) has
 * already enforced platform-admin.
 */
export async function listConnectionsAdminCore(payload: Payload): Promise<AdminConnectionView[]> {
  const result = await payload.find({
    collection: 'git-connections',
    limit: 500,
    depth: 1, // populate allowedWorkspaces so we can show names
    sort: 'name',
    overrideAccess: true,
  })
  return result.docs.map((doc) => toAdminConnectionView(doc as unknown as Record<string, unknown>))
}

export interface CreateConnectionInput {
  name: string
  provider?: string
  organization: string
  project?: string
  baseUrl?: string
  pat?: string
  allowedWorkspaces?: string[]
}

export interface MutateConnectionResult {
  ok: boolean
  error?: string
  id?: string
}

/** Trim + validate the shared required fields (name, organization). */
function validateRequired(name: unknown, organization: unknown): string | null {
  if (typeof name !== 'string' || name.trim().length === 0) return 'A name is required'
  if (typeof organization !== 'string' || organization.trim().length === 0)
    return 'An organization is required'
  return null
}

/**
 * Create a git-connection. Validates the required fields, stores the PAT (the
 * collection beforeChange hook encrypts it), and defaults provider/baseUrl.
 */
export async function createConnectionCore(
  payload: Payload,
  input: CreateConnectionInput,
): Promise<MutateConnectionResult> {
  const invalid = validateRequired(input.name, input.organization)
  if (invalid) return { ok: false, error: invalid }

  const data: Record<string, unknown> = {
    name: input.name.trim(),
    provider: input.provider || 'azure-devops',
    organization: input.organization.trim(),
    project: input.project?.trim() || '',
    baseUrl: input.baseUrl?.trim() || DEFAULT_BASE_URL,
    status: 'active',
    ...(input.allowedWorkspaces ? { allowedWorkspaces: input.allowedWorkspaces } : {}),
  }
  // Only include credentials when a PAT was supplied; the hook encrypts it.
  if (input.pat && input.pat.length > 0) {
    data.credentials = { pat: input.pat }
  }

  const doc = await payload.create({
    collection: 'git-connections',
    data: data as never,
    overrideAccess: true,
  })
  return { ok: true, id: String((doc as { id: unknown }).id) }
}

export interface UpdateConnectionInput {
  id: string
  name?: string
  organization?: string
  project?: string
  baseUrl?: string
  /** Absent/empty means KEEP the stored PAT (write-only edit). */
  pat?: string
  allowedWorkspaces?: string[]
}

/**
 * Update a git-connection. The PAT is write-only: an absent/empty `pat` leaves
 * the stored (encrypted) value untouched — `credentials` is only written when a
 * replacement PAT is supplied.
 */
export async function updateConnectionCore(
  payload: Payload,
  input: UpdateConnectionInput,
): Promise<MutateConnectionResult> {
  if (!input.id) return { ok: false, error: 'Connection id is required' }
  if (input.name !== undefined && input.name.trim().length === 0)
    return { ok: false, error: 'A name is required' }
  if (input.organization !== undefined && input.organization.trim().length === 0)
    return { ok: false, error: 'An organization is required' }

  const data: Record<string, unknown> = {}
  if (input.name !== undefined) data.name = input.name.trim()
  if (input.organization !== undefined) data.organization = input.organization.trim()
  if (input.project !== undefined) data.project = input.project.trim()
  if (input.baseUrl !== undefined) data.baseUrl = input.baseUrl.trim() || DEFAULT_BASE_URL
  if (input.allowedWorkspaces !== undefined) data.allowedWorkspaces = input.allowedWorkspaces
  // Only touch credentials when a replacement PAT was supplied.
  if (input.pat && input.pat.length > 0) data.credentials = { pat: input.pat }

  try {
    await payload.update({
      collection: 'git-connections',
      id: input.id,
      data: data as never,
      overrideAccess: true,
    })
    return { ok: true, id: input.id }
  } catch {
    return { ok: false, error: 'Connection not found' }
  }
}

export async function deleteConnectionCore(
  payload: Payload,
  id: string,
): Promise<MutateConnectionResult> {
  if (!id) return { ok: false, error: 'Connection id is required' }
  try {
    await payload.delete({ collection: 'git-connections', id, overrideAccess: true })
    return { ok: true, id }
  } catch {
    return { ok: false, error: 'Connection not found' }
  }
}

/** Minimal fetch surface the validator needs (status is all that matters). */
export type ValidateFetch = (
  url: string,
  init: { method: string; headers: Record<string, string> },
) => Promise<{ status: number; statusText?: string }>

export interface ValidateConnectionResult {
  ok: boolean
  status: ConnectionStatus
  error?: string
  lastValidatedAt?: string
}

/**
 * Build the Azure DevOps "list projects" probe URL:
 *   {baseUrl}/{organization}/_apis/projects?api-version=7.1
 * A 200 proves the PAT can authenticate against the org.
 */
export function adoProjectsUrl(baseUrl: string, organization: string): string {
  const base = (baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '')
  return `${base}/${encodeURIComponent(organization)}/_apis/projects?api-version=7.1`
}

/**
 * Validate a connection's PAT against the provider and persist the outcome:
 * 200 → status 'active' + lastValidatedAt (lastError cleared); anything else →
 * status 'error' + lastError. Decrypt + fetch are injected for testability.
 */
export async function validateConnectionCore(
  payload: Payload,
  id: string,
  opts: { fetchFn: ValidateFetch; decryptFn?: (s: string) => string; now?: Date },
): Promise<ValidateConnectionResult> {
  const decryptFn = opts.decryptFn ?? defaultDecrypt
  const nowIso = (opts.now ?? new Date()).toISOString()

  let doc: Record<string, unknown>
  try {
    doc = (await payload.findByID({
      collection: 'git-connections',
      id,
      depth: 0,
      overrideAccess: true,
    })) as unknown as Record<string, unknown>
  } catch {
    return { ok: false, status: 'error', error: 'Connection not found' }
  }

  const credentials = (doc.credentials ?? {}) as Record<string, unknown>
  const encryptedPat = typeof credentials.pat === 'string' ? credentials.pat : ''
  if (!encryptedPat) {
    const error = 'No credentials configured'
    await persistValidation(payload, id, 'error', nowIso, error)
    return { ok: false, status: 'error', error }
  }

  let pat: string
  try {
    pat = decryptFn(encryptedPat)
  } catch {
    const error = 'Failed to decrypt stored credentials'
    await persistValidation(payload, id, 'error', nowIso, error)
    return { ok: false, status: 'error', error }
  }

  const organization = typeof doc.organization === 'string' ? doc.organization : ''
  const baseUrl = typeof doc.baseUrl === 'string' && doc.baseUrl ? doc.baseUrl : DEFAULT_BASE_URL
  const url = adoProjectsUrl(baseUrl, organization)
  // Azure DevOps PAT auth: HTTP Basic with an empty username and the PAT.
  const auth = Buffer.from(`:${pat}`).toString('base64')

  let httpStatus: number
  let statusText: string | undefined
  try {
    const res = await opts.fetchFn(url, {
      method: 'GET',
      headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
    })
    httpStatus = res.status
    statusText = res.statusText
  } catch (e) {
    const error = `Could not reach the provider: ${e instanceof Error ? e.message : 'network error'}`
    await persistValidation(payload, id, 'error', nowIso, error)
    return { ok: false, status: 'error', error }
  }

  if (httpStatus >= 200 && httpStatus < 300) {
    await persistValidation(payload, id, 'active', nowIso, null)
    return { ok: true, status: 'active', lastValidatedAt: nowIso }
  }

  const error =
    httpStatus === 401 || httpStatus === 403
      ? 'Authentication failed — check the PAT and its scopes'
      : `Provider returned HTTP ${httpStatus}${statusText ? ` ${statusText}` : ''}`
  await persistValidation(payload, id, 'error', nowIso, error)
  return { ok: false, status: 'error', error }
}

async function persistValidation(
  payload: Payload,
  id: string,
  status: ConnectionStatus,
  nowIso: string,
  lastError: string | null,
): Promise<void> {
  await payload.update({
    collection: 'git-connections',
    id,
    overrideAccess: true,
    data: {
      status,
      lastValidatedAt: nowIso,
      lastError: lastError ?? null,
    } as never,
  })
}
