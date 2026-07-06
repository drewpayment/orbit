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
import { ConnectError, Code } from '@connectrpc/connect'

import { agentClient } from '@/lib/grpc/agent-client'
import { getPayloadUserFromSession } from '@/lib/auth/session'
import { isWorkspaceMember } from '@/lib/access/workspace-access'
import { mapGrpcEvent } from '@/components/features/infra-agent/lib/agent-event-dto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// Allow long-lived connections.
export const maxDuration = 3600

const TERMINAL_STATUSES = new Set(['completed', 'aborted', 'failed', 'timeout'])

const GONE_SUMMARY =
  'Workflow history no longer available (Temporal retention expired or workflow terminated)'

const DONE_SUMMARY = 'Workflow closed without recording a terminal status'

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
          const dto = mapGrpcEvent(evt)
          const lines =
            `id: ${dto.sequence}\n` +
            `data: ${JSON.stringify(dto)}\n\n`
          controller.enqueue(encoder.encode(lines))
        }
        // The gRPC stream completed normally. This happens when the workflow
        // finished AND when it was externally terminated while still
        // queryable (so we never hit the NotFound path). If the workflow's own
        // markRun didn't record a terminal status, the Mongo run is stranded
        // looking live — reconcile it. Re-read fresh: markRun may have set a
        // terminal status mid-stream, which we must not overwrite.
        if (!abort.signal.aborted) {
          await reconcileNonTerminalRun(payload, run.id, DONE_SUMMARY)
        }
        controller.enqueue(encoder.encode('event: done\ndata: {}\n\n'))
      } catch (err) {
        if (abort.signal.aborted) {
          // Client navigated away — nothing to emit.
        } else if (ConnectError.from(err).code === Code.NotFound) {
          // The Temporal workflow no longer exists (retention expired or the
          // workflow was terminated). Degrade gracefully: tell the client to
          // stop reconnecting and keep its saved history, and reconcile the
          // Mongo run if it's stranded in a non-terminal status.
          await reconcileNonTerminalRun(payload, run.id, GONE_SUMMARY)
          controller.enqueue(encoder.encode('event: gone\ndata: {}\n\n'))
        } else {
          const errPayload = JSON.stringify({ error: (err as Error).message ?? 'stream error' })
          controller.enqueue(encoder.encode(`event: error\ndata: ${errPayload}\n\n`))
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

/**
 * When the stream ends (workflow gone, or closed without a terminal status)
 * but the Mongo run is still non-terminal, mark it `failed` so the run list
 * and reopened views stop presenting it as live.
 *
 * Re-reads the run's CURRENT status rather than trusting the value captured
 * at connect time: the workflow's own markRun may have set a terminal status
 * mid-stream, and we must not overwrite it. Best-effort — a failure here must
 * not break the SSE response.
 */
async function reconcileNonTerminalRun(
  payload: Awaited<ReturnType<typeof getPayload>>,
  runId: string,
  summary: string,
): Promise<void> {
  try {
    const fresh = await payload.findByID({
      collection: 'agent-runs',
      id: runId,
      depth: 0,
      overrideAccess: true,
    })
    if (!fresh || TERMINAL_STATUSES.has(fresh.status as string)) return
    await payload.update({
      collection: 'agent-runs',
      id: runId,
      data: {
        status: 'failed',
        summary,
        endedAt: new Date().toISOString(),
      },
      overrideAccess: true,
    })
  } catch {
    // Reconciliation is best-effort; the next open will retry.
  }
}
