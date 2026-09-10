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
  return { headers, json: async () => body }
}

describe('POST /api/internal/template-definitions/[id]/dry-run-sweep-result', () => {
  const mockPayload = { findByID: vi.fn(), update: vi.fn() }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getPayload).mockResolvedValue(mockPayload as unknown as BasePayload)
    mockPayload.update.mockResolvedValue({})
  })

  it('rejects a missing/invalid API key with 401', async () => {
    const res = await POST(req({ failed: false, planHash: 'abc' }, 'wrong'), {
      params: Promise.resolve({ id: 'def-1' }),
    })
    expect(res.status).toBe(401)
    expect(mockPayload.findByID).not.toHaveBeenCalled()
  })

  it('404s when the definition is not found', async () => {
    mockPayload.findByID.mockRejectedValueOnce(new Error('not found'))
    const res = await POST(req({ failed: false, planHash: 'abc' }), {
      params: Promise.resolve({ id: 'missing' }),
    })
    expect(res.status).toBe(404)
  })

  it('400s on a non-boolean failed field', async () => {
    const res = await POST(req({ failed: 'nope', planHash: 'abc' }), {
      params: Promise.resolve({ id: 'def-1' }),
    })
    expect(res.status).toBe(400)
    expect(mockPayload.findByID).not.toHaveBeenCalled()
  })

  it('a failed run sets status=failed and preserves the existing planHash', async () => {
    mockPayload.findByID.mockResolvedValueOnce({ id: 'def-1', lastDryRunPlanHash: 'old-hash' })
    const res = await POST(req({ failed: true, planHash: 'new-hash' }), {
      params: Promise.resolve({ id: 'def-1' }),
    })
    expect(res.status).toBe(200)
    expect(mockPayload.update).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'template-definitions',
        id: 'def-1',
        data: expect.objectContaining({
          lastDryRunStatus: 'failed',
          lastDryRunPlanHash: 'old-hash',
          lastDryRunAt: expect.any(String),
        }),
        overrideAccess: true,
      }),
    )
    const json = await res.json()
    expect(json).toEqual({ status: 'failed' })
  })

  it('a succeeded run with no prior hash is ok (nothing to compare against yet)', async () => {
    mockPayload.findByID.mockResolvedValueOnce({ id: 'def-1', lastDryRunPlanHash: null })
    const res = await POST(req({ failed: false, planHash: 'hash-1' }), {
      params: Promise.resolve({ id: 'def-1' }),
    })
    const json = await res.json()
    expect(json).toEqual({ status: 'ok' })
    expect(mockPayload.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastDryRunStatus: 'ok', lastDryRunPlanHash: 'hash-1' }),
      }),
    )
  })

  it('a succeeded run with an unchanged hash stays ok', async () => {
    mockPayload.findByID.mockResolvedValueOnce({ id: 'def-1', lastDryRunPlanHash: 'hash-1' })
    const res = await POST(req({ failed: false, planHash: 'hash-1' }), {
      params: Promise.resolve({ id: 'def-1' }),
    })
    const json = await res.json()
    expect(json).toEqual({ status: 'ok' })
  })

  it('a succeeded run with a changed hash is drifted', async () => {
    mockPayload.findByID.mockResolvedValueOnce({ id: 'def-1', lastDryRunPlanHash: 'hash-1' })
    const res = await POST(req({ failed: false, planHash: 'hash-2' }), {
      params: Promise.resolve({ id: 'def-1' }),
    })
    const json = await res.json()
    expect(json).toEqual({ status: 'drifted' })
    expect(mockPayload.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastDryRunStatus: 'drifted', lastDryRunPlanHash: 'hash-2' }),
      }),
    )
  })
})
