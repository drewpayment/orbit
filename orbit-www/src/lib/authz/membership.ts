import { cache } from 'react'
import type { Payload } from 'payload'
import {
  getWorkspaceMembership,
  getMemberWorkspaceIds,
  getAdminOrOwnerWorkspaceIds,
  getOwnerWorkspaceIds,
} from '@/lib/access/workspace-access'

/**
 * Workspace membership lookups for the authz layer.
 *
 * This is the ONLY module outside `lib/access/workspace-access.ts` that may
 * touch `workspace-members`. Everything is keyed on the caller's Better-Auth id
 * until authz Phase E moves `workspace-members.user` to a `users` relationship;
 * at that point this file changes and nothing else does.
 *
 * Lookups are wrapped in React `cache` so a single request (RSC render or
 * server action) that evaluates several access rules performs each membership
 * query once. In Route Handlers `cache` has no request store and simply calls
 * through (verified 2026-09-16), which is safe: no memo, no cross-request reuse.
 *
 * NOTE: no `server-only` import here — this module is reachable from
 * `payload.config.ts`, which scripts load outside a React server context.
 */

export type WorkspaceRole = 'owner' | 'admin' | 'member'

/** Which membership set a read filter or ids lookup covers. */
export type MembershipScope = 'member' | 'manage' | 'owner'

/** The caller's active role in a workspace, or null when not an active member. */
export const membershipRole = cache(
  async (payload: Payload, betterAuthId: string, workspaceId: string): Promise<WorkspaceRole | null> => {
    const membership = await getWorkspaceMembership(payload, betterAuthId, workspaceId)
    return (membership?.role as WorkspaceRole | undefined) ?? null
  },
)

/** Ids of the workspaces where the caller holds a role in `scope`. */
export const workspaceIdsFor = cache(
  async (payload: Payload, betterAuthId: string, scope: MembershipScope): Promise<string[]> => {
    switch (scope) {
      case 'owner':
        return getOwnerWorkspaceIds(payload, betterAuthId)
      case 'manage':
        return getAdminOrOwnerWorkspaceIds(payload, betterAuthId)
      default:
        return getMemberWorkspaceIds(payload, betterAuthId)
    }
  },
)
