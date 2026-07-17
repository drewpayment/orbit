import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('payload', () => ({ getPayload: vi.fn() }))
vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('@/lib/auth/session', () => ({ getCurrentUser: vi.fn() }))
vi.mock('@/lib/scorecards/evaluate', () => ({
  clearScorecardProjections: vi.fn(),
  runScorecardEvaluation: vi.fn(),
}))
vi.mock('@/lib/scorecards/authz', () => ({ canManageScorecards: vi.fn() }))

import { getPayload } from 'payload'
import { getCurrentUser } from '@/lib/auth/session'
import { canManageScorecards } from '@/lib/scorecards/authz'
import { clearScorecardProjections, runScorecardEvaluation } from '@/lib/scorecards/evaluate'
import { Scorecards } from '@/collections/scorecards/Scorecards'
import { ScorecardRules } from '@/collections/scorecards/ScorecardRules'
import {
  deleteRule,
  deleteScorecard,
  getEntityScoreSummary,
  getManageableWorkspaces,
  getScorecardDetail,
  listScorecards,
  updateScorecard,
} from './actions'

function makePayload() {
  return {
    find: vi.fn(async ({ collection }: { collection: string }) => {
      if (collection === 'workspace-members') {
        return { docs: [{ workspace: 'ws-attacker' }] }
      }
      if (collection === 'scorecards') return { docs: [] }
      throw new Error(`unexpected find ${collection}`)
    }),
    findByID: vi.fn(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getCurrentUser as Mock).mockResolvedValue({ id: 'ba-attacker' })
  ;(canManageScorecards as Mock).mockResolvedValue(true)
})

describe('scorecard projection lifecycle', () => {
  it('clears scorecard projections and recomputes the workspace when disabling', async () => {
    const payload = {
      findByID: vi.fn().mockResolvedValue({ id: 'sc1', workspace: 'ws1', enabled: true }),
      update: vi.fn().mockResolvedValue({ id: 'sc1', workspace: 'ws1', enabled: false }),
    }
    ;(getPayload as Mock).mockResolvedValue(payload)

    await updateScorecard('sc1', { enabled: false })

    expect(clearScorecardProjections).toHaveBeenCalledWith(payload, 'sc1', 'ws1')
  })

  it('cascades scorecard-owned initiatives, action items, snapshots, rules, and projections', async () => {
    const payload = {
      findByID: vi.fn().mockResolvedValue({ id: 'sc1', workspace: 'ws1', enabled: true }),
      find: vi.fn().mockResolvedValue({ docs: [{ id: 'i1' }, { id: 'i2' }], hasNextPage: false }),
      delete: vi.fn().mockResolvedValue({ docs: [] }),
    }
    ;(getPayload as Mock).mockResolvedValue(payload)

    await deleteScorecard('sc1')

    expect(clearScorecardProjections).toHaveBeenCalledWith(payload, 'sc1', 'ws1')
    expect(payload.delete).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'initiative-action-items',
        where: { initiative: { in: ['i1', 'i2'] } },
      }),
    )
    expect(payload.delete).toHaveBeenCalledWith(
      expect.objectContaining({ collection: 'initiatives', where: { id: { in: ['i1', 'i2'] } } }),
    )
    expect(payload.delete).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'score-snapshots',
        where: { scorecard: { equals: 'sc1' } },
      }),
    )
  })

  it('re-evaluates the parent scorecard after deleting a rule', async () => {
    const payload = {
      findByID: vi.fn().mockResolvedValue({ id: 'r1', scorecard: 'sc1', workspace: 'ws1' }),
      delete: vi.fn().mockResolvedValue({ docs: [] }),
    }
    ;(getPayload as Mock).mockResolvedValue(payload)

    await deleteRule('r1')

    expect(runScorecardEvaluation).toHaveBeenCalledWith(payload, 'sc1')
  })
})

describe('scorecard collection mutation boundary', () => {
  it.each([
    [Scorecards, 'create'],
    [Scorecards, 'update'],
    [Scorecards, 'delete'],
    [ScorecardRules, 'create'],
    [ScorecardRules, 'update'],
    [ScorecardRules, 'delete'],
  ] as const)('rejects direct %s %s mutations so lifecycle services cannot be bypassed', async (collection, operation) => {
    const access = collection.access?.[operation]
    expect(typeof access).toBe('function')
    expect(
      await (access as (args: unknown) => boolean | Promise<boolean>)({
        req: { user: { id: 'payload-admin', role: 'super_admin' } },
        data: { workspace: 'ws-1' },
        id: 'doc-1',
      }),
    ).toBe(false)
  })
})

describe('scorecard server-action identity boundary', () => {
  it('does not expose an identity argument on read actions', () => {
    expect(listScorecards.length).toBe(0)
    expect(getManageableWorkspaces.length).toBe(0)
    expect(getScorecardDetail.length).toBe(1)
    expect(getEntityScoreSummary.length).toBe(1)
  })

  it('ignores an injected identity and scopes list reads to the authenticated session', async () => {
    const payload = makePayload()
    ;(getPayload as Mock).mockResolvedValue(payload)

    await (listScorecards as unknown as (injectedUserId: string) => Promise<unknown>)('ba-victim')

    expect(payload.find).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'workspace-members',
        where: expect.objectContaining({ user: { equals: 'ba-attacker' } }),
      }),
    )
  })
})
