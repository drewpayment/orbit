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
vi.mock('@/lib/authz', () => ({
  getActor: vi.fn(),
  requireActor: vi.fn(),
  check: vi.fn(),
  memberWorkspaceIds: vi.fn(),
}))
vi.mock('@/lib/temporal/automation-schedules', () => ({
  ensureAutomationSchedule: vi.fn(),
  deleteAutomationSchedule: vi.fn(),
  getScheduleNextRun: vi.fn(),
}))

import { getPayload } from 'payload'
import { getActor, requireActor, check, memberWorkspaceIds } from '@/lib/authz'
import { ensureAutomationSchedule } from '@/lib/temporal/automation-schedules'
import {
  scheduleOpFor,
  createAutomation,
  updateAutomation,
  findUnmappedRequiredInputs,
  listAutomations,
  getAutomationForEdit,
  getAutomationDetail,
} from './actions'

const ownerActor = {
  payloadId: 'payload-u1',
  betterAuthId: 'u1',
  email: 'owner@example.com',
  role: 'user' as const,
  isPlatformAdmin: false,
  user: {} as never,
}

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
    findByID: vi.fn(
      async ({ collection }: { collection: string }): Promise<Record<string, unknown>> => {
        if (collection === 'actions') return { id: 'act1', workspace: 'ws1', enabled: true }
        throw new Error(`unexpected findByID ${collection}`)
      },
    ),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getActor as Mock).mockResolvedValue(ownerActor)
  ;(requireActor as Mock).mockResolvedValue(ownerActor)
  ;(check as Mock).mockResolvedValue({ allowed: true, reason: 'workspace owner', actor: ownerActor })
  ;(memberWorkspaceIds as Mock).mockResolvedValue(['ws1'])
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

// ---------------------------------------------------------------------------
// Schedule automations reject {{template}} action inputs (server guard)
//
// A schedule has no triggering event, so any {{template}} in its input mapping
// resolves to empty at dispatch and fails non-retryably forever. Reject it at
// authoring time on BOTH create and update; event-triggered automations keep
// allowing templates.
// ---------------------------------------------------------------------------

describe('schedule automations reject {{template}} action inputs', () => {
  it('createAutomation rejects a schedule mapping containing a {{…}} value (no create)', async () => {
    const payload = makePayload()
    ;(getPayload as Mock).mockResolvedValue(payload)

    await expect(
      createAutomation({
        workspace: 'ws1',
        name: 'weekly sweep',
        event: 'schedule',
        schedule: '*/5 * * * *',
        actionId: 'act1',
        inputMapping: { message: 'Drift in {{entity.slug}}' },
        enabled: true,
      }),
    ).rejects.toThrow(/can’t use \{\{variables\}\}/i)

    expect(payload.create).not.toHaveBeenCalled()
    expect(ensureAutomationSchedule).not.toHaveBeenCalled()
  })

  it('createAutomation allows a schedule with only literal mapping values', async () => {
    const payload = makePayload()
    ;(getPayload as Mock).mockResolvedValue(payload)
    ;(ensureAutomationSchedule as Mock).mockResolvedValue(undefined)

    const res = await createAutomation({
      workspace: 'ws1',
      name: 'weekly sweep',
      event: 'schedule',
      schedule: '*/5 * * * *',
      actionId: 'act1',
      inputMapping: { message: 'Weekly maintenance run' },
      enabled: true,
    })

    expect(res).toEqual({ id: 'new1' })
    expect(payload.create).toHaveBeenCalledTimes(1)
    expect(ensureAutomationSchedule).toHaveBeenCalledTimes(1)
  })

  it('updateAutomation rejects a schedule automation gaining a {{…}} mapping (no update)', async () => {
    const payload = makePayload()
    payload.findByID = vi.fn(async ({ collection }: { collection: string }) => {
      if (collection === 'automations') {
        return { id: 'auto1', workspace: 'ws1', trigger: { event: 'schedule' } }
      }
      if (collection === 'actions') return { id: 'act1', workspace: 'ws1', enabled: true }
      throw new Error(`unexpected findByID ${collection}`)
    })
    ;(getPayload as Mock).mockResolvedValue(payload)

    await expect(
      updateAutomation('auto1', {
        name: 'weekly sweep',
        event: 'schedule',
        schedule: '*/5 * * * *',
        actionId: 'act1',
        inputMapping: { message: '{{entity.slug}}' },
        enabled: true,
      }),
    ).rejects.toThrow(/can’t use \{\{variables\}\}/i)

    expect(payload.update).not.toHaveBeenCalled()
    expect(ensureAutomationSchedule).not.toHaveBeenCalled()
  })

  it('allows an event automation with a {{…}} mapping (guard is schedule-only)', async () => {
    const payload = makePayload()
    ;(getPayload as Mock).mockResolvedValue(payload)

    const res = await createAutomation({
      workspace: 'ws1',
      name: 'drift watcher',
      event: 'entity-changed',
      actionId: 'act1',
      inputMapping: { message: 'Drift in {{entity.slug}}' },
      enabled: true,
    })

    expect(res).toEqual({ id: 'new1' })
    expect(payload.create).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// Session-identity boundary (bugfix): these query actions used to accept an
// optional `userId` argument that overrode the session — since they are
// exported `'use server'` actions, callable from the client with arbitrary
// arguments, that let any caller list or load another user's workspace
// automations. They now always resolve the actor from the session.
// ---------------------------------------------------------------------------

describe('automation query actions ignore any injected identity', () => {
  it('listAutomations takes no identity argument and scopes to the session actor', async () => {
    const payload = { find: vi.fn(async () => ({ docs: [] })) }
    ;(getPayload as Mock).mockResolvedValue(payload)

    expect(listAutomations.length).toBe(0)
    await listAutomations()

    expect(memberWorkspaceIds).toHaveBeenCalledWith('member', ownerActor)
    expect(payload.find).toHaveBeenCalledWith(
      expect.objectContaining({ collection: 'automations', where: { workspace: { in: ['ws1'] } } }),
    )
  })

  it('getAutomationForEdit takes only an automationId and denies when the policy denies management', async () => {
    const payload = {
      findByID: vi.fn().mockResolvedValue({ id: 'auto1', workspace: 'ws1' }),
    }
    ;(getPayload as Mock).mockResolvedValue(payload)
    ;(check as Mock).mockResolvedValue({ allowed: false, reason: 'not a member', actor: ownerActor })

    expect(getAutomationForEdit.length).toBe(1)
    const result = await getAutomationForEdit('auto1')

    expect(result).toBeNull()
    expect(check).toHaveBeenCalledWith('manage', { kind: 'workspace', id: 'ws1' }, ownerActor)
  })

  it('getAutomationDetail takes only an automationId and denies a non-member read', async () => {
    const payload = {
      findByID: vi.fn().mockResolvedValue({ id: 'auto1', workspace: 'ws1' }),
    }
    ;(getPayload as Mock).mockResolvedValue(payload)
    ;(check as Mock).mockResolvedValue({ allowed: false, reason: 'not a member', actor: ownerActor })

    expect(getAutomationDetail.length).toBe(1)
    const result = await getAutomationDetail('auto1')

    expect(result).toBeNull()
    expect(check).toHaveBeenCalledWith('read', { kind: 'workspace', id: 'ws1' }, ownerActor)
  })
})
