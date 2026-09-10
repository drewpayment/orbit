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

describe('GET /api/internal/action-runs/[id]', () => {
  const mockPayload = { findByID: vi.fn() }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getPayload).mockResolvedValue(mockPayload as unknown as BasePayload)
  })

  it('rejects a missing/invalid API key with 401', async () => {
    const res = await GET(req('wrong'), { params: Promise.resolve({ id: 'run-1' }) })
    expect(res.status).toBe(401)
    expect(mockPayload.findByID).not.toHaveBeenCalled()
  })

  it('404s when the run is not found', async () => {
    mockPayload.findByID.mockRejectedValueOnce(new Error('not found'))
    const res = await GET(req(), { params: Promise.resolve({ id: 'missing' }) })
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json).toEqual({ error: 'action run not found' })
  })

  it('500s on an unrelated error', async () => {
    mockPayload.findByID.mockRejectedValueOnce(new Error('boom'))
    const res = await GET(req(), { params: Promise.resolve({ id: 'run-1' }) })
    expect(res.status).toBe(500)
  })

  it('calls findByID with depth: 1 and overrideAccess: true', async () => {
    mockPayload.findByID.mockResolvedValueOnce({
      id: 'run-1',
      workspace: { id: 'ws-1', slug: 'ws-slug', name: 'Ws Name' },
      templateVersion: 'ver-1',
      dryRun: true,
      status: 'pending',
      triggeredBy: null,
    })
    await GET(req(), { params: Promise.resolve({ id: 'run-1' }) })
    expect(mockPayload.findByID).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'action-runs',
        id: 'run-1',
        depth: 1,
        overrideAccess: true,
      }),
    )
  })

  it('returns the flattened shape on success (workspace + triggeredBy populated)', async () => {
    mockPayload.findByID.mockResolvedValueOnce({
      id: 'run-1',
      workspace: { id: 'ws-1', slug: 'acme', name: 'Acme' },
      templateVersion: { id: 'ver-1' },
      dryRun: false,
      status: 'running',
      triggeredBy: { id: 'user-1', email: 'a@b.com', name: 'Alice' },
    })
    const res = await GET(req(), { params: Promise.resolve({ id: 'run-1' }) })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({
      run: {
        id: 'run-1',
        workspace: { id: 'ws-1', slug: 'acme', name: 'Acme' },
        templateVersion: 'ver-1',
        dryRun: false,
        status: 'running',
        triggeredBy: { id: 'user-1', email: 'a@b.com', name: 'Alice' },
      },
    })
  })

  it('flattens workspace when returned as a bare id string (depth 0 shape)', async () => {
    mockPayload.findByID.mockResolvedValueOnce({
      id: 'run-1',
      workspace: 'ws-1',
      templateVersion: null,
      dryRun: false,
      status: 'succeeded',
      triggeredBy: 'user-1',
    })
    const res = await GET(req(), { params: Promise.resolve({ id: 'run-1' }) })
    const json = await res.json()
    // No populated fields to read a slug/name/email from — still returns a
    // shape the Go client can safely destructure (id-only objects).
    expect(json.run.workspace).toEqual({ id: 'ws-1', slug: null, name: null })
    expect(json.run.triggeredBy).toEqual({ id: 'user-1', email: null, name: null })
    expect(json.run.templateVersion).toBeNull()
  })

  it('returns triggeredBy: null when the run has no triggeredBy (e.g. an automation-created run)', async () => {
    mockPayload.findByID.mockResolvedValueOnce({
      id: 'run-1',
      workspace: { id: 'ws-1', slug: 'acme', name: 'Acme' },
      templateVersion: 'ver-1',
      dryRun: true,
      status: 'pending',
      triggeredBy: null,
    })
    const res = await GET(req(), { params: Promise.resolve({ id: 'run-1' }) })
    const json = await res.json()
    expect(json.run.triggeredBy).toBeNull()
  })

  it('never leaks inputs/outputs/logs even if present on the fetched doc', async () => {
    mockPayload.findByID.mockResolvedValueOnce({
      id: 'run-1',
      workspace: { id: 'ws-1', slug: 'acme', name: 'Acme' },
      templateVersion: 'ver-1',
      dryRun: true,
      status: 'pending',
      triggeredBy: null,
      inputs: { secret: 'do-not-leak' },
      outputs: { text: 'do-not-leak' },
      logs: [{ ts: 'x', level: 'info', message: 'do-not-leak' }],
    })
    const res = await GET(req(), { params: Promise.resolve({ id: 'run-1' }) })
    const json = await res.json()
    expect(json.run).not.toHaveProperty('inputs')
    expect(json.run).not.toHaveProperty('outputs')
    expect(json.run).not.toHaveProperty('logs')
  })
})
