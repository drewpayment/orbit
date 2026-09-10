import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('payload', () => ({ getPayload: vi.fn() }))
vi.mock('@payload-config', () => ({ default: {} }))

process.env.ORBIT_INTERNAL_API_KEY = 'test-internal-key'

import type { BasePayload } from 'payload'
import { getPayload } from 'payload'
import { POST } from './route'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function req(body: unknown, apiKey: string | null = 'test-internal-key'): any {
  const headers = new Headers()
  if (apiKey !== null) headers.set('X-API-Key', apiKey)
  return {
    headers,
    json: async () => body,
  }
}

describe('POST /api/internal/action-runs/[id]/status', () => {
  const mockPayload = {
    findByID: vi.fn(),
    update: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getPayload).mockResolvedValue(mockPayload as unknown as BasePayload)
  })

  it('rejects a missing/invalid API key with 401', async () => {
    const res = await POST(req({ status: 'running' }, 'wrong'), { params: Promise.resolve({ id: 'run1' }) })
    expect(res.status).toBe(401)
    expect(mockPayload.findByID).not.toHaveBeenCalled()
  })

  it('404s when the run is not found', async () => {
    mockPayload.findByID.mockRejectedValueOnce(new Error('not found'))
    const res = await POST(req({ status: 'running' }), { params: Promise.resolve({ id: 'missing' }) })
    expect(res.status).toBe(404)
  })

  it('accepts steps and replaces (does not append) the steps array', async () => {
    mockPayload.findByID.mockResolvedValueOnce({ id: 'run1', logs: [] })
    mockPayload.update.mockResolvedValueOnce({ id: 'run1', status: 'running' })

    const steps = [
      { id: 'repo', name: 'Create repo', status: 'succeeded' },
      { id: 'render', name: 'Render', status: 'running' },
    ]
    const res = await POST(req({ steps }), { params: Promise.resolve({ id: 'run1' }) })

    expect(res.status).toBe(200)
    expect(mockPayload.update).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'action-runs',
        id: 'run1',
        data: expect.objectContaining({ steps }),
        overrideAccess: true,
      }),
    )
  })

  it('accepts a plan payload', async () => {
    mockPayload.findByID.mockResolvedValueOnce({ id: 'run1', logs: [] })
    mockPayload.update.mockResolvedValueOnce({ id: 'run1', status: 'running' })

    const plan = [{ kind: 'repo', name: 'my-service', description: 'Create GitHub repo' }]
    const res = await POST(req({ plan }), { params: Promise.resolve({ id: 'run1' }) })

    expect(res.status).toBe(200)
    expect(mockPayload.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ plan }),
      }),
    )
  })

  it('accepts the cancelled status', async () => {
    mockPayload.findByID.mockResolvedValueOnce({ id: 'run1', logs: [] })
    mockPayload.update.mockResolvedValueOnce({ id: 'run1', status: 'cancelled' })

    const res = await POST(req({ status: 'cancelled' }), { params: Promise.resolve({ id: 'run1' }) })
    expect(res.status).toBe(200)
    expect(mockPayload.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'cancelled' }) }),
    )
  })

  it('still appends (not replaces) logs', async () => {
    mockPayload.findByID.mockResolvedValueOnce({
      id: 'run1',
      logs: [{ ts: '2024-01-01T00:00:00.000Z', level: 'info', message: 'existing' }],
    })
    mockPayload.update.mockResolvedValueOnce({ id: 'run1', status: 'running' })

    const res = await POST(
      req({ appendLogs: [{ message: 'new line' }] }),
      { params: Promise.resolve({ id: 'run1' }) },
    )
    expect(res.status).toBe(200)
    const call = mockPayload.update.mock.calls[0][0]
    expect(call.data.logs).toHaveLength(2)
    expect(call.data.logs[1].message).toBe('new line')
  })

  it('400s when nothing to update', async () => {
    mockPayload.findByID.mockResolvedValueOnce({ id: 'run1', logs: [] })
    const res = await POST(req({}), { params: Promise.resolve({ id: 'run1' }) })
    expect(res.status).toBe(400)
    expect(mockPayload.update).not.toHaveBeenCalled()
  })
})
