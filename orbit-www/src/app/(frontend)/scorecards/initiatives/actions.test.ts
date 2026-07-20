import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('payload', () => ({ getPayload: vi.fn() }))
vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth/session', () => ({
  getCurrentUser: vi.fn(),
  getPayloadUserFromSession: vi.fn(),
}))
vi.mock('@/lib/scorecards/authz', () => ({ canManageScorecards: vi.fn() }))
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
import { getCurrentUser, getPayloadUserFromSession } from '@/lib/auth/session'
import { canManageScorecards } from '@/lib/scorecards/authz'
import { syncInitiativeActionItems } from '@/lib/scorecards/initiatives'
import { createInitiative } from './actions'
import { Initiatives } from '@/collections/scorecards/Initiatives'
import { InitiativeActionItems } from '@/collections/scorecards/InitiativeActionItems'

beforeEach(() => {
  vi.clearAllMocks()
  ;(getCurrentUser as Mock).mockResolvedValue({ id: 'ba-owner' })
  ;(getPayloadUserFromSession as Mock).mockResolvedValue({
    id: 'payload-owner',
    betterAuthId: 'ba-owner',
  })
  ;(canManageScorecards as Mock).mockResolvedValue(true)
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

    expect(canManageScorecards).toHaveBeenCalledWith(payload, 'ba-owner', 'ws-1')
    expect(payload.create).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'initiatives',
        data: expect.objectContaining({ owner: 'payload-owner' }),
      }),
    )
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
