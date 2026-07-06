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

const makeRequest = (body: unknown, apiKey: string | null = 'test-api-key') =>
  new Request('http://localhost/api/internal/pending-approvals', {
    method: 'POST',
    headers: apiKey ? { 'X-API-Key': apiKey } : {},
    body: JSON.stringify(body),
  }) as unknown as NextRequest

// Worker-shaped body: agentRunId is the run UUID, NOT the Mongo ObjectId.
const workerBody = {
  workspaceId: 'ws-1',
  workflowId: 'agent-05c65b89-1234',
  runId: 'temporal-run-1',
  agentRunId: '05c65b89-aaaa-bbbb-cccc-dddddddddddd',
  approvalId: 'appr-1',
  kind: 'tool_registration',
  title: 'Register deploy_thing',
}

describe('POST /api/internal/pending-approvals', () => {
  const mockPayload = {
    find: vi.fn(),
    create: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getPayload).mockResolvedValue(mockPayload as unknown as BasePayload)
    mockPayload.create.mockImplementation(async ({ data }: any) => ({
      id: 'pa-new',
      agentRun: data.agentRun,
    }))
  })

  it('returns 401 without API key', async () => {
    const res = await POST(makeRequest(workerBody, null))
    expect(res.status).toBe(401)
  })

  it('returns 400 when a required field is missing', async () => {
    const res = await POST(makeRequest({ ...workerBody, approvalId: '' }))
    expect(res.status).toBe(400)
  })

  it('resolves agentRunId (UUID) to the agent-runs Mongo id via workflowId lookup', async () => {
    // First find = idempotency check (none), second find = agent-runs lookup.
    mockPayload.find
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({ docs: [{ id: 'mongo-objectid-123', workflowId: workerBody.workflowId }] })

    const res = await POST(makeRequest(workerBody))
    expect(res.status).toBe(200)

    const createArgs = mockPayload.create.mock.calls.at(-1)?.[0]
    expect(createArgs.collection).toBe('pending-approvals')
    // The relationship must be the resolved Mongo id, never the UUID.
    expect(createArgs.data.agentRun).toBe('mongo-objectid-123')
    expect(createArgs.data.agentRun).not.toBe(workerBody.agentRunId)
  })

  it('creates the row with agentRun omitted when no agent-runs row matches (no 500)', async () => {
    mockPayload.find
      .mockResolvedValueOnce({ docs: [] }) // idempotency
      .mockResolvedValueOnce({ docs: [] }) // agent-runs lookup: none

    const res = await POST(makeRequest(workerBody))
    expect(res.status).toBe(200)

    const createArgs = mockPayload.create.mock.calls.at(-1)?.[0]
    expect(createArgs.data.agentRun).toBeUndefined()
  })

  it('still creates the row even if the agent-runs lookup throws (relationship resolution must not 500 the create)', async () => {
    mockPayload.find
      .mockResolvedValueOnce({ docs: [] }) // idempotency
      .mockRejectedValueOnce(new Error('mongo blip during lookup'))

    const res = await POST(makeRequest(workerBody))
    expect(res.status).toBe(200)

    const createArgs = mockPayload.create.mock.calls.at(-1)?.[0]
    expect(createArgs.data.agentRun).toBeUndefined()
  })

  it('idempotent: returns existing row without creating a duplicate', async () => {
    mockPayload.find.mockResolvedValueOnce({ docs: [{ id: 'pa-existing' }] })

    const res = await POST(makeRequest(workerBody))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe('pa-existing')
    expect(body.alreadyExisted).toBe(true)
    expect(mockPayload.create).not.toHaveBeenCalled()
  })

  it('omits agentRun when the worker sends no agentRunId', async () => {
    const { agentRunId: _omit, ...noRunId } = workerBody
    mockPayload.find.mockResolvedValueOnce({ docs: [] }) // idempotency

    const res = await POST(makeRequest(noRunId))
    expect(res.status).toBe(200)
    const createArgs = mockPayload.create.mock.calls.at(-1)?.[0]
    expect(createArgs.data.agentRun).toBeUndefined()
    // No agent-runs lookup needed when there's no agentRunId to resolve.
    expect(mockPayload.find).toHaveBeenCalledTimes(1)
  })
})
