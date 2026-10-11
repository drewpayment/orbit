import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('payload', () => ({ getPayload: vi.fn() }))
vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/authz', () => ({
  getActor: vi.fn(),
  check: vi.fn(),
  memberWorkspaceIds: vi.fn(),
}))
vi.mock('@/lib/actions/run', () => ({ runActionById: vi.fn(), executeAction: vi.fn() }))

import { getPayload } from 'payload'
import { getActor, memberWorkspaceIds } from '@/lib/authz'
import { listActions, getManageableActionWorkspaces, listRuns, getRun, canApproveRun } from './actions'

const sessionActor = {
  payloadId: 'pl-me',
  betterAuthId: 'ba-me',
  email: 'me@test.com',
  role: 'user',
  isPlatformAdmin: false,
  user: { id: 'pl-me' },
}
const forgedActor = { ...sessionActor, payloadId: 'pl-victim', betterAuthId: 'ba-victim', isPlatformAdmin: true }

describe('self-service read actions never trust a client-supplied actor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(getActor as any).mockResolvedValue(sessionActor)
    ;(memberWorkspaceIds as any).mockResolvedValue([])
    ;(getPayload as any).mockResolvedValue({ find: vi.fn().mockResolvedValue({ docs: [] }), findByID: vi.fn() })
  })

  it.each([
    ['listActions', () => (listActions as any)(forgedActor)],
    ['getManageableActionWorkspaces', () => (getManageableActionWorkspaces as any)(forgedActor)],
    ['listRuns', () => (listRuns as any)(forgedActor)],
    ['getRun', () => (getRun as any)(forgedActor, 'run-1')],
  ])('%s resolves the actor from the session', async (_name, call) => {
    await call()
    expect(memberWorkspaceIds).toHaveBeenCalled()
    for (const c of (memberWorkspaceIds as any).mock.calls) {
      expect(c[1]).toBe(sessionActor)
    }
  })

  it('returns empty results when unauthenticated even if an actor is supplied', async () => {
    ;(getActor as any).mockResolvedValue(null)
    await expect((listActions as any)(forgedActor)).resolves.toEqual([])
    await expect((listRuns as any)(forgedActor)).resolves.toEqual([])
    await expect((getRun as any)(forgedActor, 'run-1')).resolves.toBeNull()
    expect(memberWorkspaceIds).not.toHaveBeenCalled()
  })
})

describe('canApproveRun', () => {
  it('is false when unauthenticated, regardless of policy other than none', async () => {
    ;(getActor as any).mockResolvedValue(null)
    await expect(canApproveRun('ws-1', 'workspace-admin')).resolves.toBe(false)
    await expect(canApproveRun('ws-1', 'platform-admin')).resolves.toBe(false)
  })
})
