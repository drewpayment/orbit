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

describe('GET /api/internal/template-definitions/[id]', () => {
  const mockPayload = { findByID: vi.fn() }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getPayload).mockResolvedValue(mockPayload as unknown as BasePayload)
  })

  it('rejects a missing/invalid API key with 401', async () => {
    const res = await GET(req('wrong'), { params: Promise.resolve({ id: 'def-1' }) })
    expect(res.status).toBe(401)
    expect(mockPayload.findByID).not.toHaveBeenCalled()
  })

  it('404s when the definition is not found', async () => {
    mockPayload.findByID.mockRejectedValueOnce(new Error('not found'))
    const res = await GET(req(), { params: Promise.resolve({ id: 'missing' }) })
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json).toEqual({ error: 'template definition not found' })
  })

  it('500s on an unrelated error', async () => {
    mockPayload.findByID.mockRejectedValueOnce(new Error('boom'))
    const res = await GET(req(), { params: Promise.resolve({ id: 'def-1' }) })
    expect(res.status).toBe(500)
  })

  it('calls findByID with depth: 0 and overrideAccess: true', async () => {
    mockPayload.findByID.mockResolvedValueOnce({
      id: 'def-1',
      workspace: 'ws-1',
      status: 'published',
      currentVersion: 'v-3',
      name: 'Service Template',
    })
    await GET(req(), { params: Promise.resolve({ id: 'def-1' }) })
    expect(mockPayload.findByID).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'template-definitions',
        id: 'def-1',
        depth: 0,
        overrideAccess: true,
      }),
    )
  })

  it('returns the definition shape on success', async () => {
    mockPayload.findByID.mockResolvedValueOnce({
      id: 'def-1',
      workspace: 'ws-1',
      status: 'published',
      currentVersion: 'v-3',
      name: 'Service Template',
    })
    const res = await GET(req(), { params: Promise.resolve({ id: 'def-1' }) })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({
      definition: {
        id: 'def-1',
        workspace: 'ws-1',
        status: 'published',
        currentVersion: 'v-3',
        name: 'Service Template',
      },
    })
  })

  it('flattens relationship fields to string ids even when Payload returns populated objects', async () => {
    mockPayload.findByID.mockResolvedValueOnce({
      id: 'def-1',
      workspace: { id: 'ws-1', name: 'Some Workspace' },
      status: 'published',
      currentVersion: { id: 'v-3', versionNumber: 3 },
      name: 'Service Template',
    })
    const res = await GET(req(), { params: Promise.resolve({ id: 'def-1' }) })
    const json = await res.json()
    expect(json.definition.workspace).toBe('ws-1')
    expect(json.definition.currentVersion).toBe('v-3')
  })

  it('reports an empty currentVersion as an empty string, not undefined', async () => {
    mockPayload.findByID.mockResolvedValueOnce({
      id: 'def-1',
      workspace: 'ws-1',
      status: 'draft',
      currentVersion: null,
      name: 'Draft Template',
    })
    const res = await GET(req(), { params: Promise.resolve({ id: 'def-1' }) })
    const json = await res.json()
    expect(json.definition.currentVersion).toBe('')
    expect(json.definition.status).toBe('draft')
  })
})
