import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('payload', () => ({ getPayload: vi.fn() }))
vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('@/lib/authz', () => ({
  getActor: vi.fn(async () => ({ payloadId: 'u1', betterAuthId: 'u1', user: { id: 'u1' } })),
  check: vi.fn(async () => ({ allowed: true })),
  memberWorkspaceIds: vi.fn(async () => []),
}))
vi.mock('@/lib/clients/deployment-client', () => ({
  startDeploymentWorkflow: vi.fn(),
  getDeploymentProgress: vi.fn(),
}))
vi.mock('@/lib/encryption', () => ({ encrypt: vi.fn(), decrypt: vi.fn() }))
vi.mock('@octokit/rest', () => ({ Octokit: vi.fn() }))
vi.mock('@/lib/temporal/client', () => ({ getTemporalClient: vi.fn() }))
vi.mock('next/headers', () => ({ headers: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { getPayload } from 'payload'
import { createDeployment, startDeployment, startDeployToLaunch } from './deployments'
import { instantiateTemplate, startInstantiation, getInstantiationProgress } from './templates'
import { exportPlatformChargebackCSV } from '../(frontend)/platform/kafka/billing/actions'
import { analyzeRepository } from './builds'
import { registerSchema } from '../(frontend)/workspaces/[slug]/kafka/actions'

describe('hidden preview features refuse to run server actions', () => {
  beforeEach(() => {
    vi.stubEnv('ORBIT_ENABLE_PREVIEW_FEATURES', '')
    vi.stubEnv('NEXT_PUBLIC_ORBIT_ENABLE_PREVIEW_FEATURES', '')
    vi.mocked(getPayload).mockClear()
  })
  afterEach(() => vi.unstubAllEnvs())

  it('deployments', async () => {
    const created = await createDeployment({
      appId: 'a',
      name: 'n',
      generator: 'helm',
      config: {},
      target: { type: 'kubernetes' },
    })
    expect(created.success).toBe(false)
    expect(await startDeployment('d')).toMatchObject({ success: false })
    expect(getPayload).not.toHaveBeenCalled()
  })

  it('deploy to launch', async () => {
    const res = await startDeployToLaunch('d')
    expect(res).toMatchObject({ success: false, error: expect.stringContaining('not available') })
    expect(getPayload).not.toHaveBeenCalled()
  })

  it('legacy template instantiate + progress', async () => {
    expect(
      await instantiateTemplate({ templateId: 't', workspaceId: 'w', variables: {} } as never),
    ).toMatchObject({ success: false })
    expect(
      await startInstantiation({ templateId: 't', workspaceId: 'w', targetOrg: 'o', variables: {} } as never),
    ).toMatchObject({ success: false })
    expect(await getInstantiationProgress('wf-1-abc')).toMatchObject({
      error: expect.stringContaining('not available'),
    })
    expect(getPayload).not.toHaveBeenCalled()
  })

  it('kafka schema registration', async () => {
    const res = await registerSchema({ topicId: 't', type: 'value', format: 'avro', content: '{}' } as never)
    expect(res).toMatchObject({ success: false, error: expect.stringContaining('not available') })
    expect(getPayload).not.toHaveBeenCalled()
  })

  it('kafka chargeback export', async () => {
    await expect(exportPlatformChargebackCSV(new Date(), new Date())).rejects.toThrow(
      /not available/,
    )
  })

  it('deployments run again once enabled', async () => {
    vi.stubEnv('ORBIT_ENABLE_PREVIEW_FEATURES', 'deployments')
    vi.mocked(getPayload).mockResolvedValue({
      findByID: vi.fn().mockResolvedValue(null),
    } as never)
    expect(await startDeployment('d')).toMatchObject({ success: false, error: 'Deployment not found' })
  })

  it('analyzeRepository no longer fabricates detection results', async () => {
    vi.mocked(getPayload).mockResolvedValue({
      findByID: vi.fn().mockResolvedValue({ repository: { url: 'https://github.com/o/r' } }),
    } as never)
    expect(await analyzeRepository('app1')).toEqual({
      success: false,
      error: 'Repository analysis is not available yet.',
    })
  })
})
