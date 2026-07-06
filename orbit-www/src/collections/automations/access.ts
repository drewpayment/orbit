import type { Access } from 'payload'
import {
  workspaceScopedRead as scopedRead,
  manageCreate,
  docWorkspaceMutate,
} from '@/lib/access/collection-access'

/**
 * Workspace-scoped access for the Automations collection — thin adapters over
 * the shared `@/lib/access/collection-access` factories (issue #63). The tenant
 * boundary is the caller's active workspace memberships, keyed on the
 * Better-Auth id; the only bypass is a platform admin. Authoring an Automation
 * is a privileged config change, so create/update/delete are gated on workspace
 * owner/admin — there is no member-create path. Internal writebacks run with
 * overrideAccess.
 */

export const workspaceScopedRead: Access = scopedRead()

/** Create gated on owner/admin of the target `data.workspace`. */
export const workspaceScopedManageCreate: Access = manageCreate(['owner', 'admin'])

/** Update/delete gated on owner/admin of the automation's workspace. */
export const workspaceScopedManageMutate: Access = docWorkspaceMutate('automations', [
  'owner',
  'admin',
])
