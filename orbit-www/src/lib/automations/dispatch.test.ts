import { describe, it, expect, vi, beforeEach } from 'vitest'

// createAndDispatchRun is the shared P3 helper; we stub it so this test stays
// focused on the dispatcher's match → resolve → run → stamp orchestration and
// never touches the real run executor. vi.hoisted keeps the stub available to
// the hoisted vi.mock factory.
const { createAndDispatchRun } = vi.hoisted(() => ({
  createAndDispatchRun: vi.fn(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (_payload: any, _input: any) => ({ runId: 'run1', status: 'succeeded' }),
  ),
}))
vi.mock('@/lib/actions/create-run', () => ({ createAndDispatchRun }))

import { dispatchAutomationEvent } from './dispatch'
import type { RuleResultChangedEvent } from './events'

const driftEvent: RuleResultChangedEvent = {
  type: 'rule-result-changed',
  workspace: 'ws1',
  entity: { id: 'e1', slug: 'billing', name: 'Billing', kind: 'service', lifecycle: 'production' },
  scorecard: { id: 'sc1', name: 'Prod readiness' },
  rule: { id: 'r1', title: 'Has owner' },
  passed: false,
  previousPassed: true,
  transition: 'drift',
  detail: '`owner` is not set.',
}

/** Build a fake Payload that returns the given automations + a loadable action. */
function makePayload(automations: unknown[], action: unknown = { id: 'act1', enabled: true, workspace: 'ws1' }) {
  const updates: { collection: string; id: string; data: unknown }[] = []
  return {
    updates,
    find: vi.fn(async ({ collection }: { collection: string }) => {
      if (collection === 'automations') return { docs: automations }
      return { docs: [] }
    }),
    findByID: vi.fn(async ({ collection, id }: { collection: string; id: string }) => {
      if (collection === 'actions') return action
      throw new Error(`unexpected findByID ${collection}/${id}`)
    }),
    update: vi.fn(async (args: { collection: string; id: string; data: unknown }) => {
      updates.push(args)
      return { id: args.id }
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

beforeEach(() => {
  createAndDispatchRun.mockClear()
})

describe('dispatchAutomationEvent', () => {
  it('dispatches a matching, enabled, filtered automation and stamps lastTriggeredAt', async () => {
    const payload = makePayload([
      {
        id: 'a1',
        name: 'Open remediation on drift',
        enabled: true,
        action: 'act1',
        trigger: { event: 'rule-result-changed', filter: { transition: 'drift' } },
        inputMapping: { entity: '{{entity.id}}', message: 'Rule {{rule.title}} failing' },
      },
    ])

    const result = await dispatchAutomationEvent(payload, driftEvent)

    expect(result).toEqual({ matched: 1, dispatched: 1 })
    expect(createAndDispatchRun).toHaveBeenCalledTimes(1)
    const arg = createAndDispatchRun.mock.calls[0][1]
    expect(arg).toMatchObject({
      trigger: 'automation',
      triggeredBy: null,
      entityId: 'e1',
      origin: 'Open remediation on drift',
      inputs: { entity: 'e1', message: 'Rule Has owner failing' },
    })
    // lastTriggeredAt stamped on the automation.
    expect(payload.updates).toContainEqual(
      expect.objectContaining({ collection: 'automations', id: 'a1' }),
    )
  })

  it('does not dispatch when the filter excludes the event', async () => {
    const payload = makePayload([
      {
        id: 'a1',
        name: 'recovery only',
        enabled: true,
        action: 'act1',
        trigger: { event: 'rule-result-changed', filter: { transition: 'recovery' } },
      },
    ])
    const result = await dispatchAutomationEvent(payload, driftEvent)
    expect(result).toEqual({ matched: 0, dispatched: 0 })
    expect(createAndDispatchRun).not.toHaveBeenCalled()
  })

  it('skips a matched automation whose action is disabled', async () => {
    const payload = makePayload(
      [
        {
          id: 'a1',
          name: 'x',
          enabled: true,
          action: 'act1',
          trigger: { event: 'rule-result-changed' },
        },
      ],
      { id: 'act1', enabled: false, workspace: 'ws1' },
    )
    const result = await dispatchAutomationEvent(payload, driftEvent)
    expect(result).toEqual({ matched: 1, dispatched: 0 })
    expect(createAndDispatchRun).not.toHaveBeenCalled()
  })

  it('isolates a failing dispatch so others still run', async () => {
    createAndDispatchRun
      .mockRejectedValueOnce(new Error('bad inputs'))
      .mockResolvedValueOnce({ runId: 'run2', status: 'succeeded' })
    const payload = makePayload([
      { id: 'a1', name: 'one', enabled: true, action: 'act1', trigger: { event: 'rule-result-changed' } },
      { id: 'a2', name: 'two', enabled: true, action: 'act1', trigger: { event: 'rule-result-changed' } },
    ])
    const result = await dispatchAutomationEvent(payload, driftEvent)
    expect(result).toEqual({ matched: 2, dispatched: 1 })
    expect(createAndDispatchRun).toHaveBeenCalledTimes(2)
  })
})
