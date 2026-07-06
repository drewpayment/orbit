import type { Access } from 'payload'
import {
  workspaceScopedRead as scopedRead,
  memberCreate,
  manageCreate,
  docWorkspaceMutate,
} from '@/lib/access/collection-access'

/**
 * Workspace-scoped access for the Self-Service actions collections — thin
 * adapters over the shared `@/lib/access/collection-access` factories (issue
 * #63). The tenant boundary is the caller's active workspace memberships, keyed
 * on the Better-Auth id; the only bypass is a platform admin. Authoring an
 * Action is owner/admin; RUNNING one (an action-run) is open to any active
 * member. Server actions / internal writebacks run with overrideAccess.
 */

export const workspaceScopedRead: Access = scopedRead()

/** Create allowed for any active member of the target `data.workspace`. */
export const workspaceScopedMemberCreate: Access = memberCreate()

/** Create gated on owner/admin of the target `data.workspace` (authoring Actions). */
export const workspaceScopedManageCreate: Access = manageCreate(['owner', 'admin'])

/** Update/delete: active member of the doc's workspace holding one of `roles`. */
export const workspaceScopedMutate = (slug: string, roles: string[]): Access =>
  docWorkspaceMutate(slug, roles)
