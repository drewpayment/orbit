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
  new Request('http://localhost/api/internal/agent-runs', {
    method: 'POST',
    headers: apiKey ? { 'X-API-Key': apiKey } : {},
    body: JSON.stringify(body),
  }) as unknown as NextRequest

const workerBody = {
  workspaceId: 'ws-1',
  userId: 'user-1',
  workflowId: 'scaffolder-run-1-agentStep',
  title: 'Provision the thing',
  initialPrompt: 'Provision the thing',
}

describe('POST /api/internal/agent-runs', () => {
  const mockPayload = {
    find: vi.fn(),
    create: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getPayload).mockResolvedValue(mockPayload as unknown as BasePayload)
    mockPayload.create.mockImplementation(async ({ data }: any) => ({
      id: 'run-new',
      llmProvider: data.llmProvider,
    }))
  })

  it('returns 401 without a valid API key', async () => {
    const res = await POST(makeRequest(workerBody, null))
    expect(res.status).toBe(401)
    expect(mockPayload.find).not.toHaveBeenCalled()
  })

  it('returns 400 when a required field is missing', async () => {
    const res = await POST(makeRequest({ ...workerBody, workflowId: '' }))
    expect(res.status).toBe(400)
  })

  it('resolves the workspace default LLM provider and creates the row', async () => {
    mockPayload.find
      .mockResolvedValueOnce({ docs: [] }) // idempotency check: no existing row
      .mockResolvedValueOnce({ docs: [{ id: 'llm-default' }] }) // default provider

    const res = await POST(makeRequest(workerBody))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json).toEqual({ agentRunId: 'run-new', llmProviderId: 'llm-default' })

    const createArgs = mockPayload.create.mock.calls.at(-1)?.[0]
    expect(createArgs.collection).toBe('agent-runs')
    expect(createArgs.data.workspace).toBe('ws-1')
    expect(createArgs.data.workflowId).toBe(workerBody.workflowId)
    expect(createArgs.data.llmProvider).toBe('llm-default')
    expect(createArgs.data.startedBy).toBe('user-1')
    expect(createArgs.data.status).toBe('starting')
    expect(createArgs.overrideAccess).toBe(true)
  })

  it('uses the sole provider implicitly when the workspace has exactly one and none is marked default', async () => {
    mockPayload.find
      .mockResolvedValueOnce({ docs: [] }) // idempotency check
      .mockResolvedValueOnce({ docs: [] }) // no default
      .mockResolvedValueOnce({ docs: [{ id: 'llm-sole' }] }) // exactly one provider (limit: 2 returns 1)

    const res = await POST(makeRequest(workerBody))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.llmProviderId).toBe('llm-sole')
  })

  it('returns 422 AMBIGUOUS_LLM_PROVIDER when the workspace has multiple providers and none is default', async () => {
    mockPayload.find
      .mockResolvedValueOnce({ docs: [] }) // idempotency check
      .mockResolvedValueOnce({ docs: [] }) // no default
      .mockResolvedValueOnce({ docs: [{ id: 'llm-a' }, { id: 'llm-b' }] }) // two candidates, ambiguous

    const res = await POST(makeRequest(workerBody))
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.code).toBe('AMBIGUOUS_LLM_PROVIDER')
    expect(mockPayload.create).not.toHaveBeenCalled()
  })

  it('returns 422 NO_LLM_PROVIDER when the workspace has no LLM provider configured', async () => {
    mockPayload.find
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({ docs: [] })

    const res = await POST(makeRequest(workerBody))
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.code).toBe('NO_LLM_PROVIDER')
    expect(mockPayload.create).not.toHaveBeenCalled()
  })

  it('is idempotent on workflowId: a retried attempt returns the existing row', async () => {
    mockPayload.find.mockResolvedValueOnce({
      docs: [{ id: 'run-existing', workflowId: workerBody.workflowId, llmProvider: 'llm-existing' }],
    })

    const res = await POST(makeRequest(workerBody))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ agentRunId: 'run-existing', llmProviderId: 'llm-existing' })
    expect(mockPayload.create).not.toHaveBeenCalled()
  })

  it('flattens a populated llmProvider relationship on the existing-row path', async () => {
    mockPayload.find.mockResolvedValueOnce({
      docs: [
        {
          id: 'run-existing',
          workflowId: workerBody.workflowId,
          llmProvider: { id: 'llm-existing', model: 'gpt-x' },
        },
      ],
    })

    const res = await POST(makeRequest(workerBody))
    const json = await res.json()
    expect(json.llmProviderId).toBe('llm-existing')
  })

  it('derives a title from initialPrompt when title is omitted', async () => {
    mockPayload.find
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({ docs: [{ id: 'llm-default' }] })

    const longPrompt = 'x'.repeat(200)
    await POST(makeRequest({ ...workerBody, title: undefined, initialPrompt: longPrompt }))

    const createArgs = mockPayload.create.mock.calls.at(-1)?.[0]
    expect(createArgs.data.title).toBe(longPrompt.slice(0, 80))
  })
})
