/**
 * SSE proxy: /api/agent/[runId]/stream
 *
 * Subscribes to the AgentService.StreamAgentEvents server-streaming RPC and
 * fans the events out to the chat UI as text/event-stream so the EventSource
 * in AgentChatThread can render them as they arrive. This replaces Spike 1's
 * 600ms polling fallback with a single long-lived connection.
 *
 * Auth: cookie-based (EventSource cannot send custom headers). The route
 * resolves the AgentRun by workflowId, then asserts the requesting user is
 * an active member of that run's workspace.
 *
 * Resume: EventSource auto-reconnects with Last-Event-ID; the route falls
 * back to ?since= for the initial connection. Each event is emitted with
 * `id: <sequence>` so reconnects pick up exactly where they left off.
 *
 * The route emits SSE comment heartbeats (": ping\n\n") every 15s so idle
 * intermediaries (NGINX, ELB) don't close the connection.
 */

import { NextRequest } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'

import { agentClient } from '@/lib/grpc/agent-client'
import { getPayloadUserFromSession } from '@/lib/auth/session'
import { isWorkspaceMember } from '@/lib/access/workspace-access'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// Allow long-lived connections.
export const maxDuration = 3600

interface ServerEventDTO {
  sequence: string
  emittedAt: string
  kind:
    | 'conversation_turn'
    | 'token_delta'
    | 'proposal_update'
    | 'approval_request'
    | 'approval_resolution'
    | 'status_update'
    | 'tool_call_output_chunk'
    | 'unknown'
  conversationTurn?: { turnId: string; role: string; content: string }
  tokenDelta?: { turnId: string; delta: string }
  proposalUpdate?: { proposalId: string; title: string; summary: string; bodyMarkdown: string }
  approvalRequest?: {
    approvalId: string
    kind: string
    title: string
    bodyMarkdown: string
    // Structured fields for tool_registration approvals so the chat UI
    // can render an editable form. Empty for other kinds.
    name?: string
    description?: string
    templateKind?: string
    templateJson?: string
    inputSchemaJson?: string
    reasoning?: string
    agentToolId?: string
  }
  approvalResolution?: { approvalId: string; approved: boolean; resolvedBy: string; notes: string }
  statusUpdate?: { status: string; message: string }
  toolCallOutputChunk?: { callId: string; stream: string; chunk: string }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ runId: string }> },
) {
  const { runId } = await context.params
  const workflowId = decodeURIComponent(runId)

  // Resume cursor: prefer Last-Event-ID (auto-reconnect), then ?since=, then 0.
  const lastEventID = request.headers.get('last-event-id')
  const sinceParam = request.nextUrl.searchParams.get('since')
  let since = 0n
  try {
    since = BigInt(lastEventID ?? sinceParam ?? '0')
  } catch {
    since = 0n
  }

  // Auth: cookie session → AgentRun → workspace membership.
  const user = await getPayloadUserFromSession()
  if (!user) {
    return new Response('Unauthorized', { status: 401 })
  }
  const payload = await getPayload({ config })
  const runs = await payload.find({
    collection: 'agent-runs',
    where: { workflowId: { equals: workflowId } },
    limit: 1,
    overrideAccess: true,
  })
  const run = runs.docs[0]
  if (!run) {
    return new Response('Agent run not found', { status: 404 })
  }
  const workspaceId =
    typeof run.workspace === 'string' ? run.workspace : run.workspace?.id
  if (!workspaceId || !(await isWorkspaceMember(payload, user.id, workspaceId))) {
    return new Response('Forbidden', { status: 403 })
  }

  const encoder = new TextEncoder()
  const abort = new AbortController()
  request.signal.addEventListener('abort', () => abort.abort())

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Initial comment so the client transitions out of "connecting".
      controller.enqueue(encoder.encode(': connected\n\n'))

      // Heartbeat keeps idle proxies happy.
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'))
        } catch {
          // Stream closed — interval will be cleared in finally.
        }
      }, 15_000)

      try {
        const grpc = agentClient.streamAgentEvents(
          { workflowId, sinceSequence: since },
          { signal: abort.signal },
        )
        for await (const evt of grpc) {
          if (abort.signal.aborted) break
          const dto = mapEvent(evt)
          const lines =
            `id: ${dto.sequence}\n` +
            `data: ${JSON.stringify(dto)}\n\n`
          controller.enqueue(encoder.encode(lines))
        }
        controller.enqueue(encoder.encode('event: done\ndata: {}\n\n'))
      } catch (err) {
        if (!abort.signal.aborted) {
          const payload = JSON.stringify({ error: (err as Error).message ?? 'stream error' })
          controller.enqueue(encoder.encode(`event: error\ndata: ${payload}\n\n`))
        }
      } finally {
        clearInterval(heartbeat)
        try {
          controller.close()
        } catch {
          // already closed
        }
      }
    },
    cancel() {
      abort.abort()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Disable buffering on common reverse proxies (NGINX honors this).
      'X-Accel-Buffering': 'no',
    },
  })
}

function mapEvent(evt: any): ServerEventDTO {
  const sequence = String(evt.sequence ?? 0n)
  const emittedAt = evt.emittedAt?.seconds
    ? new Date(Number(evt.emittedAt.seconds) * 1000).toISOString()
    : new Date().toISOString()
  const base: ServerEventDTO = { sequence, emittedAt, kind: 'unknown' }
  const e = evt.event
  if (!e) return base
  switch (e.case) {
    case 'conversationTurn':
      return { ...base, kind: 'conversation_turn', conversationTurn: e.value }
    case 'tokenDelta':
      return { ...base, kind: 'token_delta', tokenDelta: e.value }
    case 'proposalUpdate':
      return { ...base, kind: 'proposal_update', proposalUpdate: e.value }
    case 'approvalRequest': {
      // Hoist Struct payload fields into the DTO so the chat UI can
      // populate an editable form without parsing body_markdown.
      const v = e.value as { approvalId: string; kind: string; title: string; bodyMarkdown: string; payload?: { fields?: Record<string, { stringValue?: string }> } }
      const fields = v.payload?.fields ?? {}
      const fieldStr = (k: string) => (typeof fields[k]?.stringValue === 'string' ? fields[k].stringValue! : undefined)
      return {
        ...base,
        kind: 'approval_request',
        approvalRequest: {
          approvalId: v.approvalId,
          kind: v.kind,
          title: v.title,
          bodyMarkdown: v.bodyMarkdown,
          name: fieldStr('name'),
          description: fieldStr('description'),
          templateKind: fieldStr('template_kind'),
          templateJson: fieldStr('template_json'),
          inputSchemaJson: fieldStr('input_schema_json'),
          reasoning: fieldStr('reasoning'),
          agentToolId: fieldStr('agent_tool_id'),
        },
      }
    }
    case 'approvalResolution':
      return { ...base, kind: 'approval_resolution', approvalResolution: e.value }
    case 'statusUpdate':
      return { ...base, kind: 'status_update', statusUpdate: e.value }
    case 'toolCallOutputChunk':
      return { ...base, kind: 'tool_call_output_chunk', toolCallOutputChunk: e.value }
    default:
      return base
  }
}
