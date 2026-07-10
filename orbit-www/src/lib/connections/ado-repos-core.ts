import type { Payload } from 'payload'
import { resolveConnectionToken, type EntraTokenMinter, type ConnectionTokenLookup } from './token-core'
import { adoProjectsUrl } from './connections-core'

/**
 * Testable core for ADO repo listing (WI2) — the git-connections analogue of
 * `listInstallationRepositories`. Resolves the connection's credentials through
 * `resolveConnectionToken` (basic-pat or bearer) and hits the Azure DevOps git
 * REST API directly. The decrypted token NEVER leaves this process: callers get
 * back only repo metadata or an error string, never the credential.
 *
 * A connection may be project-scoped (list one project's repos) or org-wide
 * (enumerate `_apis/projects`, then fan in). `fetchFn`/`decryptFn`/`mintFn` are
 * injected so unit tests exercise the matrix without a real ADO org or network.
 */

const DEFAULT_BASE_URL = 'https://dev.azure.com'

/** Same shape the repo browser consumes, plus the ADO `project` coordinate. */
export interface AdoRepository {
  name: string
  fullName: string
  description: string | null
  private: boolean
  defaultBranch: string
  project: string
}

/** Minimal fetch surface: status + JSON body are all the core needs. */
export type AdoFetch = (
  url: string,
  init: { headers: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

export type ListReposResult = { ok: true; repos: AdoRepository[] } | { ok: false; error: string }

export interface ListReposOptions {
  fetchFn: AdoFetch
  decryptFn?: (s: string) => string
  mintFn?: EntraTokenMinter
}

/**
 * Build the ADO "list repositories" URL for a project:
 *   {baseUrl}/{org}/{project}/_apis/git/repositories?api-version=7.1
 */
export function adoRepositoriesUrl(baseUrl: string, org: string, project: string): string {
  const base = (baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '')
  return `${base}/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/git/repositories?api-version=7.1`
}

function authHeader(authMode: 'basic-pat' | 'bearer', token: string): string {
  // Azure DevOps PAT auth: HTTP Basic with an empty username and the PAT.
  return authMode === 'bearer'
    ? `Bearer ${token}`
    : `Basic ${Buffer.from(`:${token}`).toString('base64')}`
}

/** ADO returns `refs/heads/main`; the browser wants the short branch name. */
function stripBranch(ref: unknown): string {
  return typeof ref === 'string' ? ref.replace(/^refs\/heads\//, '') : ''
}

/** ADO list endpoints wrap results in `{ count, value: [...] }`. */
function extractValues(body: unknown): Array<Record<string, unknown>> {
  if (body && typeof body === 'object') {
    const value = (body as { value?: unknown }).value
    if (Array.isArray(value)) {
      return value.filter((v): v is Record<string, unknown> => !!v && typeof v === 'object')
    }
  }
  return []
}

function credErrorMessage(resolved: Extract<ConnectionTokenLookup, { ok: false }>): string {
  switch (resolved.code) {
    case 'NOT_FOUND':
      return 'Connection not found'
    case 'NOT_CONFIGURED':
      return 'Connection has no credentials configured'
    case 'DECRYPT_FAILED':
      return 'Failed to decrypt connection credentials'
    default:
      return `Microsoft Entra sign-in failed: ${resolved.error}`
  }
}

function httpErrorMessage(status: number): string {
  if (status === 401 || status === 403) {
    return 'Authentication failed — check the connection credentials and their access to the organization'
  }
  if (status === 404) return 'Azure DevOps organization or project not found (HTTP 404)'
  return `Azure DevOps returned HTTP ${status}`
}

function networkErrorMessage(e: unknown): string {
  return `Could not reach Azure DevOps: ${e instanceof Error ? e.message : 'network error'}`
}

async function fetchProjectNames(
  fetchFn: AdoFetch,
  baseUrl: string,
  organization: string,
  headers: Record<string, string>,
): Promise<{ ok: true; names: string[] } | { ok: false; error: string }> {
  try {
    const res = await fetchFn(adoProjectsUrl(baseUrl, organization), { headers })
    if (!res.ok) return { ok: false, error: httpErrorMessage(res.status) }
    const names = extractValues(await res.json())
      .map((v) => String(v.name ?? ''))
      .filter((n) => n.length > 0)
    return { ok: true, names }
  } catch (e) {
    return { ok: false, error: networkErrorMessage(e) }
  }
}

export async function listConnectionRepositoriesCore(
  payload: Payload,
  connectionId: string,
  opts: ListReposOptions,
): Promise<ListReposResult> {
  const resolved = await resolveConnectionToken(payload, connectionId, opts.decryptFn, opts.mintFn)
  if (!resolved.ok) {
    return { ok: false, error: credErrorMessage(resolved) }
  }

  const { organization, project, baseUrl, authMode, token } = resolved.body
  const headers = { Authorization: authHeader(authMode, token), Accept: 'application/json' }

  // Project-scoped connections list one project; org-wide connections enumerate
  // every project first, then fan in.
  let projects: string[]
  if (project) {
    projects = [project]
  } else {
    const listed = await fetchProjectNames(opts.fetchFn, baseUrl, organization, headers)
    if (!listed.ok) return listed
    projects = listed.names
  }

  const repos: AdoRepository[] = []
  for (const proj of projects) {
    let body: unknown
    try {
      const res = await opts.fetchFn(adoRepositoriesUrl(baseUrl, organization, proj), { headers })
      if (!res.ok) return { ok: false, error: httpErrorMessage(res.status) }
      body = await res.json()
    } catch (e) {
      return { ok: false, error: networkErrorMessage(e) }
    }

    for (const raw of extractValues(body)) {
      if (raw.isDisabled === true) continue
      const name = String(raw.name ?? '')
      if (!name) continue
      repos.push({
        name,
        fullName: `${proj}/${name}`,
        description: null,
        // ADO git repos have no public/private flag; they are org-private.
        private: true,
        defaultBranch: stripBranch(raw.defaultBranch),
        project: proj,
      })
    }
  }

  return { ok: true, repos }
}
