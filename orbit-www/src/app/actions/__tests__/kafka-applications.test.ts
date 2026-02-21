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

vi.mock('@/lib/kafka/quotas', () => ({
  canCreateApplication: vi.fn(),
  getWorkspaceQuotaInfo: vi.fn(),
}))

vi.mock('@/lib/temporal/client', () => ({
  getTemporalClient: vi.fn(),
}))

import { getPayload } from 'payload'
import { auth } from '@/lib/auth'
import { listApplicationsWithProvisioningIssues } from '../kafka-applications'

describe('listApplicationsWithProvisioningIssues', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return error when not authenticated', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null)

    const result = await listApplicationsWithProvisioningIssues()

    expect(result).toEqual({ success: false, error: 'Not authenticated' })
  })

  it('should return applications with provisioning issues', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'user-1' },
      session: {},
    } as any)

    const mockApps = {
      docs: [
        {
          id: 'app-1',
          name: 'App 1',
          slug: 'app-1',
          workspace: { id: 'ws-1', slug: 'workspace-1' },
          provisioningStatus: 'failed',
          provisioningError: 'Cluster creation failed',
          provisioningDetails: { dev: { status: 'failed', error: 'timeout' } },
          provisioningWorkflowId: 'workflow-1',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        {
          id: 'app-2',
          name: 'App 2',
          slug: 'app-2',
          workspace: { id: 'ws-2', slug: 'workspace-2' },
          provisioningStatus: 'partial',
          provisioningError: null,
          provisioningDetails: { dev: { status: 'success' }, prod: { status: 'failed', error: 'quota' } },
          provisioningWorkflowId: 'workflow-2',
          updatedAt: '2024-01-02T00:00:00Z',
        },
      ],
    }

    const mockPayload = {
      find: vi.fn().mockResolvedValue(mockApps),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await listApplicationsWithProvisioningIssues()

    expect(result.success).toBe(true)
    expect(result.applications).toHaveLength(2)
    expect(result.applications?.[0]).toEqual({
      id: 'app-1',
      name: 'App 1',
      slug: 'app-1',
      workspaceId: 'ws-1',
      workspaceSlug: 'workspace-1',
      provisioningStatus: 'failed',
      provisioningError: 'Cluster creation failed',
      provisioningDetails: { dev: { status: 'failed', error: 'timeout' } },
      provisioningWorkflowId: 'workflow-1',
      updatedAt: '2024-01-01T00:00:00Z',
    })

    // Verify the query uses correct provisioning statuses
    expect(mockPayload.find).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'kafka-applications',
        where: {
          and: [
            { status: { not_equals: 'deleted' } },
            { provisioningStatus: { in: ['pending', 'in_progress', 'partial', 'failed'] } },
          ],
        },
      })
    )
  })

  it('should filter by workspaceId when provided', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'user-1' },
      session: {},
    } as any)

    const mockPayload = {
      find: vi.fn().mockResolvedValue({ docs: [] }),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    await listApplicationsWithProvisioningIssues('ws-1')

    expect(mockPayload.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          and: expect.arrayContaining([
            { workspace: { equals: 'ws-1' } },
          ]),
        }),
      })
    )
  })

  it('should handle workspace as string ID', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'user-1' },
      session: {},
    } as any)

    const mockApps = {
      docs: [
        {
          id: 'app-1',
          name: 'App 1',
          slug: 'app-1',
          workspace: 'ws-1', // String ID instead of object
          provisioningStatus: 'pending',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ],
    }

    const mockPayload = {
      find: vi.fn().mockResolvedValue(mockApps),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await listApplicationsWithProvisioningIssues()

    expect(result.success).toBe(true)
    expect(result.applications?.[0].workspaceId).toBe('ws-1')
    expect(result.applications?.[0].workspaceSlug).toBeUndefined()
  })
})
