import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('payload', () => ({ getPayload: vi.fn() }))
vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('@/lib/authz', () => ({ getActor: vi.fn(), check: vi.fn() }))

const lineage = vi.hoisted(() => ({
  getTopicLineageGraph: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
  getApplicationLineageGraph: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
  getTopicLineageSummary: vi.fn().mockResolvedValue({}),
  getApplicationLineageSummary: vi.fn().mockResolvedValue({}),
  getCrossWorkspaceLineage: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/lib/kafka/lineage', () => lineage)

import { getPayload } from 'payload'
import { getActor, check } from '@/lib/authz'
import {
  getTopicLineage,
  getApplicationLineage,
  getTopicLineageSummaryAction,
  getApplicationLineageSummaryAction,
  getCrossWorkspaceLineageAction,
  getTopicLineageEdges,
  getApplicationLineageEdges,
} from '../kafka-lineage'

const actor = {
  payloadId: 'pl-1',
  betterAuthId: 'ba-1',
  email: 'a@test.com',
  role: 'user',
  isPlatformAdmin: false,
  user: { id: 'pl-1', collection: 'users' },
}

type Call = () => Promise<{ success: boolean; error?: string }>

const calls: Array<[string, Call]> = [
  ['getTopicLineage', () => getTopicLineage('t-1')],
  ['getApplicationLineage', () => getApplicationLineage('a-1')],
  ['getTopicLineageSummaryAction', () => getTopicLineageSummaryAction('t-1')],
  ['getApplicationLineageSummaryAction', () => getApplicationLineageSummaryAction('a-1')],
  ['getCrossWorkspaceLineageAction', () => getCrossWorkspaceLineageAction('ws-1')],
  ['getTopicLineageEdges', () => getTopicLineageEdges('t-1')],
  ['getApplicationLineageEdges', () => getApplicationLineageEdges('a-1')],
]

describe('kafka lineage actions: authorization', () => {
  let payload: { findByID: ReturnType<typeof vi.fn>; find: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    vi.clearAllMocks()
    payload = {
      findByID: vi.fn().mockImplementation(async ({ collection, id }: any) => {
        if (collection === 'workspaces') return { id }
        return { id, workspace: { id: 'ws-1' } }
      }),
      find: vi.fn().mockResolvedValue({ docs: [] }),
    }
    ;(getPayload as any).mockResolvedValue(payload)
    ;(getActor as any).mockResolvedValue(actor)
    ;(check as any).mockResolvedValue({ allowed: true, reason: 'workspace member', actor })
  })

  const noDataAccess = () => {
    expect(payload.find).not.toHaveBeenCalled()
    for (const fn of Object.values(lineage)) expect(fn).not.toHaveBeenCalled()
  }

  describe.each(calls)('%s', (_name, call) => {
    it('rejects unauthenticated callers', async () => {
      ;(getActor as any).mockResolvedValue(null)
      const r = await call()
      expect(r.success).toBe(false)
      noDataAccess()
    })

    it('rejects non-members of the owning workspace', async () => {
      ;(check as any).mockResolvedValue({ allowed: false, reason: 'not a member of this workspace', actor })
      const r = await call()
      expect(r.success).toBe(false)
      expect(check).toHaveBeenCalledWith('read', { kind: 'workspace', id: 'ws-1' }, actor)
      noDataAccess()
    })

    it('allows members', async () => {
      const r = await call()
      expect(r.success).toBe(true)
    })
  })
})
