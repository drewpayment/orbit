import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('payload', () => ({ getPayload: vi.fn() }))
vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('@/lib/authz', () => ({
  getActor: vi.fn(),
  requireActor: vi.fn(),
  check: vi.fn(),
  memberWorkspaceIds: vi.fn(),
}))
vi.mock('@/lib/scorecards/evaluate', () => ({
  clearScorecardProjections: vi.fn(),
  runScorecardEvaluation: vi.fn(),
}))

import { getPayload } from 'payload'
import { getActor, requireActor, check, memberWorkspaceIds } from '@/lib/authz'
import { clearScorecardProjections, runScorecardEvaluation } from '@/lib/scorecards/evaluate'
import { Scorecards } from '@/collections/scorecards/Scorecards'
import { ScorecardRules } from '@/collections/scorecards/ScorecardRules'
import {
  createScorecard,
  deleteRule,
  deleteScorecard,
  getEntityScoreSummary,
  getManageableWorkspaces,
  getScorecardDetail,
  listScorecards,
  updateScorecard,
} from './actions'

const attackerActor = {
  payloadId: 'pl-attacker',
  betterAuthId: 'ba-attacker',
  email: 'attacker@example.com',
  role: 'user' as const,
  isPlatformAdmin: false,
  user: {} as never,
}

function makePayload() {
  return {
    find: vi.fn(async ({ collection }: { collection: string }) => {
      if (collection === 'scorecards') return { docs: [] }
      throw new Error(`unexpected find ${collection}`)
    }),
    findByID: vi.fn(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getActor as Mock).mockResolvedValue(attackerActor)
  ;(requireActor as Mock).mockResolvedValue(attackerActor)
  ;(check as Mock).mockResolvedValue({ allowed: true, reason: 'workspace owner', actor: attackerActor })
  ;(memberWorkspaceIds as Mock).mockResolvedValue(['ws-attacker'])
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

describe('scorecard authoring authorization boundary', () => {
  it('denies createScorecard when the policy denies management of the target workspace', async () => {
    const payload = { findByID: vi.fn(), create: vi.fn() }
    ;(getPayload as Mock).mockResolvedValue(payload)
    ;(check as Mock).mockResolvedValue({ allowed: false, reason: 'not a member', actor: attackerActor })

    await expect(
      createScorecard({ workspace: 'ws-foreign', name: 'Foreign scorecard' }),
    ).rejects.toThrow(/do not have permission/i)

    expect(check).toHaveBeenCalledWith('manage', { kind: 'workspace', id: 'ws-foreign' }, attackerActor)
    expect(payload.create).not.toHaveBeenCalled()
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

    // memberWorkspaceIds is driven by the session actor resolved from getActor(),
    // never by any argument the caller passes in.
    expect(memberWorkspaceIds).toHaveBeenCalledWith('member', attackerActor)
    expect(payload.find).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'scorecards',
        where: { workspace: { in: ['ws-attacker'] } },
      }),
    )
  })
})
