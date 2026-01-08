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

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import { getPayload } from 'payload'
import { auth } from '@/lib/auth'
import {
  submitApplicationRequest,
  getMyRequests,
  getPendingWorkspaceApprovals,
  getPendingPlatformApprovals,
  approveRequestAsWorkspaceAdmin,
  rejectRequestAsWorkspaceAdmin,
  approveRequestAsPlatformAdmin,
  rejectRequestAsPlatformAdmin,
  getWorkspaceAdminStatus,
} from '../kafka-application-requests'

describe('submitApplicationRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return unauthorized when no session', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null)

    const result = await submitApplicationRequest({
      workspaceId: 'workspace-1',
      applicationName: 'Test App',
      applicationSlug: 'test-app',
    })

    expect(result).toEqual({ success: false, error: 'Not authenticated' })
  })

  it('should return error when user is not a workspace member', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'user-1' },
      session: {},
    } as any)

    const mockPayload = {
      find: vi.fn().mockResolvedValue({ docs: [] }),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await submitApplicationRequest({
      workspaceId: 'workspace-1',
      applicationName: 'Test App',
      applicationSlug: 'test-app',
    })

    expect(result).toEqual({ success: false, error: 'Not a member of this workspace' })
  })

  it('should create request successfully', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'user-1' },
      session: {},
    } as any)

    const mockPayload = {
      find: vi
        .fn()
        .mockResolvedValueOnce({ docs: [{ id: 'membership-1' }] }) // membership check
        .mockResolvedValueOnce({ docs: [] }) // existing request check
        .mockResolvedValueOnce({ docs: [] }), // existing app check
      create: vi.fn().mockResolvedValue({ id: 'request-1' }),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await submitApplicationRequest({
      workspaceId: 'workspace-1',
      applicationName: 'Test App',
      applicationSlug: 'test-app',
      description: 'Test description',
    })

    expect(result).toEqual({ success: true, requestId: 'request-1' })
    expect(mockPayload.create).toHaveBeenCalledWith({
      collection: 'kafka-application-requests',
      data: {
        workspace: 'workspace-1',
        applicationName: 'Test App',
        applicationSlug: 'test-app',
        description: 'Test description',
        requestedBy: 'user-1',
        status: 'pending_workspace',
      },
      overrideAccess: true,
    })
  })
})

describe('getMyRequests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return error when no session', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null)

    const result = await getMyRequests('workspace-1')

    expect(result).toEqual({ success: false, error: 'Not authenticated' })
  })

  it('should return user requests', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'user-1' },
      session: {},
    } as any)

    const mockRequest = {
      id: 'request-1',
      applicationName: 'Test App',
      applicationSlug: 'test-app',
      status: 'pending_workspace',
      workspace: { id: 'workspace-1', name: 'Test Workspace' },
      requestedBy: { id: 'user-1', name: 'Test User', email: 'test@test.com' },
      createdAt: '2024-01-01T00:00:00Z',
    }

    const mockPayload = {
      find: vi.fn().mockResolvedValue({ docs: [mockRequest] }),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await getMyRequests('workspace-1')

    expect(result.success).toBe(true)
    expect(result.requests).toHaveLength(1)
    expect(result.requests?.[0].applicationName).toBe('Test App')
  })
})

describe('getPendingWorkspaceApprovals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return unauthorized when no session', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null)

    const result = await getPendingWorkspaceApprovals('workspace-1')

    expect(result).toEqual({ success: false, error: 'Not authenticated' })
  })

  it('should return error when user is not a workspace admin', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'user-1' },
      session: {},
    } as any)

    const mockPayload = {
      find: vi.fn().mockResolvedValue({ docs: [] }),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await getPendingWorkspaceApprovals('workspace-1')

    expect(result).toEqual({ success: false, error: 'Not a workspace admin' })
  })

  it('should return pending requests for workspace admin', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'user-1' },
      session: {},
    } as any)

    const mockRequest = {
      id: 'request-1',
      applicationName: 'Test App',
      applicationSlug: 'test-app',
      status: 'pending_workspace',
      workspace: { id: 'workspace-1', name: 'Test Workspace' },
      requestedBy: { id: 'user-2', name: 'Test User', email: 'test@test.com' },
      createdAt: '2024-01-01T00:00:00Z',
    }

    const mockPayload = {
      find: vi
        .fn()
        .mockResolvedValueOnce({ docs: [{ id: 'membership-1', role: 'admin' }] }) // membership check
        .mockResolvedValueOnce({ docs: [mockRequest] }), // requests
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await getPendingWorkspaceApprovals('workspace-1')

    expect(result.success).toBe(true)
    expect(result.requests).toHaveLength(1)
  })
})

describe('getPendingPlatformApprovals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return unauthorized when no session', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null)

    const result = await getPendingPlatformApprovals()

    expect(result).toEqual({ success: false, error: 'Not authenticated' })
  })

  it('should return error when user is not a platform admin', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'user-1' },
      session: {},
    } as any)

    const mockPayload = {
      findByID: vi.fn().mockResolvedValue(null),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await getPendingPlatformApprovals()

    expect(result).toEqual({ success: false, error: 'Not a platform admin' })
  })

  it('should return pending platform requests for platform admin', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'user-1' },
      session: {},
    } as any)

    const mockRequest = {
      id: 'request-1',
      applicationName: 'Test App',
      applicationSlug: 'test-app',
      status: 'pending_platform',
      workspace: { id: 'workspace-1', name: 'Test Workspace' },
      requestedBy: { id: 'user-2', name: 'Test User', email: 'test@test.com' },
      workspaceApprovedBy: { id: 'user-3', name: 'Admin', email: 'admin@test.com' },
      workspaceApprovedAt: '2024-01-01T00:00:00Z',
      createdAt: '2024-01-01T00:00:00Z',
    }

    const mockPayload = {
      findByID: vi.fn().mockResolvedValue({ id: 'user-1' }), // platform admin check
      find: vi.fn().mockResolvedValue({ docs: [mockRequest] }),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await getPendingPlatformApprovals()

    expect(result.success).toBe(true)
    expect(result.requests).toHaveLength(1)
    expect(result.requests?.[0].status).toBe('pending_platform')
  })
})

describe('approveRequestAsWorkspaceAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return unauthorized when no session', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null)

    const result = await approveRequestAsWorkspaceAdmin('request-1')

    expect(result).toEqual({ success: false, error: 'Not authenticated' })
  })

  it('should return error when request not found', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'user-1' },
      session: {},
    } as any)

    const mockPayload = {
      findByID: vi.fn().mockResolvedValue(null),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await approveRequestAsWorkspaceAdmin('request-1')

    expect(result).toEqual({ success: false, error: 'Request not found' })
  })

  it('should return error when request is not pending workspace approval', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'user-1' },
      session: {},
    } as any)

    const mockPayload = {
      findByID: vi.fn().mockResolvedValue({
        id: 'request-1',
        status: 'pending_platform',
        workspace: 'workspace-1',
      }),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await approveRequestAsWorkspaceAdmin('request-1')

    expect(result).toEqual({ success: false, error: 'Request is not pending workspace approval' })
  })

  it('should approve request successfully', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'user-1' },
      session: {},
    } as any)

    const mockPayload = {
      findByID: vi.fn().mockResolvedValue({
        id: 'request-1',
        status: 'pending_workspace',
        workspace: 'workspace-1',
      }),
      find: vi.fn().mockResolvedValue({ docs: [{ id: 'membership-1', role: 'admin' }] }),
      update: vi.fn().mockResolvedValue({ id: 'request-1' }),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await approveRequestAsWorkspaceAdmin('request-1')

    expect(result).toEqual({ success: true })
    expect(mockPayload.update).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'kafka-application-requests',
        id: 'request-1',
        data: expect.objectContaining({
          status: 'pending_platform',
          workspaceApprovedBy: 'user-1',
        }),
      })
    )
  })
})

describe('rejectRequestAsWorkspaceAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should reject request with reason', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'user-1' },
      session: {},
    } as any)

    const mockPayload = {
      findByID: vi.fn().mockResolvedValue({
        id: 'request-1',
        status: 'pending_workspace',
        workspace: 'workspace-1',
      }),
      find: vi.fn().mockResolvedValue({ docs: [{ id: 'membership-1', role: 'admin' }] }),
      update: vi.fn().mockResolvedValue({ id: 'request-1' }),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await rejectRequestAsWorkspaceAdmin('request-1', 'Duplicate request')

    expect(result).toEqual({ success: true })
    expect(mockPayload.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'rejected',
          rejectedBy: 'user-1',
          rejectionReason: 'Duplicate request',
        }),
      })
    )
  })
})

describe('approveRequestAsPlatformAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return unauthorized when no session', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null)

    const result = await approveRequestAsPlatformAdmin('request-1', 'single')

    expect(result).toEqual({ success: false, error: 'Not authenticated' })
  })

  it('should return error when not a platform admin', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'user-1' },
      session: {},
    } as any)

    const mockPayload = {
      findByID: vi.fn().mockResolvedValue(null),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await approveRequestAsPlatformAdmin('request-1', 'single')

    expect(result).toEqual({ success: false, error: 'Not a platform admin' })
  })

  it('should approve request with single action', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'user-1' },
      session: {},
    } as any)

    const mockPayload = {
      findByID: vi
        .fn()
        .mockResolvedValueOnce({ id: 'user-1' }) // platform admin check
        .mockResolvedValueOnce({
          id: 'request-1',
          status: 'pending_platform',
          workspace: 'workspace-1',
        }), // request
      update: vi.fn().mockResolvedValue({ id: 'request-1' }),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await approveRequestAsPlatformAdmin('request-1', 'single')

    expect(result).toEqual({ success: true })
    expect(mockPayload.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'approved',
          platformApprovedBy: 'user-1',
          platformAction: 'approved_single',
        }),
      })
    )
  })

  it('should approve request with increase_quota action', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'user-1' },
      session: {},
    } as any)

    const mockPayload = {
      findByID: vi
        .fn()
        .mockResolvedValueOnce({ id: 'user-1' }) // platform admin check
        .mockResolvedValueOnce({
          id: 'request-1',
          status: 'pending_platform',
          workspace: 'workspace-1',
        }), // request
      update: vi.fn().mockResolvedValue({ id: 'request-1' }),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await approveRequestAsPlatformAdmin('request-1', 'increase_quota')

    expect(result).toEqual({ success: true })
    expect(mockPayload.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          platformAction: 'increased_quota',
        }),
      })
    )
  })
})

describe('rejectRequestAsPlatformAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should reject request with reason', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'user-1' },
      session: {},
    } as any)

    const mockPayload = {
      findByID: vi
        .fn()
        .mockResolvedValueOnce({ id: 'user-1' }) // platform admin check
        .mockResolvedValueOnce({
          id: 'request-1',
          status: 'pending_platform',
          workspace: 'workspace-1',
        }), // request
      update: vi.fn().mockResolvedValue({ id: 'request-1' }),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await rejectRequestAsPlatformAdmin('request-1', 'Policy violation')

    expect(result).toEqual({ success: true })
    expect(mockPayload.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'rejected',
          rejectedBy: 'user-1',
          rejectionReason: 'Policy violation',
        }),
      })
    )
  })
})

describe('getWorkspaceAdminStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return not admin when no session', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null)

    const result = await getWorkspaceAdminStatus('workspace-1')

    expect(result).toEqual({ isAdmin: false, pendingCount: 0 })
  })

  it('should return not admin when user is not workspace admin', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'user-1' },
      session: {},
    } as any)

    const mockPayload = {
      find: vi.fn().mockResolvedValue({ docs: [] }),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await getWorkspaceAdminStatus('workspace-1')

    expect(result).toEqual({ isAdmin: false, pendingCount: 0 })
  })

  it('should return admin status with pending count', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'user-1' },
      session: {},
    } as any)

    const mockPayload = {
      find: vi
        .fn()
        .mockResolvedValueOnce({ docs: [{ id: 'membership-1', role: 'admin' }] }) // membership
        .mockResolvedValueOnce({ totalDocs: 3 }), // pending count
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await getWorkspaceAdminStatus('workspace-1')

    expect(result).toEqual({ isAdmin: true, pendingCount: 3 })
  })
})
