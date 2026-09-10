import 'server-only'
import type { Payload } from 'payload'

/**
 * Authorization for the In-App Template Authoring surfaces (v2 Scaffolder,
 * phase-2 plan Task 7 / design §3.7). Mirrors `lib/actions/authz.ts`'s shape
 * one-for-one (same `workspace-members` role check, same `isPayloadAdmin`
 * bypass parameter) with one new rule that has no Actions analog:
 *
 *   - **manage** (author/edit/delete template-definitions): workspace
 *     owner/admin — same as `canManageActions`.
 *   - **run** (execute a published template → create an action-run): any
 *     active member — same as `canRunActions`.
 *   - **publish** (flip a definition to `status: published`): workspace
 *     owner/admin for `visibility: workspace`, but a **platform admin** is
 *     required when `visibility` is `shared` or `public` — crossing tenant
 *     boundaries needs platform-admin sign-off (design §3.7). This is
 *     enforced again, independently, by `TemplateDefinitions`'s
 *     `beforeChange` hook and by `lib/scaffolder/versions.ts`'s
 *     `publishVersion` — this helper is the server-action-level gate ahead
 *     of both.
 *
 * `isPayloadAdmin` must be computed by the caller from
 * `isPlatformAdmin(user)` (`lib/access/workspace-access.ts`) against the
 * resolved Payload user — this module never looks the user up itself.
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

/** May the user author/edit/delete template-definitions in this workspace? (owner/admin) */
export async function canManageTemplateDefinitions(
  payload: Payload,
  userId: string | undefined | null,
  workspaceId: string | undefined | null,
  isPayloadAdmin = false,
): Promise<boolean> {
  if (isPayloadAdmin) return true
  if (!userId || !workspaceId) return false
  return hasWorkspaceRole(payload, userId, workspaceId, ['owner', 'admin'])
}

/** May the user run a template-definition in this workspace? (any active member) */
export async function canRunTemplateDefinition(
  payload: Payload,
  userId: string | undefined | null,
  workspaceId: string | undefined | null,
  isPayloadAdmin = false,
): Promise<boolean> {
  if (isPayloadAdmin) return true
  if (!userId || !workspaceId) return false
  return hasWorkspaceRole(payload, userId, workspaceId, ['owner', 'admin', 'member'])
}

/**
 * May the user resolve an `approval:request` step's mid-run gate (Phase 4
 * Task C)? Per the phase 4 plan (§13 decision 6): workspace owner/admin OR
 * the caller's own id/email is listed in the step's `approvers`. The
 * internal API key alone is never an approver — this check happens in the
 * server action BEFORE the RPC is called, not only server-side inside the
 * RPC.
 *
 * `approvers` is free text (emails or team ids), not RBAC-validated at
 * definition-author time (a known gap, documented on the `approval:request`
 * action) — matching against the caller's own id or email is the closest
 * this can get without a team-membership lookup.
 */
export async function canApproveScaffolderStep(
  payload: Payload,
  userId: string | undefined | null,
  userEmail: string | undefined | null,
  workspaceId: string | undefined | null,
  approvers: string[] | undefined | null,
  isPayloadAdmin = false,
): Promise<boolean> {
  if (isPayloadAdmin) return true
  if (!userId) return false

  const listed = (approvers ?? []).some(
    (a) => a === userId || (userEmail && a.toLowerCase() === userEmail.toLowerCase()),
  )
  if (listed) return true

  if (!workspaceId) return false
  return hasWorkspaceRole(payload, userId, workspaceId, ['owner', 'admin'])
}

/** A `template-definitions.visibility` value (mirrors the collection's select options). */
export type TemplateVisibility = 'workspace' | 'shared' | 'public' | undefined | null

/**
 * May the user publish a template-definition with the given `visibility`?
 * Workspace owner/admin for `workspace` visibility; requires
 * `isPayloadAdmin` (platform admin) in addition for `shared`/`public`.
 */
export async function canPublishTemplateDefinition(
  payload: Payload,
  userId: string | undefined | null,
  workspaceId: string | undefined | null,
  visibility: TemplateVisibility,
  isPayloadAdmin = false,
): Promise<boolean> {
  if (isPayloadAdmin) return true
  if (!userId || !workspaceId) return false

  const isOwnerOrAdmin = await hasWorkspaceRole(payload, userId, workspaceId, ['owner', 'admin'])
  if (!isOwnerOrAdmin) return false

  const isRestrictedVisibility = visibility === 'shared' || visibility === 'public'
  // isPayloadAdmin already returned true above when set — reaching here with
  // a restricted visibility means the caller is NOT a platform admin.
  if (isRestrictedVisibility) return false

  return true
}
