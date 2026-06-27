import 'server-only'
import type { Payload } from 'payload'

/**
 * Authoring authorization for scorecards (IDP refocus P2, Option A).
 *
 * Standards-authoring (create/edit/delete scorecards and their rules) is a
 * privileged capability gated on **workspace owner/admin** via the working
 * `workspace-members` system — the same authz everything else in the app
 * actually enforces. Members get read-only + can run evaluations.
 *
 * This is the SINGLE server-side source of truth for the "can manage
 * scorecards" decision; the collection `access` rules, the authoring server
 * actions, and the server-computed UI `canManage` flags all route through it.
 * It is intentionally named for a future `scorecards:manage` permission: when
 * the granular Permissions/Roles system is activated, only this file changes.
 */

const MANAGE_ROLES = ['owner', 'admin'] as const

/**
 * True if `userId` may author scorecards in `workspaceId` (active owner/admin
 * membership). Pass `isPayloadAdmin` for Payload-authenticated admin users
 * (admin panel), who bypass the membership check.
 */
export async function canManageScorecards(
  payload: Payload,
  userId: string | undefined | null,
  workspaceId: string | undefined | null,
  isPayloadAdmin = false,
): Promise<boolean> {
  if (isPayloadAdmin) return true
  if (!userId || !workspaceId) return false

  const members = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: workspaceId } },
        { user: { equals: userId } },
        { role: { in: [...MANAGE_ROLES] } },
        { status: { equals: 'active' } },
      ],
    },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })

  return members.docs.length > 0
}
