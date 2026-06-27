/**
 * Shared Infrastructure Agent event mapping.
 *
 * There are two sources of agent events that must render identically:
 *
 *  1. The live gRPC stream (AgentService.StreamAgentEvents) — a protobuf
 *     `AgentEvent` with a `oneof event` framing, consumed by the SSE proxy
 *     at /api/agent/[runId]/stream.
 *  2. The durable Mongo replica (`agent-events` collection) written by the
 *     temporal worker — each row carries the exact per-kind payload map the
 *     workflow emitted.
 *
 * Both are normalized into a single `AgentEventDTO` (the wire shape the
 * EventSource client + SSR page ingest). Keeping the mapping in one place is
 * the contract that makes "reload mid-run" and "reopen a finished run" show
 * the same transcript as the live stream.
 *
 * Persisted-event payload contract (agreed with the temporal worker):
 *   The `agent-events.payload` JSON is the camelCase per-kind object that the
 *   DTO exposes — i.e. for a `conversation_turn` row the payload is
 *   `{ turnId, role, content, toolName?, toolCallId? }`. The worker emits the
 *   same shape the SSE DTO carries so this module can pass it through with
 *   only light normalization/validation. token_delta and raw
 *   tool_call_output_chunk are ephemeral and never persisted.
 */

export type AgentEventKind =
  | 'conversation_turn'
  | 'token_delta'
  | 'proposal_update'
  | 'approval_request'
  | 'approval_resolution'
  | 'status_update'
  | 'tool_call_output_chunk'
  | 'tool_call_output'
  | 'unknown'

export interface AgentEventDTO {
  sequence: string
  emittedAt: string
  kind: AgentEventKind
  conversationTurn?: {
    turnId: string
    role: string
    content: string
    toolName?: string
    toolCallId?: string
  }
  tokenDelta?: { turnId: string; delta: string }
  proposalUpdate?: { proposalId: string; title: string; summary: string; bodyMarkdown: string }
  approvalRequest?: {
    approvalId: string
    kind: string
    title: string
    bodyMarkdown: string
    name?: string
    displayName?: string
    description?: string
    category?: string
    templateKind?: string
    templateJson?: string
    inputSchemaJson?: string
    reasoning?: string
    agentToolId?: string
    patternId?: string
  }
  approvalResolution?: { approvalId: string; approved: boolean; resolvedBy: string; notes: string }
  statusUpdate?: { status: string; message: string }
  toolCallOutputChunk?: { callId: string; stream: string; chunk: string }
}

// ──────────────────────────── helpers ────────────────────────────

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}
function optStr(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}
function bool(v: unknown): boolean {
  return v === true
}

function emittedAtIso(emittedAt: unknown): string {
  // gRPC Timestamp ({ seconds, nanos }) or already-ISO string or Date.
  if (typeof emittedAt === 'string' && emittedAt) return new Date(emittedAt).toISOString()
  if (emittedAt instanceof Date) return emittedAt.toISOString()
  const seconds = (emittedAt as { seconds?: number | bigint } | null | undefined)?.seconds
  if (seconds != null) return new Date(Number(seconds) * 1000).toISOString()
  return new Date().toISOString()
}

/**
 * Hoist an ApprovalRequest's protobuf Struct payload (`{ fields: { k:
 * { stringValue } } }`) into flat string fields the chat UI's editable form
 * consumes without parsing body_markdown.
 */
function flattenApprovalStruct(
  payload: { fields?: Record<string, { stringValue?: string }> } | undefined,
): Record<string, string | undefined> {
  const fields = payload?.fields ?? {}
  const fieldStr = (k: string) =>
    typeof fields[k]?.stringValue === 'string' ? fields[k]!.stringValue : undefined
  return {
    name: fieldStr('name'),
    displayName: fieldStr('display_name'),
    description: fieldStr('description'),
    category: fieldStr('category'),
    templateKind: fieldStr('template_kind'),
    templateJson: fieldStr('template_json'),
    inputSchemaJson: fieldStr('input_schema_json'),
    reasoning: fieldStr('reasoning'),
    agentToolId: fieldStr('agent_tool_id'),
    patternId: fieldStr('pattern_id'),
  }
}

// ──────────────────────────── gRPC stream mapper ────────────────────────────

/**
 * Map a live protobuf `AgentEvent` (oneof framing) to the DTO. Used by the
 * SSE proxy route.
 */
export function mapGrpcEvent(evt: unknown): AgentEventDTO {
  const e = evt as {
    sequence?: number | bigint
    emittedAt?: unknown
    event?: { case?: string; value?: unknown }
  }
  const sequence = String(e.sequence ?? 0n)
  const emittedAt = emittedAtIso(e.emittedAt)
  const base: AgentEventDTO = { sequence, emittedAt, kind: 'unknown' }
  const inner = e.event
  if (!inner || !inner.case) return base

  switch (inner.case) {
    case 'conversationTurn': {
      const v = inner.value as {
        turnId: string
        role: string
        content: string
        toolCallId?: string
        toolName?: string
      }
      return {
        ...base,
        kind: 'conversation_turn',
        conversationTurn: {
          turnId: str(v.turnId),
          role: str(v.role),
          content: str(v.content),
          toolName: optStr(v.toolName),
          toolCallId: optStr(v.toolCallId),
        },
      }
    }
    case 'tokenDelta': {
      const v = inner.value as { turnId: string; delta: string }
      return { ...base, kind: 'token_delta', tokenDelta: { turnId: str(v.turnId), delta: str(v.delta) } }
    }
    case 'proposalUpdate': {
      const v = inner.value as { proposalId: string; title: string; summary: string; bodyMarkdown: string }
      return {
        ...base,
        kind: 'proposal_update',
        proposalUpdate: {
          proposalId: str(v.proposalId),
          title: str(v.title),
          summary: str(v.summary),
          bodyMarkdown: str(v.bodyMarkdown),
        },
      }
    }
    case 'approvalRequest': {
      const v = inner.value as {
        approvalId: string
        kind: string
        title: string
        bodyMarkdown: string
        payload?: { fields?: Record<string, { stringValue?: string }> }
      }
      return {
        ...base,
        kind: 'approval_request',
        approvalRequest: {
          approvalId: str(v.approvalId),
          kind: str(v.kind),
          title: str(v.title),
          bodyMarkdown: str(v.bodyMarkdown),
          ...flattenApprovalStruct(v.payload),
        },
      }
    }
    case 'approvalResolution': {
      const v = inner.value as { approvalId: string; approved: boolean; resolvedBy: string; notes: string }
      return {
        ...base,
        kind: 'approval_resolution',
        approvalResolution: {
          approvalId: str(v.approvalId),
          approved: bool(v.approved),
          resolvedBy: str(v.resolvedBy),
          notes: str(v.notes),
        },
      }
    }
    case 'statusUpdate': {
      const v = inner.value as { status: string; message: string }
      return { ...base, kind: 'status_update', statusUpdate: { status: str(v.status), message: str(v.message) } }
    }
    case 'toolCallOutputChunk': {
      const v = inner.value as { callId: string; stream: string; chunk: string }
      return {
        ...base,
        kind: 'tool_call_output_chunk',
        toolCallOutputChunk: { callId: str(v.callId), stream: str(v.stream), chunk: str(v.chunk) },
      }
    }
    default:
      return base
  }
}

// ──────────────────────────── persisted-event mapper ────────────────────────────

/** Shape of a persisted `agent-events` row as read from Payload. */
export interface PersistedAgentEvent {
  sequence: number | string
  emittedAt: string | Date
  kind: string
  payload: unknown
}

/**
 * Map a durable `agent-events` row to the DTO. The row's `payload` is the
 * camelCase per-kind object (see module docstring). A persisted
 * `tool_call_output` (aggregated tool output) is surfaced as a
 * tool_call_output_chunk so it flows through the same UI buffer the live
 * stream uses.
 */
export function mapPersistedEvent(row: PersistedAgentEvent): AgentEventDTO {
  const sequence = String(row.sequence ?? 0)
  const emittedAt = emittedAtIso(row.emittedAt)
  const base: AgentEventDTO = { sequence, emittedAt, kind: 'unknown' }
  const p = (row.payload ?? {}) as Record<string, unknown>

  switch (row.kind) {
    case 'conversation_turn':
      return {
        ...base,
        kind: 'conversation_turn',
        conversationTurn: {
          turnId: str(p.turnId),
          role: str(p.role),
          content: str(p.content),
          toolName: optStr(p.toolName),
          toolCallId: optStr(p.toolCallId),
        },
      }
    case 'proposal_update':
      return {
        ...base,
        kind: 'proposal_update',
        proposalUpdate: {
          proposalId: str(p.proposalId),
          title: str(p.title),
          summary: str(p.summary),
          bodyMarkdown: str(p.bodyMarkdown),
        },
      }
    case 'approval_request':
      return {
        ...base,
        kind: 'approval_request',
        approvalRequest: {
          approvalId: str(p.approvalId),
          kind: str(p.kind),
          title: str(p.title),
          bodyMarkdown: str(p.bodyMarkdown),
          name: optStr(p.name),
          displayName: optStr(p.displayName),
          description: optStr(p.description),
          category: optStr(p.category),
          templateKind: optStr(p.templateKind),
          templateJson: optStr(p.templateJson),
          inputSchemaJson: optStr(p.inputSchemaJson),
          reasoning: optStr(p.reasoning),
          agentToolId: optStr(p.agentToolId),
          patternId: optStr(p.patternId),
        },
      }
    case 'approval_resolution':
      return {
        ...base,
        kind: 'approval_resolution',
        approvalResolution: {
          approvalId: str(p.approvalId),
          approved: bool(p.approved),
          resolvedBy: str(p.resolvedBy),
          notes: str(p.notes),
        },
      }
    case 'status_update':
      return {
        ...base,
        kind: 'status_update',
        statusUpdate: { status: str(p.status), message: str(p.message) },
      }
    case 'tool_call_output':
    case 'tool_call_output_chunk':
      return {
        ...base,
        kind: 'tool_call_output_chunk',
        toolCallOutputChunk: {
          callId: str(p.callId),
          stream: str(p.stream),
          // Aggregated tool_call_output stores the full text under `text`;
          // a streamed chunk uses `chunk`.
          chunk: str(p.chunk ?? p.text),
        },
      }
    default:
      return base
  }
}

/**
 * Highest sequence in a list of DTOs (as a string, suitable for the stream
 * `?since=` cursor). Returns '0' for an empty list.
 */
export function maxSequence(events: { sequence: string }[]): string {
  let max = 0n
  for (const e of events) {
    try {
      const s = BigInt(e.sequence)
      if (s > max) max = s
    } catch {
      // ignore non-numeric sequences
    }
  }
  return String(max)
}
