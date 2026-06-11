import type { Payload } from 'payload'

/**
 * Thrown when a user is not an active member of the requested workspace.
 * Callers that need to return a typed error object should catch this.
 */
export class WorkspaceMembershipError extends Error {
  constructor(message = 'Not a member of this workspace') {
    super(message)
    this.name = 'WorkspaceMembershipError'
  }
}

/**
 * Assert that `betterAuthId` is an active member of `workspaceId`.
 * Throws `WorkspaceMembershipError` if the check fails so callers can
 * handle it uniformly.
 *
 * Designed to be called from server actions and API route handlers after
 * the caller has already verified the session is present.
 *
 * NOTE: workspace-members.user stores the Better Auth user ID, NOT the
 * Payload document ID.  Always pass `payloadUser.betterAuthId` (or
 * `session.user.id` from a BetterAuth session) — never `payloadUser.id`.
 */
export async function requireWorkspaceMembership(
  payload: Payload,
  betterAuthId: string,
  workspaceId: string,
): Promise<void> {
  const result = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: workspaceId } },
        { user: { equals: betterAuthId } },
        { status: { equals: 'active' } },
      ],
    },
    limit: 1,
    overrideAccess: true,
  })

  if (result.docs.length === 0) {
    throw new WorkspaceMembershipError()
  }
}

/**
 * Convenience wrapper that returns a discriminated-union result object
 * instead of throwing, for functions that already use the
 * `{ success, error }` return pattern.
 */
export async function checkWorkspaceMembership(
  payload: Payload,
  betterAuthId: string,
  workspaceId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireWorkspaceMembership(payload, betterAuthId, workspaceId)
    return { ok: true }
  } catch {
    return { ok: false, error: 'Not a member of this workspace' }
  }
}
