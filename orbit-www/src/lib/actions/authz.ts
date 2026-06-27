import 'server-only'
import type { Payload } from 'payload'

/**
 * Authorization for self-service Actions (IDP refocus P3).
 *
 * Two distinct capabilities, both keyed on the working `workspace-members`
 * system (P3 mirrors the scorecards Option A choice):
 *   - **manage** (define/edit/delete Actions): workspace owner/admin.
 *   - **run** (execute an Action → create an action-run): any active member —
 *     that's the point of self-service.
 *
 * Single server-side source of truth for both checks; the collection access
 * rules, the run/authoring server actions, and the UI gating all route through
 * here. Named to map cleanly onto future `actions:manage` / `actions:run`
 * permissions when the granular Permissions/Roles system is activated.
 */

async function hasWorkspaceRole(
  payload: Payload,
  userId: string,
  workspaceId: string,
  roles: string[],
): Promise<boolean> {
  const members = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: workspaceId } },
        { user: { equals: userId } },
        { role: { in: roles } },
        { status: { equals: 'active' } },
      ],
    },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  return members.docs.length > 0
}

/** May the user define/edit Actions in this workspace? (owner/admin) */
export async function canManageActions(
  payload: Payload,
  userId: string | undefined | null,
  workspaceId: string | undefined | null,
  isPayloadAdmin = false,
): Promise<boolean> {
  if (isPayloadAdmin) return true
  if (!userId || !workspaceId) return false
  return hasWorkspaceRole(payload, userId, workspaceId, ['owner', 'admin'])
}

/** May the user run Actions in this workspace? (any active member) */
export async function canRunActions(
  payload: Payload,
  userId: string | undefined | null,
  workspaceId: string | undefined | null,
  isPayloadAdmin = false,
): Promise<boolean> {
  if (isPayloadAdmin) return true
  if (!userId || !workspaceId) return false
  return hasWorkspaceRole(payload, userId, workspaceId, ['owner', 'admin', 'member'])
}

/** May the user approve a run gated by `policy`? */
export async function canApproveActionRun(
  payload: Payload,
  userId: string | undefined | null,
  workspaceId: string | undefined | null,
  policy: 'none' | 'workspace-admin' | 'platform-admin',
  isPayloadAdmin = false,
): Promise<boolean> {
  if (policy === 'none') return true
  if (isPayloadAdmin) return true
  if (policy === 'platform-admin') return false // only Payload admins approve platform-gated runs
  if (!userId || !workspaceId) return false
  return hasWorkspaceRole(payload, userId, workspaceId, ['owner', 'admin'])
}
