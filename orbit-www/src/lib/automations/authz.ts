import 'server-only'
import type { Payload } from 'payload'

/**
 * Authoring authorization for Automations (IDP refocus P4).
 *
 * Defining/editing/deleting an Automation is a privileged config change gated on
 * **workspace owner/admin** — the same Option A choice P2 (scorecards) and P3
 * (actions) made, keyed on the working `workspace-members` system. There is no
 * "run" capability here: an automation runs its target Action automatically; the
 * authoring owner/admin IS the authority for the runs it creates.
 *
 * Single server-side source of truth for the "can manage automations" decision;
 * the collection access rules, the authoring server actions, and the UI gating
 * all route through it. Named for a future `automations:manage` permission.
 */

const MANAGE_ROLES = ['owner', 'admin'] as const

export async function canManageAutomations(
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
