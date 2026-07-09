import { describe, it, expect } from 'vitest'
import type { Payload } from 'payload'
import {
  isTokenExpired,
  toAdminInstallationView,
  sortInstallations,
  listInstallationsAdminCore,
  getInstallationRefreshStateCore,
  countAppsForInstallation,
  deleteInstallationCore,
  updateInstallationWorkspacesCore,
  type AdminInstallationView,
} from './installations-core'

// --- FakePayload -------------------------------------------------------------
// Minimal in-memory Payload stand-in (find/findByID/delete) mirroring the
// discovery core tests. allowedWorkspaces are pre-populated to model depth:1.

type Doc = Record<string, unknown> & { id: string }

function getField(doc: Doc, field: string): unknown {
  return field.split('.').reduce<unknown>((acc, part) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[part]
    return undefined
  }, doc)
}

function matchesWhere(doc: Doc, where: unknown): boolean {
  if (!where || typeof where !== 'object') return true
  for (const [field, condRaw] of Object.entries(where as Record<string, unknown>)) {
    const cond = condRaw as Record<string, unknown>
    if ('equals' in cond && getField(doc, field) !== cond.equals) return false
  }
  return true
}

class FakePayload {
  collections: Record<string, Doc[]> = { 'github-installations': [], apps: [] }

  async find({
    collection,
    where,
    limit = 100,
  }: {
    collection: string
    where?: unknown
    limit?: number
  }) {
    const matched = (this.collections[collection] ?? []).filter((d) => matchesWhere(d, where))
    // limit:0 means "count only" in Payload — return no rows but the total.
    const docs = limit === 0 ? [] : matched.slice(0, limit)
    return { docs, totalDocs: matched.length, hasNextPage: false }
  }

  async findByID({ collection, id }: { collection: string; id: string }) {
    const doc = (this.collections[collection] ?? []).find((d) => d.id === id)
    if (!doc) throw new Error(`findByID: ${collection}/${id} not found`)
    return doc
  }

  async delete({ collection, id }: { collection: string; id: string }) {
    const list = this.collections[collection] ?? []
    const idx = list.findIndex((d) => d.id === id)
    if (idx === -1) throw new Error(`delete: ${collection}/${id} not found`)
    const [doc] = list.splice(idx, 1)
    return doc
  }

  async update({
    collection,
    id,
    data,
  }: {
    collection: string
    id: string
    data: Record<string, unknown>
  }) {
    const doc = (this.collections[collection] ?? []).find((d) => d.id === id)
    if (!doc) throw new Error(`update: ${collection}/${id} not found`)
    Object.assign(doc, data)
    return doc
  }
}

function payloadOf(f: FakePayload) {
  return f as unknown as Payload
}

const NOW = new Date('2026-07-07T12:00:00.000Z')
const FUTURE = '2026-07-07T13:00:00.000Z'
const PAST = '2026-07-07T11:00:00.000Z'

describe('isTokenExpired', () => {
  it('treats a future expiry as valid', () => {
    expect(isTokenExpired(FUTURE, NOW)).toBe(false)
  })
  it('treats a past expiry as expired', () => {
    expect(isTokenExpired(PAST, NOW)).toBe(true)
  })
  it('treats exact-now as expired (<=)', () => {
    expect(isTokenExpired(NOW.toISOString(), NOW)).toBe(true)
  })
  it('treats missing/malformed timestamps as expired', () => {
    expect(isTokenExpired(null, NOW)).toBe(true)
    expect(isTokenExpired(undefined, NOW)).toBe(true)
    expect(isTokenExpired('not-a-date', NOW)).toBe(true)
  })
})

describe('toAdminInstallationView', () => {
  it('projects fields, computes tokenExpired, and never leaks the token', () => {
    const view = toAdminInstallationView(
      {
        id: 'inst-1',
        installationId: 12345,
        accountLogin: 'acme',
        installationToken: 'encrypted-secret',
        tokenExpiresAt: FUTURE,
        status: 'active',
        repositorySelection: 'selected',
        selectedRepositories: [{ fullName: 'acme/a' }, { fullName: 'acme/b' }],
        allowedWorkspaces: [{ id: 'ws-1', name: 'Platform' }, 'ws-2'],
        updatedAt: PAST,
      },
      NOW,
    )
    expect(view).toMatchObject<Partial<AdminInstallationView>>({
      id: 'inst-1',
      installationId: '12345',
      accountLogin: 'acme',
      status: 'active',
      tokenExpiresAt: FUTURE,
      tokenExpired: false,
      repositorySelection: 'selected',
      selectedRepositoryCount: 2,
    })
    expect(view.allowedWorkspaces).toEqual([
      { id: 'ws-1', name: 'Platform' },
      { id: 'ws-2', name: 'ws-2' },
    ])
    expect(JSON.stringify(view)).not.toContain('encrypted-secret')
    expect('installationToken' in (view as unknown as Record<string, unknown>)).toBe(false)
  })

  it('flags an expired token', () => {
    const view = toAdminInstallationView(
      { id: 'x', installationId: 1, accountLogin: 'x', tokenExpiresAt: PAST, status: 'active' },
      NOW,
    )
    expect(view.tokenExpired).toBe(true)
  })

  it('defaults selectedRepositoryCount to 0 when repositorySelection is all', () => {
    const view = toAdminInstallationView(
      { id: 'x', installationId: 1, accountLogin: 'x', tokenExpiresAt: FUTURE, repositorySelection: 'all' },
      NOW,
    )
    expect(view.selectedRepositoryCount).toBe(0)
    expect(view.repositorySelection).toBe('all')
  })
})

describe('sortInstallations', () => {
  it('puts unhealthy (bad status or expired token) first, then alphabetical', () => {
    const mk = (
      accountLogin: string,
      status: AdminInstallationView['status'],
      tokenExpired: boolean,
    ): AdminInstallationView => ({
      id: accountLogin,
      installationId: accountLogin,
      accountLogin,
      status,
      tokenExpiresAt: null,
      tokenExpired,
      repositorySelection: 'all',
      selectedRepositoryCount: 0,
      allowedWorkspaces: [],
      lastFailureReason: null,
      updatedAt: null,
    })
    const sorted = sortInstallations([
      mk('zebra', 'active', false), // healthy
      mk('apple', 'active', false), // healthy
      mk('mango', 'active', true), // expired token → attention
      mk('beta', 'needs_reconnect', false), // bad status → attention
    ])
    expect(sorted.map((v) => v.accountLogin)).toEqual(['beta', 'mango', 'apple', 'zebra'])
  })
})

describe('listInstallationsAdminCore', () => {
  it('maps all docs, sorts unhealthy first, and omits the token', async () => {
    const fp = new FakePayload()
    fp.collections['github-installations'] = [
      {
        id: 'a',
        installationId: 1,
        accountLogin: 'healthy-co',
        installationToken: 'secret-a',
        tokenExpiresAt: FUTURE,
        status: 'active',
        repositorySelection: 'all',
        allowedWorkspaces: [],
      },
      {
        id: 'b',
        installationId: 2,
        accountLogin: 'expired-co',
        installationToken: 'secret-b',
        tokenExpiresAt: PAST,
        status: 'active',
        repositorySelection: 'all',
        allowedWorkspaces: [],
      },
    ]
    const views = await listInstallationsAdminCore(payloadOf(fp), NOW)
    expect(views.map((v) => v.accountLogin)).toEqual(['expired-co', 'healthy-co'])
    expect(JSON.stringify(views)).not.toContain('secret-a')
    expect(JSON.stringify(views)).not.toContain('secret-b')
  })
})

describe('getInstallationRefreshStateCore', () => {
  it('returns the current status + freshly computed expiry after a refresh flips the token', async () => {
    const fp = new FakePayload()
    fp.collections['github-installations'] = [
      { id: 'a', installationId: 1, tokenExpiresAt: PAST, status: 'refresh_failed' },
    ]
    const before = await getInstallationRefreshStateCore(payloadOf(fp), 'a', NOW)
    expect(before).toEqual({ status: 'refresh_failed', tokenExpiresAt: PAST, tokenExpired: true })

    // Simulate the refresh workflow writing a fresh token + healthy status.
    fp.collections['github-installations'][0].tokenExpiresAt = FUTURE
    fp.collections['github-installations'][0].status = 'active'
    const after = await getInstallationRefreshStateCore(payloadOf(fp), 'a', NOW)
    expect(after).toEqual({ status: 'active', tokenExpiresAt: FUTURE, tokenExpired: false })
  })
})

describe('countAppsForInstallation', () => {
  it('counts apps whose repository.installationId matches the numeric id', async () => {
    const fp = new FakePayload()
    fp.collections['apps'] = [
      { id: 'a1', repository: { installationId: '12345' } },
      { id: 'a2', repository: { installationId: '12345' } },
      { id: 'a3', repository: { installationId: '999' } },
      { id: 'a4' }, // no repository
    ]
    expect(await countAppsForInstallation(payloadOf(fp), '12345')).toBe(2)
    expect(await countAppsForInstallation(payloadOf(fp), '999')).toBe(1)
    expect(await countAppsForInstallation(payloadOf(fp), 'none')).toBe(0)
  })
})

describe('deleteInstallationCore', () => {
  it('cancels the refresh workflow, deletes the doc, and reports the app count', async () => {
    const fp = new FakePayload()
    fp.collections['github-installations'] = [{ id: 'inst-1', installationId: 12345 }]
    fp.collections['apps'] = [
      { id: 'a1', repository: { installationId: '12345' } },
      { id: 'a2', repository: { installationId: '12345' } },
    ]
    let cancelled = false
    const res = await deleteInstallationCore(payloadOf(fp), 'inst-1', async () => {
      cancelled = true
    })
    expect(res).toEqual({ ok: true, appCount: 2 })
    expect(cancelled).toBe(true)
    expect(fp.collections['github-installations']).toHaveLength(0)
  })

  it('still deletes when the workflow cancel throws (best-effort)', async () => {
    const fp = new FakePayload()
    fp.collections['github-installations'] = [{ id: 'inst-1', installationId: 12345 }]
    const res = await deleteInstallationCore(payloadOf(fp), 'inst-1', async () => {
      throw new Error('workflow not found')
    })
    expect(res.ok).toBe(true)
    expect(fp.collections['github-installations']).toHaveLength(0)
  })

  it('returns not-found for a missing installation without cancelling', async () => {
    const fp = new FakePayload()
    let cancelled = false
    const res = await deleteInstallationCore(payloadOf(fp), 'nope', async () => {
      cancelled = true
    })
    expect(res).toEqual({ ok: false, error: 'Installation not found', appCount: 0 })
    expect(cancelled).toBe(false)
  })
})

describe('updateInstallationWorkspacesCore', () => {
  it('persists the workspace ids onto the installation doc', async () => {
    const fp = new FakePayload()
    fp.collections['github-installations'] = [
      { id: 'inst-1', installationId: 12345, allowedWorkspaces: ['ws-old'] },
    ]
    const res = await updateInstallationWorkspacesCore(payloadOf(fp), 'inst-1', ['ws-1', 'ws-2'])
    expect(res).toEqual({ ok: true })
    expect(fp.collections['github-installations'][0].allowedWorkspaces).toEqual(['ws-1', 'ws-2'])
  })

  it('clears the assignment when given an empty array', async () => {
    const fp = new FakePayload()
    fp.collections['github-installations'] = [
      { id: 'inst-1', installationId: 12345, allowedWorkspaces: ['ws-1'] },
    ]
    const res = await updateInstallationWorkspacesCore(payloadOf(fp), 'inst-1', [])
    expect(res.ok).toBe(true)
    expect(fp.collections['github-installations'][0].allowedWorkspaces).toEqual([])
  })

  it('rejects a missing installation id', async () => {
    const fp = new FakePayload()
    const res = await updateInstallationWorkspacesCore(payloadOf(fp), '', ['ws-1'])
    expect(res).toEqual({ ok: false, error: 'Installation id is required' })
  })

  it('returns not-found when the installation does not exist', async () => {
    const fp = new FakePayload()
    const res = await updateInstallationWorkspacesCore(payloadOf(fp), 'nope', ['ws-1'])
    expect(res).toEqual({ ok: false, error: 'Installation not found' })
  })
})
