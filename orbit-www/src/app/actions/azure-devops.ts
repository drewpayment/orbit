'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { listConnectionRepositoriesCore } from '@/lib/connections/ado-repos-core'
import type { Repository } from './github'

/**
 * Azure DevOps repo-source server actions (WI2) — the git-connections analogue
 * of `actions/github.ts`. Same gating (session + workspace membership) and the
 * same PAT-less contract: the connection's decrypted credential never crosses
 * back to the client; actions return only repo metadata or `{ success:false }`.
 *
 * git-connections access is platform-admin only, so every read here uses
 * `overrideAccess: true` and is instead gated by the caller's workspace
 * membership plus the connection's `allowedWorkspaces`.
 */

export interface GitConnectionSource {
  id: string
  name: string
  organization: string
  baseUrl: string
}

async function requireMember(workspaceId: string): Promise<{ ok: boolean }> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { ok: false }

  const payload = await getPayload({ config })
  const membership = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: workspaceId } },
        { user: { equals: session.user.id } },
        { status: { equals: 'active' } },
      ],
    },
    limit: 1,
  })
  return { ok: membership.docs.length > 0 }
}

/**
 * Active ADO connections whose `allowedWorkspaces` includes this workspace.
 * Mirrors `getWorkspaceGitHubInstallations`: session + membership gated, no
 * secrets in the projection.
 */
export async function getWorkspaceGitConnections(workspaceId: string): Promise<{
  success: boolean
  error?: string
  connections: GitConnectionSource[]
}> {
  const member = await requireMember(workspaceId)
  if (!member.ok) return { success: false, error: 'Unauthorized', connections: [] }

  const payload = await getPayload({ config })
  const result = await payload.find({
    collection: 'git-connections',
    where: {
      and: [
        { allowedWorkspaces: { contains: workspaceId } },
        { status: { equals: 'active' } },
      ],
    },
    overrideAccess: true,
    limit: 200,
    depth: 0,
  })

  return {
    success: true,
    connections: result.docs.map((doc) => {
      const d = doc as unknown as Record<string, unknown>
      return {
        id: String(d.id),
        name: typeof d.name === 'string' ? d.name : String(d.id),
        organization: typeof d.organization === 'string' ? d.organization : '',
        baseUrl:
          typeof d.baseUrl === 'string' && d.baseUrl.length > 0
            ? d.baseUrl
            : 'https://dev.azure.com',
      }
    }),
  }
}

/**
 * List the repos backing an ADO connection. `page` is accepted for parity with
 * the GitHub action but ADO listing is unpaginated (all projects/repos fetched
 * in one pass), so `hasMore` is always false. Client-side search filters this
 * full listing.
 */
export async function listConnectionRepositories(
  connectionId: string,
  _page: number = 1,
): Promise<{ success: boolean; error?: string; repos: Repository[]; hasMore: boolean }> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { success: false, error: 'Unauthorized', repos: [], hasMore: false }
  }

  const payload = await getPayload({ config })
  const result = await listConnectionRepositoriesCore(payload, connectionId, {
    fetchFn: (url, init) => fetch(url, init),
  })

  if (!result.ok) {
    return { success: false, error: result.error, repos: [], hasMore: false }
  }
  return { success: true, repos: result.repos, hasMore: false }
}

/**
 * Search an ADO connection's repos by name. ADO has no repo-search API, so this
 * lists the full set and filters client-side (WI2.3).
 */
export async function searchConnectionRepositories(
  connectionId: string,
  query: string,
): Promise<{ success: boolean; error?: string; repos: Repository[]; hasMore: boolean }> {
  const listed = await listConnectionRepositories(connectionId)
  if (!listed.success) return listed

  const q = query.trim().toLowerCase()
  const repos = q.length === 0 ? listed.repos : listed.repos.filter((r) => r.name.toLowerCase().includes(q))
  return { success: true, repos, hasMore: false }
}
