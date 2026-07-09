import type { Payload } from 'payload'

/**
 * Testable core for the dashboard Attention Hub discovery card (WP7, Phase 1.5,
 * docs/plans/2026-07-06-catalog-discovery.md).
 *
 * `getDiscoveryAttention` answers one question for the signed-in dashboard: how
 * many `status: 'proposed'` discovery rows are waiting for review, grouped by the
 * workspace they belong to. It is a read-only aggregate — no mutations, no
 * Temporal — so it lives session-free here and is unit-tested with the same
 * FakePayload pattern as `actions-core.test.ts`.
 *
 * Tenant isolation mirrors the rest of discovery: membership is keyed on the
 * caller's **Better-Auth id** (`workspace-members.user` is a TEXT field holding
 * that id) — never the Payload `users` id. Platform admins additionally see the
 * GLOBAL queue (rows with no workspace — WP8), matching the CatalogEntities
 * global-entity access rules; non-admins never see global rows.
 */

/** Human label for the platform-admin global (workspace-less) proposal group. */
export const GLOBAL_GROUP_NAME = 'Global catalog'

/**
 * The hub is bounded: at most this many rows render. When the caller has more
 * groups than this, the lowest-priority remainder folds into a single overflow
 * row (`workspaceId: 'overflow'`) so the card never grows unbounded.
 */
export const MAX_ATTENTION_GROUPS = 6

export interface DiscoveryAttentionGroup {
  /** Workspace id, `null` for the global queue, or `'overflow'` for the folded remainder. */
  workspaceId: string | null
  workspaceName: string
  /** Slug for the workspace `/discovery` link; `null` for global and overflow rows. */
  workspaceSlug: string | null
  proposed: number
}

export interface DiscoveryAttention {
  /** Total proposed rows the caller can see (across every group, pre-cap). */
  total: number
  groups: DiscoveryAttentionGroup[]
}

const EMPTY: DiscoveryAttention = { total: 0, groups: [] }

/** Normalize a relationship value (`string` id or populated `{ id }`) to its id. */
function relId(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value === 'object' && 'id' in (value as Record<string, unknown>)) {
    return String((value as { id: unknown }).id)
  }
  return null
}

/**
 * Proposed-discovery counts grouped by workspace for the dashboard hub. Returns
 * one group per member workspace with at least one `proposed` row, plus a single
 * GLOBAL group (workspace-less rows) when `isPlatformAdmin`. Groups are sorted by
 * `proposed` descending and capped at {@link MAX_ATTENTION_GROUPS}; any remainder
 * folds into an `overflow` row. `total` counts every proposed row the caller can
 * see, so the card can render nothing when it is zero.
 */
export async function getDiscoveryAttention(
  payload: Payload,
  betterAuthId: string,
  isPlatformAdmin: boolean,
): Promise<DiscoveryAttention> {
  if (!betterAuthId) return EMPTY

  // Active member workspaces, keyed on the Better-Auth id (tenant isolation).
  const members = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [{ user: { equals: betterAuthId } }, { status: { equals: 'active' } }],
    },
    limit: 1000,
    depth: 0,
    overrideAccess: true,
  })

  const workspaceIds = Array.from(
    new Set(members.docs.map((d) => relId(d.workspace)).filter((id): id is string => !!id)),
  )

  const groups: DiscoveryAttentionGroup[] = []

  if (workspaceIds.length > 0) {
    // Resolve names/slugs for the link targets in one query.
    const workspaces = await payload.find({
      collection: 'workspaces',
      where: { id: { in: workspaceIds } },
      limit: 1000,
      depth: 0,
      overrideAccess: true,
    })
    const byId = new Map(workspaces.docs.map((w) => [String(w.id), w]))

    for (const id of workspaceIds) {
      const { totalDocs } = await payload.count({
        collection: 'discovered-entities',
        where: {
          and: [{ workspace: { equals: id } }, { status: { equals: 'proposed' } }],
        },
        overrideAccess: true,
      })
      if (totalDocs > 0) {
        const ws = byId.get(id)
        groups.push({
          workspaceId: id,
          workspaceName: ws?.name ?? 'Workspace',
          workspaceSlug: ws?.slug ?? null,
          proposed: totalDocs,
        })
      }
    }
  }

  // Global (workspace-less) queue — platform admins only (WP8). Harmless while
  // `workspace` is still required: the count is simply zero.
  if (isPlatformAdmin) {
    const { totalDocs } = await payload.count({
      collection: 'discovered-entities',
      where: {
        and: [{ workspace: { exists: false } }, { status: { equals: 'proposed' } }],
      },
      overrideAccess: true,
    })
    if (totalDocs > 0) {
      groups.push({
        workspaceId: null,
        workspaceName: GLOBAL_GROUP_NAME,
        workspaceSlug: null,
        proposed: totalDocs,
      })
    }
  }

  const total = groups.reduce((sum, g) => sum + g.proposed, 0)

  // Highest-priority (most proposals) first; stable name tiebreak keeps ordering
  // deterministic for equal counts.
  groups.sort((a, b) => b.proposed - a.proposed || a.workspaceName.localeCompare(b.workspaceName))

  if (groups.length > MAX_ATTENTION_GROUPS) {
    const head = groups.slice(0, MAX_ATTENTION_GROUPS - 1)
    const rest = groups.slice(MAX_ATTENTION_GROUPS - 1)
    head.push({
      workspaceId: 'overflow',
      workspaceName: `${rest.length} more workspace${rest.length === 1 ? '' : 's'}`,
      workspaceSlug: null,
      proposed: rest.reduce((sum, g) => sum + g.proposed, 0),
    })
    return { total, groups: head }
  }

  return { total, groups }
}
