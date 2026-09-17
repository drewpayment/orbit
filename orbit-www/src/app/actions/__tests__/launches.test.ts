import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock dependencies before imports
vi.mock('payload', () => ({
  getPayload: vi.fn(),
}))

vi.mock('@payload-config', () => ({
  default: {},
}))

/**
 * Mocked at the `@/lib/authz` module boundary (never the real `actor.ts`,
 * which pulls in the Better-Auth Mongo client). `getActor` returns the Actor
 * built from the test's simulated session (`authApi.getSession`, kept as a
 * drop-in for the old `auth.api.getSession` mock); `check`/`memberWorkspaceIds`
 * re-derive the caller's workspace role(s) by calling the CURRENTLY mocked
 * `getPayload()`'s `find({ collection: 'workspace-members' })` — the exact
 * query surface these tests already control per-case (`docs: [...]` /
 * `docs: []`) — so every existing `find` stub keeps driving the same
 * ALLOW/DENY outcome it always did. `betterAuthId` is the session's
 * `user.id` (used for membership lookups and forwarded to the Go gRPC
 * calls); `payloadId` is a DISTINCT `user.payloadId` (defaulting to the
 * session id if a test doesn't set one) so any `relationTo: 'users'` write
 * (`launchedBy`, `approvedBy`) or Payload-id comparison (`isOwner`) that
 * accidentally used `betterAuthId` instead of `payloadId` would fail here
 * rather than passing by coincidence.
 */
const authApi = { getSession: vi.fn() }
vi.mock('@/lib/authz', () => ({
  getActor: vi.fn(async () => {
    const session = await authApi.getSession()
    if (!session?.user) return null
    return {
      payloadId: session.user.payloadId ?? session.user.id,
      betterAuthId: session.user.id,
      email: session.user.email ?? '',
      role: 'user',
      isPlatformAdmin: false,
      user: session.user,
    }
  }),
  check: vi.fn(async (verb: string, resource: { kind: string; id?: string; roles?: string[] }, actorArg?: unknown) => {
    const session = await authApi.getSession()
    const actor = (actorArg as { betterAuthId: string } | undefined) ?? (session?.user ? { betterAuthId: session.user.id } : null)
    if (!actor) return { allowed: false, reason: 'unauthenticated', actor: null }
    if (resource.kind !== 'workspace') return { allowed: false, reason: 'platform admin required', actor }
    const { getPayload } = await import('payload')
    const payload = await getPayload({} as never)
    const result = await payload.find({
      collection: 'workspace-members',
      where: {
        and: [
          { workspace: { equals: resource.id } },
          { user: { equals: actor.betterAuthId } },
          { status: { equals: 'active' } },
        ],
      },
      limit: 1,
    })
    const role = (result.docs[0]?.role as string | undefined) ?? (result.docs.length > 0 ? 'member' : null)
    if (!role) return { allowed: false, reason: 'not a member of this workspace', actor }
    const allowedRoles = resource.roles ?? (verb === 'read' || verb === 'create' ? ['owner', 'admin', 'member'] : ['owner', 'admin'])
    return { allowed: allowedRoles.includes(role), reason: role, actor }
  }),
  memberWorkspaceIds: vi.fn(async (_scope: string, actorArg?: unknown) => {
    const session = await authApi.getSession()
    const actor = (actorArg as { betterAuthId: string } | undefined) ?? (session?.user ? { betterAuthId: session.user.id } : null)
    if (!actor) return []
    const { getPayload } = await import('payload')
    const payload = await getPayload({} as never)
    const result = await payload.find({
      collection: 'workspace-members',
      where: { user: { equals: actor.betterAuthId }, status: { equals: 'active' } },
      limit: 1000,
    })
    return [
      ...new Set(
        (result.docs as Array<{ workspace: string | { id: string } }>).map((m) =>
          String(typeof m.workspace === 'string' ? m.workspace : m.workspace.id),
        ),
      ),
    ]
  }),
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
  user: { id: 'user-1', payloadId: 'pl-1' },
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
    authApi.getSession.mockResolvedValue(null)

    const result = await createLaunch(validInput)

    expect(result).toEqual({ success: false, error: 'Unauthorized' })
  })

  it('should return error when user is not a workspace member', async () => {
    authApi.getSession.mockResolvedValue(mockSession)

    const mockPayload = {
      find: vi.fn().mockResolvedValue({ docs: [] }),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await createLaunch(validInput)

    expect(result).toEqual({ success: false, error: 'Not a member of this workspace' })
    // Membership is now resolved through the `@/lib/authz` `check()` layer
    // (mocked above) rather than a direct `payload.find` in this action — it
    // still queries `workspace-members` for this workspace/user under the hood.
    expect(mockPayload.find).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'workspace-members',
        where: expect.objectContaining({
          and: expect.arrayContaining([
            { workspace: { equals: 'workspace-1' } },
            { user: { equals: 'user-1' } },
            { status: { equals: 'active' } },
          ]),
        }),
      }),
    )
  })

  it('should return error when cloud account not found', async () => {
    authApi.getSession.mockResolvedValue(mockSession)

    const mockPayload = {
      find: vi.fn().mockResolvedValue({ docs: [{ id: 'membership-1' }] }),
      findByID: vi.fn().mockResolvedValue(null),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await createLaunch(validInput)

    expect(result).toEqual({ success: false, error: 'Cloud account not found' })
  })

  it('should return error when template not found', async () => {
    authApi.getSession.mockResolvedValue(mockSession)

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
    authApi.getSession.mockResolvedValue(mockSession)

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
        launchedBy: 'pl-1',
        approvalConfig: {
          required: true,
          approvers: ['user-2'],
          timeoutHours: 24,
        },
      }),
    })
  })

  it('should include appId when provided', async () => {
    authApi.getSession.mockResolvedValue(mockSession)

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
    authApi.getSession.mockResolvedValue(null)

    const result = await startLaunch('launch-1')

    expect(result).toEqual({ success: false, error: 'Unauthorized' })
  })

  it('should return error when launch not found', async () => {
    authApi.getSession.mockResolvedValue(mockSession)

    const mockPayload = {
      findByID: vi.fn().mockResolvedValue(null),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await startLaunch('nonexistent')

    expect(result).toEqual({ success: false, error: 'Launch not found' })
  })

  it('should call gRPC and update the launch record on success', async () => {
    authApi.getSession.mockResolvedValue(mockSession)

    const mockLaunch = {
      id: 'launch-1',
      workspace: 'workspace-1',
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
      find: vi.fn().mockResolvedValue({ docs: [{ id: 'member-1' }] }),
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
      undefined,
      'workspace-1',
      false,
      'user-1',
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

  it('auto-approves and writes approvedBy as the Payload id when the launcher is an approver', async () => {
    authApi.getSession.mockResolvedValue(mockSession)

    const mockLaunch = {
      id: 'launch-1',
      workspace: 'workspace-1',
      template: { id: 'template-1', slug: 's3-bucket' },
      cloudAccount: { id: 'cloud-1' },
      provider: 'aws',
      region: 'us-east-1',
      parameters: {},
      // approvers holds Payload ids — 'pl-1' matches mockSession's payloadId,
      // not its betterAuthId ('user-1'), so this only auto-approves if the
      // source compares against actor.payloadId.
      approvalConfig: { required: true, approvers: ['pl-1'] },
    }

    const mockPayload = {
      findByID: vi.fn().mockResolvedValue(mockLaunch),
      find: vi.fn().mockResolvedValue({ docs: [{ id: 'member-1' }] }),
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
      {},
      true,
      undefined,
      'workspace-1',
      true,
      'user-1',
    )
    expect(mockPayload.update).toHaveBeenCalledWith({
      collection: 'launches',
      id: 'launch-1',
      data: expect.objectContaining({
        workflowId: 'workflow-123',
        status: 'launching',
        approvedBy: 'pl-1',
      }),
    })
  })

  it('should update launch status to failed when gRPC call fails', async () => {
    authApi.getSession.mockResolvedValue(mockSession)

    const mockLaunch = {
      id: 'launch-1',
      workspace: 'workspace-1',
      template: { id: 'template-1', slug: 's3-bucket' },
      cloudAccount: { id: 'cloud-1' },
      provider: 'aws',
      region: 'us-east-1',
      parameters: {},
      approvalConfig: { required: false },
    }

    const mockPayload = {
      findByID: vi.fn().mockResolvedValue(mockLaunch),
      find: vi.fn().mockResolvedValue({ docs: [{ id: 'member-1' }] }),
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
    authApi.getSession.mockResolvedValue(mockSession)

    const mockLaunch = {
      id: 'launch-1',
      workspace: 'workspace-1',
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
      find: vi.fn().mockResolvedValue({ docs: [{ id: 'member-1' }] }),
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
      undefined,
      'workspace-1',
      false,
      'user-1',
    )
  })
})

describe('getLaunchStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return null when no session', async () => {
    authApi.getSession.mockResolvedValue(null)

    const result = await getLaunchStatus('launch-1')

    expect(result).toBeNull()
  })

  it('should return launch details', async () => {
    authApi.getSession.mockResolvedValue(mockSession)

    const mockLaunch = { id: 'launch-1', status: 'running', workspace: 'workspace-1' }
    const mockPayload = {
      findByID: vi.fn().mockResolvedValue(mockLaunch),
      find: vi.fn().mockResolvedValue({ docs: [{ id: 'member-1' }] }),
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
    authApi.getSession.mockResolvedValue(null)

    const result = await getLaunchWorkflowProgress('workflow-1')

    expect(result).toEqual({ success: false, error: 'Unauthorized' })
  })

  it('should return progress from gRPC client', async () => {
    authApi.getSession.mockResolvedValue(mockSession)
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
    authApi.getSession.mockResolvedValue(null)

    const result = await approveLaunchAction('workflow-1', true)

    expect(result).toEqual({ success: false, error: 'Unauthorized' })
  })

  it('should call gRPC approve with user ID and notes', async () => {
    authApi.getSession.mockResolvedValue(mockSession)
    vi.mocked(approveLaunch).mockResolvedValue({ success: true, error: '' } as any)

    const mockPayload = {
      find: vi.fn().mockImplementation(async (args: { collection: string }) => {
        if (args.collection === 'launches') {
          return { docs: [{ id: 'launch-1', workspace: 'workspace-1' }] }
        }
        return { docs: [{ id: 'membership-1', role: 'owner' }] }
      }),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await approveLaunchAction('workflow-1', true, 'Looks good')

    expect(result).toEqual({ success: true })
    expect(approveLaunch).toHaveBeenCalledWith('workflow-1', true, 'user-1', 'Looks good')
  })

  it('should deny when the actor cannot manage the launch workspace', async () => {
    authApi.getSession.mockResolvedValue(mockSession)

    const mockPayload = {
      find: vi.fn().mockImplementation(async (args: { collection: string }) => {
        if (args.collection === 'launches') {
          return { docs: [{ id: 'launch-1', workspace: 'workspace-1' }] }
        }
        return { docs: [] } // no membership → deny
      }),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await approveLaunchAction('workflow-1', true)

    expect(result).toEqual({ success: false, error: 'Not a member of this workspace' })
    expect(approveLaunch).not.toHaveBeenCalled()
  })

  it('should return Launch not found when no launch matches the workflow id', async () => {
    authApi.getSession.mockResolvedValue(mockSession)

    const mockPayload = {
      find: vi.fn().mockResolvedValue({ docs: [] }),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await approveLaunchAction('workflow-1', true)

    expect(result).toEqual({ success: false, error: 'Launch not found' })
  })
})

describe('deorbitLaunchAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return unauthorized when no session', async () => {
    authApi.getSession.mockResolvedValue(null)

    const result = await deorbitLaunchAction('workflow-1')

    expect(result).toEqual({ success: false, error: 'Unauthorized' })
  })

  it('should call gRPC deorbit with user ID and reason', async () => {
    authApi.getSession.mockResolvedValue(mockSession)
    vi.mocked(deorbitLaunch).mockResolvedValue({ success: true, error: '' } as any)

    const mockPayload = {
      find: vi.fn().mockImplementation(async (args: { collection: string }) => {
        if (args.collection === 'launches') {
          return { docs: [{ id: 'launch-1', workspace: 'workspace-1' }] }
        }
        return { docs: [{ id: 'membership-1', role: 'owner' }] }
      }),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await deorbitLaunchAction('workflow-1', 'No longer needed')

    expect(result).toEqual({ success: true })
    expect(deorbitLaunch).toHaveBeenCalledWith('workflow-1', 'user-1', 'No longer needed')
  })

  it('should deny when the actor cannot manage the launch workspace', async () => {
    authApi.getSession.mockResolvedValue(mockSession)

    const mockPayload = {
      find: vi.fn().mockImplementation(async (args: { collection: string }) => {
        if (args.collection === 'launches') {
          return { docs: [{ id: 'launch-1', workspace: 'workspace-1' }] }
        }
        return { docs: [] } // no membership → deny
      }),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await deorbitLaunchAction('workflow-1')

    expect(result).toEqual({ success: false, error: 'Not a member of this workspace' })
    expect(deorbitLaunch).not.toHaveBeenCalled()
  })
})

describe('abortLaunchAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return unauthorized when no session', async () => {
    authApi.getSession.mockResolvedValue(null)

    const result = await abortLaunchAction('workflow-1')

    expect(result).toEqual({ success: false, error: 'Unauthorized' })
  })

  it('should call gRPC abort with user ID (owner of the launch, no membership needed)', async () => {
    authApi.getSession.mockResolvedValue(mockSession)
    vi.mocked(abortLaunch).mockResolvedValue({ success: true, error: '' } as any)

    const mockPayload = {
      find: vi.fn().mockImplementation(async (args: { collection: string }) => {
        if (args.collection === 'launches') {
          return { docs: [{ id: 'launch-1', workspace: 'workspace-1', launchedBy: 'pl-1' }] }
        }
        return { docs: [] } // no membership row needed — actor is the launch owner
      }),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await abortLaunchAction('workflow-1')

    expect(result).toEqual({ success: true })
    expect(abortLaunch).toHaveBeenCalledWith('workflow-1', 'user-1')
  })

  it('should deny when the actor is neither the launch owner nor a workspace member', async () => {
    authApi.getSession.mockResolvedValue(mockSession)

    const mockPayload = {
      find: vi.fn().mockImplementation(async (args: { collection: string }) => {
        if (args.collection === 'launches') {
          return { docs: [{ id: 'launch-1', workspace: 'workspace-1', launchedBy: 'someone-else' }] }
        }
        return { docs: [] } // no membership → deny
      }),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await abortLaunchAction('workflow-1')

    expect(result).toEqual({ success: false, error: 'Not a member of this workspace' })
    expect(abortLaunch).not.toHaveBeenCalled()
  })
})

describe('getLaunchTemplates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return unauthorized when no session', async () => {
    authApi.getSession.mockResolvedValue(null)

    const result = await getLaunchTemplates()

    expect(result).toEqual({ success: false, error: 'Unauthorized', docs: [] })
  })

  it('should return all templates when no provider filter', async () => {
    authApi.getSession.mockResolvedValue(mockSession)

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
    authApi.getSession.mockResolvedValue(mockSession)

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
    authApi.getSession.mockResolvedValue(null)

    const result = await getCloudAccounts('workspace-1')

    expect(result).toEqual({ success: false, error: 'Unauthorized', docs: [] })
  })

  it('should filter by workspace and connected status', async () => {
    authApi.getSession.mockResolvedValue(mockSession)

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
    authApi.getSession.mockResolvedValue(null)

    const result = await getLaunches('workspace-1')

    expect(result).toEqual({ success: false, error: 'Unauthorized', docs: [] })
  })

  it('should return launches for workspace', async () => {
    authApi.getSession.mockResolvedValue(mockSession)

    const mockLaunches = [{ id: 'l1', status: 'running' }]
    const mockPayload = {
      find: vi.fn()
        .mockResolvedValueOnce({ docs: [{ id: 'member-1' }] }) // membership check
        .mockResolvedValueOnce({ docs: mockLaunches }), // launches query
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await getLaunches('workspace-1')

    expect(result).toEqual({ success: true, docs: mockLaunches })
    expect(mockPayload.find).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'launches',
        where: { workspace: { equals: 'workspace-1' } },
        depth: 2,
        sort: '-updatedAt',
        limit: 100,
        overrideAccess: true,
      }),
    )
  })
})

describe('getAllUserLaunches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return unauthorized when no session', async () => {
    authApi.getSession.mockResolvedValue(null)

    const result = await getAllUserLaunches()

    expect(result).toEqual({ success: false, error: 'Unauthorized', docs: [] })
  })

  it('should return empty docs when user has no workspace memberships', async () => {
    authApi.getSession.mockResolvedValue(mockSession)

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
    authApi.getSession.mockResolvedValue(mockSession)

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
