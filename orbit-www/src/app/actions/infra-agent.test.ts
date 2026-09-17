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

vi.mock('@/lib/authz', () => ({
  getActor: vi.fn(),
  check: vi.fn(),
}))

vi.mock('@/lib/grpc/agent-client', () => ({
  agentClient: {
    startInfrastructureAgent: vi.fn(),
    abortAgent: vi.fn(),
    sendMessage: vi.fn(),
    approveAction: vi.fn(),
    rejectAction: vi.fn(),
    sendReviewerMessage: vi.fn(),
  },
}))

import type { BasePayload } from 'payload'
import { getPayload } from 'payload'
import { create } from '@bufbuild/protobuf'
import {
  StartInfrastructureAgentResponseSchema,
  AbortAgentResponseSchema,
} from '@/lib/proto/idp/agent/v1/agent_pb'
import { getActor, check } from '@/lib/authz'
import { agentClient } from '@/lib/grpc/agent-client'
const {
  startAgentRun,
  sendAgentMessage,
  approveAgentAction,
  rejectAgentAction,
  approveAgentActionWithEdits,
  sendReviewerMessage,
  abortAgentRun,
} = await import('./infra-agent')

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
    vi.mocked(getPayload).mockResolvedValue(mockPayload as unknown as BasePayload)
    vi.mocked(getActor).mockResolvedValue({
      payloadId: 'user-1',
      betterAuthId: 'ba-user-1',
    } as unknown as Awaited<ReturnType<typeof getActor>>)
    vi.mocked(check).mockResolvedValue({ allowed: true, reason: 'workspace member', actor: null })
    // buildPromptWithWorkspaceContext does payload.findByID + payload.find; keep them benign.
    mockPayload.findByID.mockResolvedValue({ id: 'ws-1', name: 'WS', slug: 'ws' })
    mockPayload.find.mockResolvedValue({ docs: [] })
    vi.mocked(agentClient.startInfrastructureAgent).mockResolvedValue(
      create(StartInfrastructureAgentResponseSchema, {
        workflowId: 'wf-123',
        runId: 'run-123',
        agentRunId: 'ar-123',
      }),
    )
  })

  it('aborts the started workflow if the run-row create fails', async () => {
    mockPayload.create.mockRejectedValue(new Error('mongo down'))
    vi.mocked(agentClient.abortAgent).mockResolvedValue(create(AbortAgentResponseSchema, {}))

    const result = await startAgentRun(input)

    expect(result.success).toBe(false)
    expect(agentClient.startInfrastructureAgent).toHaveBeenCalled()
    expect(agentClient.abortAgent).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: 'wf-123', reason: 'run record creation failed' }),
    )
  })

  it('does not abort when the workflow itself failed to start', async () => {
    vi.mocked(agentClient.startInfrastructureAgent).mockRejectedValue(new Error('grpc unavailable'))

    const result = await startAgentRun(input)

    expect(result.success).toBe(false)
    expect(agentClient.abortAgent).not.toHaveBeenCalled()
    expect(mockPayload.create).not.toHaveBeenCalled()
  })

  it('still returns failure even if the compensating abort throws', async () => {
    mockPayload.create.mockRejectedValue(new Error('mongo down'))
    vi.mocked(agentClient.abortAgent).mockRejectedValue(new Error('abort failed too'))

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

describe('workspace authorization gates', () => {
  const actor = { payloadId: 'user-1', betterAuthId: 'ba-user-1' } as unknown as Awaited<
    ReturnType<typeof getActor>
  >

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getActor).mockResolvedValue(actor)
  })

  it('startAgentRun denies when check() denies and does not call the agent client', async () => {
    vi.mocked(check).mockResolvedValue({ allowed: false, reason: 'x', actor: null })

    const result = await startAgentRun({
      workspaceId: 'ws-1',
      repositoryId: 'repo-1',
      llmProviderId: 'llm-1',
      initialPrompt: 'do the thing',
    })

    expect(check).toHaveBeenCalledWith('read', { kind: 'workspace', id: 'ws-1' }, actor)
    expect(result).toEqual({ success: false, error: 'Not a member of this workspace' })
    expect(agentClient.startInfrastructureAgent).not.toHaveBeenCalled()
  })

  it('sendAgentMessage denies when check() denies and does not call the agent client', async () => {
    vi.mocked(check).mockResolvedValue({ allowed: false, reason: 'x', actor: null })

    const result = await sendAgentMessage({
      workspaceId: 'ws-1',
      workflowId: 'wf-1',
      message: 'hi',
    })

    expect(check).toHaveBeenCalledWith('read', { kind: 'workspace', id: 'ws-1' }, actor)
    expect(result).toEqual({ success: false, error: 'Forbidden' })
    expect(agentClient.sendMessage).not.toHaveBeenCalled()
  })

  it('approveAgentAction denies when check() denies and does not call the agent client', async () => {
    vi.mocked(check).mockResolvedValue({ allowed: false, reason: 'x', actor: null })

    const result = await approveAgentAction({
      workspaceId: 'ws-1',
      workflowId: 'wf-1',
      approvalId: 'ap-1',
    })

    expect(check).toHaveBeenCalledWith('manage', { kind: 'workspace', id: 'ws-1' }, actor)
    expect(result).toEqual({
      success: false,
      error: 'Approval requires workspace admin or owner',
    })
    expect(agentClient.approveAction).not.toHaveBeenCalled()
  })

  it('rejectAgentAction denies when check() denies and does not call the agent client', async () => {
    vi.mocked(check).mockResolvedValue({ allowed: false, reason: 'x', actor: null })

    const result = await rejectAgentAction({
      workspaceId: 'ws-1',
      workflowId: 'wf-1',
      approvalId: 'ap-1',
      reason: 'nope',
    })

    expect(check).toHaveBeenCalledWith('manage', { kind: 'workspace', id: 'ws-1' }, actor)
    expect(result).toEqual({
      success: false,
      error: 'Rejection requires workspace admin or owner',
    })
    expect(agentClient.rejectAction).not.toHaveBeenCalled()
  })

  it('approveAgentActionWithEdits denies when check() denies and does not call the agent client', async () => {
    vi.mocked(check).mockResolvedValue({ allowed: false, reason: 'x', actor: null })

    const result = await approveAgentActionWithEdits({
      workspaceId: 'ws-1',
      workflowId: 'wf-1',
      approvalId: 'ap-1',
      edits: {},
    })

    expect(check).toHaveBeenCalledWith('manage', { kind: 'workspace', id: 'ws-1' }, actor)
    expect(result).toEqual({
      success: false,
      error: 'Approval requires workspace admin or owner',
    })
    expect(agentClient.approveAction).not.toHaveBeenCalled()
  })

  it('sendReviewerMessage denies when check() denies and does not call the agent client', async () => {
    vi.mocked(check).mockResolvedValue({ allowed: false, reason: 'x', actor: null })

    const result = await sendReviewerMessage({
      workspaceId: 'ws-1',
      workflowId: 'wf-1',
      approvalId: 'ap-1',
      message: 'question?',
    })

    expect(check).toHaveBeenCalledWith('read', { kind: 'workspace', id: 'ws-1' }, actor)
    expect(result).toEqual({ success: false, error: 'Forbidden' })
    expect(agentClient.sendReviewerMessage).not.toHaveBeenCalled()
  })

  it('abortAgentRun denies when check() denies and does not call the agent client', async () => {
    vi.mocked(check).mockResolvedValue({ allowed: false, reason: 'x', actor: null })

    const result = await abortAgentRun({
      workspaceId: 'ws-1',
      workflowId: 'wf-1',
    })

    expect(check).toHaveBeenCalledWith('read', { kind: 'workspace', id: 'ws-1' }, actor)
    expect(result).toEqual({ success: false, error: 'Forbidden' })
    expect(agentClient.abortAgent).not.toHaveBeenCalled()
  })
})
