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
import type { BasePayload } from 'payload'
import { getPayload } from 'payload'
const { POST } = await import('./route')

const makeContext = (id: string) => ({ params: Promise.resolve({ id }) })

const makeRequest = (id: string, body: unknown, apiKey: string | null = 'test-api-key') =>
  new Request(`http://localhost/api/internal/agent-tools/${id}/resolve`, {
    method: 'POST',
    headers: apiKey ? { 'X-API-Key': apiKey } : {},
    body: JSON.stringify(body),
  }) as unknown as NextRequest

describe('POST /api/internal/agent-tools/[id]/resolve', () => {
  const mockPayload = {
    findByID: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    find: vi.fn(),
  }

  const baseTool = {
    id: 'tool-1',
    workspace: 'ws-1',
    name: 'deploy_thing',
    description: 'does a thing',
    inputSchemaJson: '',
    templateKind: 'shell' as const,
    templateJson: '{"cmd":"echo hi"}',
    status: 'pending' as const,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getPayload).mockResolvedValue(mockPayload as unknown as BasePayload)
    mockPayload.create.mockResolvedValue({ id: 'ver-1' })
    mockPayload.update.mockImplementation(async ({ data }: any) => ({
      id: 'tool-1',
      status: data.status,
    }))
    mockPayload.find.mockResolvedValue({ docs: [] })
  })

  it('returns 401 without API key', async () => {
    const res = await POST(makeRequest('tool-1', { approved: true }, null), makeContext('tool-1'))
    expect(res.status).toBe(401)
  })

  it('returns 409 and changes nothing when workspaceId does not match the tool workspace', async () => {
    mockPayload.findByID.mockResolvedValue({ ...baseTool, status: 'pending' })

    const res = await POST(
      makeRequest('tool-1', { approved: true, workspaceId: 'ws-OTHER' }),
      makeContext('tool-1'),
    )

    expect(res.status).toBe(409)
    expect(mockPayload.create).not.toHaveBeenCalled()
    expect(mockPayload.update).not.toHaveBeenCalled()
  })

  it('proceeds when workspaceId matches the tool workspace', async () => {
    mockPayload.findByID.mockResolvedValue({ ...baseTool, status: 'pending' })

    const res = await POST(
      makeRequest('tool-1', { approved: true, workspaceId: 'ws-1' }),
      makeContext('tool-1'),
    )

    expect(res.status).toBe(200)
    expect(mockPayload.update).toHaveBeenCalled()
    const body = await res.json()
    expect(body.status).toBe('approved')
  })

  it('proceeds and warns when workspaceId is absent (backward compatible)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockPayload.findByID.mockResolvedValue({ ...baseTool, status: 'pending' })

    const res = await POST(makeRequest('tool-1', { approved: true }), makeContext('tool-1'))

    expect(res.status).toBe(200)
    expect(mockPayload.update).toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('normalizes a populated workspace relationship object for the cross-check', async () => {
    mockPayload.findByID.mockResolvedValue({
      ...baseTool,
      workspace: { id: 'ws-1', name: 'My WS' },
      status: 'pending',
    })

    const res = await POST(
      makeRequest('tool-1', { approved: true, workspaceId: 'ws-1' }),
      makeContext('tool-1'),
    )
    expect(res.status).toBe(200)
  })

  it('is idempotent: already-approved tool short-circuits with 200 and no writes', async () => {
    mockPayload.findByID.mockResolvedValue({ ...baseTool, status: 'approved' })

    const res = await POST(
      makeRequest('tool-1', { approved: true, workspaceId: 'ws-1' }),
      makeContext('tool-1'),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('approved')
    expect(body.alreadyResolved).toBe(true)
    expect(mockPayload.create).not.toHaveBeenCalled()
    expect(mockPayload.update).not.toHaveBeenCalled()
  })

  it('is idempotent: already-rejected tool short-circuits with 200 and no writes', async () => {
    mockPayload.findByID.mockResolvedValue({ ...baseTool, status: 'rejected' })

    const res = await POST(
      makeRequest('tool-1', { approved: true, workspaceId: 'ws-1' }),
      makeContext('tool-1'),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('rejected')
    expect(body.alreadyResolved).toBe(true)
    expect(mockPayload.create).not.toHaveBeenCalled()
    expect(mockPayload.update).not.toHaveBeenCalled()
  })

  it('does not double-create a v1 version row if one already exists for this tool', async () => {
    mockPayload.findByID.mockResolvedValue({ ...baseTool, status: 'pending' })
    // Simulate a prior partial run that already wrote version 1.
    mockPayload.find.mockResolvedValue({ docs: [{ id: 'existing-ver-1', versionNumber: 1 }] })

    const res = await POST(
      makeRequest('tool-1', { approved: true, workspaceId: 'ws-1' }),
      makeContext('tool-1'),
    )

    expect(res.status).toBe(200)
    // No new version 1 created.
    const createdVersionNumbers = mockPayload.create.mock.calls.map((c: any[]) => c[0]?.data?.versionNumber)
    expect(createdVersionNumbers).not.toContain(1)
  })

  it('partial-retry: v1 exists but v2 missing — creates v2 exactly once and returns agentToolVersionId', async () => {
    mockPayload.findByID.mockResolvedValue({ ...baseTool, status: 'pending' })
    // Prior attempt wrote v1 then crashed before v2 / status patch.
    mockPayload.find.mockResolvedValue({ docs: [{ id: 'existing-ver-1', versionNumber: 1 }] })
    mockPayload.create.mockResolvedValue({ id: 'ver-2-new' })

    const res = await POST(
      makeRequest('tool-1', {
        approved: true,
        workspaceId: 'ws-1',
        edited: true,
        editedFields: { name: 'deploy_thing_v2' },
      }),
      makeContext('tool-1'),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.agentToolVersionId).toBe('ver-2-new')

    const createdVersionNumbers = mockPayload.create.mock.calls.map((c: any[]) => c[0]?.data?.versionNumber)
    // v1 not recreated; v2 created exactly once.
    expect(createdVersionNumbers).not.toContain(1)
    expect(createdVersionNumbers.filter((n: number) => n === 2)).toHaveLength(1)
    // Tool fields patched to the edited values + currentVersion bumped.
    const patch = mockPayload.update.mock.calls.at(-1)?.[0]?.data
    expect(patch.name).toBe('deploy_thing_v2')
    expect(patch.currentVersion).toBe(2)
  })

  it('partial-retry: both v1 and v2 already exist — reuses v2 id and creates nothing', async () => {
    mockPayload.findByID.mockResolvedValue({ ...baseTool, status: 'pending' })
    mockPayload.find.mockResolvedValue({
      docs: [
        { id: 'existing-ver-1', versionNumber: 1 },
        { id: 'existing-ver-2', versionNumber: 2 },
      ],
    })

    const res = await POST(
      makeRequest('tool-1', {
        approved: true,
        workspaceId: 'ws-1',
        edited: true,
        editedFields: { name: 'deploy_thing_v2' },
      }),
      makeContext('tool-1'),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.agentToolVersionId).toBe('existing-ver-2')
    expect(mockPayload.create).not.toHaveBeenCalled()
    const patch = mockPayload.update.mock.calls.at(-1)?.[0]?.data
    expect(patch.currentVersion).toBe(2)
  })

  it('rejection path still works and patches the row', async () => {
    mockPayload.findByID.mockResolvedValue({ ...baseTool, status: 'pending' })

    const res = await POST(
      makeRequest('tool-1', { approved: false, reason: 'unsafe', workspaceId: 'ws-1' }),
      makeContext('tool-1'),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('rejected')
    expect(mockPayload.update).toHaveBeenCalled()
  })
})
