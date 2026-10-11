/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

const getActor = vi.fn()
const workspaceRole = vi.fn()
vi.mock('@/lib/authz', () => ({ getActor, workspaceRole }))

const mintServiceToken = vi.fn(async () => 'signed-token')
vi.mock('./svc-auth-token', () => ({ mintServiceToken }))

const virtualClusterWorkspace = vi.fn()
vi.mock('./object-workspace', () => ({ virtualClusterWorkspace }))

function actorFor(id: string, role: string) {
  return {
    payloadId: `pl-${id}`,
    betterAuthId: id,
    email: `${id}@example.com`,
    role,
    isPlatformAdmin: role === 'super_admin' || role === 'admin',
    user: {},
  }
}

async function run(method: string, message: unknown, actor: ReturnType<typeof actorFor> | null) {
  getActor.mockResolvedValue(actor)
  const { bifrostConsumerGroupInterceptor } = await import('./bifrost-auth-interceptor')
  const next = vi.fn(async () => 'response')
  const req = { method: { name: method }, message, header: new Headers() }
  const result = bifrostConsumerGroupInterceptor(next as never)(req as never)
  return { result, next, req }
}

describe('bifrostConsumerGroupInterceptor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('signs the virtual cluster workspace for a member', async () => {
    virtualClusterWorkspace.mockResolvedValue('ws-1')
    workspaceRole.mockResolvedValue('member')

    const { result, next, req } = await run('ListConsumerGroups', { virtualClusterId: 'vc-1' }, actorFor('u1', 'user'))
    await result

    expect(virtualClusterWorkspace).toHaveBeenCalledWith('vc-1')
    expect(mintServiceToken).toHaveBeenCalledWith('u1', 'ws-1', { platformAdmin: false })
    expect(req.header.get('Authorization')).toBe('Bearer signed-token')
    expect(next).toHaveBeenCalled()
  })

  it.each(['ListConsumerGroups', 'DescribeConsumerGroup', 'ResetConsumerGroupOffsets'])(
    '%s refuses a non-member of the cluster workspace (cross-tenant)',
    async (method) => {
      virtualClusterWorkspace.mockResolvedValue('ws-other')
      workspaceRole.mockResolvedValue(null)

      const { result, next } = await run(method, { virtualClusterId: 'vc-1' }, actorFor('u1', 'user'))

      await expect(result).rejects.toThrow(/not a member/)
      expect(mintServiceToken).not.toHaveBeenCalled()
      expect(next).not.toHaveBeenCalled()
    },
  )

  it('refuses when the cluster workspace cannot be determined', async () => {
    virtualClusterWorkspace.mockResolvedValue(null)

    const { result } = await run('ResetConsumerGroupOffsets', { virtualClusterId: 'vc-gone' }, actorFor('u1', 'user'))

    await expect(result).rejects.toThrow(/cannot determine the workspace/)
    expect(mintServiceToken).not.toHaveBeenCalled()
  })

  it('lets a platform admin through on the adm claim without a workspace lookup', async () => {
    const { result } = await run('ListConsumerGroups', { virtualClusterId: 'vc-1' }, actorFor('root', 'super_admin'))
    await result

    expect(virtualClusterWorkspace).not.toHaveBeenCalled()
    expect(mintServiceToken).toHaveBeenCalledWith('root', '', { platformAdmin: true })
  })

  it('signs the admin claim for the server-trusted virtual cluster sync, for any authenticated user', async () => {
    const { result } = await run('UpsertVirtualCluster', { config: { id: 'vc-1' } }, actorFor('u1', 'user'))
    await result

    expect(mintServiceToken).toHaveBeenCalledWith('u1', '', { platformAdmin: true })
  })

  it('does not elevate any other RPC for a plain user', async () => {
    const { result } = await run('DeleteVirtualCluster', { virtualClusterId: 'vc-1' }, actorFor('u1', 'user'))
    await result

    expect(mintServiceToken).toHaveBeenCalledWith('u1', '', { platformAdmin: false })
  })

  it('throws when there is no authenticated user', async () => {
    const { result } = await run('ListConsumerGroups', { virtualClusterId: 'vc-1' }, null)

    await expect(result).rejects.toThrow(/no authenticated user/)
    expect(mintServiceToken).not.toHaveBeenCalled()
  })
})
