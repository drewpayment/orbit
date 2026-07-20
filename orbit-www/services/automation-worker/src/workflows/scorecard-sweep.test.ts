import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listEnabledScorecards: vi.fn(),
  evaluateScorecard: vi.fn(),
  captureWorkspaceSnapshots: vi.fn(),
}))

vi.mock('@temporalio/workflow', () => {
  let proxyIndex = 0
  const proxies = [
    { listEnabledScorecards: mocks.listEnabledScorecards },
    { evaluateScorecard: mocks.evaluateScorecard },
    { captureWorkspaceSnapshots: mocks.captureWorkspaceSnapshots },
  ]
  return {
    proxyActivities: vi.fn(() => proxies[proxyIndex++]),
    workflowInfo: vi.fn(() => ({ workflowId: 'scorecard-sweep', runId: 'run-123' })),
  }
})

import { ScorecardEvaluationSweepWorkflow } from './scorecard-sweep'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.evaluateScorecard.mockResolvedValue(undefined)
  mocks.captureWorkspaceSnapshots.mockResolvedValue(undefined)
})

describe('ScorecardEvaluationSweepWorkflow', () => {
  it('evaluates each workspace sequentially and uses a stable final capture key', async () => {
    mocks.listEnabledScorecards.mockResolvedValue([
      { id: 'a', workspaceId: 'ws1' },
      { id: 'b', workspaceId: 'ws1' },
      { id: 'c', workspaceId: 'ws2' },
    ])
    const events: string[] = []
    mocks.evaluateScorecard.mockImplementation(async ({ scorecardId }) => {
      events.push(`evaluate:${scorecardId}`)
    })
    mocks.captureWorkspaceSnapshots.mockImplementation(async ({ workspaceId, captureKey }) => {
      events.push(`capture:${workspaceId}:${captureKey}`)
    })

    await expect(ScorecardEvaluationSweepWorkflow()).resolves.toEqual({
      total: 3,
      succeeded: 3,
      failed: [],
    })

    expect(mocks.evaluateScorecard).toHaveBeenCalledWith({
      scorecardId: 'a',
      captureSnapshots: false,
    })
    expect(mocks.captureWorkspaceSnapshots).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      captureKey: 'scorecard-sweep:run-123',
    })
    expect(events.indexOf('evaluate:a')).toBeLessThan(events.indexOf('evaluate:b'))
    expect(events.indexOf('evaluate:b')).toBeLessThan(
      events.indexOf('capture:ws1:scorecard-sweep:run-123'),
    )
  })

  it('does not capture a workspace after one of its scorecards fails', async () => {
    mocks.listEnabledScorecards.mockResolvedValue([
      { id: 'a', workspaceId: 'ws1' },
      { id: 'b', workspaceId: 'ws1' },
    ])
    mocks.evaluateScorecard.mockImplementation(async ({ scorecardId }) => {
      if (scorecardId === 'b') throw new Error('evaluation failed')
    })

    await expect(ScorecardEvaluationSweepWorkflow()).resolves.toEqual({
      total: 2,
      succeeded: 1,
      failed: [{ scorecardId: 'b', error: 'evaluation failed' }],
    })
    expect(mocks.captureWorkspaceSnapshots).not.toHaveBeenCalled()
  })
})
