import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ConnectError, Code } from '@connectrpc/connect'

vi.mock('payload', () => ({ getPayload: vi.fn() }))
vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('@/lib/grpc/agent-client', () => ({
  agentClient: { streamAgentEvents: vi.fn() },
}))
vi.mock('@/lib/auth/session', () => ({ getPayloadUserFromSession: vi.fn() }))
vi.mock('@/lib/access/workspace-access', () => ({ isWorkspaceMember: vi.fn() }))

import { getPayload } from 'payload'
import { agentClient } from '@/lib/grpc/agent-client'
import { getPayloadUserFromSession } from '@/lib/auth/session'
import { isWorkspaceMember } from '@/lib/access/workspace-access'
import { GET } from './route'

const mockPayload = {
  find: vi.fn(),
  findByID: vi.fn(),
  update: vi.fn(),
}

function makeRequest(): any {
  return {
    headers: new Headers(),
    nextUrl: { searchParams: new URLSearchParams() },
    signal: { aborted: false, addEventListener: vi.fn() },
  }
}

const ctx = { params: Promise.resolve({ runId: 'wf-1' }) }

async function readStream(res: Response): Promise<string> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let out = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    out += decoder.decode(value, { stream: true })
  }
  return out
}

/** Async-iterable that yields nothing then completes (normal stream end). */
function emptyStream() {
  return (async function* () {})()
}

/** Async-iterable whose first iteration throws a ConnectError. */
function throwingStream(code: Code): AsyncIterable<unknown> {
  return {
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<unknown>> {
          return Promise.reject(new ConnectError('boom', code))
        },
      }
    },
  }
}

describe('GET /api/agent/[runId]/stream', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(getPayload as any).mockResolvedValue(mockPayload)
    ;(getPayloadUserFromSession as any).mockResolvedValue({ id: 'user-1' })
    ;(isWorkspaceMember as any).mockResolvedValue(true)
    // agent-runs lookup at connect time
    mockPayload.find.mockResolvedValue({ docs: [{ id: 'run-1', workspace: 'ws-1', status: 'running' }] })
    mockPayload.update.mockResolvedValue({ id: 'run-1' })
  })

  it('reconciles a still-non-terminal run to failed on clean stream end, then emits done', async () => {
    ;(agentClient.streamAgentEvents as any).mockReturnValue(emptyStream())
    // Fresh re-read still shows non-terminal.
    mockPayload.findByID.mockResolvedValue({ id: 'run-1', status: 'running' })

    const res = await GET(makeRequest(), ctx)
    const body = await readStream(res)

    expect(body).toContain('event: done')
    expect(mockPayload.findByID).toHaveBeenCalledWith(
      expect.objectContaining({ collection: 'agent-runs', id: 'run-1' }),
    )
    expect(mockPayload.update).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'agent-runs',
        id: 'run-1',
        data: expect.objectContaining({
          status: 'failed',
          summary: 'Workflow closed without recording a terminal status',
        }),
      }),
    )
  })

  it('does NOT overwrite a run that reached a terminal status mid-stream', async () => {
    ;(agentClient.streamAgentEvents as any).mockReturnValue(emptyStream())
    // markRun set it to completed during the stream — fresh read reflects that.
    mockPayload.findByID.mockResolvedValue({ id: 'run-1', status: 'completed' })

    const res = await GET(makeRequest(), ctx)
    const body = await readStream(res)

    expect(body).toContain('event: done')
    expect(mockPayload.update).not.toHaveBeenCalled()
  })

  it('emits gone (not error) and reconciles on gRPC NotFound', async () => {
    ;(agentClient.streamAgentEvents as any).mockReturnValue(throwingStream(Code.NotFound))
    mockPayload.findByID.mockResolvedValue({ id: 'run-1', status: 'awaiting_user' })

    const res = await GET(makeRequest(), ctx)
    const body = await readStream(res)

    expect(body).toContain('event: gone')
    expect(body).not.toContain('event: error')
    expect(mockPayload.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'failed',
          summary: expect.stringContaining('Workflow history no longer available'),
        }),
      }),
    )
  })

  it('emits error (not gone) on a non-NotFound gRPC failure and does not reconcile', async () => {
    ;(agentClient.streamAgentEvents as any).mockReturnValue(throwingStream(Code.Internal))

    const res = await GET(makeRequest(), ctx)
    const body = await readStream(res)

    expect(body).toContain('event: error')
    expect(body).not.toContain('event: gone')
    expect(mockPayload.update).not.toHaveBeenCalled()
  })

  it('returns 403 for a non-member', async () => {
    ;(isWorkspaceMember as any).mockResolvedValue(false)
    const res = await GET(makeRequest(), ctx)
    expect(res.status).toBe(403)
  })
})
