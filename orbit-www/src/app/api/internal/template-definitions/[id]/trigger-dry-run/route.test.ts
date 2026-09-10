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

describe('POST /api/internal/template-definitions/[id]/trigger-dry-run', () => {
  const mockPayload = {
    findByID: vi.fn(),
    find: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getPayload).mockResolvedValue(mockPayload as unknown as BasePayload)
  })

  const definition = {
    id: 'def-1',
    name: 'Service Template',
    status: 'published',
    workspace: 'ws-1',
  }
  const version = {
    id: 'ver-1',
    definition: 'def-1',
    workspace: 'ws-1',
    definitionJson: { apiVersion: 'orbit/v2', kind: 'Template' },
  }

  it('rejects a missing/invalid API key with 401', async () => {
    const res = await POST(req({}, 'wrong'), { params: Promise.resolve({ id: 'def-1' }) })
    expect(res.status).toBe(401)
    expect(mockPayload.findByID).not.toHaveBeenCalled()
  })

  it('404s when the definition is not found', async () => {
    mockPayload.findByID.mockRejectedValueOnce(new Error('not found'))
    const res = await POST(req({ templateVersionId: 'ver-1', parameters: {} }), {
      params: Promise.resolve({ id: 'missing' }),
    })
    expect(res.status).toBe(404)
  })

  it('400s when the definition is not published', async () => {
    mockPayload.findByID.mockResolvedValueOnce({ ...definition, status: 'draft' })
    const res = await POST(req({ templateVersionId: 'ver-1', parameters: {} }), {
      params: Promise.resolve({ id: 'def-1' }),
    })
    expect(res.status).toBe(400)
    expect(mockPayload.create).not.toHaveBeenCalled()
  })

  it('400s when the version does not belong to the definition', async () => {
    mockPayload.findByID.mockResolvedValueOnce(definition).mockResolvedValueOnce({
      ...version,
      definition: 'def-OTHER',
    })
    const res = await POST(req({ templateVersionId: 'ver-1', parameters: {} }), {
      params: Promise.resolve({ id: 'def-1' }),
    })
    expect(res.status).toBe(400)
    expect(mockPayload.create).not.toHaveBeenCalled()
  })

  it('creates the runner action if none exists, then the run, stamps lastDryRunAt, and returns the definitionJson', async () => {
    mockPayload.findByID.mockResolvedValueOnce(definition).mockResolvedValueOnce(version)
    mockPayload.find.mockResolvedValueOnce({ docs: [] })
    mockPayload.create.mockResolvedValueOnce({ id: 'action-1' }).mockResolvedValueOnce({ id: 'run-1' })

    const res = await POST(
      req({ templateVersionId: 'ver-1', parameters: { name: 'orders' }, trigger: 'scheduled-sweep' }),
      { params: Promise.resolve({ id: 'def-1' }) },
    )

    expect(res.status).toBe(200)
    expect(mockPayload.find).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'actions',
        where: {
          and: [{ 'backend.type': { equals: 'scaffolder' } }, { 'backend.ref': { equals: 'def-1' } }],
        },
      }),
    )
    expect(mockPayload.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        collection: 'actions',
        data: expect.objectContaining({ backend: { type: 'scaffolder', ref: 'def-1' } }),
        overrideAccess: true,
      }),
    )
    expect(mockPayload.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        collection: 'action-runs',
        data: expect.objectContaining({
          action: 'action-1',
          workspace: 'ws-1',
          templateVersion: 'ver-1',
          dryRun: true,
          inputs: { name: 'orders' },
          status: 'pending',
          trigger: 'scheduled-sweep',
        }),
        overrideAccess: true,
      }),
    )
    expect(mockPayload.update).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'template-definitions',
        id: 'def-1',
        data: expect.objectContaining({ lastDryRunAt: expect.any(String) }),
      }),
    )

    const json = await res.json()
    expect(json).toEqual({
      runId: 'run-1',
      workspaceId: 'ws-1',
      definitionJson: { apiVersion: 'orbit/v2', kind: 'Template' },
    })
  })

  it('reuses an existing runner action instead of creating a second one', async () => {
    mockPayload.findByID.mockResolvedValueOnce(definition).mockResolvedValueOnce(version)
    mockPayload.find.mockResolvedValueOnce({ docs: [{ id: 'existing-action' }] })
    mockPayload.create.mockResolvedValueOnce({ id: 'run-1' })

    await POST(req({ templateVersionId: 'ver-1', parameters: {} }), {
      params: Promise.resolve({ id: 'def-1' }),
    })

    expect(mockPayload.create).toHaveBeenCalledTimes(1)
    expect(mockPayload.create).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'action-runs',
        data: expect.objectContaining({ action: 'existing-action' }),
      }),
    )
  })
})
