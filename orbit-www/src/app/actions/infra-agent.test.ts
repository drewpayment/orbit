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

vi.mock('@/lib/auth/session', () => ({
  getPayloadUserFromSession: vi.fn(),
}))

vi.mock('@/lib/access/workspace-access', () => ({
  isWorkspaceMember: vi.fn(),
  isWorkspaceAdminOrOwner: vi.fn(),
}))

vi.mock('@/lib/grpc/agent-client', () => ({
  agentClient: {
    startInfrastructureAgent: vi.fn(),
    abortAgent: vi.fn(),
  },
}))

import { getPayload } from 'payload'
import { getPayloadUserFromSession } from '@/lib/auth/session'
import { isWorkspaceMember } from '@/lib/access/workspace-access'
import { agentClient } from '@/lib/grpc/agent-client'
const { startAgentRun } = await import('./infra-agent')

describe('startAgentRun compensation', () => {
  const mockPayload = {
    create: vi.fn(),
    findByID: vi.fn(),
    find: vi.fn(),
  }

  const input = {
    workspaceId: 'ws-1',
    repositoryId: 'repo-1',
    llmProviderId: 'llm-1',
    initialPrompt: 'do the thing',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    ;(getPayload as any).mockResolvedValue(mockPayload)
    ;(getPayloadUserFromSession as any).mockResolvedValue({ id: 'user-1' })
    ;(isWorkspaceMember as any).mockResolvedValue(true)
    // buildPromptWithWorkspaceContext does payload.findByID + payload.find; keep them benign.
    mockPayload.findByID.mockResolvedValue({ id: 'ws-1', name: 'WS', slug: 'ws' })
    mockPayload.find.mockResolvedValue({ docs: [] })
    ;(agentClient.startInfrastructureAgent as any).mockResolvedValue({
      workflowId: 'wf-123',
      runId: 'run-123',
      agentRunId: 'ar-123',
    })
  })

  it('aborts the started workflow if the run-row create fails', async () => {
    mockPayload.create.mockRejectedValue(new Error('mongo down'))
    ;(agentClient.abortAgent as any).mockResolvedValue({})

    const result = await startAgentRun(input)

    expect(result.success).toBe(false)
    expect(agentClient.startInfrastructureAgent).toHaveBeenCalled()
    expect(agentClient.abortAgent).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: 'wf-123', reason: 'run record creation failed' }),
    )
  })

  it('does not abort when the workflow itself failed to start', async () => {
    ;(agentClient.startInfrastructureAgent as any).mockRejectedValue(new Error('grpc unavailable'))

    const result = await startAgentRun(input)

    expect(result.success).toBe(false)
    expect(agentClient.abortAgent).not.toHaveBeenCalled()
    expect(mockPayload.create).not.toHaveBeenCalled()
  })

  it('still returns failure even if the compensating abort throws', async () => {
    mockPayload.create.mockRejectedValue(new Error('mongo down'))
    ;(agentClient.abortAgent as any).mockRejectedValue(new Error('abort failed too'))

    const result = await startAgentRun(input)

    expect(result.success).toBe(false)
    if (!result.success) {
      // Original create error is surfaced, not the abort error.
      expect(result.error).toContain('mongo down')
    }
  })

  it('happy path: returns the workflow identifiers and does not abort', async () => {
    mockPayload.create.mockResolvedValue({ id: 'agent-run-1' })

    const result = await startAgentRun(input)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.workflowId).toBe('wf-123')
      expect(result.runId).toBe('run-123')
    }
    expect(agentClient.abortAgent).not.toHaveBeenCalled()
  })
})
