import { describe, it, expect, vi, beforeEach } from 'vitest'

// collections/Apps.ts may pull in the encryption module, which requires a
// 32-byte base64 key at import time. Hoisted so it is set before any import.
vi.hoisted(() => {
  process.env.ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString('base64')
})

const octokitRequest = vi.fn()
const getInstallationOctokit = vi.fn(async () => ({ request: octokitRequest }))

vi.mock('../../lib/github/octokit', () => ({ getInstallationOctokit: (...a: unknown[]) => getInstallationOctokit(...(a as [])) }))
vi.mock('../../lib/app-manifest', () => ({ serializeAppManifest: () => 'yaml' }))
vi.mock('../../lib/github-manifest', () => ({
  parseGitHubUrl: () => ({ owner: 'acme', repo: 'repo' }),
}))
vi.mock('@/lib/grpc/health-client', () => ({
  healthClient: { deleteSchedule: vi.fn().mockResolvedValue({}), upsertSchedule: vi.fn() },
}))
vi.mock('@/lib/catalog/projection', () => ({
  projectAppEntity: vi.fn(),
  removeProjectedEntity: vi.fn(),
}))
vi.mock('payload', () => ({ getPayload: vi.fn(async () => ({ update: vi.fn().mockResolvedValue({}) })) }))
vi.mock('@payload-config', () => ({ default: {} }))

import { Apps } from '../Apps'

const PAYLOAD_ID = 'a1b2c3d4e5f6a1b2c3d4e5f6'

const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0))
}

function reqWith(installationDocs: unknown[]) {
  const find = vi.fn().mockResolvedValue({ docs: installationDocs })
  return { req: { payload: { find } }, find }
}

const baseDoc = {
  id: 'app-1',
  name: 'new-name',
  workspace: 'ws-1',
  syncEnabled: true,
  webhookId: '777',
  repository: { url: 'https://github.com/acme/repo', installationId: PAYLOAD_ID, branch: 'main' },
}

describe('Apps hooks only act through installations granted to the app workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    octokitRequest.mockImplementation(async (route: string) => {
      if (route.startsWith('PUT')) return { data: { commit: { sha: 'sha1' } } }
      if (route.startsWith('GET')) throw new Error('404')
      return { data: {} }
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  const outbound = () => Apps.hooks!.afterChange![1] as any
  const afterDelete = () => Apps.hooks!.afterDelete![0] as any

  it('outbound manifest sync writes via the numeric id of a granted installation', async () => {
    const { req, find } = reqWith([{ id: PAYLOAD_ID, installationId: 4242, allowedWorkspaces: ['ws-1'] }])
    await outbound()({ doc: baseDoc, previousDoc: { ...baseDoc, name: 'old' }, context: {}, req })
    await flush()

    expect(JSON.stringify(find.mock.calls[0][0].where)).toContain('"allowedWorkspaces":{"contains":"ws-1"}')
    expect(getInstallationOctokit).toHaveBeenCalledWith(4242)
    expect(octokitRequest.mock.calls.some((c) => String(c[0]).startsWith('PUT'))).toBe(true)
  })

  it('outbound manifest sync skips (with a warning) when the installation is not granted', async () => {
    const { req } = reqWith([])
    await outbound()({ doc: baseDoc, previousDoc: { ...baseDoc, name: 'old' }, context: {}, req })
    await flush()

    expect(getInstallationOctokit).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalled()
  })

  it('webhook cleanup on delete uses the numeric id of a granted installation', async () => {
    const { req } = reqWith([{ id: PAYLOAD_ID, installationId: 4242, allowedWorkspaces: ['ws-1'] }])
    await afterDelete()({ doc: baseDoc, req })
    await flush()

    expect(getInstallationOctokit).toHaveBeenCalledWith(4242)
    expect(octokitRequest).toHaveBeenCalledWith('DELETE /repos/{owner}/{repo}/hooks/{hook_id}', expect.anything())
  })

  it('webhook cleanup on delete skips (with a warning) when the installation is not granted', async () => {
    const { req } = reqWith([])
    await afterDelete()({ doc: baseDoc, req })
    await flush()

    expect(getInstallationOctokit).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalled()
  })
})
