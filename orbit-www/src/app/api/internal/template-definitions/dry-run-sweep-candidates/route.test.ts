import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('payload', () => ({ getPayload: vi.fn() }))
vi.mock('@payload-config', () => ({ default: {} }))

process.env.ORBIT_INTERNAL_API_KEY = 'test-internal-key'

import type { BasePayload } from 'payload'
import { getPayload } from 'payload'
import { GET } from './route'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function req(apiKey: string | null = 'test-internal-key'): any {
  const headers = new Headers()
  if (apiKey !== null) headers.set('X-API-Key', apiKey)
  return { headers }
}

describe('GET /api/internal/template-definitions/dry-run-sweep-candidates', () => {
  const mockPayload = { find: vi.fn() }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getPayload).mockResolvedValue(mockPayload as unknown as BasePayload)
  })

  it('rejects a missing/invalid API key with 401', async () => {
    const res = await GET(req('wrong'))
    expect(res.status).toBe(401)
    expect(mockPayload.find).not.toHaveBeenCalled()
  })

  it('queries published definitions with a non-null currentVersion at depth 0', async () => {
    mockPayload.find.mockResolvedValueOnce({ docs: [] })
    await GET(req())
    expect(mockPayload.find).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'template-definitions',
        depth: 0,
        overrideAccess: true,
        limit: 0,
        where: {
          and: [{ status: { equals: 'published' } }, { currentVersion: { exists: true } }],
        },
      }),
    )
  })

  it('returns the flattened candidate shape, including definitions with no fixtures', async () => {
    mockPayload.find.mockResolvedValueOnce({
      docs: [
        {
          id: 'def-1',
          name: 'Service Template',
          workspace: { id: 'ws-1', name: 'Acme' },
          currentVersion: { id: 'ver-1' },
          fixtures: [{ id: 'fix-1', name: 'Basic', values: { name: 'orders' } }],
        },
        {
          id: 'def-2',
          name: 'No Fixtures Template',
          workspace: 'ws-2',
          currentVersion: 'ver-2',
          fixtures: null,
        },
      ],
    })
    const res = await GET(req())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({
      templates: [
        {
          id: 'def-1',
          name: 'Service Template',
          workspaceId: 'ws-1',
          currentVersionId: 'ver-1',
          fixtures: [{ id: 'fix-1', name: 'Basic', values: { name: 'orders' } }],
        },
        {
          id: 'def-2',
          name: 'No Fixtures Template',
          workspaceId: 'ws-2',
          currentVersionId: 'ver-2',
          fixtures: [],
        },
      ],
    })
  })

  it('500s on an unrelated error', async () => {
    mockPayload.find.mockRejectedValueOnce(new Error('boom'))
    const res = await GET(req())
    expect(res.status).toBe(500)
  })
})
