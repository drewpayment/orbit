/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@payload-config', () => ({ default: {} }))

const find = vi.fn()
const findByID = vi.fn()
vi.mock('payload', () => ({ getPayload: vi.fn(async () => ({ find, findByID })) }))

import { resolveOwningWorkspace, virtualClusterWorkspace } from './object-workspace'

const LAUNCH = 'idp.launch.v1.LaunchService'
const DEPLOYMENT = 'idp.deployment.v1.DeploymentService'

describe('resolveOwningWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(['GetLaunchProgress', 'ApproveLaunch', 'DeorbitLaunch', 'AbortLaunch'])(
    '%s resolves the launch workspace from its workflow id',
    async (method) => {
      find.mockResolvedValue({ docs: [{ workspace: 'ws-1' }] })

      const ws = await resolveOwningWorkspace(LAUNCH, method, { workflowId: 'launch-abc-1' })

      expect(ws).toBe('ws-1')
      expect(find).toHaveBeenCalledWith(
        expect.objectContaining({
          collection: 'launches',
          where: { workflowId: { equals: 'launch-abc-1' } },
          overrideAccess: true,
        }),
      )
    },
  )

  it('accepts a populated workspace relationship', async () => {
    find.mockResolvedValue({ docs: [{ workspace: { id: 'ws-2', name: 'x' } }] })
    expect(await resolveOwningWorkspace(LAUNCH, 'AbortLaunch', { workflowId: 'launch-abc-1' })).toBe('ws-2')
  })

  it('DeployToLaunch resolves the workspace from the launch id', async () => {
    findByID.mockResolvedValue({ workspace: 'ws-3' })

    expect(await resolveOwningWorkspace(LAUNCH, 'DeployToLaunch', { launchId: 'l-1' })).toBe('ws-3')
    expect(findByID).toHaveBeenCalledWith(expect.objectContaining({ collection: 'launches', id: 'l-1' }))
  })

  it('DeployToLaunch yields null for an unknown launch', async () => {
    findByID.mockRejectedValue(new Error('Not Found'))
    expect(await resolveOwningWorkspace(LAUNCH, 'DeployToLaunch', { launchId: 'nope' })).toBeNull()
  })

  it('GetDeploymentProgress resolves through the deployment app', async () => {
    find.mockResolvedValue({ docs: [{ app: { id: 'app-1', workspace: 'ws-4' } }] })

    expect(await resolveOwningWorkspace(DEPLOYMENT, 'GetDeploymentProgress', { workflowId: 'deployment-d1' })).toBe('ws-4')
    expect(find).toHaveBeenCalledWith(expect.objectContaining({ collection: 'deployments', depth: 1 }))
  })

  it('yields null when no document matches the workflow id', async () => {
    find.mockResolvedValue({ docs: [] })
    expect(await resolveOwningWorkspace(LAUNCH, 'AbortLaunch', { workflowId: 'launch-zzz' })).toBeNull()
  })

  it('yields null without querying for an empty id', async () => {
    expect(await resolveOwningWorkspace(LAUNCH, 'AbortLaunch', { workflowId: '' })).toBeNull()
    expect(find).not.toHaveBeenCalled()
  })

  it('does not resolve RPCs it does not know', async () => {
    expect(await resolveOwningWorkspace(LAUNCH, 'StartLaunch', { workspaceId: 'ws-1' })).toBeNull()
    expect(await resolveOwningWorkspace(undefined, undefined, {})).toBeNull()
    expect(find).not.toHaveBeenCalled()
  })
})

describe('virtualClusterWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('prefers the cluster workspace', async () => {
    findByID.mockResolvedValue({ workspace: 'ws-1', application: { workspace: 'ws-legacy' } })
    expect(await virtualClusterWorkspace('vc-1')).toBe('ws-1')
  })

  it('falls back to the legacy parent application workspace', async () => {
    findByID.mockResolvedValue({ workspace: null, application: { id: 'a', workspace: 'ws-legacy' } })
    expect(await virtualClusterWorkspace('vc-1')).toBe('ws-legacy')
  })

  it('yields null for an unknown or unowned cluster', async () => {
    findByID.mockRejectedValue(new Error('Not Found'))
    expect(await virtualClusterWorkspace('vc-gone')).toBeNull()
    findByID.mockResolvedValue({ workspace: null, application: null })
    expect(await virtualClusterWorkspace('vc-orphan')).toBeNull()
    expect(await virtualClusterWorkspace('')).toBeNull()
  })
})
