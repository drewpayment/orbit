import type { Access, FieldAccess } from 'payload'
import {
  workspaceScopedRead as scopedRead,
  memberCreate,
  manageCreate,
  docWorkspaceMutate,
} from '@/lib/access/collection-access'
import { isPlatformAdmin } from '@/lib/access/workspace-access'

/**
 * Workspace-scoped access for the scorecards collections — thin adapters over
 * the shared `@/lib/access/collection-access` factories (issue #63). The tenant
 * boundary is the caller's active workspace memberships, keyed on the
 * Better-Auth id. The only bypass is a platform admin (role super_admin/admin);
 * Temporal/eval writebacks run with overrideAccess and bypass these rules.
 */

export const workspaceScopedRead: Access = scopedRead()

/** Create allowed for any active member of the target `data.workspace`. */
export const workspaceScopedCreate: Access = memberCreate()

/** Create for standards-authoring collections: owner/admin of `data.workspace`. */
export const workspaceScopedManageCreate: Access = manageCreate(['owner', 'admin'])

/** Update/delete: active member of the doc's workspace holding one of `roles`. */
export const workspaceScopedMutate = (slug: string, roles: string[]): Access =>
  docWorkspaceMutate(slug, roles)

/** Tenant/parent identity fields are immutable outside trusted overrideAccess writes. */
export const platformAdminFieldUpdate: FieldAccess = ({ req: { user } }) => isPlatformAdmin(user)
