import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Lifecycle-helper unit tests (P4.2). A fake Temporal client (`getTemporalClient`
 * mocked) lets us assert the spec/action/state mapping and the fail-closed
 * error propagation without a real Temporal. The error classes are provided by
 * the `@temporalio/client` mock so the helper's `instanceof` checks switch on the
 * same classes the tests throw.
 */

vi.mock('@temporalio/client', () => ({
  ScheduleAlreadyRunning: class ScheduleAlreadyRunning extends Error {
    readonly scheduleId: string
    constructor(message: string, scheduleId: string) {
      super(message)
      this.name = 'ScheduleAlreadyRunning'
      this.scheduleId = scheduleId
    }
  },
  ScheduleNotFoundError: class ScheduleNotFoundError extends Error {
    readonly scheduleId: string
    constructor(message: string, scheduleId: string) {
      super(message)
      this.name = 'ScheduleNotFoundError'
      this.scheduleId = scheduleId
    }
  },
}))

const { getTemporalClient } = vi.hoisted(() => ({ getTemporalClient: vi.fn() }))
vi.mock('@/lib/temporal/client', () => ({ getTemporalClient }))

import { ScheduleAlreadyRunning, ScheduleNotFoundError } from '@temporalio/client'
import {
  ensureAutomationSchedule,
  deleteAutomationSchedule,
  getScheduleNextRun,
} from './automation-schedules'

function makeClient() {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const create = vi.fn(async (..._args: any[]): Promise<any> => undefined)
  const update = vi.fn(async (..._args: any[]): Promise<any> => undefined)
  const del = vi.fn(async (..._args: any[]): Promise<any> => undefined)
  const describe = vi.fn(
    async (..._args: any[]): Promise<any> => ({ info: { nextActionTimes: [] as Date[] } }),
  )
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const getHandle = vi.fn(() => ({ update, delete: del, describe }))
  const client = { schedule: { create, getHandle } }
  return { client, create, update, del, describe, getHandle }
}

beforeEach(() => {
  getTemporalClient.mockReset()
})

describe('ensureAutomationSchedule', () => {
  it('creates the schedule with the mapped spec/action and state.paused=false when enabled', async () => {
    const { client, create } = makeClient()
    getTemporalClient.mockResolvedValue(client)

    await ensureAutomationSchedule({ id: 'a1', workspaceId: 'ws1', cron: '*/5 * * * *', enabled: true })

    expect(create).toHaveBeenCalledTimes(1)
    const opts = create.mock.calls[0][0] as Record<string, any>
    expect(opts.scheduleId).toBe('automation:a1')
    expect(opts.spec.cronExpressions).toEqual(['*/5 * * * *'])
    expect(opts.spec.timezone).toBe('UTC')
    expect(opts.action.type).toBe('startWorkflow')
    expect(opts.action.workflowType).toBe('AutomationDispatchWorkflow')
    expect(opts.action.taskQueue).toBe('orbit-automations')
    expect(opts.action.args).toEqual([{ automationId: 'a1', workspaceId: 'ws1' }])
    expect(opts.state.paused).toBe(false)
  })

  it('creates paused when the automation is disabled', async () => {
    const { client, create } = makeClient()
    getTemporalClient.mockResolvedValue(client)

    await ensureAutomationSchedule({ id: 'a1', workspaceId: 'ws1', cron: '0 * * * *', enabled: false })

    expect((create.mock.calls[0][0] as { state: { paused: boolean } }).state.paused).toBe(true)
  })

  it('falls back to update when the schedule already exists, converging spec/action/paused', async () => {
    const { client, create, getHandle, update } = makeClient()
    create.mockRejectedValueOnce(new ScheduleAlreadyRunning('exists', 'automation:a1'))
    getTemporalClient.mockResolvedValue(client)

    await ensureAutomationSchedule({ id: 'a1', workspaceId: 'ws1', cron: '0 0 * * *', enabled: false })

    expect(getHandle).toHaveBeenCalledWith('automation:a1')
    expect(update).toHaveBeenCalledTimes(1)

    // The updateFn must merge our new spec/action over the previous description
    // and preserve unrelated prev state (e.g. note) while forcing paused.
    const updateFn = update.mock.calls[0][0] as (prev: any) => any
    const next = updateFn({
      spec: { cronExpressions: ['stale'], timezone: 'UTC' },
      action: { workflowType: 'Stale' },
      state: { paused: false, note: 'keep me' },
      policies: {},
    })
    expect(next.spec.cronExpressions).toEqual(['0 0 * * *'])
    expect(next.action.workflowType).toBe('AutomationDispatchWorkflow')
    expect(next.action.args).toEqual([{ automationId: 'a1', workspaceId: 'ws1' }])
    expect(next.state.paused).toBe(true)
    expect(next.state.note).toBe('keep me')
  })

  it('propagates a non-already-exists create failure (fail-closed)', async () => {
    const { client, create } = makeClient()
    create.mockRejectedValueOnce(new Error('connection refused'))
    getTemporalClient.mockResolvedValue(client)

    await expect(
      ensureAutomationSchedule({ id: 'a1', workspaceId: 'ws1', cron: '* * * * *', enabled: true }),
    ).rejects.toThrow('connection refused')
  })
})

describe('deleteAutomationSchedule', () => {
  it('treats NOT-FOUND as success', async () => {
    const { client, del } = makeClient()
    del.mockRejectedValueOnce(new ScheduleNotFoundError('gone', 'automation:a1'))
    getTemporalClient.mockResolvedValue(client)

    await expect(deleteAutomationSchedule('a1')).resolves.toBeUndefined()
  })

  it('propagates other delete failures', async () => {
    const { client, del } = makeClient()
    del.mockRejectedValueOnce(new Error('boom'))
    getTemporalClient.mockResolvedValue(client)

    await expect(deleteAutomationSchedule('a1')).rejects.toThrow('boom')
  })
})

describe('getScheduleNextRun', () => {
  it('returns the first upcoming action time as an ISO string', async () => {
    const when = new Date('2026-07-01T00:00:00.000Z')
    const { client, describe } = makeClient()
    describe.mockResolvedValueOnce({ info: { nextActionTimes: [when] } })
    getTemporalClient.mockResolvedValue(client)

    await expect(getScheduleNextRun('a1')).resolves.toBe('2026-07-01T00:00:00.000Z')
  })

  it('returns null when there are no upcoming action times', async () => {
    const { client, describe } = makeClient()
    describe.mockResolvedValueOnce({ info: { nextActionTimes: [] } })
    getTemporalClient.mockResolvedValue(client)

    await expect(getScheduleNextRun('a1')).resolves.toBeNull()
  })
})
