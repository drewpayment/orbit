import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('payload', () => ({
  getPayload: vi.fn(),
}))

vi.mock('@payload-config', () => ({
  default: {},
}))

vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}))

vi.mock('next/headers', () => ({
  headers: vi.fn(() => Promise.resolve(new Headers())),
}))

import { getPayload } from 'payload'
import { auth } from '@/lib/auth'
import { importRepository } from '../apps'

describe('importRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should store installationId when provided', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'user-1' },
      session: {},
    } as any)

    const mockPayload = {
      find: vi.fn().mockResolvedValue({ docs: [{ id: 'membership-1' }] }),
      create: vi.fn().mockResolvedValue({ id: 'app-1' }),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    await importRepository({
      workspaceId: 'workspace-1',
      repositoryUrl: 'https://github.com/acme/repo',
      name: 'my-app',
      installationId: 'install-1',
    })

    expect(mockPayload.create).toHaveBeenCalledWith({
      collection: 'apps',
      data: expect.objectContaining({
        repository: expect.objectContaining({
          installationId: 'install-1',
        }),
      }),
    })
  })

  it('should work without installationId', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'user-1' },
      session: {},
    } as any)

    const mockPayload = {
      find: vi.fn().mockResolvedValue({ docs: [{ id: 'membership-1' }] }),
      create: vi.fn().mockResolvedValue({ id: 'app-1' }),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    await importRepository({
      workspaceId: 'workspace-1',
      repositoryUrl: 'https://github.com/acme/repo',
      name: 'my-app',
    })

    expect(mockPayload.create).toHaveBeenCalledWith({
      collection: 'apps',
      data: expect.objectContaining({
        repository: expect.not.objectContaining({
          installationId: expect.anything(),
        }),
      }),
    })
  })
})
