'use server'

import { getPayload } from 'payload'
import config from '@payload-config'

import { getPayloadUserFromSession } from '@/lib/auth/session'
import {
  isWorkspaceMember,
  isWorkspaceAdminOrOwner,
} from '@/lib/access/workspace-access'
import { agentClient } from '@/lib/grpc/agent-client'

// Server actions for the Infrastructure Agent chat UI. Live event streaming
// runs through /api/agent/[runId]/stream (SSE proxy over the AgentService
// server-streaming RPC); these actions cover the unary mutations (start a
// run, send a message, approve / reject / abort).

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

