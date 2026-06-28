import { describe, it, expect, vi, beforeEach } from 'vitest'

// createAndDispatchRun is the shared P3 helper; stub it so this test stays
// focused on the dispatcher's single-automation schedule short-circuit and never
// touches the real run executor. vi.hoisted keeps the stub available to the
// hoisted vi.mock factory (the repo's hoisting gotcha).
const { createAndDispatchRun } = vi.hoisted(() => ({
  createAndDispatchRun: vi.fn(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (_payload: any, _input: any) => ({ runId: 'run1', status: 'succeeded' }),
  ),
}))
vi.mock('@/lib/actions/create-run', () => ({ createAndDispatchRun }))

import { dispatchAutomationEvent } from './dispatch'
import type { ScheduleEvent } from './events'
import { InputValidationError } from '@/lib/actions/input-schema'

const scheduleEvent: ScheduleEvent = {
  type: 'schedule',
  workspace: 'ws1',
  automationId: 'a1',
}

/**
 * Build a fake Payload for the schedule path. `findByID` serves the automation
 * (by id) and the action; `find` is present but must NOT be called on the
 * schedule short-circuit (we assert that).
 */
function makePayload(
  automation: unknown,
  action: unknown = { id: 'act1', enabled: true, workspace: 'ws1' },
) {
  const updates: { collection: string; id: string; data: unknown }[] = []
  return {
    updates,
    find: vi.fn(async () => ({ docs: [] })),
    findByID: vi.fn(async ({ collection, id }: { collection: string; id: string }) => {
      if (collection === 'automations') {
        if (automation == null) throw new Error('not found')
        return automation
      }
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
  createAndDispatchRun.mockReset()
  createAndDispatchRun.mockResolvedValue({ runId: 'run1', status: 'succeeded' })
})

describe('dispatchAutomationEvent — schedule (single-automation)', () => {
  it('dispatches exactly the targeted automation, stamps lastTriggeredAt, no fan-out', async () => {
    const payload = makePayload({
      id: 'a1',
      name: 'weekly-sweep',
      enabled: true,
      action: 'act1',
      workspace: 'ws1',
      trigger: { event: 'schedule' },
      inputMapping: { name: 'weekly-sweep', who: 'entity={{entity.slug}}' },
    })

    const result = await dispatchAutomationEvent(payload, scheduleEvent)

    expect(result).toEqual({ matched: 1, dispatched: 1 })
    // No fan-out query on the schedule path.
    expect(payload.find).not.toHaveBeenCalled()
    expect(createAndDispatchRun).toHaveBeenCalledTimes(1)
    const arg = createAndDispatchRun.mock.calls[0][1]
    expect(arg).toMatchObject({
      trigger: 'automation',
      triggeredBy: null,
      sourceAutomationId: 'a1',
      origin: 'weekly-sweep',
      // schedule has no entity/rule context: a mixed-text {{entity.*}} renders
      // empty, and the literal passes through unchanged.
      inputs: { name: 'weekly-sweep', who: 'entity=' },
    })
    expect(arg.entityId).toBeUndefined()
    expect(payload.updates).toContainEqual(
      expect.objectContaining({ collection: 'automations', id: 'a1' }),
    )
  })

  it('does not dispatch a disabled automation', async () => {
    const payload = makePayload({
      id: 'a1',
      name: 'paused',
      enabled: false,
      action: 'act1',
      workspace: 'ws1',
      trigger: { event: 'schedule' },
    })
    const result = await dispatchAutomationEvent(payload, scheduleEvent)
    expect(result.dispatched).toBe(0)
    expect(createAndDispatchRun).not.toHaveBeenCalled()
  })

  it('does not dispatch when the automation belongs to a different workspace', async () => {
    const payload = makePayload({
      id: 'a1',
      name: 'other-ws',
      enabled: true,
      action: 'act1',
      workspace: 'ws-other',
      trigger: { event: 'schedule' },
    })
    const result = await dispatchAutomationEvent(payload, scheduleEvent)
    expect(result.dispatched).toBe(0)
    expect(createAndDispatchRun).not.toHaveBeenCalled()
  })

  it('does not dispatch when the automation is not a schedule automation', async () => {
    const payload = makePayload({
      id: 'a1',
      name: 'event-driven',
      enabled: true,
      action: 'act1',
      workspace: 'ws1',
      trigger: { event: 'rule-result-changed' },
    })
    const result = await dispatchAutomationEvent(payload, scheduleEvent)
    expect(result.dispatched).toBe(0)
    expect(createAndDispatchRun).not.toHaveBeenCalled()
  })

  it('returns {matched:0,dispatched:0} when the automation is not found', async () => {
    const payload = makePayload(null)
    const result = await dispatchAutomationEvent(payload, scheduleEvent)
    expect(result).toEqual({ matched: 0, dispatched: 0 })
    expect(createAndDispatchRun).not.toHaveBeenCalled()
  })

  it('skips a schedule automation whose action is disabled', async () => {
    const payload = makePayload(
      {
        id: 'a1',
        name: 'weekly-sweep',
        enabled: true,
        action: 'act1',
        workspace: 'ws1',
        trigger: { event: 'schedule' },
      },
      { id: 'act1', enabled: false, workspace: 'ws1' },
    )
    const result = await dispatchAutomationEvent(payload, scheduleEvent)
    expect(result.dispatched).toBe(0)
    expect(createAndDispatchRun).not.toHaveBeenCalled()
  })

  it('propagates a transient dispatch error (so the route 500s and Temporal retries)', async () => {
    createAndDispatchRun.mockRejectedValueOnce(new Error('transient boom'))
    const payload = makePayload({
      id: 'a1',
      name: 'weekly-sweep',
      enabled: true,
      action: 'act1',
      workspace: 'ws1',
      trigger: { event: 'schedule' },
    })
    await expect(dispatchAutomationEvent(payload, scheduleEvent)).rejects.toThrow('transient boom')
  })

  it('propagates a terminal InputValidationError so the route can return 422', async () => {
    // Invalid/missing required inputs are terminal: the same inputs can never
    // validate on retry. The schedule branch lets createAndDispatchRun errors
    // propagate, so the typed error must reach the caller (the internal route)
    // intact — carrying its INPUT_VALIDATION discriminator — for the 422 map.
    createAndDispatchRun.mockRejectedValueOnce(new InputValidationError('"Target" is required.'))
    const payload = makePayload({
      id: 'a1',
      name: 'weekly-sweep',
      enabled: true,
      action: 'act1',
      workspace: 'ws1',
      trigger: { event: 'schedule' },
    })

    const err = await dispatchAutomationEvent(payload, scheduleEvent).catch((e) => e)
    expect(err).toBeInstanceOf(InputValidationError)
    expect((err as InputValidationError).code).toBe('INPUT_VALIDATION')
    expect((err as Error).message).toBe('"Target" is required.')
  })

  it('non-schedule events still use the fan-out query path', async () => {
    const payload = makePayload({
      id: 'a1',
      name: 'x',
      enabled: true,
      action: 'act1',
      workspace: 'ws1',
      trigger: { event: 'entity-changed' },
    })
    await dispatchAutomationEvent(payload, {
      type: 'entity-changed',
      workspace: 'ws1',
      entity: { id: 'e1' },
      operation: 'update',
    })
    // Fan-out path queries automations via find.
    expect(payload.find).toHaveBeenCalled()
  })
})
