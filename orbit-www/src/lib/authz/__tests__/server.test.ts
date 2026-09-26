/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Actor } from '../actor'

const mocks = vi.hoisted(() => ({
  getActor: vi.fn(),
  find: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('payload', () => ({ getPayload: vi.fn(async () => ({ find: mocks.find })) }))
vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('../actor', () => {
  class UnauthenticatedError extends Error {
    readonly status = 401
    constructor(message = 'Unauthenticated') {
      super(message)
      this.name = 'UnauthenticatedError'
    }
  }
  return { getActor: mocks.getActor, UnauthenticatedError }
})

import { authorize, check, memberWorkspaceIds, workspaceRole, authzErrorResponse, AuthzError } from '../server'
import { UnauthenticatedError } from '../actor'

type MemberDoc = { workspace: string; user: string; role: string; status: string }

function seedMembers(members: MemberDoc[]) {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  mocks.find.mockImplementation(async (args: any) => {
    if (args.collection !== 'workspace-members') return { docs: [] }
    const and: any[] = args.where?.and ?? []
    return {
      docs: members.filter((m) =>
        and.every((c) => {
          if (c.workspace) return m.workspace === c.workspace.equals
          if (c.user) return m.user === c.user.equals
          if (c.status) return m.status === c.status.equals
          if (c.role?.equals) return m.role === c.role.equals
          if (c.role?.in) return c.role.in.includes(m.role)
          return true
        }),
      ),
    }
  })
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

const actor = (over: Partial<Actor> = {}): Actor =>
  ({
    payloadId: 'p-1',
    betterAuthId: 'ba-1',
    email: 'm@example.com',
    role: 'user',
    isPlatformAdmin: false,
    user: {} as Actor['user'],
    ...over,
  }) as Actor

beforeEach(() => {
  mocks.getActor.mockReset()
  mocks.find.mockReset()
})

describe('authorize', () => {
  it('throws UnauthenticatedError (401) when there is no actor', async () => {
    mocks.getActor.mockResolvedValue(null)
    await expect(authorize('read', { kind: 'workspace', id: 'ws-1' })).rejects.toBeInstanceOf(UnauthenticatedError)
    expect(mocks.find).not.toHaveBeenCalled()
  })

  it('throws AuthzError (403) carrying the decision on deny', async () => {
    mocks.getActor.mockResolvedValue(actor())
    seedMembers([{ workspace: 'ws-1', user: 'ba-1', role: 'member', status: 'active' }])
    const err = await authorize('update', { kind: 'workspace', id: 'ws-1' }).catch((e) => e)
    expect(err).toBeInstanceOf(AuthzError)
    expect(err.status).toBe(403)
    expect(err.decision.allowed).toBe(false)
    expect(err.decision.reason).toMatch(/owner or admin/)
  })

  it('returns the actor on allow', async () => {
    mocks.getActor.mockResolvedValue(actor())
    seedMembers([{ workspace: 'ws-1', user: 'ba-1', role: 'admin', status: 'active' }])
    const a = await authorize('update', { kind: 'workspace', id: 'ws-1' })
    expect(a.payloadId).toBe('p-1')
  })

  it('uses a supplied actor instead of resolving one', async () => {
    seedMembers([{ workspace: 'ws-1', user: 'ba-2', role: 'owner', status: 'active' }])
    const a = await authorize('delete', { kind: 'workspace', id: 'ws-1' }, actor({ betterAuthId: 'ba-2', payloadId: 'p-2' }))
    expect(a.payloadId).toBe('p-2')
    expect(mocks.getActor).not.toHaveBeenCalled()
  })

  it('a supplied null actor is unauthenticated', async () => {
    await expect(authorize('read', { kind: 'platform' }, null)).rejects.toBeInstanceOf(UnauthenticatedError)
  })

  it('platform admin passes a platform resource without a membership query', async () => {
    mocks.getActor.mockResolvedValue(actor({ isPlatformAdmin: true, role: 'admin' }))
    await authorize('manage', { kind: 'platform' })
    expect(mocks.find).not.toHaveBeenCalled()
  })

  it('membership is keyed on betterAuthId, ownership on payloadId', async () => {
    mocks.getActor.mockResolvedValue(actor())
    seedMembers([{ workspace: 'ws-1', user: 'p-1', role: 'owner', status: 'active' }]) // stored under the wrong id
    await expect(authorize('update', { kind: 'workspace', id: 'ws-1' })).rejects.toBeInstanceOf(AuthzError)
    await expect(
      authorize('update', { kind: 'doc', workspaceId: 'ws-1', ownerPayloadId: 'p-1' }),
    ).resolves.toBeTruthy()
  })
})

describe('check', () => {
  it('never throws; returns the decision and the actor', async () => {
    mocks.getActor.mockResolvedValue(null)
    const anon = await check('read', { kind: 'workspace', id: 'ws-1' })
    expect(anon.allowed).toBe(false)
    expect(anon.actor).toBeNull()

    mocks.getActor.mockResolvedValue(actor())
    seedMembers([{ workspace: 'ws-1', user: 'ba-1', role: 'member', status: 'active' }])
    const ok = await check('read', { kind: 'workspace', id: 'ws-1' })
    expect(ok.allowed).toBe(true)
    expect(ok.actor?.payloadId).toBe('p-1')
  })
})

describe('memberWorkspaceIds', () => {
  it('returns [] for anonymous and the member set otherwise', async () => {
    mocks.getActor.mockResolvedValue(null)
    expect(await memberWorkspaceIds()).toEqual([])

    mocks.getActor.mockResolvedValue(actor())
    seedMembers([
      { workspace: 'ws-1', user: 'ba-1', role: 'member', status: 'active' },
      { workspace: 'ws-2', user: 'ba-1', role: 'admin', status: 'active' },
      { workspace: 'ws-3', user: 'ba-1', role: 'owner', status: 'pending' },
    ])
    expect((await memberWorkspaceIds()).sort()).toEqual(['ws-1', 'ws-2'])
    expect(await memberWorkspaceIds('manage')).toEqual(['ws-2'])
  })

  it('does not give platform admins every workspace (callers decide)', async () => {
    mocks.getActor.mockResolvedValue(actor({ isPlatformAdmin: true }))
    seedMembers([])
    expect(await memberWorkspaceIds()).toEqual([])
  })
})

describe('workspaceRole', () => {
  it('returns the active role or null', async () => {
    mocks.getActor.mockResolvedValue(actor())
    seedMembers([{ workspace: 'ws-1', user: 'ba-1', role: 'admin', status: 'active' }])
    expect(await workspaceRole('ws-1')).toBe('admin')
    expect(await workspaceRole('ws-2')).toBeNull()
    mocks.getActor.mockResolvedValue(null)
    expect(await workspaceRole('ws-1')).toBeNull()
  })
})

describe('authzErrorResponse', () => {
  it('maps UnauthenticatedError → 401, AuthzError → 403, anything else → null', async () => {
    const r401 = authzErrorResponse(new UnauthenticatedError())
    expect(r401?.status).toBe(401)
    const r403 = authzErrorResponse(new AuthzError({ allowed: false, reason: 'nope' }, 'read', { kind: 'platform' }))
    expect(r403?.status).toBe(403)
    expect(await r403?.json()).toEqual({ error: 'Forbidden', reason: 'nope' })
    expect(authzErrorResponse(new Error('boom'))).toBeNull()
  })
})
