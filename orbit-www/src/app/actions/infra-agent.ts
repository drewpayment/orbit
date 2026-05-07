'use server'

import { getPayload } from 'payload'
import config from '@payload-config'

import { getPayloadUserFromSession } from '@/lib/auth/session'
import {
  isWorkspaceMember,
  isWorkspaceAdminOrOwner,
} from '@/lib/access/workspace-access'
import { agentClient } from '@/lib/grpc/agent-client'

export interface AgentEventDTO {
  sequence: bigint
  emittedAt: string
  kind:
    | 'conversation_turn'
    | 'token_delta'
    | 'proposal_update'
    | 'approval_request'
    | 'approval_resolution'
    | 'status_update'
    | 'unknown'
  conversationTurn?: {
    turnId: string
    role: string
    content: string
  }
  tokenDelta?: { turnId: string; delta: string }
  proposalUpdate?: {
    proposalId: string
    title: string
    summary: string
    bodyMarkdown: string
  }
  approvalRequest?: {
    approvalId: string
    kind: string
    title: string
    bodyMarkdown: string
  }
  approvalResolution?: {
    approvalId: string
    approved: boolean
    resolvedBy: string
    notes: string
  }
  statusUpdate?: { status: string; message: string }
}

interface StartAgentRunInput {
  workspaceId: string
  repositoryId?: string
  llmProviderId: string
  initialPrompt: string
}

export async function startAgentRun(input: StartAgentRunInput) {
  const user = await getPayloadUserFromSession()
  if (!user) return { success: false as const, error: 'Unauthorized' }

  const payload = await getPayload({ config })
  if (!(await isWorkspaceMember(payload, user.id, input.workspaceId))) {
    return { success: false as const, error: 'Not a member of this workspace' }
  }

  try {
    const resp = await agentClient.startInfrastructureAgent({
      workspaceId: input.workspaceId,
      repositoryId: input.repositoryId ?? '',
      initialPrompt: input.initialPrompt,
      llmProviderId: input.llmProviderId,
      userId: user.id,
    })

    // Persist a Payload run row for history.
    await payload.create({
      collection: 'agent-runs',
      data: {
        workspace: input.workspaceId,
        repository: input.repositoryId,
        workflowId: resp.workflowId,
        runId: resp.runId,
        title: input.initialPrompt.slice(0, 80),
        initialPrompt: input.initialPrompt,
        llmProvider: input.llmProviderId,
        status: 'starting',
        startedBy: user.id,
        startedAt: new Date().toISOString(),
      },
      overrideAccess: true,
    })

    return {
      success: true as const,
      workflowId: resp.workflowId,
      runId: resp.runId,
      agentRunId: resp.agentRunId,
    }
  } catch (err) {
    return { success: false as const, error: (err as Error).message }
  }
}

export async function sendAgentMessage(input: {
  workspaceId: string
  workflowId: string
  message: string
}) {
  const user = await getPayloadUserFromSession()
  if (!user) return { success: false as const, error: 'Unauthorized' }
  const payload = await getPayload({ config })
  if (!(await isWorkspaceMember(payload, user.id, input.workspaceId))) {
    return { success: false as const, error: 'Forbidden' }
  }
  try {
    await agentClient.sendMessage({
      workflowId: input.workflowId,
      userId: user.id,
      message: input.message,
    })
    return { success: true as const }
  } catch (err) {
    return { success: false as const, error: (err as Error).message }
  }
}

export async function approveAgentAction(input: {
  workspaceId: string
  workflowId: string
  approvalId: string
  notes?: string
}) {
  const user = await getPayloadUserFromSession()
  if (!user) return { success: false as const, error: 'Unauthorized' }
  const payload = await getPayload({ config })
  if (!(await isWorkspaceAdminOrOwner(payload, user.id, input.workspaceId))) {
    return { success: false as const, error: 'Approval requires workspace admin or owner' }
  }
  try {
    await agentClient.approveAction({
      workflowId: input.workflowId,
      approvalId: input.approvalId,
      approvedBy: user.id,
      notes: input.notes ?? '',
    })
    return { success: true as const }
  } catch (err) {
    return { success: false as const, error: (err as Error).message }
  }
}

export async function rejectAgentAction(input: {
  workspaceId: string
  workflowId: string
  approvalId: string
  reason: string
}) {
  const user = await getPayloadUserFromSession()
  if (!user) return { success: false as const, error: 'Unauthorized' }
  const payload = await getPayload({ config })
  if (!(await isWorkspaceAdminOrOwner(payload, user.id, input.workspaceId))) {
    return { success: false as const, error: 'Rejection requires workspace admin or owner' }
  }
  try {
    await agentClient.rejectAction({
      workflowId: input.workflowId,
      approvalId: input.approvalId,
      rejectedBy: user.id,
      reason: input.reason,
    })
    return { success: true as const }
  } catch (err) {
    return { success: false as const, error: (err as Error).message }
  }
}

export async function abortAgentRun(input: {
  workspaceId: string
  workflowId: string
  reason?: string
}) {
  const user = await getPayloadUserFromSession()
  if (!user) return { success: false as const, error: 'Unauthorized' }
  const payload = await getPayload({ config })
  if (!(await isWorkspaceMember(payload, user.id, input.workspaceId))) {
    return { success: false as const, error: 'Forbidden' }
  }
  try {
    await agentClient.abortAgent({
      workflowId: input.workflowId,
      requestedBy: user.id,
      reason: input.reason ?? '',
    })
    return { success: true as const }
  } catch (err) {
    return { success: false as const, error: (err as Error).message }
  }
}

/**
 * Polling-style "stream" — drains all events emitted since `since` from the
 * AgentService server stream, then closes. The chat UI calls this on a
 * 500ms cadence; an SSE proxy can replace it without changing the UI.
 */
export async function getAgentEvents(input: {
  workspaceId: string
  workflowId: string
  since: bigint
  maxBatch?: number
}): Promise<{ success: boolean; events?: AgentEventDTO[]; latest?: bigint; error?: string }> {
  const user = await getPayloadUserFromSession()
  if (!user) return { success: false, error: 'Unauthorized' }
  const payload = await getPayload({ config })
  if (!(await isWorkspaceMember(payload, user.id, input.workspaceId))) {
    return { success: false, error: 'Forbidden' }
  }

  try {
    const events: AgentEventDTO[] = []
    let latest = input.since
    const max = input.maxBatch ?? 200

    const stream = agentClient.streamAgentEvents({
      workflowId: input.workflowId,
      sinceSequence: input.since,
    })

    // Pull at most `max` events then break — the stream itself stays alive in
    // the gRPC layer for as long as the workflow runs, but on this polling
    // cadence we just want a snapshot batch.
    const drained = drainWithLimit(stream, max)
    for await (const evt of drained) {
      const dto = mapEvent(evt)
      events.push(dto)
      if (evt.sequence > latest) latest = evt.sequence
    }
    return { success: true, events, latest }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}

async function* drainWithLimit<T>(stream: AsyncIterable<T>, limit: number): AsyncIterable<T> {
  let i = 0
  for await (const item of stream) {
    yield item
    if (++i >= limit) return
  }
}

function mapEvent(evt: any): AgentEventDTO {
  const base: AgentEventDTO = {
    sequence: evt.sequence,
    emittedAt: evt.emittedAt?.seconds
      ? new Date(Number(evt.emittedAt.seconds) * 1000).toISOString()
      : new Date().toISOString(),
    kind: 'unknown',
  }
  const e = evt.event
  if (!e) return base
  switch (e.case) {
    case 'conversationTurn':
      return { ...base, kind: 'conversation_turn', conversationTurn: e.value }
    case 'tokenDelta':
      return { ...base, kind: 'token_delta', tokenDelta: e.value }
    case 'proposalUpdate':
      return { ...base, kind: 'proposal_update', proposalUpdate: e.value }
    case 'approvalRequest':
      return { ...base, kind: 'approval_request', approvalRequest: e.value }
    case 'approvalResolution':
      return { ...base, kind: 'approval_resolution', approvalResolution: e.value }
    case 'statusUpdate':
      return { ...base, kind: 'status_update', statusUpdate: e.value }
    default:
      return base
  }
}
