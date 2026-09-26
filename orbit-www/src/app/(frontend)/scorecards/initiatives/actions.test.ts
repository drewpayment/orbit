import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('payload', () => ({ getPayload: vi.fn() }))
vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/authz', () => ({
  getActor: vi.fn(),
  requireActor: vi.fn(),
  check: vi.fn(),
  memberWorkspaceIds: vi.fn(),
  ALL_ROLES: ['owner', 'admin', 'member'],
}))
vi.mock('@/lib/scorecards/initiatives', () => ({
  syncInitiativeActionItems: vi.fn(),
  assertAssigneeInWorkspace: vi.fn(),
  computeInitiativeProgress: vi.fn(() => ({
    total: 0,
    open: 0,
    inProgress: 0,
    done: 0,
    waived: 0,
    pctComplete: 100,
  })),
  toActionItemLite: vi.fn((value) => value),
  userDisplayName: vi.fn(() => null),
}))

import { getPayload } from 'payload'
import { requireActor, check } from '@/lib/authz'
import { syncInitiativeActionItems } from '@/lib/scorecards/initiatives'
import { createInitiative, updateInitiativeStatus } from './actions'
import { Initiatives } from '@/collections/scorecards/Initiatives'
import { InitiativeActionItems } from '@/collections/scorecards/InitiativeActionItems'

const ownerActor = {
  payloadId: 'payload-owner',
  betterAuthId: 'ba-owner',
  email: 'owner@example.com',
  role: 'user' as const,
  isPlatformAdmin: false,
  user: {} as never,
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(requireActor as Mock).mockResolvedValue(ownerActor)
  ;(check as Mock).mockResolvedValue({ allowed: true, reason: 'workspace owner', actor: ownerActor })
  ;(syncInitiativeActionItems as Mock).mockResolvedValue({ created: 0, completed: 0, reopened: 0 })
})

describe('createInitiative user identity bridging', () => {
  it('stores the Payload user id in the owner relationship', async () => {
    const payload = {
      findByID: vi.fn(async () => ({
        id: 'sc-1',
        workspace: 'ws-1',
        levels: [{ name: 'Silver', rank: 2 }],
      })),
      create: vi.fn(async () => ({ id: 'initiative-1' })),
    }
    ;(getPayload as Mock).mockResolvedValue(payload)

    await createInitiative({
      name: 'Reach Silver',
      scorecardId: 'sc-1',
      targetLevel: 'Silver',
    })

    expect(check).toHaveBeenCalledWith('manage', { kind: 'workspace', id: 'ws-1' }, ownerActor)
    expect(payload.create).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'initiatives',
        data: expect.objectContaining({ owner: 'payload-owner' }),
      }),
    )
  })
})

describe('initiative lifecycle authorization boundary', () => {
  it('denies updateInitiativeStatus when the policy denies management of the workspace', async () => {
    const payload = {
      findByID: vi.fn().mockResolvedValue({ id: 'ini-1', workspace: 'ws-1' }),
      update: vi.fn(),
    }
    ;(getPayload as Mock).mockResolvedValue(payload)
    ;(check as Mock).mockResolvedValue({ allowed: false, reason: 'not a member', actor: ownerActor })

    await expect(updateInitiativeStatus('ini-1', 'completed')).rejects.toThrow(
      /do not have permission/i,
    )
    expect(payload.update).not.toHaveBeenCalled()
  })
})

describe('direct Payload collection policy', () => {
  it('requires manager access for initiative create and update', () => {
    expect(Initiatives.access?.create).not.toBeUndefined()
    expect(Initiatives.access?.update).not.toBeUndefined()
    expect(Initiatives.access?.create).not.toBe(InitiativeActionItems.access?.create)
  })

  it('forbids direct action-item creation because generated items use overrideAccess', async () => {
    const create = InitiativeActionItems.access?.create
    expect(typeof create).toBe('function')
    expect(
      await (create as (args: unknown) => boolean | Promise<boolean>)({
        req: { user: { id: 'member' } },
        data: { workspace: 'ws-1' },
      }),
    ).toBe(false)
  })

  it.each([
    [Initiatives, 'workspace'],
    [Initiatives, 'scorecard'],
    [InitiativeActionItems, 'workspace'],
    [InitiativeActionItems, 'initiative'],
    [InitiativeActionItems, 'entity'],
    [InitiativeActionItems, 'rule'],
  ])('makes %s.%s immutable through field access', (collection, fieldName) => {
    const field = collection.fields.find(
      (candidate) => 'name' in candidate && candidate.name === fieldName,
    )
    expect(field && 'access' in field ? field.access?.update : undefined).toBeTypeOf('function')
  })
})
