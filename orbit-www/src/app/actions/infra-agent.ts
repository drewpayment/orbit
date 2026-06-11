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

  const promptWithContext = await buildPromptWithWorkspaceContext(
    payload,
    input.workspaceId,
    input.initialPrompt,
  )

  let resp: Awaited<ReturnType<typeof agentClient.startInfrastructureAgent>>
  try {
    resp = await agentClient.startInfrastructureAgent({
      workspaceId: input.workspaceId,
      repositoryId: input.repositoryId ?? '',
      initialPrompt: promptWithContext,
      llmProviderId: input.llmProviderId,
      userId: user.id,
    })
  } catch (err) {
    // Workflow never started — nothing to compensate.
    return { success: false as const, error: (err as Error).message }
  }

  try {
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
  } catch (err) {
    // The workflow already started but we couldn't record it. Abort the
    // orphan so it doesn't run unattended without a backing run row. The
    // abort is best-effort: surface the original create error regardless.
    try {
      await agentClient.abortAgent({
        workflowId: resp.workflowId,
        requestedBy: user.id,
        reason: 'run record creation failed',
      })
    } catch (abortErr) {
      console.error(
        '[infra-agent] startAgentRun compensation: abort of orphan workflow failed:',
        abortErr,
      )
    }
    return { success: false as const, error: (err as Error).message }
  }

  return {
    success: true as const,
    workflowId: resp.workflowId,
    runId: resp.runId,
    agentRunId: resp.agentRunId,
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

/**
 * approveAgentActionWithEdits — commit α + pattern_registration.
 *
 * For tool-registration and pattern_registration approvals, the reviewer
 * can edit the agent's proposed fields before approving. Empty fields mean
 * "leave the agent's value unchanged"; the workflow pre-flight validates
 * the resulting template via the Go template engine and rejects the gate
 * cleanly if the edit produces an unparseable placeholder.
 *
 * displayName + category are pattern-specific (no analog in
 * tool_registration); the workflow ignores them for tool_registration
 * gates.
 *
 * Workspace admin/owner gating mirrors approveAgentAction.
 */
export type PatternCategory =
  | 'compute'
  | 'data'
  | 'cache'
  | 'queue'
  | 'observability'
  | 'edge'
  | 'static-site'
  | 'other'

export async function approveAgentActionWithEdits(input: {
  workspaceId: string
  workflowId: string
  approvalId: string
  notes?: string
  edits: {
    name?: string
    displayName?: string
    description?: string
    category?: PatternCategory
    templateKind?: 'shell' | 'http' | 'composite'
    templateJson?: string
    inputSchemaJson?: string
  }
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
      edits: {
        name: input.edits.name ?? '',
        displayName: input.edits.displayName ?? '',
        description: input.edits.description ?? '',
        category: input.edits.category ?? '',
        templateKind: input.edits.templateKind ?? '',
        templateJson: input.edits.templateJson ?? '',
        inputSchemaJson: input.edits.inputSchemaJson ?? '',
      },
    })
    return { success: true as const }
  } catch (err) {
    return { success: false as const, error: (err as Error).message }
  }
}

/**
 * sendReviewerMessage — commit β.
 *
 * Sends a reviewer message into an open approval gate. The workflow
 * appends it as a conversation turn, runs an LLM step with no tools (so
 * the agent can only respond with text), and surfaces the agent's reply
 * as a regular ConversationTurn event. The gate stays open until a real
 * Approve / Reject lands.
 *
 * Workspace membership is sufficient — anyone in the chat can ask the
 * agent questions during a gate. Approval itself still requires admin.
 */
export async function sendReviewerMessage(input: {
  workspaceId: string
  workflowId: string
  approvalId: string
  message: string
}) {
  const user = await getPayloadUserFromSession()
  if (!user) return { success: false as const, error: 'Unauthorized' }
  const payload = await getPayload({ config })
  if (!(await isWorkspaceMember(payload, user.id, input.workspaceId))) {
    return { success: false as const, error: 'Forbidden' }
  }
  if (!input.message.trim()) {
    return { success: false as const, error: 'Message is required' }
  }
  try {
    await agentClient.sendReviewerMessage({
      workflowId: input.workflowId,
      approvalId: input.approvalId,
      userId: user.id,
      message: input.message,
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

// buildPromptWithWorkspaceContext prepends a structured summary of the
// current workspace (apps + cloud accounts) to the user's free-form goal so
// the agent has immediate awareness without needing a tool round-trip on
// turn 1. The orbit_* tools (orbit_get_app, orbit_list_cloud_accounts) let
// the agent fetch additional detail later.
async function buildPromptWithWorkspaceContext(
  payload: Awaited<ReturnType<typeof getPayload>>,
  workspaceId: string,
  userPrompt: string,
): Promise<string> {
  try {
    const [workspace, appsResult, cloudAccountsResult] = await Promise.all([
      payload.findByID({ collection: 'workspaces', id: workspaceId, overrideAccess: true }),
      payload.find({
        collection: 'apps',
        where: { workspace: { equals: workspaceId } },
        limit: 50,
        depth: 0,
        overrideAccess: true,
      }),
      payload.find({
        collection: 'cloud-accounts',
        where: { workspaces: { equals: workspaceId } },
        limit: 50,
        depth: 0,
        overrideAccess: true,
      }),
    ])

    const lines: string[] = []
    lines.push('[Workspace context — provided automatically by Orbit]')
    lines.push(`Workspace: ${workspace.name} (slug: ${workspace.slug}, id: ${workspace.id})`)

    if (appsResult.docs.length === 0) {
      lines.push('Apps in this workspace: (none)')
    } else {
      lines.push(`Apps in this workspace (${appsResult.docs.length}):`)
      for (const app of appsResult.docs) {
        const repoUrl = (app as { repository?: { url?: string } }).repository?.url ?? '(no repo)'
        const status = (app as { status?: string }).status ?? 'unknown'
        lines.push(`  - ${app.name} (id: ${app.id}, repo: ${repoUrl}, status: ${status})`)
      }
    }

    if (cloudAccountsResult.docs.length === 0) {
      lines.push('Cloud accounts available to this workspace: (none — agent cannot deploy until one is connected)')
    } else {
      lines.push(`Cloud accounts available (${cloudAccountsResult.docs.length}):`)
      for (const acc of cloudAccountsResult.docs) {
        const provider = (acc as { provider?: string }).provider ?? 'unknown'
        const region = (acc as { region?: string }).region ?? '(no default)'
        const status = (acc as { status?: string }).status ?? 'unknown'
        lines.push(`  - ${acc.name} (id: ${acc.id}, provider: ${provider}, region: ${region}, status: ${status})`)
      }
    }

    lines.push('')
    lines.push('Use orbit_get_app, orbit_list_apps, or orbit_list_cloud_accounts to fetch additional detail. Credentials are never returned by these tools — execute via shell_exec inside the sandbox where they are projected as env vars.')
    lines.push('')
    lines.push('[User goal]')
    lines.push(userPrompt)

    return lines.join('\n')
  } catch (err) {
    console.error('[infra-agent] buildPromptWithWorkspaceContext failed; sending raw prompt:', err)
    return userPrompt
  }
}

