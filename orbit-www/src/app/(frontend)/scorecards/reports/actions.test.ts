import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('payload', () => ({ getPayload: vi.fn() }))
vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('@/lib/authz', () => ({
  getActor: vi.fn(),
  check: vi.fn(),
}))

import { getPayload } from 'payload'
import { getActor, check } from '@/lib/authz'
import { getScorecardReport } from './actions'

const actor = {
  payloadId: 'payload-user',
  betterAuthId: 'ba-user',
  email: 'user@example.com',
  role: 'user' as const,
  isPlatformAdmin: false,
  user: {} as never,
}

function whereText(value: unknown): string {
  return JSON.stringify(value)
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getActor as Mock).mockResolvedValue(actor)
  ;(check as Mock).mockResolvedValue({ allowed: true, reason: 'workspace member', actor })
})

describe('getScorecardReport workspace boundary', () => {
  it('rejects a workspace without an active membership before loading report data', async () => {
    const payload = { find: vi.fn() }
    ;(getPayload as Mock).mockResolvedValue(payload)
    ;(check as Mock).mockResolvedValue({ allowed: false, reason: 'not a member', actor })

    const report = await getScorecardReport('ws-victim', 30)

    expect(report.kpis.entityTotal).toBe(0)
    expect(check).toHaveBeenCalledWith('read', { kind: 'workspace', id: 'ws-victim' }, actor)
    expect(payload.find).not.toHaveBeenCalled()
  })

  it('scopes every data query to one workspace and includes all result pages', async () => {
    const payload = {
      find: vi.fn(async (args: Record<string, unknown>) => {
        const collection = String(args.collection)
        const where = whereText(args.where)
        const page = Number(args.page ?? 1)

        if (collection === 'entity-scores' && where.includes('overall')) {
          return page === 1
            ? {
                docs: [
                  {
                    id: 'overall-1',
                    workspace: 'ws1',
                    scope: 'overall',
                    score: 40,
                    evaluatedAt: '2026-07-01T00:00:00.000Z',
                    entity: { id: 'e1', name: 'one', kind: 'service' },
                  },
                ],
                hasNextPage: true,
                totalDocs: 2,
              }
            : {
                docs: [
                  {
                    id: 'overall-2',
                    workspace: 'ws1',
                    scope: 'overall',
                    score: 80,
                    evaluatedAt: '2026-07-02T00:00:00.000Z',
                    entity: { id: 'e2', name: 'two', kind: 'service' },
                  },
                ],
                hasNextPage: false,
                totalDocs: 2,
              }
        }
        if (collection === 'catalog-entities' && args.limit === 0) {
          return { docs: [], hasNextPage: false, totalDocs: 2 }
        }
        if (collection === 'catalog-entities') {
          return { docs: [], hasNextPage: false, totalDocs: 0 }
        }
        if (collection === 'scorecards') {
          return { docs: [], hasNextPage: false, totalDocs: 0 }
        }
        if (collection === 'score-snapshots') {
          return { docs: [], hasNextPage: false, totalDocs: 0 }
        }
        throw new Error(`unexpected query: ${collection} ${where}`)
      }),
    }
    ;(getPayload as Mock).mockResolvedValue(payload)

    const report = await getScorecardReport('ws1', 30)

    expect(report.workspaceId).toBe('ws1')
    expect(report.kpis.avgScore).toBe(60)
    expect(report.kpis.entityTotal).toBe(2)
    expect(check).toHaveBeenCalledWith('read', { kind: 'workspace', id: 'ws1' }, actor)

    const dataQueries = payload.find.mock.calls.map(([args]) => args as Record<string, unknown>)
    expect(dataQueries.length).toBeGreaterThan(0)
    for (const query of dataQueries) {
      expect(whereText(query.where)).toContain('"equals":"ws1"')
      expect(whereText(query.where)).not.toContain('"in":["ws1"')
    }
    expect(
      payload.find.mock.calls.some(
        ([args]) => args.collection === 'entity-scores' && args.page === 2,
      ),
    ).toBe(true)
    const trendQuery = dataQueries.find((query) => query.collection === 'score-snapshots')
    expect(whereText(trendQuery?.where)).toContain('greater_than_equal')
  })
})
