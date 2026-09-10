import type { getPayload } from 'payload'
import type { EntityKind } from '@/collections/catalog/constants'

/**
 * Data sources for Orbit-native `SchemaForm` field pickers (Template
 * Authoring Phase 2, Group A Task 5): `OrbitTeamPicker`, `OrbitEntityPicker`,
 * `OrbitRepoPicker`. `OrbitWorkspacePicker` doesn't need a lookup here — the
 * caller already resolves the manageable-workspaces list server-side and
 * passes it in as a prop.
 *
 * PURE module — no `'use server'`, no `@payload-config` import — so these
 * functions are unit-testable against a fake Payload client without pulling
 * in the whole app config (and its `DATABASE_URI` requirement). The
 * `'use server'` wrappers that resolve the real session + Payload client live
 * in `picker-data-actions.ts`, which imports from here.
 *
 * Every function is RBAC-scoped to the CALLER's own workspace membership —
 * never to a `workspaceId`/`connectionId` prop alone. A caller who is not an
 * active member of the requested workspace gets an empty list, not an error
 * (pickers degrade to "no options" rather than leaking existence).
 *
 * KNOWN LIMITATION — `OrbitRepoPicker`: there is no live-provider (GitHub/ADO)
 * repository-browsing API wired up in this repo yet. `getReposForConnection`
 * proxies with `catalog-entities` rows of kind `service` whose `source.type`
 * is `apps` or `scan` (i.e. already-imported/discovered repos) within the
 * connection's `allowedWorkspaces`. This is a v1 stand-in, not a live
 * provider browse — flagged as a follow-up in the PR.
 */

type PayloadClient = Awaited<ReturnType<typeof getPayload>>

export interface PickerOption {
  id: string
  label: string
  description?: string
}

function relId(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value === 'object' && 'id' in (value as Record<string, unknown>)) {
    return String((value as { id: unknown }).id)
  }
  return null
}

/** Is `userId` an active member of `workspaceId`? The tenant boundary check every picker gates on. */
async function isActiveMember(
  payload: PayloadClient,
  userId: string,
  workspaceId: string,
): Promise<boolean> {
  const result = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: workspaceId } },
        { user: { equals: userId } },
        { status: { equals: 'active' } },
      ],
    },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  return result.docs.length > 0
}

// ---------------------------------------------------------------------------
// OrbitTeamPicker — no `teams` collection exists yet (verified against
// src/collections/*); proxy with the workspace's active members
// (owners/admins first), per the Phase 2 task instructions.
// ---------------------------------------------------------------------------

export async function getTeamsForWorkspace(
  payload: PayloadClient,
  callerId: string,
  workspaceId: string,
): Promise<PickerOption[]> {
  if (!(await isActiveMember(payload, callerId, workspaceId))) return []

  const members = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [{ workspace: { equals: workspaceId } }, { status: { equals: 'active' } }],
    },
    limit: 500,
    depth: 0,
    overrideAccess: true,
    sort: 'role',
  })

  // `workspace-members.user` stores a Better-Auth id (plain text, not a
  // Payload relationship — see the module doc comment), so it never
  // populates via `depth`. Resolve display names with a second lookup
  // against `users.betterAuthId` rather than showing raw ids in the picker.
  const memberIds = members.docs.map((m) => String(m.user))
  const nameByBetterAuthId = new Map<string, string>()
  if (memberIds.length > 0) {
    const users = await payload.find({
      collection: 'users',
      where: { betterAuthId: { in: memberIds } },
      limit: memberIds.length,
      depth: 0,
      overrideAccess: true,
    })
    for (const u of users.docs) {
      const key = String((u as { betterAuthId?: unknown }).betterAuthId ?? '')
      const name = (u as { name?: string; email?: string }).name || (u as { email?: string }).email
      if (key && name) nameByBetterAuthId.set(key, name)
    }
  }

  return members.docs.map((m) => {
    const userId = String(m.user)
    return {
      id: userId,
      label: nameByBetterAuthId.get(userId) ?? userId,
      description: String(m.role ?? 'member'),
    }
  })
}

// ---------------------------------------------------------------------------
// OrbitEntityPicker(kind)
// ---------------------------------------------------------------------------

export async function getEntitiesForWorkspace(
  payload: PayloadClient,
  callerId: string,
  workspaceId: string,
  kind: EntityKind | string,
): Promise<PickerOption[]> {
  if (!(await isActiveMember(payload, callerId, workspaceId))) return []

  const result = await payload.find({
    collection: 'catalog-entities',
    where: {
      and: [{ workspace: { equals: workspaceId } }, { kind: { equals: kind } }],
    },
    limit: 500,
    depth: 0,
    overrideAccess: true,
  })

  return result.docs.map((e) => ({
    id: String(e.id),
    label: String(e.name ?? e.slug ?? e.id),
    description: e.lifecycle ? String(e.lifecycle) : undefined,
  }))
}

// ---------------------------------------------------------------------------
// OrbitRepoPicker(connection) — see KNOWN LIMITATION above.
// ---------------------------------------------------------------------------

const REPO_PROXY_SOURCE_TYPES = ['apps', 'scan'] as const

export async function getReposForConnection(
  payload: PayloadClient,
  callerId: string,
  workspaceId: string,
  connectionId: string,
): Promise<PickerOption[]> {
  if (!(await isActiveMember(payload, callerId, workspaceId))) return []

  const connection = await payload.findByID({
    collection: 'git-connections',
    id: connectionId,
    depth: 0,
    overrideAccess: true,
  })
  if (!connection) return []

  const allowedWorkspaces = (connection.allowedWorkspaces as unknown[] | undefined ?? []).map(relId)
  if (!allowedWorkspaces.includes(workspaceId)) return []

  const result = await payload.find({
    collection: 'catalog-entities',
    where: {
      and: [
        { workspace: { equals: workspaceId } },
        { kind: { equals: 'service' } },
        { 'source.type': { in: REPO_PROXY_SOURCE_TYPES } },
      ],
    },
    limit: 500,
    depth: 0,
    overrideAccess: true,
  })

  return result.docs.map((e) => ({
    id: String(e.id),
    label: String(e.name ?? e.slug ?? e.id),
  }))
}
