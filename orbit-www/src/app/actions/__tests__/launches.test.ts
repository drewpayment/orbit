import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock dependencies before imports
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

vi.mock('@/lib/clients/launch-client', () => ({
  startLaunchWorkflow: vi.fn(),
  getLaunchProgress: vi.fn(),
  approveLaunch: vi.fn(),
  deorbitLaunch: vi.fn(),
  abortLaunch: vi.fn(),
}))

import { getPayload } from 'payload'
import { auth } from '@/lib/auth'
import { startLaunchWorkflow, getLaunchProgress, approveLaunch, deorbitLaunch, abortLaunch } from '@/lib/clients/launch-client'
import {
  createLaunch,
  startLaunch,
  getLaunchStatus,
  getLaunchWorkflowProgress,
  approveLaunchAction,
  deorbitLaunchAction,
  abortLaunchAction,
  getLaunchTemplates,
  getCloudAccounts,
  getLaunches,
  getAllUserLaunches,
} from '../launches'

const mockSession = {
  user: { id: 'user-1' },
  session: {},
} as any

describe('createLaunch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const validInput = {
    name: 'My Launch',
    workspaceId: 'workspace-1',
    templateId: 'template-1',
    templateSlug: 's3-bucket',
    cloudAccountId: 'cloud-1',
    provider: 'aws',
    region: 'us-east-1',
    parameters: { bucketName: 'my-bucket' },
  }

  it('should return unauthorized when no session', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null)

    const result = await createLaunch(validInput)

    expect(result).toEqual({ success: false, error: 'Unauthorized' })
  })

  it('should return error when user is not a workspace member', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockSession)

    const mockPayload = {
      find: vi.fn().mockResolvedValue({ docs: [] }),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await createLaunch(validInput)

    expect(result).toEqual({ success: false, error: 'Not a member of this workspace' })
    expect(mockPayload.find).toHaveBeenCalledWith({
      collection: 'workspace-members',
      where: {
        and: [
          { workspace: { equals: 'workspace-1' } },
          { user: { equals: 'user-1' } },
          { status: { equals: 'active' } },
        ],
      },
    })
  })

  it('should return error when cloud account not found', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockSession)

    const mockPayload = {
      find: vi.fn().mockResolvedValue({ docs: [{ id: 'membership-1' }] }),
      findByID: vi.fn().mockResolvedValue(null),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await createLaunch(validInput)

    expect(result).toEqual({ success: false, error: 'Cloud account not found' })
  })

  it('should return error when template not found', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockSession)

    const mockPayload = {
      find: vi.fn().mockResolvedValue({ docs: [{ id: 'membership-1' }] }),
      findByID: vi.fn()
        .mockResolvedValueOnce({ id: 'cloud-1', approvalRequired: false }) // cloud account
        .mockResolvedValueOnce(null), // template
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await createLaunch(validInput)

    expect(result).toEqual({ success: false, error: 'Launch template not found' })
  })

  it('should create a launch record successfully', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockSession)

    const mockPayload = {
      find: vi.fn().mockResolvedValue({ docs: [{ id: 'membership-1' }] }),
      findByID: vi.fn()
        .mockResolvedValueOnce({ id: 'cloud-1', approvalRequired: true, approvers: ['user-2'] }) // cloud account
        .mockResolvedValueOnce({ id: 'template-1', slug: 's3-bucket' }), // template
      create: vi.fn().mockResolvedValue({ id: 'launch-1' }),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await createLaunch(validInput)

    expect(result).toEqual({ success: true, launchId: 'launch-1' })
    expect(mockPayload.create).toHaveBeenCalledWith({
      collection: 'launches',
      data: expect.objectContaining({
        name: 'My Launch',
        workspace: 'workspace-1',
        template: 'template-1',
        cloudAccount: 'cloud-1',
        provider: 'aws',
        region: 'us-east-1',
        parameters: { bucketName: 'my-bucket' },
        status: 'pending',
        launchedBy: 'user-1',
        approvalConfig: {
          required: true,
          approvers: ['user-2'],
          timeoutHours: 24,
        },
      }),
    })
  })

  it('should include appId when provided', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockSession)

    const mockPayload = {
      find: vi.fn().mockResolvedValue({ docs: [{ id: 'membership-1' }] }),
      findByID: vi.fn()
        .mockResolvedValueOnce({ id: 'cloud-1', approvalRequired: false })
        .mockResolvedValueOnce({ id: 'template-1', slug: 's3-bucket' }),
      create: vi.fn().mockResolvedValue({ id: 'launch-1' }),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    await createLaunch({ ...validInput, appId: 'app-1' })

    expect(mockPayload.create).toHaveBeenCalledWith({
      collection: 'launches',
      data: expect.objectContaining({
        app: 'app-1',
      }),
    })
  })
})

describe('startLaunch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return unauthorized when no session', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null)

    const result = await startLaunch('launch-1')

    expect(result).toEqual({ success: false, error: 'Unauthorized' })
  })

  it('should return error when launch not found', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockSession)

    const mockPayload = {
      findByID: vi.fn().mockResolvedValue(null),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await startLaunch('nonexistent')

    expect(result).toEqual({ success: false, error: 'Launch not found' })
  })

  it('should call gRPC and update the launch record on success', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockSession)

    const mockLaunch = {
      id: 'launch-1',
      template: {
        id: 'template-1',
        slug: 's3-bucket',
      },
      cloudAccount: {
        id: 'cloud-1',
      },
      provider: 'aws',
      region: 'us-east-1',
      parameters: { bucketName: 'test' },
      approvalConfig: { required: false },
    }

    const mockPayload = {
      findByID: vi.fn().mockResolvedValue(mockLaunch),
      update: vi.fn().mockResolvedValue({}),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)
    vi.mocked(startLaunchWorkflow).mockResolvedValue({
      success: true,
      workflowId: 'workflow-123',
      error: '',
    } as any)

    const result = await startLaunch('launch-1')

    expect(result).toEqual({ success: true, workflowId: 'workflow-123' })
    expect(startLaunchWorkflow).toHaveBeenCalledWith(
      'launch-1',
      's3-bucket',
      'cloud-1',
      'aws',
      'us-east-1',
      { bucketName: 'test' },
      false,
    )
    expect(mockPayload.update).toHaveBeenCalledWith({
      collection: 'launches',
      id: 'launch-1',
      data: expect.objectContaining({
        workflowId: 'workflow-123',
        status: 'launching',
      }),
    })
  })

  it('should update launch status to failed when gRPC call fails', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockSession)

    const mockLaunch = {
      id: 'launch-1',
      template: { id: 'template-1', slug: 's3-bucket' },
      cloudAccount: { id: 'cloud-1' },
      provider: 'aws',
      region: 'us-east-1',
      parameters: {},
      approvalConfig: { required: false },
    }

    const mockPayload = {
      findByID: vi.fn().mockResolvedValue(mockLaunch),
      update: vi.fn().mockResolvedValue({}),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)
    vi.mocked(startLaunchWorkflow).mockRejectedValue(new Error('gRPC connection failed'))

    const result = await startLaunch('launch-1')

    expect(result).toEqual({ success: false, error: 'gRPC connection failed' })
    expect(mockPayload.update).toHaveBeenCalledWith({
      collection: 'launches',
      id: 'launch-1',
      data: {
        status: 'failed',
        launchError: 'gRPC connection failed',
      },
    })
  })

  it('should resolve template from string ID if needed', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockSession)

    const mockLaunch = {
      id: 'launch-1',
      template: 'template-1', // string ID, not resolved
      cloudAccount: { id: 'cloud-1' },
      provider: 'aws',
      region: 'us-east-1',
      parameters: {},
      approvalConfig: { required: false },
    }

    const mockPayload = {
      findByID: vi.fn()
        .mockResolvedValueOnce(mockLaunch) // initial launch fetch
        .mockResolvedValueOnce({ id: 'template-1', slug: 'resolved-template' }), // template resolve
      update: vi.fn().mockResolvedValue({}),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)
    vi.mocked(startLaunchWorkflow).mockResolvedValue({
      success: true,
      workflowId: 'workflow-456',
      error: '',
    } as any)

    const result = await startLaunch('launch-1')

    expect(result.success).toBe(true)
    expect(startLaunchWorkflow).toHaveBeenCalledWith(
      'launch-1',
      'resolved-template',
      'cloud-1',
      'aws',
      'us-east-1',
      {},
      false,
    )
  })
})

describe('getLaunchStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return null when no session', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null)

    const result = await getLaunchStatus('launch-1')

    expect(result).toBeNull()
  })

  it('should return launch details', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockSession)

    const mockLaunch = { id: 'launch-1', status: 'running' }
    const mockPayload = {
      findByID: vi.fn().mockResolvedValue(mockLaunch),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await getLaunchStatus('launch-1')

    expect(result).toEqual(mockLaunch)
  })
})

describe('getLaunchWorkflowProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return unauthorized when no session', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null)

    const result = await getLaunchWorkflowProgress('workflow-1')

    expect(result).toEqual({ success: false, error: 'Unauthorized' })
  })

  it('should return progress from gRPC client', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockSession)
    vi.mocked(getLaunchProgress).mockResolvedValue({
      status: 'running',
      currentStep: 2,
      totalSteps: 5,
      message: 'Provisioning resources',
      percentage: 40,
      logs: ['Step 1 done', 'Step 2 in progress'],
    } as any)

    const result = await getLaunchWorkflowProgress('workflow-1')

    expect(result).toEqual({
      success: true,
      status: 'running',
      currentStep: 2,
      totalSteps: 5,
      message: 'Provisioning resources',
      percentage: 40,
      logs: ['Step 1 done', 'Step 2 in progress'],
    })
  })
})

describe('approveLaunchAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return unauthorized when no session', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null)

    const result = await approveLaunchAction('workflow-1', true)

    expect(result).toEqual({ success: false, error: 'Unauthorized' })
  })

  it('should call gRPC approve with user ID and notes', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockSession)
    vi.mocked(approveLaunch).mockResolvedValue({ success: true, error: '' } as any)

    const result = await approveLaunchAction('workflow-1', true, 'Looks good')

    expect(result).toEqual({ success: true })
    expect(approveLaunch).toHaveBeenCalledWith('workflow-1', true, 'user-1', 'Looks good')
  })
})

describe('deorbitLaunchAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return unauthorized when no session', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null)

    const result = await deorbitLaunchAction('workflow-1')

    expect(result).toEqual({ success: false, error: 'Unauthorized' })
  })

  it('should call gRPC deorbit with user ID and reason', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockSession)
    vi.mocked(deorbitLaunch).mockResolvedValue({ success: true, error: '' } as any)

    const result = await deorbitLaunchAction('workflow-1', 'No longer needed')

    expect(result).toEqual({ success: true })
    expect(deorbitLaunch).toHaveBeenCalledWith('workflow-1', 'user-1', 'No longer needed')
  })
})

describe('abortLaunchAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return unauthorized when no session', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null)

    const result = await abortLaunchAction('workflow-1')

    expect(result).toEqual({ success: false, error: 'Unauthorized' })
  })

  it('should call gRPC abort with user ID', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockSession)
    vi.mocked(abortLaunch).mockResolvedValue({ success: true, error: '' } as any)

    const result = await abortLaunchAction('workflow-1')

    expect(result).toEqual({ success: true })
    expect(abortLaunch).toHaveBeenCalledWith('workflow-1', 'user-1')
  })
})

describe('getLaunchTemplates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return unauthorized when no session', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null)

    const result = await getLaunchTemplates()

    expect(result).toEqual({ success: false, error: 'Unauthorized', docs: [] })
  })

  it('should return all templates when no provider filter', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockSession)

    const mockTemplates = [
      { id: 't1', name: 'S3 Bucket', provider: 'aws' },
      { id: 't2', name: 'GCS Bucket', provider: 'gcp' },
    ]
    const mockPayload = {
      find: vi.fn().mockResolvedValue({ docs: mockTemplates }),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await getLaunchTemplates()

    expect(result).toEqual({ success: true, docs: mockTemplates })
    expect(mockPayload.find).toHaveBeenCalledWith({
      collection: 'launch-templates',
      where: {},
      limit: 100,
    })
  })

  it('should filter by provider when provided', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockSession)

    const mockPayload = {
      find: vi.fn().mockResolvedValue({ docs: [{ id: 't1', provider: 'aws' }] }),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await getLaunchTemplates('aws')

    expect(result.success).toBe(true)
    expect(mockPayload.find).toHaveBeenCalledWith({
      collection: 'launch-templates',
      where: { provider: { equals: 'aws' } },
      limit: 100,
    })
  })
})

describe('getCloudAccounts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return unauthorized when no session', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null)

    const result = await getCloudAccounts('workspace-1')

    expect(result).toEqual({ success: false, error: 'Unauthorized', docs: [] })
  })

  it('should filter by workspace and connected status', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockSession)

    const mockAccounts = [
      { id: 'ca-1', name: 'Production AWS', provider: 'aws' },
    ]
    const mockPayload = {
      find: vi.fn().mockResolvedValue({ docs: mockAccounts }),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await getCloudAccounts('workspace-1')

    expect(result).toEqual({ success: true, docs: mockAccounts })
    expect(mockPayload.find).toHaveBeenCalledWith({
      collection: 'cloud-accounts',
      where: {
        and: [
          { workspaces: { contains: 'workspace-1' } },
          { status: { equals: 'connected' } },
        ],
      },
      limit: 100,
    })
  })
})

describe('getLaunches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return unauthorized when no session', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null)

    const result = await getLaunches('workspace-1')

    expect(result).toEqual({ success: false, error: 'Unauthorized', docs: [] })
  })

  it('should return launches for workspace', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockSession)

    const mockLaunches = [{ id: 'l1', status: 'running' }]
    const mockPayload = {
      find: vi.fn().mockResolvedValue({ docs: mockLaunches }),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await getLaunches('workspace-1')

    expect(result).toEqual({ success: true, docs: mockLaunches })
    expect(mockPayload.find).toHaveBeenCalledWith({
      collection: 'launches',
      where: { workspace: { equals: 'workspace-1' } },
      depth: 2,
      sort: '-updatedAt',
      limit: 100,
    })
  })
})

describe('getAllUserLaunches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return unauthorized when no session', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null)

    const result = await getAllUserLaunches()

    expect(result).toEqual({ success: false, error: 'Unauthorized', docs: [] })
  })

  it('should return empty docs when user has no workspace memberships', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockSession)

    const mockPayload = {
      find: vi.fn().mockResolvedValue({ docs: [] }),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await getAllUserLaunches()

    expect(result).toEqual({ success: true, docs: [] })
    // Should only call find once (for memberships), not for launches
    expect(mockPayload.find).toHaveBeenCalledTimes(1)
  })

  it('should query launches across all user workspaces', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockSession)

    const mockPayload = {
      find: vi.fn()
        .mockResolvedValueOnce({
          docs: [
            { workspace: 'ws-1' },
            { workspace: { id: 'ws-2' } },
          ],
        }) // memberships
        .mockResolvedValueOnce({
          docs: [{ id: 'l1' }, { id: 'l2' }],
        }), // launches
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await getAllUserLaunches()

    expect(result).toEqual({ success: true, docs: [{ id: 'l1' }, { id: 'l2' }] })
    expect(mockPayload.find).toHaveBeenNthCalledWith(2, {
      collection: 'launches',
      where: { workspace: { in: ['ws-1', 'ws-2'] } },
      depth: 2,
      sort: '-updatedAt',
      limit: 100,
    })
  })
})
