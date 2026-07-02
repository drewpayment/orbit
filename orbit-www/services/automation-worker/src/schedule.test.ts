import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Sweep-schedule ensure tests. A fake Temporal client (passed directly to the
 * ensure fn) lets us assert the spec/action/state mapping and the fail-closed
 * converge/propagate behavior without a real Temporal. `@temporalio/client` is
 * mocked so the helper's `ScheduleAlreadyRunning instanceof` check switches on
 * the same class the tests throw.
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
}))

import { ScheduleAlreadyRunning } from '@temporalio/client'
import { ensureScorecardSweepSchedule } from './schedule'

function makeClient() {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const create = vi.fn(async (..._args: any[]): Promise<any> => undefined)
  const update = vi.fn(async (..._args: any[]): Promise<any> => undefined)
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const getHandle = vi.fn(() => ({ update }))
  const client = { schedule: { create, getHandle } }
  return { client, create, update, getHandle }
}

const ENV_KEYS = ['SCORECARD_EVAL_CRON', 'SCORECARD_EVAL_DISABLED', 'AUTOMATION_SCHEDULE_TZ'] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  vi.restoreAllMocks()
})

describe('ensureScorecardSweepSchedule', () => {
  it('creates the global schedule with default cron/tz and state.paused=false', async () => {
    const { client, create } = makeClient()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ensureScorecardSweepSchedule(client as any)

    expect(create).toHaveBeenCalledTimes(1)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const opts = create.mock.calls[0][0] as Record<string, any>
    expect(opts.scheduleId).toBe('scorecard-evaluation:global')
    expect(opts.spec.cronExpressions).toEqual(['0 5 * * *'])
    expect(opts.spec.timezone).toBe('UTC')
    expect(opts.action.type).toBe('startWorkflow')
    expect(opts.action.workflowType).toBe('ScorecardEvaluationSweepWorkflow')
    expect(opts.action.taskQueue).toBe('orbit-automations')
    expect(opts.action.args ?? []).toEqual([])
    expect(opts.state.paused).toBe(false)
  })

  it('honors SCORECARD_EVAL_CRON and AUTOMATION_SCHEDULE_TZ overrides', async () => {
    process.env.SCORECARD_EVAL_CRON = '0 */6 * * *'
    process.env.AUTOMATION_SCHEDULE_TZ = 'America/New_York'
    const { client, create } = makeClient()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ensureScorecardSweepSchedule(client as any)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const opts = create.mock.calls[0][0] as Record<string, any>
    expect(opts.spec.cronExpressions).toEqual(['0 */6 * * *'])
    expect(opts.spec.timezone).toBe('America/New_York')
  })

  it('creates paused when SCORECARD_EVAL_DISABLED=1', async () => {
    process.env.SCORECARD_EVAL_DISABLED = '1'
    const { client, create } = makeClient()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ensureScorecardSweepSchedule(client as any)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((create.mock.calls[0][0] as any).state.paused).toBe(true)
  })

  it('creates paused when SCORECARD_EVAL_DISABLED=true', async () => {
    process.env.SCORECARD_EVAL_DISABLED = 'true'
    const { client, create } = makeClient()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ensureScorecardSweepSchedule(client as any)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((create.mock.calls[0][0] as any).state.paused).toBe(true)
  })

  it('converges on ScheduleAlreadyRunning, merging spec/action/paused over prev', async () => {
    process.env.SCORECARD_EVAL_DISABLED = '1'
    const { client, create, getHandle, update } = makeClient()
    create.mockRejectedValueOnce(new ScheduleAlreadyRunning('exists', 'scorecard-evaluation:global'))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ensureScorecardSweepSchedule(client as any)

    expect(getHandle).toHaveBeenCalledWith('scorecard-evaluation:global')
    expect(update).toHaveBeenCalledTimes(1)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateFn = update.mock.calls[0][0] as (prev: any) => any
    const next = updateFn({
      spec: { cronExpressions: ['stale'], timezone: 'UTC' },
      action: { workflowType: 'Stale' },
      state: { paused: false, note: 'keep me' },
      policies: {},
    })
    expect(next.spec.cronExpressions).toEqual(['0 5 * * *'])
    expect(next.action.workflowType).toBe('ScorecardEvaluationSweepWorkflow')
    expect(next.state.paused).toBe(true)
    expect(next.state.note).toBe('keep me')
  })

  it('propagates a non-already-exists create failure (fail-closed)', async () => {
    const { client, create } = makeClient()
    create.mockRejectedValueOnce(new Error('connection refused'))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(ensureScorecardSweepSchedule(client as any)).rejects.toThrow('connection refused')
  })
})
