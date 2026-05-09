'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'

import {
  abortAgentRun,
  approveAgentAction,
  approveAgentActionWithEdits,
  rejectAgentAction,
  sendAgentMessage,
  sendReviewerMessage,
} from '@/app/actions/infra-agent'

/**
 * Wire shape emitted by /api/agent/[runId]/stream. Mirrors AgentEvent in the
 * proto with bigints stringified for JSON.
 */
interface AgentEventDTO {
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

interface Props {
  workspaceId: string
  workflowId: string
}

interface ChatTurn {
  turnId: string
  role: string
  content: string
}

interface PendingApproval {
  approvalId: string
  kind: string
  title: string
  bodyMarkdown: string
  // Structured editable payload — populated for tool_registration kind.
  name?: string
  description?: string
  templateKind?: string
  templateJson?: string
  inputSchemaJson?: string
  reasoning?: string
}

interface Proposal {
  proposalId: string
  title: string
  summary: string
  bodyMarkdown: string
}

// Reconnect backoff: 0.5s → 1s → 2s → 4s, capped.
const RECONNECT_BACKOFF_MS = [500, 1000, 2000, 4000]

interface ToolOutputBuffer {
  callId: string
  // Accumulated stdout/stderr; rendered as a single code block under the
  // tool call so the user can read CLI prompts (e.g. az login device codes)
  // before the activity has returned.
  text: string
}

export function AgentChatThread({ workspaceId, workflowId }: Props) {
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [streamingTurns, setStreamingTurns] = useState<Record<string, string>>({})
  const [toolOutputs, setToolOutputs] = useState<Record<string, ToolOutputBuffer>>({})
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([])
  const [status, setStatus] = useState('starting')
  const [statusMessage, setStatusMessage] = useState('')
  const [connection, setConnection] = useState<'connecting' | 'live' | 'reconnecting' | 'closed'>('connecting')
  const [input, setInput] = useState('')
  const [pending, startTransition] = useTransition()
  const scrollRef = useRef<HTMLDivElement>(null)

  const ingest = useCallback((events: AgentEventDTO[]) => {
    setTurns((prev) => {
      const next = [...prev]
      const indexByTurnId = new Map(next.map((t, i) => [t.turnId, i]))
      let modified = false
      for (const e of events) {
        if (e.kind === 'conversation_turn' && e.conversationTurn) {
          const ct = e.conversationTurn
          const idx = indexByTurnId.get(ct.turnId)
          if (idx === undefined) {
            indexByTurnId.set(ct.turnId, next.length)
            next.push({ turnId: ct.turnId, role: ct.role, content: ct.content })
          } else {
            next[idx] = { turnId: ct.turnId, role: ct.role, content: ct.content }
          }
          modified = true
        }
      }
      return modified ? next : prev
    })

    setStreamingTurns((prev) => {
      let modified = false
      const next = { ...prev }
      for (const e of events) {
        if (e.kind === 'token_delta' && e.tokenDelta) {
          const id = e.tokenDelta.turnId
          next[id] = (next[id] ?? '') + e.tokenDelta.delta
          modified = true
        }
        if (e.kind === 'conversation_turn' && e.conversationTurn?.role === 'assistant') {
          // Final assistant turn arrived; clear partial.
          if (next[e.conversationTurn.turnId] !== undefined) {
            delete next[e.conversationTurn.turnId]
            modified = true
          }
        }
      }
      return modified ? next : prev
    })

    setToolOutputs((prev) => {
      let modified = false
      const next = { ...prev }
      for (const e of events) {
        if (e.kind === 'tool_call_output_chunk' && e.toolCallOutputChunk) {
          const { callId, chunk } = e.toolCallOutputChunk
          if (!callId) continue
          const existing = next[callId]?.text ?? ''
          next[callId] = { callId, text: existing + chunk + '\n' }
          modified = true
        }
      }
      return modified ? next : prev
    })

    for (const e of events) {
      if (e.kind === 'proposal_update' && e.proposalUpdate) {
        setProposal({
          proposalId: e.proposalUpdate.proposalId,
          title: e.proposalUpdate.title,
          summary: e.proposalUpdate.summary,
          bodyMarkdown: e.proposalUpdate.bodyMarkdown,
        })
      }
      if (e.kind === 'approval_request' && e.approvalRequest) {
        const ar = e.approvalRequest
        setPendingApprovals((prev) => [
          ...prev.filter((a) => a.approvalId !== ar.approvalId),
          {
            approvalId: ar.approvalId,
            kind: ar.kind,
            title: ar.title,
            bodyMarkdown: ar.bodyMarkdown,
            name: ar.name,
            description: ar.description,
            templateKind: ar.templateKind,
            templateJson: ar.templateJson,
            inputSchemaJson: ar.inputSchemaJson,
            reasoning: ar.reasoning,
          },
        ])
      }
      if (e.kind === 'approval_resolution' && e.approvalResolution) {
        const ar = e.approvalResolution
        setPendingApprovals((prev) => prev.filter((a) => a.approvalId !== ar.approvalId))
      }
      if (e.kind === 'status_update' && e.statusUpdate) {
        setStatus(e.statusUpdate.status)
        setStatusMessage(e.statusUpdate.message)
      }
    }
  }, [])

  // SSE subscription. EventSource auto-reconnects with Last-Event-ID; we
  // also handle our own reconnect-on-error path with exponential backoff
  // (capped) since EventSource's built-in retry doesn't surface auth or
  // server-side close events to us cleanly. The `done` event from the
  // proxy means the workflow finished — we treat that as a clean close
  // and do not reconnect.
  useEffect(() => {
    let cancelled = false
    let attempt = 0
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let es: EventSource | null = null

    const connect = () => {
      if (cancelled) return
      setConnection(attempt === 0 ? 'connecting' : 'reconnecting')

      const url = `/api/agent/${encodeURIComponent(workflowId)}/stream`
      es = new EventSource(url)

      es.onopen = () => {
        attempt = 0
        setConnection('live')
      }

      es.onmessage = (msg) => {
        try {
          const dto = JSON.parse(msg.data) as AgentEventDTO
          ingest([dto])
        } catch {
          // skip malformed message
        }
      }

      es.addEventListener('done', () => {
        cancelled = true
        setConnection('closed')
        es?.close()
      })

      es.addEventListener('error', () => {
        // EventSource will retry on its own, but we want to disambiguate
        // "transient network blip" from "server gave up". Close + reopen
        // ourselves with a backoff so reconnects don't hammer the server
        // when the workflow is genuinely gone.
        es?.close()
        if (cancelled) return
        const delay = RECONNECT_BACKOFF_MS[Math.min(attempt, RECONNECT_BACKOFF_MS.length - 1)]
        attempt += 1
        setConnection('reconnecting')
        reconnectTimer = setTimeout(connect, delay)
      })
    }

    connect()

    return () => {
      cancelled = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      es?.close()
      setConnection('closed')
    }
  }, [workflowId, ingest])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns, streamingTurns, proposal, pendingApprovals.length])

  const onSend = () => {
    const text = input.trim()
    if (!text) return
    setInput('')
    startTransition(async () => {
      const result = await sendAgentMessage({ workspaceId, workflowId, message: text })
      if (!result.success) setStatusMessage(result.error)
    })
  }

  const onApprove = (approvalId: string) =>
    startTransition(async () => {
      await approveAgentAction({ workspaceId, workflowId, approvalId })
    })

  const onReject = (approvalId: string) =>
    startTransition(async () => {
      await rejectAgentAction({ workspaceId, workflowId, approvalId, reason: 'rejected' })
    })

  const onAbort = () =>
    startTransition(async () => {
      await abortAgentRun({ workspaceId, workflowId, reason: 'user requested abort' })
    })

  const terminal = ['completed', 'aborted', 'failed', 'timeout'].includes(status)

  return (
    <div className="flex flex-col h-full gap-3">
      <div className="flex items-center gap-2 text-xs">
        <Badge variant={terminal ? 'destructive' : 'secondary'}>{status}</Badge>
        {connection !== 'live' && connection !== 'closed' && (
          <Badge variant="outline" className="text-amber-600 border-amber-500/50">
            {connection === 'connecting' ? 'connecting…' : 'reconnecting…'}
          </Badge>
        )}
        {statusMessage && <span className="text-muted-foreground truncate">{statusMessage}</span>}
        <div className="ml-auto">
          {!terminal && (
            <Button variant="ghost" size="sm" onClick={onAbort} disabled={pending}>
              Abort
            </Button>
          )}
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-3 pr-2">
        {turns.map((t) => (
          <ChatBubble key={t.turnId} role={t.role} content={t.content} />
        ))}
        {Object.entries(streamingTurns).map(([turnId, content]) => (
          <ChatBubble key={`stream-${turnId}`} role="assistant" content={content + '▍'} />
        ))}

        {Object.values(toolOutputs).map((buf) => (
          <ToolOutputBubble key={`out-${buf.callId}`} text={buf.text} />
        ))}

        {proposal && <ProposalBlock proposal={proposal} />}

        {pendingApprovals.map((a) => (
          <ApprovalCard
            key={a.approvalId}
            approval={a}
            workspaceId={workspaceId}
            workflowId={workflowId}
            disabled={pending}
            onApprove={() => onApprove(a.approvalId)}
            onReject={() => onReject(a.approvalId)}
          />
        ))}
      </div>

      <div className="border-t pt-3">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={terminal ? 'Run finished. Start a new one to continue.' : 'Reply to the agent…'}
          rows={2}
          disabled={terminal}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              onSend()
            }
          }}
        />
        <div className="flex justify-between items-center mt-2">
          <p className="text-xs text-muted-foreground">⌘/Ctrl+Enter to send</p>
          <Button size="sm" onClick={onSend} disabled={terminal || pending || !input.trim()}>
            Send
          </Button>
        </div>
      </div>
    </div>
  )
}

function ChatBubble({ role, content }: { role: string; content: string }) {
  const isUser = role === 'user'
  const isAssistant = role === 'assistant'
  const isTool = role === 'tool'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={[
          'max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap',
          isUser ? 'bg-primary text-primary-foreground' : '',
          isAssistant ? 'bg-muted' : '',
          isTool ? 'bg-slate-100 text-slate-700 border border-slate-200 font-mono text-xs' : '',
        ].join(' ')}
      >
        {!isUser && <div className="text-[10px] uppercase opacity-60 mb-0.5">{role}</div>}
        {content}
      </div>
    </div>
  )
}

function ProposalBlock({ proposal }: { proposal: Proposal }) {
  return (
    <Card className="border-blue-500/40 bg-blue-50/40">
      <CardContent className="py-4 space-y-2">
        <p className="text-xs uppercase text-blue-600 font-medium">Latest proposal</p>
        <h3 className="font-semibold">{proposal.title}</h3>
        <p className="text-sm text-muted-foreground">{proposal.summary}</p>
        <pre className="whitespace-pre-wrap text-sm font-sans pt-2">{proposal.bodyMarkdown}</pre>
      </CardContent>
    </Card>
  )
}

/**
 * ApprovalCard renders the in-chat approval gate. For tool_registration
 * kind it offers an "Edit" toggle that lets the reviewer modify the
 * agent's proposed name / description / template / schema before
 * approving — JSON fields are validated client-side first so the
 * workflow's pre-flight expansion doesn't reject the gate over a typo.
 */
function ApprovalCard({
  approval,
  workspaceId,
  workflowId,
  disabled,
  onApprove,
  onReject,
}: {
  approval: PendingApproval
  workspaceId: string
  workflowId: string
  disabled: boolean
  onApprove: () => void
  onReject: () => void
}) {
  const isToolReg = approval.kind === 'tool_registration'
  const [editing, setEditing] = useState(false)
  const [replying, setReplying] = useState(false)
  const [reviewerMessage, setReviewerMessage] = useState('')
  const [editName, setEditName] = useState(approval.name ?? '')
  const [editDescription, setEditDescription] = useState(approval.description ?? '')
  const [editTemplateKind, setEditTemplateKind] = useState(approval.templateKind ?? 'shell')
  const [editTemplateJson, setEditTemplateJson] = useState(approval.templateJson ?? '')
  const [editSchemaJson, setEditSchemaJson] = useState(approval.inputSchemaJson ?? '')
  const [submitting, startSubmit] = useTransition()
  const [replySubmitting, startReplySubmit] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [replyError, setReplyError] = useState<string | null>(null)

  const onSendReviewerMessage = () => {
    if (!reviewerMessage.trim()) return
    const text = reviewerMessage
    setReplyError(null)
    setReviewerMessage('')
    startReplySubmit(async () => {
      const res = await sendReviewerMessage({
        workspaceId,
        workflowId,
        approvalId: approval.approvalId,
        message: text,
      })
      if (!res.success) {
        setReplyError(res.error)
        setReviewerMessage(text)
      } else {
        setReplying(false)
      }
    })
  }

  const validateClient = (): string | null => {
    if (editTemplateJson.trim()) {
      try {
        JSON.parse(editTemplateJson)
      } catch {
        return 'Template body is not valid JSON.'
      }
    }
    if (editSchemaJson.trim()) {
      try {
        JSON.parse(editSchemaJson)
      } catch {
        return 'Input schema is not valid JSON.'
      }
    }
    return null
  }

  const onApproveWithEdits = () => {
    const v = validateClient()
    if (v) {
      setError(v)
      return
    }
    setError(null)
    startSubmit(async () => {
      const res = await approveAgentActionWithEdits({
        workspaceId,
        workflowId,
        approvalId: approval.approvalId,
        edits: {
          name: editName !== (approval.name ?? '') ? editName : undefined,
          description: editDescription !== (approval.description ?? '') ? editDescription : undefined,
          templateKind:
            editTemplateKind !== (approval.templateKind ?? '')
              ? (editTemplateKind as 'shell' | 'http' | 'composite')
              : undefined,
          templateJson:
            editTemplateJson !== (approval.templateJson ?? '') ? editTemplateJson : undefined,
          inputSchemaJson:
            editSchemaJson !== (approval.inputSchemaJson ?? '') ? editSchemaJson : undefined,
        },
      })
      if (!res.success) setError(res.error)
    })
  }

  return (
    <Card className="border-amber-500/40 bg-amber-50/40">
      <CardContent className="space-y-3 py-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs uppercase text-amber-600 font-medium">
              {approval.kind} • approval required
            </p>
            <h3 className="font-semibold">{approval.title}</h3>
          </div>
          {isToolReg && (
            <Button
              size="sm"
              variant={editing ? 'secondary' : 'outline'}
              onClick={() => setEditing((e) => !e)}
              disabled={disabled || submitting}
            >
              {editing ? 'Cancel edits' : 'Edit'}
            </Button>
          )}
        </div>

        {!editing && (
          <pre className="whitespace-pre-wrap text-sm font-sans">{approval.bodyMarkdown}</pre>
        )}

        {editing && isToolReg && (
          <div className="space-y-3 text-xs">
            <div className="space-y-1">
              <label className="font-medium block">Name</label>
              <input
                className="w-full rounded border bg-white px-2 py-1 font-mono"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                disabled={disabled || submitting}
              />
            </div>
            <div className="space-y-1">
              <label className="font-medium block">Description</label>
              <textarea
                className="w-full rounded border bg-white px-2 py-1"
                rows={2}
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                disabled={disabled || submitting}
              />
            </div>
            <div className="space-y-1">
              <label className="font-medium block">Template kind</label>
              <select
                className="w-full rounded border bg-white px-2 py-1 font-mono"
                value={editTemplateKind}
                onChange={(e) => setEditTemplateKind(e.target.value)}
                disabled={disabled || submitting}
              >
                <option value="shell">shell</option>
                <option value="http">http</option>
                <option value="composite">composite</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="font-medium block">Template body (JSON)</label>
              <textarea
                className="w-full rounded border bg-white px-2 py-1 font-mono"
                rows={6}
                value={editTemplateJson}
                onChange={(e) => setEditTemplateJson(e.target.value)}
                disabled={disabled || submitting}
              />
            </div>
            <div className="space-y-1">
              <label className="font-medium block">Input schema (JSON)</label>
              <textarea
                className="w-full rounded border bg-white px-2 py-1 font-mono"
                rows={4}
                value={editSchemaJson}
                onChange={(e) => setEditSchemaJson(e.target.value)}
                disabled={disabled || submitting}
              />
            </div>
            {approval.reasoning && (
              <details className="text-muted-foreground">
                <summary className="cursor-pointer">Agent's reasoning</summary>
                <pre className="whitespace-pre-wrap pt-2">{approval.reasoning}</pre>
              </details>
            )}
          </div>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}

        <div className="flex gap-2 flex-wrap">
          {!editing && (
            <Button size="sm" onClick={onApprove} disabled={disabled || submitting}>
              Approve as proposed
            </Button>
          )}
          {editing && (
            <Button size="sm" onClick={onApproveWithEdits} disabled={disabled || submitting}>
              {submitting ? 'Approving…' : 'Approve with edits'}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={onReject} disabled={disabled || submitting}>
            Reject
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setReplying((r) => !r)}
            disabled={disabled || submitting}
          >
            {replying ? 'Cancel reply' : 'Reply to agent'}
          </Button>
        </div>

        {replying && (
          <div className="space-y-2 pt-2 border-t">
            <p className="text-xs text-muted-foreground">
              Ask the agent to clarify, justify, or explore alternatives. The gate stays open while
              you discuss; the agent can only respond with text — not run new commands — until you
              approve or reject.
            </p>
            <Textarea
              value={reviewerMessage}
              onChange={(e) => setReviewerMessage(e.target.value)}
              placeholder="Why this command instead of …?"
              rows={2}
              disabled={disabled || replySubmitting}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  onSendReviewerMessage()
                }
              }}
            />
            {replyError && <p className="text-xs text-destructive">{replyError}</p>}
            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={onSendReviewerMessage}
                disabled={disabled || replySubmitting || !reviewerMessage.trim()}
              >
                {replySubmitting ? 'Sending…' : 'Send to agent'}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ToolOutputBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-start">
      <pre className="max-w-[85%] rounded-lg px-3 py-2 text-xs font-mono bg-slate-900 text-slate-100 whitespace-pre-wrap break-words">
        <span className="text-[10px] uppercase opacity-60 block mb-0.5">shell output</span>
        {text}
      </pre>
    </div>
  )
}
