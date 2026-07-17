/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('payload', () => ({ getPayload: vi.fn() }))
vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('@/lib/auth/internal-api-auth', () => ({ validateInternalApiKey: vi.fn(() => null) }))
vi.mock('@/lib/scorecards/snapshots', () => ({ captureScoreSnapshots: vi.fn() }))

import { getPayload } from 'payload'
import { captureScoreSnapshots } from '@/lib/scorecards/snapshots'
import { POST } from './route'

function request(body: unknown) {
  return new Request('http://localhost/api/internal/scorecards/capture-snapshots', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getPayload as Mock).mockResolvedValue({})
  ;(captureScoreSnapshots as Mock).mockResolvedValue({ skipped: false, rowsWritten: 2 })
})

describe('POST capture snapshots', () => {
  it('validates and forwards the stable capture key', async () => {
    const response = await POST(
      request({ workspaceId: 'ws1', force: true, captureKey: 'workflow-1:ws1' }) as never,
    )

    expect(response.status).toBe(200)
    expect(captureScoreSnapshots).toHaveBeenCalledWith({}, 'ws1', {
      force: true,
      captureKey: 'workflow-1:ws1',
    })
  })

  it('rejects an empty capture key when one is supplied', async () => {
    const response = await POST(
      request({ workspaceId: 'ws1', force: true, captureKey: '   ' }) as never,
    )

    expect(response.status).toBe(400)
    expect(captureScoreSnapshots).not.toHaveBeenCalled()
  })
})
