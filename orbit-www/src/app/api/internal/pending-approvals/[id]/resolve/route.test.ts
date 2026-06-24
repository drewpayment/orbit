/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('payload', () => ({
  getPayload: vi.fn(),
}))

vi.mock('@payload-config', () => ({
  default: {},
}))

vi.stubEnv('ORBIT_INTERNAL_API_KEY', 'test-api-key')

import type { NextRequest } from 'next/server'
import { getPayload } from 'payload'
const { POST } = await import('./route')

const makeContext = (id: string) => ({ params: Promise.resolve({ id }) })

const makeRequest = (id: string, body: unknown, apiKey: string | null = 'test-api-key') =>
  new Request(`http://localhost/api/internal/pending-approvals/${id}/resolve`, {
    method: 'POST',
    headers: apiKey ? { 'X-API-Key': apiKey } : {},
    body: JSON.stringify(body),
  }) as unknown as NextRequest

describe('POST /api/internal/pending-approvals/[id]/resolve', () => {
  const mockPayload = {
    findByID: vi.fn(),
    update: vi.fn(),
  }

  const baseRow = {
    id: 'pa-1',
    workspace: 'ws-1',
    status: 'pending' as const,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getPayload).mockResolvedValue(mockPayload)
    mockPayload.update.mockImplementation(async ({ data }: any) => ({
      id: 'pa-1',
      status: data.status,
    }))
  })

  it('returns 401 without API key', async () => {
    const res = await POST(makeRequest('pa-1', { status: 'resolved' }, null), makeContext('pa-1'))
    expect(res.status).toBe(401)
  })

  it('returns 409 and changes nothing when workspaceId does not match', async () => {
    mockPayload.findByID.mockResolvedValue(baseRow)

    const res = await POST(
      makeRequest('pa-1', { status: 'resolved', resolution: 'approved', workspaceId: 'ws-OTHER' }),
      makeContext('pa-1'),
    )

    expect(res.status).toBe(409)
    expect(mockPayload.update).not.toHaveBeenCalled()
  })

  it('proceeds when workspaceId matches', async () => {
    mockPayload.findByID.mockResolvedValue(baseRow)

    const res = await POST(
      makeRequest('pa-1', { status: 'resolved', resolution: 'approved', workspaceId: 'ws-1' }),
      makeContext('pa-1'),
    )

    expect(res.status).toBe(200)
    expect(mockPayload.update).toHaveBeenCalled()
  })

  it('proceeds and warns when workspaceId is absent (backward compatible)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockPayload.findByID.mockResolvedValue(baseRow)

    const res = await POST(
      makeRequest('pa-1', { status: 'resolved', resolution: 'approved' }),
      makeContext('pa-1'),
    )

    expect(res.status).toBe(200)
    expect(mockPayload.update).toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('normalizes a populated workspace relationship object for the cross-check', async () => {
    mockPayload.findByID.mockResolvedValue({ ...baseRow, workspace: { id: 'ws-1' } })

    const res = await POST(
      makeRequest('pa-1', { status: 'resolved', resolution: 'approved', workspaceId: 'ws-1' }),
      makeContext('pa-1'),
    )
    expect(res.status).toBe(200)
  })
})
