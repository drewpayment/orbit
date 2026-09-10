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

describe('GET /api/internal/template-definition-versions/[id]', () => {
  const mockPayload = { findByID: vi.fn() }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getPayload).mockResolvedValue(mockPayload as unknown as BasePayload)
  })

  it('rejects a missing/invalid API key with 401', async () => {
    const res = await GET(req('wrong'), { params: Promise.resolve({ id: 'v-1' }) })
    expect(res.status).toBe(401)
    expect(mockPayload.findByID).not.toHaveBeenCalled()
  })

  it('404s when the version is not found', async () => {
    mockPayload.findByID.mockRejectedValueOnce(new Error('not found'))
    const res = await GET(req(), { params: Promise.resolve({ id: 'missing' }) })
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json).toEqual({ error: 'template definition version not found' })
  })

  it('500s on an unrelated error', async () => {
    mockPayload.findByID.mockRejectedValueOnce(new Error('boom'))
    const res = await GET(req(), { params: Promise.resolve({ id: 'v-1' }) })
    expect(res.status).toBe(500)
  })

  it('calls findByID with depth: 0 and overrideAccess: true', async () => {
    mockPayload.findByID.mockResolvedValueOnce({
      id: 'v-1',
      definition: 'def-1',
      workspace: 'ws-1',
      versionNumber: 1,
      definitionJson: { apiVersion: 'orbit/v2' },
    })
    await GET(req(), { params: Promise.resolve({ id: 'v-1' }) })
    expect(mockPayload.findByID).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'template-definition-versions',
        id: 'v-1',
        depth: 0,
        overrideAccess: true,
      }),
    )
  })

  it('returns the version shape on success, definitionJson not stringified', async () => {
    mockPayload.findByID.mockResolvedValueOnce({
      id: 'v-1',
      definition: 'def-1',
      workspace: 'ws-1',
      versionNumber: 3,
      definitionJson: { apiVersion: 'orbit/v2', kind: 'Template' },
    })
    const res = await GET(req(), { params: Promise.resolve({ id: 'v-1' }) })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({
      version: {
        id: 'v-1',
        definition: 'def-1',
        workspace: 'ws-1',
        versionNumber: 3,
        definitionJson: { apiVersion: 'orbit/v2', kind: 'Template' },
      },
    })
    expect(typeof json.version.definitionJson).toBe('object')
  })

  it('flattens relationship fields to string ids even when Payload returns populated objects (depth > 0 would)', async () => {
    mockPayload.findByID.mockResolvedValueOnce({
      id: 'v-1',
      definition: { id: 'def-1', name: 'Some Definition' },
      workspace: { id: 'ws-1', name: 'Some Workspace' },
      versionNumber: 1,
      definitionJson: {},
    })
    const res = await GET(req(), { params: Promise.resolve({ id: 'v-1' }) })
    const json = await res.json()
    expect(json.version.definition).toBe('def-1')
    expect(json.version.workspace).toBe('ws-1')
  })
})
