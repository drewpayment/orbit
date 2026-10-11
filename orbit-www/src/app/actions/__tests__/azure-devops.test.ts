import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('payload', () => ({ getPayload: vi.fn() }))
vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('@/lib/authz', () => ({
  getActor: vi.fn(),
  check: vi.fn(),
  memberWorkspaceIds: vi.fn(),
}))

const core = vi.hoisted(() => ({
  listConnectionRepositoriesCore: vi.fn().mockResolvedValue({ ok: true, repos: [] }),
}))
vi.mock('@/lib/connections/ado-repos-core', () => core)

import { getPayload } from 'payload'
import { getActor, memberWorkspaceIds } from '@/lib/authz'
import { listConnectionRepositories, searchConnectionRepositories } from '../azure-devops'

const actor = {
  payloadId: 'pl-1',
  betterAuthId: 'ba-1',
  email: 'a@test.com',
  role: 'user',
  isPlatformAdmin: false,
  user: { id: 'pl-1', collection: 'users' },
}

describe('ADO repo browsing is gated by the connection allowedWorkspaces', () => {
  let payload: { findByID: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    vi.clearAllMocks()
    payload = { findByID: vi.fn().mockResolvedValue({ id: 'conn-1', allowedWorkspaces: ['ws-1'] }) }
    ;(getPayload as any).mockResolvedValue(payload)
    ;(getActor as any).mockResolvedValue(actor)
    ;(memberWorkspaceIds as any).mockResolvedValue(['ws-1'])
  })

  it('rejects unauthenticated callers', async () => {
    ;(getActor as any).mockResolvedValue(null)
    const r = await listConnectionRepositories('conn-1')
    expect(r.success).toBe(false)
    expect(core.listConnectionRepositoriesCore).not.toHaveBeenCalled()
  })

  it('does not use the connection credentials for a non-member of its workspaces', async () => {
    ;(memberWorkspaceIds as any).mockResolvedValue(['ws-other'])
    const r = await listConnectionRepositories('conn-1')
    expect(r).toEqual({ success: false, error: 'Connection not found', repos: [], hasMore: false })
    expect(core.listConnectionRepositoriesCore).not.toHaveBeenCalled()
  })

  it('treats an unknown connection as not found', async () => {
    payload.findByID.mockRejectedValue(new Error('Not Found'))
    const r = await listConnectionRepositories('missing')
    expect(r.success).toBe(false)
    expect(core.listConnectionRepositoriesCore).not.toHaveBeenCalled()
  })

  it('lists repos for a member of an allowed workspace', async () => {
    const r = await listConnectionRepositories('conn-1')
    expect(r.success).toBe(true)
    expect(core.listConnectionRepositoriesCore).toHaveBeenCalledOnce()
  })

  it('search inherits the same gate', async () => {
    ;(memberWorkspaceIds as any).mockResolvedValue([])
    const r = await searchConnectionRepositories('conn-1', 'api')
    expect(r.success).toBe(false)
    expect(core.listConnectionRepositoriesCore).not.toHaveBeenCalled()
  })
})
