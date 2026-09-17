import type { Payload, Where } from 'payload'
import type { WorkspaceMember } from '@/payload-types'
import type { WorkspaceRole } from '@/lib/authz/membership'

/**
 * Data access for the workspace roster (`workspace-members` as DATA: listing,
 * counting, inviting, changing roles, removing). Authorization decisions do
 * NOT live here; they go through `@/lib/authz` (`authorize`, `check`,
 * `memberWorkspaceIds`, `workspaceRole`).
 *
 * This module and `lib/authz/membership.ts` are the only places outside
 * `lib/access` that may name the `workspace-members` collection (lint-enforced).
 * `workspace-members.user` holds a Better-Auth id until authz Phase E moves it
 * to a `users` relationship; every `betterAuthId` parameter below flips to a
 * Payload id then, and nothing outside these two files changes.
 *
 * Every call runs with `overrideAccess: true`: the CALLER has already made the
 * authorization decision (D2 pattern: authorize, then override).
 */

const COLLECTION = 'workspace-members' as const

export type MembershipSummary = { workspaceId: string; role: WorkspaceRole; memberId: string }

function workspaceIdOf(m: WorkspaceMember): string {
  return typeof m.workspace === 'string' ? m.workspace : String(m.workspace.id)
}

/** Active members of a workspace, newest first unless `sort` is given. */
export async function listWorkspaceMembers(
  payload: Payload,
  workspaceId: string,
  options: { limit?: number; sort?: string; roles?: readonly WorkspaceRole[] } = {},
): Promise<WorkspaceMember[]> {
  const and: Where[] = [
    { workspace: { equals: workspaceId } },
    { status: { equals: 'active' } },
  ]
  if (options.roles) and.push({ role: { in: [...options.roles] } })
  const result = await payload.find({
    collection: COLLECTION,
    where: { and },
    limit: options.limit ?? 500,
    sort: options.sort ?? '-createdAt',
    depth: 0,
    overrideAccess: true,
  })
  return result.docs
}

/** Number of active members in a workspace. */
export async function countWorkspaceMembers(payload: Payload, workspaceId: string): Promise<number> {
  const result = await payload.find({
    collection: COLLECTION,
    where: { and: [{ workspace: { equals: workspaceId } }, { status: { equals: 'active' } }] },
    limit: 0,
    depth: 0,
    overrideAccess: true,
  })
  return result.totalDocs
}

/** Active memberships of one user, with the role held in each workspace. */
export async function listMembershipsFor(payload: Payload, betterAuthId: string): Promise<MembershipSummary[]> {
  const result = await payload.find({
    collection: COLLECTION,
    where: { and: [{ user: { equals: betterAuthId } }, { status: { equals: 'active' } }] },
    limit: 500,
    depth: 0,
    overrideAccess: true,
  })
  return result.docs.map((m) => ({
    workspaceId: workspaceIdOf(m),
    role: m.role as WorkspaceRole,
    memberId: String(m.id),
  }))
}

/** The user's membership row in a workspace (any status), or null. */
export async function findMembership(
  payload: Payload,
  betterAuthId: string,
  workspaceId: string,
): Promise<WorkspaceMember | null> {
  const result = await payload.find({
    collection: COLLECTION,
    where: { and: [{ workspace: { equals: workspaceId } }, { user: { equals: betterAuthId } }] },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  return result.docs[0] ?? null
}

/**
 * The user's ACTIVE membership row in a workspace, optionally narrowed to a
 * role set, with the caller choosing whether access control applies. Used by
 * `@/lib/data/cached-queries.ts` (`getWorkspaceMembership`), whose several
 * out-of-area callers rely on its exact current signature/behavior including
 * the `overrideAccess` default of `false` (Phase C, #135) — moved here only to
 * get the raw `workspace-members` query out of a non-roster file.
 */
export async function findActiveMembershipWithOptions(
  payload: Payload,
  workspaceId: string,
  betterAuthId: string,
  options: { roles?: string[]; overrideAccess?: boolean } = {},
): Promise<WorkspaceMember | null> {
  const and: Where[] = [
    { workspace: { equals: workspaceId } },
    { user: { equals: betterAuthId } },
    { status: { equals: 'active' } },
  ]
  if (options.roles?.length) and.push({ role: { in: options.roles } })
  const result = await payload.find({
    collection: COLLECTION,
    where: { and },
    limit: 1,
    overrideAccess: options.overrideAccess ?? false,
  })
  return result.docs[0] ?? null
}

/**
 * Every ACTIVE membership row for a user, depth 1 (populated workspace). Used
 * by `@/lib/data/cached-queries.ts` (`getUserWorkspaceMemberships`) — moved
 * here only to get the raw `workspace-members` query out of a non-roster file;
 * behavior (shape, depth, limit, `overrideAccess: true`) is unchanged.
 */
export async function listActiveMembershipDocsFor(
  payload: Payload,
  betterAuthId: string,
): Promise<WorkspaceMember[]> {
  const result = await payload.find({
    collection: COLLECTION,
    where: { user: { equals: betterAuthId }, status: { equals: 'active' } },
    depth: 1,
    limit: 100,
    overrideAccess: true,
  })
  return result.docs
}

/**
 * Add an active member. Idempotent: an existing row (any status) is returned
 * unchanged rather than duplicated; pass `upgradeRole` to raise its role.
 */
export async function addWorkspaceMember(
  payload: Payload,
  args: { workspaceId: string; betterAuthId: string; role: WorkspaceRole; upgradeRole?: boolean },
): Promise<{ member: WorkspaceMember; created: boolean }> {
  const existing = await findMembership(payload, args.betterAuthId, args.workspaceId)
  if (existing) {
    if (args.upgradeRole && existing.role !== args.role) {
      const member = await payload.update({
        collection: COLLECTION,
        id: existing.id,
        data: { role: args.role, status: 'active' },
        overrideAccess: true,
      })
      return { member, created: false }
    }
    return { member: existing, created: false }
  }
  const now = new Date().toISOString()
  const member = await payload.create({
    collection: COLLECTION,
    data: {
      workspace: args.workspaceId,
      user: args.betterAuthId,
      role: args.role,
      status: 'active',
      requestedAt: now,
      approvedAt: now,
    },
    overrideAccess: true,
  })
  return { member, created: true }
}

export async function updateWorkspaceMemberRole(
  payload: Payload,
  memberId: string,
  role: WorkspaceRole,
): Promise<WorkspaceMember> {
  return payload.update({ collection: COLLECTION, id: memberId, data: { role }, overrideAccess: true })
}

export async function removeWorkspaceMember(payload: Payload, memberId: string): Promise<void> {
  await payload.delete({ collection: COLLECTION, id: memberId, overrideAccess: true })
}

/** Delete every membership row of a workspace (workspace deletion). Returns the count removed. */
export async function deleteWorkspaceMembers(payload: Payload, workspaceId: string): Promise<number> {
  const result = await payload.delete({
    collection: COLLECTION,
    where: { workspace: { equals: workspaceId } },
    overrideAccess: true,
  })
  return result.docs.length
}
