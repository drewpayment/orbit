import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('payload', () => ({ getPayload: vi.fn() }))
vi.mock('@payload-config', () => ({ default: {} }))

process.env.ORBIT_INTERNAL_API_KEY = 'test-internal-key'

import type { BasePayload } from 'payload'
import { getPayload } from 'payload'
import { GET } from './route'

const skeletonDoc = {
  id: 'sk-1',
  name: 'Go Service Starter',
  slug: 'go-service-starter',
  workspace: 'ws-1',
  version: 3,
  totalSize: 42,
  files: [
    { path: 'main.go', content: 'package main', size: 12, isBinary: false },
    { path: 'README.md', content: '# hi', size: 4, isBinary: false },
  ],
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function req(url: string, apiKey: string | null = 'test-internal-key'): any {
  const headers = new Headers()
  if (apiKey !== null) headers.set('X-API-Key', apiKey)
  return { headers, nextUrl: new URL(url) }
}

describe('GET /api/internal/template-skeletons/[id]', () => {
  const mockPayload = { findByID: vi.fn() }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getPayload).mockResolvedValue(mockPayload as unknown as BasePayload)
  })

  it('rejects a missing/invalid API key with 401 before any DB access', async () => {
    const res = await GET(req('https://x/api/internal/template-skeletons/sk-1?workspaceId=ws-1', 'wrong'), {
      params: Promise.resolve({ id: 'sk-1' }),
    })
    expect(res.status).toBe(401)
    expect(mockPayload.findByID).not.toHaveBeenCalled()
  })

  it('400s when workspaceId query param is missing', async () => {
    const res = await GET(req('https://x/api/internal/template-skeletons/sk-1'), {
      params: Promise.resolve({ id: 'sk-1' }),
    })
    expect(res.status).toBe(400)
    expect(mockPayload.findByID).not.toHaveBeenCalled()
  })

  it('404s when the skeleton is not found', async () => {
    mockPayload.findByID.mockRejectedValueOnce(new Error('not found'))
    const res = await GET(req('https://x/api/internal/template-skeletons/missing?workspaceId=ws-1'), {
      params: Promise.resolve({ id: 'missing' }),
    })
    expect(res.status).toBe(404)
  })

  it('404s (not 403) when workspaceId does not match the skeleton workspace', async () => {
    mockPayload.findByID.mockResolvedValueOnce(skeletonDoc)
    const res = await GET(req('https://x/api/internal/template-skeletons/sk-1?workspaceId=ws-OTHER'), {
      params: Promise.resolve({ id: 'sk-1' }),
    })
    expect(res.status).toBe(404)
  })

  it('404s when workspace is a populated object that does not match', async () => {
    mockPayload.findByID.mockResolvedValueOnce({ ...skeletonDoc, workspace: { id: 'ws-1', name: 'W' } })
    const res = await GET(req('https://x/api/internal/template-skeletons/sk-1?workspaceId=ws-OTHER'), {
      params: Promise.resolve({ id: 'sk-1' }),
    })
    expect(res.status).toBe(404)
  })

  it('500s on an unrelated error', async () => {
    mockPayload.findByID.mockRejectedValueOnce(new Error('boom'))
    const res = await GET(req('https://x/api/internal/template-skeletons/sk-1?workspaceId=ws-1'), {
      params: Promise.resolve({ id: 'sk-1' }),
    })
    expect(res.status).toBe(500)
  })

  it('calls findByID with depth: 0 and overrideAccess: true', async () => {
    mockPayload.findByID.mockResolvedValueOnce(skeletonDoc)
    await GET(req('https://x/api/internal/template-skeletons/sk-1?workspaceId=ws-1'), {
      params: Promise.resolve({ id: 'sk-1' }),
    })
    expect(mockPayload.findByID).toHaveBeenCalledWith(
      expect.objectContaining({ collection: 'template-skeletons', id: 'sk-1', depth: 0, overrideAccess: true }),
    )
  })

  it('returns full bundle (with content) on success without ?manifest', async () => {
    mockPayload.findByID.mockResolvedValueOnce(skeletonDoc)
    const res = await GET(req('https://x/api/internal/template-skeletons/sk-1?workspaceId=ws-1'), {
      params: Promise.resolve({ id: 'sk-1' }),
    })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({
      id: 'sk-1',
      name: 'Go Service Starter',
      slug: 'go-service-starter',
      version: 3,
      totalSize: 42,
      files: [
        { path: 'main.go', size: 12, content: 'package main' },
        { path: 'README.md', size: 4, content: '# hi' },
      ],
    })
  })

  it('returns manifest-only (no content) when ?manifest=1', async () => {
    mockPayload.findByID.mockResolvedValueOnce(skeletonDoc)
    const res = await GET(req('https://x/api/internal/template-skeletons/sk-1?workspaceId=ws-1&manifest=1'), {
      params: Promise.resolve({ id: 'sk-1' }),
    })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({
      id: 'sk-1',
      name: 'Go Service Starter',
      slug: 'go-service-starter',
      version: 3,
      totalSize: 42,
      files: [
        { path: 'main.go', size: 12 },
        { path: 'README.md', size: 4 },
      ],
    })
    expect(JSON.stringify(json)).not.toContain('package main')
  })
})
