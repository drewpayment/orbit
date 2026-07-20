import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('payload', () => ({ getPayload: vi.fn() }))
vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('@/lib/auth/session', () => ({ getCurrentUser: vi.fn() }))

import { getPayload } from 'payload'
import { getCurrentUser } from '@/lib/auth/session'
import { getScorecardReport } from './actions'

function whereText(value: unknown): string {
  return JSON.stringify(value)
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getCurrentUser as Mock).mockResolvedValue({ id: 'ba-user' })
})

describe('getScorecardReport workspace boundary', () => {
  it('rejects a workspace without an active membership before loading report data', async () => {
    const payload = {
      find: vi.fn(async ({ collection }: { collection: string }) => {
        if (collection === 'workspace-members') return { docs: [], hasNextPage: false, totalDocs: 0 }
        throw new Error(`unexpected query: ${collection}`)
      }),
    }
    ;(getPayload as Mock).mockResolvedValue(payload)

    const report = await getScorecardReport('ws-victim', 30)

    expect(report.kpis.entityTotal).toBe(0)
    expect(payload.find).toHaveBeenCalledTimes(1)
    const membershipQuery = payload.find.mock.calls[0][0] as Record<string, unknown>
    expect(whereText(membershipQuery.where)).toContain('ws-victim')
  })

  it('scopes every data query to one workspace and includes all result pages', async () => {
    const payload = {
      find: vi.fn(async (args: Record<string, unknown>) => {
        const collection = String(args.collection)
        const where = whereText(args.where)
        const page = Number(args.page ?? 1)

        if (collection === 'workspace-members') {
          return { docs: [{ id: 'm1', workspace: 'ws1' }], hasNextPage: false, totalDocs: 1 }
        }
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

    const dataQueries = payload.find.mock.calls
      .map(([args]) => args as Record<string, unknown>)
      .filter((args) => args.collection !== 'workspace-members')
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
