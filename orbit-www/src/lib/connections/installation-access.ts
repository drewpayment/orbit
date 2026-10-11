import type { Payload, Where } from 'payload'

/**
 * Resolution of a GitHub App installation REFERENCE to its `github-installations`
 * doc, and the workspace grant check.
 *
 * An app stores `repository.installationId` as the `github-installations`
 * Payload doc id (what the repo picker hands out); legacy rows and some
 * callers hold the numeric GitHub installation id instead. Every GitHub call
 * needs the NUMERIC id, which is the doc's `installationId` field, so consumers
 * must resolve the ref here rather than `Number(ref)` (NaN for a Payload id).
 *
 * NOTE: deliberately free of `@/lib/authz` / `server-only` imports — this is
 * reachable from the `apps` collection hooks, which also load under scripts.
 */

export type ResolvedInstallation = {
  /** `github-installations` Payload doc id. */
  id: string
  /** Numeric GitHub installation id — use this for GitHub API / token calls. */
  githubInstallationId: number
  allowedWorkspaces: unknown
  accountLogin?: string
}

const NUMERIC = /^\d{1,15}$/
const OBJECT_ID = /^[0-9a-f]{24}$/i

function toResolved(doc: unknown): ResolvedInstallation | null {
  if (!doc || typeof doc !== 'object') return null
  const d = doc as { id?: unknown; installationId?: unknown; allowedWorkspaces?: unknown; accountLogin?: unknown }
  const githubInstallationId = Number(d.installationId)
  if (d.id === undefined || !Number.isFinite(githubInstallationId) || githubInstallationId <= 0) return null
  return {
    id: String(d.id),
    githubInstallationId,
    allowedWorkspaces: d.allowedWorkspaces,
    ...(typeof d.accountLogin === 'string' && { accountLogin: d.accountLogin }),
  }
}

/**
 * Resolve a ref (Payload doc id, or numeric GitHub id) to its installation doc.
 * No workspace constraint: callers authorize separately. Never throws.
 */
export async function findInstallationByRef(
  payload: Payload,
  ref: unknown,
): Promise<ResolvedInstallation | null> {
  if (ref === null || ref === undefined || ref === '') return null
  const value = String(ref)
  try {
    if (NUMERIC.test(value)) {
      const found = await payload.find({
        collection: 'github-installations',
        where: { installationId: { equals: Number(value) } },
        limit: 1,
        depth: 0,
        overrideAccess: true,
      })
      return toResolved(found.docs[0])
    }
    const doc = await payload.findByID({
      collection: 'github-installations',
      id: value,
      depth: 0,
      overrideAccess: true,
    })
    return toResolved(doc)
  } catch {
    return null
  }
}

async function findGrantedDoc(
  payload: Payload,
  ref: unknown,
  workspaceId: string | null | undefined,
): Promise<unknown | null> {
  if (ref === null || ref === undefined || ref === '' || !workspaceId) return null
  const value = String(ref)
  const byRef: Where[] = []
  if (OBJECT_ID.test(value)) byRef.push({ id: { equals: value } })
  if (NUMERIC.test(value)) byRef.push({ installationId: { equals: Number(value) } })
  if (byRef.length === 0) return null
  try {
    const found = await payload.find({
      collection: 'github-installations',
      where: { and: [{ or: byRef }, { allowedWorkspaces: { contains: workspaceId } }] },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    return found.docs[0] ?? null
  } catch {
    return null
  }
}

/**
 * Resolve `ref` to its installation doc ONLY if it is granted to `workspaceId`
 * (`allowedWorkspaces` contains it) and carries a usable numeric GitHub id.
 * Never throws; unknown/ungranted => null.
 */
export async function resolveInstallationForWorkspace(
  payload: Payload,
  ref: unknown,
  workspaceId: string | null | undefined,
): Promise<ResolvedInstallation | null> {
  return toResolved(await findGrantedDoc(payload, ref, workspaceId))
}

/** Is the installation `ref` granted to `workspaceId`? (Create-path gate.) */
export async function installationAllowedForWorkspace(
  payload: Payload,
  ref: unknown,
  workspaceId: string | null | undefined,
): Promise<boolean> {
  return (await findGrantedDoc(payload, ref, workspaceId)) !== null
}
