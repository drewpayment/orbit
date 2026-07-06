import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('payload', () => ({ getPayload: vi.fn() }))
vi.mock('@payload-config', () => ({ default: {} }))

// validateInternalApiKey reads ORBIT_INTERNAL_API_KEY; set it so a matching
// X-API-Key passes and a wrong one fails.
process.env.ORBIT_INTERNAL_API_KEY = 'test-internal-key'

import type { BasePayload } from 'payload'
import { getPayload } from 'payload'
import { POST } from './route'

function req(body: unknown, apiKey: string | null = 'test-internal-key'): any {
  const headers = new Headers()
  if (apiKey !== null) headers.set('X-API-Key', apiKey)
  return {
    headers,
    json: async () => body,
  }
}

describe('POST /api/internal/agent-events', () => {
  const mockPayload = {
    find: vi.fn(),
    create: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getPayload).mockResolvedValue(mockPayload as unknown as BasePayload)
  })

  it('rejects a missing/invalid API key with 401', async () => {
    const res = await POST(req({ workflowId: 'w', workspaceId: 'ws', events: [] }, 'wrong'))
    expect(res.status).toBe(401)
    expect(mockPayload.find).not.toHaveBeenCalled()
  })

  it('404s when the run is not found', async () => {
    mockPayload.find.mockResolvedValueOnce({ docs: [] }) // agent-runs lookup
    const res = await POST(req({ workflowId: 'missing', workspaceId: 'ws', events: [] }))
    expect(res.status).toBe(404)
  })

  it('409s when the run workspace does not match', async () => {
    mockPayload.find.mockResolvedValueOnce({ docs: [{ id: 'run1', workspace: 'ws-other' }] })
    const res = await POST(req({ workflowId: 'w1', workspaceId: 'ws-mine', events: [] }))
    expect(res.status).toBe(409)
    expect(mockPayload.create).not.toHaveBeenCalled()
  })

  it('creates new events and skips already-persisted sequences (idempotent)', async () => {
    // run lookup
    mockPayload.find.mockResolvedValueOnce({ docs: [{ id: 'run1', workspace: 'ws1' }] })
    // existing-sequence lookup: sequence 1 already present, 2 absent
    mockPayload.find.mockResolvedValueOnce({ docs: [{ sequence: 1 }] })

    mockPayload.create.mockResolvedValue({ id: 'evt' })

    const res = await POST(
      req({
        workflowId: 'w1',
        workspaceId: 'ws1',
        events: [
          { sequence: 1, kind: 'conversation_turn', payload: { turnId: 't1' }, emittedAt: '2024-01-01T00:00:00.000Z' },
          { sequence: 2, kind: 'status_update', payload: { status: 'running' }, emittedAt: '2024-01-01T00:00:01.000Z' },
        ],
      }),
    )

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.created).toBe(1)
    expect(json.skipped).toBe(1)
    // Only sequence 2 is created.
    expect(mockPayload.create).toHaveBeenCalledTimes(1)
    expect(mockPayload.create).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'agent-events',
        data: expect.objectContaining({ workflowId: 'w1', workspace: 'ws1', run: 'run1', sequence: 2 }),
      }),
    )
  })

  it('treats a duplicate-key create race as a skip, not a 500', async () => {
    mockPayload.find.mockResolvedValueOnce({ docs: [{ id: 'run1', workspace: 'ws1' }] })
    mockPayload.find.mockResolvedValueOnce({ docs: [] }) // nothing pre-existing
    mockPayload.create.mockRejectedValueOnce(new Error('E11000 duplicate key error'))

    const res = await POST(
      req({
        workflowId: 'w1',
        workspaceId: 'ws1',
        events: [
          { sequence: 5, kind: 'status_update', payload: { status: 'running' }, emittedAt: '2024-01-01T00:00:00.000Z' },
        ],
      }),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.created).toBe(0)
    expect(json.skipped).toBe(1)
  })

  it('400s on a malformed body', async () => {
    mockPayload.find.mockResolvedValueOnce({ docs: [{ id: 'run1', workspace: 'ws1' }] })
    const res = await POST(req({ workflowId: 'w1', workspaceId: 'ws1', events: 'not-an-array' }))
    expect(res.status).toBe(400)
  })
})
