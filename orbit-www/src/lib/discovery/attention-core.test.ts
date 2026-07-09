import { describe, it, expect } from 'vitest'
import type { Payload } from 'payload'
import {
  getDiscoveryAttention,
  GLOBAL_GROUP_NAME,
  MAX_ATTENTION_GROUPS,
} from './attention-core'

// --- FakePayload -------------------------------------------------------------
//
// In-memory Payload stand-in mirroring actions-core.test.ts, extended with a
// `count` method (used by the aggregate) and a `workspaces` collection, plus an
// `exists` operator so the global (workspace-less) query runs against it. The
// real getWorkspaceMembership-style query keys on the Better-Auth id, so no authz
// mocking — the tenant isolation is exercised for real.

type Doc = Record<string, unknown> & { id: string }

class FakePayload {
  collections: Record<string, Doc[]> = {
    'workspace-members': [],
    'discovered-entities': [],
    workspaces: [],
  }

  async find({
    collection,
    where,
    limit = 100,
  }: {
    collection: string
    where?: unknown
    limit?: number
  }) {
    const all = (this.collections[collection] ?? []).filter((d) => matchesWhere(d, where))
    return { docs: all.slice(0, limit), hasNextPage: false }
  }

  async count({ collection, where }: { collection: string; where?: unknown }) {
    const all = (this.collections[collection] ?? []).filter((d) => matchesWhere(d, where))
    return { totalDocs: all.length }
  }
}

function getField(doc: Doc, field: string): unknown {
  if (field.includes('.')) {
    return field.split('.').reduce<unknown>((acc, part) => {
      if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[part]
      return undefined
    }, doc)
  }
  return doc[field]
}

function matchesWhere(doc: Doc, where: unknown): boolean {
  if (!where || typeof where !== 'object') return true
  const w = where as Record<string, unknown>
  if (Array.isArray(w.and)) return (w.and as unknown[]).every((c) => matchesWhere(doc, c))
  if (Array.isArray(w.or)) return (w.or as unknown[]).some((c) => matchesWhere(doc, c))

  for (const [field, condRaw] of Object.entries(w)) {
    const cond = condRaw as Record<string, unknown>
    const raw = field === 'id' ? doc.id : getField(doc, field)
    const actualId = raw && typeof raw === 'object' ? (raw as Doc).id : raw
    if ('equals' in cond) {
      if (actualId !== cond.equals) return false
    } else if ('in' in cond) {
      if (!(cond.in as unknown[]).includes(actualId)) return false
    } else if ('exists' in cond) {
      const present = raw !== undefined && raw !== null
      if (present !== cond.exists) return false
    }
  }
  return true
}

function fp() {
  return new FakePayload()
}
function payloadOf(f: FakePayload) {
  return f as unknown as Payload
}

const AUTH_ID = 'better-auth-user-1'

function seedMember(f: FakePayload, workspaceId: string, betterAuthId = AUTH_ID) {
  f.collections['workspace-members'].push({
    id: `wm-${workspaceId}-${betterAuthId}`,
    workspace: workspaceId,
    user: betterAuthId,
    role: 'member',
    status: 'active',
  })
}

function seedWorkspace(f: FakePayload, id: string, name: string, slug: string) {
  f.collections.workspaces.push({ id, name, slug })
}

let dedupe = 0
function seedProposed(f: FakePayload, workspaceId: string | null, status = 'proposed') {
  f.collections['discovered-entities'].push({
    id: `de-${dedupe}`,
    ...(workspaceId === null ? {} : { workspace: workspaceId }),
    status,
    detectedKind: 'service',
    dedupeKey: `key-${dedupe++}`,
  })
}

describe('getDiscoveryAttention', () => {
  it('returns empty for a missing caller', async () => {
    const f = fp()
    expect(await getDiscoveryAttention(payloadOf(f), '', false)).toEqual({ total: 0, groups: [] })
  })

  it('returns empty when the caller has no proposals to review', async () => {
    const f = fp()
    seedMember(f, 'ws1')
    seedWorkspace(f, 'ws1', 'Alpha', 'alpha')
    // an imported row must not count
    seedProposed(f, 'ws1', 'imported')

    const res = await getDiscoveryAttention(payloadOf(f), AUTH_ID, false)
    expect(res).toEqual({ total: 0, groups: [] })
  })

  it('groups proposed counts by member workspace with name + slug', async () => {
    const f = fp()
    seedMember(f, 'ws1')
    seedMember(f, 'ws2')
    seedWorkspace(f, 'ws1', 'Alpha', 'alpha')
    seedWorkspace(f, 'ws2', 'Beta', 'beta')
    seedProposed(f, 'ws1')
    seedProposed(f, 'ws2')
    seedProposed(f, 'ws2')
    seedProposed(f, 'ws2') // ws2 has more → sorts first

    const res = await getDiscoveryAttention(payloadOf(f), AUTH_ID, false)
    expect(res.total).toBe(4)
    expect(res.groups).toEqual([
      { workspaceId: 'ws2', workspaceName: 'Beta', workspaceSlug: 'beta', proposed: 3 },
      { workspaceId: 'ws1', workspaceName: 'Alpha', workspaceSlug: 'alpha', proposed: 1 },
    ])
  })

  it('omits member workspaces with zero proposed rows', async () => {
    const f = fp()
    seedMember(f, 'ws1')
    seedMember(f, 'ws2')
    seedWorkspace(f, 'ws1', 'Alpha', 'alpha')
    seedWorkspace(f, 'ws2', 'Beta', 'beta')
    seedProposed(f, 'ws1')

    const res = await getDiscoveryAttention(payloadOf(f), AUTH_ID, false)
    expect(res.groups.map((g) => g.workspaceId)).toEqual(['ws1'])
  })

  it('never counts another workspace the caller is not a member of', async () => {
    const f = fp()
    seedMember(f, 'ws1')
    seedWorkspace(f, 'ws1', 'Alpha', 'alpha')
    seedProposed(f, 'ws1')
    seedProposed(f, 'ws-other') // caller is not a member

    const res = await getDiscoveryAttention(payloadOf(f), AUTH_ID, false)
    expect(res.total).toBe(1)
    expect(res.groups).toHaveLength(1)
    expect(res.groups[0].workspaceId).toBe('ws1')
  })

  it('adds a global group only for platform admins', async () => {
    const f = fp()
    seedMember(f, 'ws1')
    seedWorkspace(f, 'ws1', 'Alpha', 'alpha')
    seedProposed(f, 'ws1')
    seedProposed(f, null) // global (workspace-less)
    seedProposed(f, null)

    const nonAdmin = await getDiscoveryAttention(payloadOf(f), AUTH_ID, false)
    expect(nonAdmin.total).toBe(1)
    expect(nonAdmin.groups.map((g) => g.workspaceId)).toEqual(['ws1'])

    const admin = await getDiscoveryAttention(payloadOf(f), AUTH_ID, true)
    expect(admin.total).toBe(3)
    const global = admin.groups.find((g) => g.workspaceId === null)
    expect(global).toEqual({
      workspaceId: null,
      workspaceName: GLOBAL_GROUP_NAME,
      workspaceSlug: null,
      proposed: 2,
    })
  })

  it('caps at MAX_ATTENTION_GROUPS, folding the remainder into an overflow row', async () => {
    const f = fp()
    // 8 member workspaces, one proposal each — decreasing so ordering is stable.
    for (let i = 0; i < 8; i++) {
      const id = `ws${i}`
      seedMember(f, id)
      seedWorkspace(f, id, `W${i}`, `w${i}`)
      for (let n = 0; n <= 8 - i; n++) seedProposed(f, id)
    }

    const res = await getDiscoveryAttention(payloadOf(f), AUTH_ID, false)
    expect(res.groups).toHaveLength(MAX_ATTENTION_GROUPS)
    const overflow = res.groups[res.groups.length - 1]
    expect(overflow.workspaceId).toBe('overflow')
    expect(overflow.workspaceName).toBe('3 more workspaces')
    // total is the true sum across every proposed row, incl. the folded remainder
    const summed = res.groups.reduce((s, g) => s + g.proposed, 0)
    expect(summed).toBe(res.total)
  })
})
