import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'

/**
 * Authoring-wiring tests (P4.2): the pure `scheduleOpFor` decision table and the
 * fail-closed create path (Schedule failure rolls back the record; event
 * automations never touch Temporal). Temporal + Payload + auth are mocked so
 * these stay unit tests.
 */

vi.mock('payload', () => ({ getPayload: vi.fn() }))
vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth/session', () => ({ getCurrentUser: vi.fn() }))
vi.mock('@/lib/automations/authz', () => ({ canManageAutomations: vi.fn() }))
vi.mock('@/lib/temporal/automation-schedules', () => ({
  ensureAutomationSchedule: vi.fn(),
  deleteAutomationSchedule: vi.fn(),
  getScheduleNextRun: vi.fn(),
}))

import { getPayload } from 'payload'
import { getCurrentUser } from '@/lib/auth/session'
import { canManageAutomations } from '@/lib/automations/authz'
import { ensureAutomationSchedule } from '@/lib/temporal/automation-schedules'
import { scheduleOpFor, createAutomation, findUnmappedRequiredInputs } from './actions'

// ---------------------------------------------------------------------------
// findUnmappedRequiredInputs — authoring-time required-input guard (pure)
// ---------------------------------------------------------------------------

describe('findUnmappedRequiredInputs', () => {
  const schema = {
    fields: [
      { name: 'message', label: 'Message', type: 'text', required: true },
      { name: 'channel', label: 'Channel', type: 'text' }, // optional
    ],
  }

  it('reports a required field with no mapping (by label)', async () => {
    expect(await findUnmappedRequiredInputs(schema, null)).toEqual(['Message'])
    expect(await findUnmappedRequiredInputs(schema, {})).toEqual(['Message'])
    expect(await findUnmappedRequiredInputs(schema, undefined)).toEqual(['Message'])
  })

  it('treats a whitespace-only mapping as unmapped', async () => {
    expect(await findUnmappedRequiredInputs(schema, { message: '   ' })).toEqual(['Message'])
  })

  it('accepts a mapped required field', async () => {
    expect(await findUnmappedRequiredInputs(schema, { message: 'hi' })).toEqual([])
    expect(await findUnmappedRequiredInputs(schema, { message: '{{rule.title}}' })).toEqual([])
  })

  it('never reports non-required fields', async () => {
    expect(await findUnmappedRequiredInputs(schema, { message: 'hi' })).toEqual([])
    // `channel` absent but optional → still fine
  })

  it('returns [] when the action has no input schema', async () => {
    expect(await findUnmappedRequiredInputs(undefined, null)).toEqual([])
    expect(await findUnmappedRequiredInputs({ fields: [] }, null)).toEqual([])
  })

  it('falls back to the field name when no label is present', async () => {
    const noLabel = { fields: [{ name: 'message', type: 'text', required: true }] }
    expect(await findUnmappedRequiredInputs(noLabel, null)).toEqual(['message'])
  })
})

// ---------------------------------------------------------------------------
// scheduleOpFor decision table (pure, no Temporal)
// ---------------------------------------------------------------------------

describe('scheduleOpFor', () => {
  const PREV = ['schedule', 'entity-changed', 'rule-result-changed', null] as const
  const NEXT = ['schedule', 'entity-changed', 'rule-result-changed'] as const

  for (const prev of PREV) {
    for (const next of NEXT) {
      const expected = next === 'schedule' ? 'ensure' : prev === 'schedule' ? 'delete' : 'none'
      it(`prev=${prev ?? 'null'} → next=${next} ⇒ ${expected}`, async () => {
        expect(await scheduleOpFor(prev, next)).toBe(expected)
      })
    }
  }

  it('treats undefined prev like null', async () => {
    expect(await scheduleOpFor(undefined, 'schedule')).toBe('ensure')
    expect(await scheduleOpFor(undefined, 'entity-changed')).toBe('none')
  })
})

// ---------------------------------------------------------------------------
// createAutomation — fail-closed wiring
// ---------------------------------------------------------------------------

function makePayload() {
  return {
    create: vi.fn(async () => ({ id: 'new1' })),
    delete: vi.fn(async () => ({})),
    update: vi.fn(async () => ({ id: 'new1' })),
    find: vi.fn(async () => ({ docs: [] })),
    findByID: vi.fn(async ({ collection }: { collection: string }) => {
      if (collection === 'actions') return { id: 'act1', workspace: 'ws1', enabled: true }
      throw new Error(`unexpected findByID ${collection}`)
    }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getCurrentUser as Mock).mockResolvedValue({ id: 'u1' })
  ;(canManageAutomations as Mock).mockResolvedValue(true)
})

describe('createAutomation — schedule path (fail-closed)', () => {
  it('rolls back the created record and throws when the Schedule fails', async () => {
    const payload = makePayload()
    ;(getPayload as Mock).mockResolvedValue(payload)
    ;(ensureAutomationSchedule as Mock).mockRejectedValue(new Error('temporal down'))

    await expect(
      createAutomation({
        workspace: 'ws1',
        name: 'weekly sweep',
        event: 'schedule',
        schedule: '*/5 * * * *',
        actionId: 'act1',
        enabled: true,
      }),
    ).rejects.toThrow(/scheduling service is unavailable/i)

    expect(payload.create).toHaveBeenCalledTimes(1)
    expect(ensureAutomationSchedule).toHaveBeenCalledWith({
      id: 'new1',
      workspaceId: 'ws1',
      cron: '*/5 * * * *',
      enabled: true,
    })
    expect(payload.delete).toHaveBeenCalledWith(
      expect.objectContaining({ collection: 'automations', id: 'new1' }),
    )
  })

  it('persists and ensures the Schedule on the happy path (no rollback)', async () => {
    const payload = makePayload()
    ;(getPayload as Mock).mockResolvedValue(payload)
    ;(ensureAutomationSchedule as Mock).mockResolvedValue(undefined)

    const res = await createAutomation({
      workspace: 'ws1',
      name: 'weekly sweep',
      event: 'schedule',
      schedule: '*/5 * * * *',
      actionId: 'act1',
      enabled: true,
    })

    expect(res).toEqual({ id: 'new1' })
    expect(ensureAutomationSchedule).toHaveBeenCalledTimes(1)
    expect(payload.delete).not.toHaveBeenCalled()
  })

  it('rejects a schedule automation with no cron before inserting any record', async () => {
    const payload = makePayload()
    ;(getPayload as Mock).mockResolvedValue(payload)

    await expect(
      createAutomation({
        workspace: 'ws1',
        name: 'no cron',
        event: 'schedule',
        schedule: '   ',
        actionId: 'act1',
        enabled: true,
      }),
    ).rejects.toThrow(/cron schedule is required/i)

    expect(payload.create).not.toHaveBeenCalled()
    expect(ensureAutomationSchedule).not.toHaveBeenCalled()
  })
})

describe('createAutomation — required-input validation', () => {
  const actionWithRequiredInput = {
    id: 'act1',
    workspace: 'ws1',
    enabled: true,
    inputSchema: { fields: [{ name: 'message', label: 'Message', type: 'text', required: true }] },
  }

  it('rejects (without creating) when a required action input is unmapped', async () => {
    const payload = makePayload()
    payload.findByID = vi.fn(async ({ collection }: { collection: string }) => {
      if (collection === 'actions') return actionWithRequiredInput
      throw new Error(`unexpected findByID ${collection}`)
    })
    ;(getPayload as Mock).mockResolvedValue(payload)

    await expect(
      createAutomation({
        workspace: 'ws1',
        name: 'notify on drift',
        event: 'entity-changed',
        actionId: 'act1',
        enabled: true,
      }),
    ).rejects.toThrow(/Map a value for every required input/i)

    expect(payload.create).not.toHaveBeenCalled()
    expect(ensureAutomationSchedule).not.toHaveBeenCalled()
  })

  it('proceeds once the required input is mapped', async () => {
    const payload = makePayload()
    payload.findByID = vi.fn(async ({ collection }: { collection: string }) => {
      if (collection === 'actions') return actionWithRequiredInput
      throw new Error(`unexpected findByID ${collection}`)
    })
    ;(getPayload as Mock).mockResolvedValue(payload)

    const res = await createAutomation({
      workspace: 'ws1',
      name: 'notify on drift',
      event: 'entity-changed',
      actionId: 'act1',
      inputMapping: { message: '{{rule.title}} drifted' },
      enabled: true,
    })

    expect(res).toEqual({ id: 'new1' })
    expect(payload.create).toHaveBeenCalledTimes(1)
  })
})

describe('createAutomation — event path never touches Temporal', () => {
  it('saves an event automation even when Temporal would be down', async () => {
    const payload = makePayload()
    ;(getPayload as Mock).mockResolvedValue(payload)
    ;(ensureAutomationSchedule as Mock).mockRejectedValue(new Error('temporal down'))

    const res = await createAutomation({
      workspace: 'ws1',
      name: 'drift watcher',
      event: 'entity-changed',
      actionId: 'act1',
      enabled: true,
    })

    expect(res).toEqual({ id: 'new1' })
    expect(ensureAutomationSchedule).not.toHaveBeenCalled()
    expect(payload.delete).not.toHaveBeenCalled()
  })
})
