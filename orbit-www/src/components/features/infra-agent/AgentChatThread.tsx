'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'

import {
  abortAgentRun,
  approveAgentAction,
  getAgentEvents,
  rejectAgentAction,
  sendAgentMessage,
  type AgentEventDTO,
} from '@/app/actions/infra-agent'

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
}

interface Proposal {
  proposalId: string
  title: string
  summary: string
  bodyMarkdown: string
}

const POLL_INTERVAL_MS = 600

export function AgentChatThread({ workspaceId, workflowId }: Props) {
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [streamingTurns, setStreamingTurns] = useState<Record<string, string>>({})
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([])
  const [status, setStatus] = useState('starting')
  const [statusMessage, setStatusMessage] = useState('')
  const [input, setInput] = useState('')
  const [pending, startTransition] = useTransition()
  const sinceRef = useRef<bigint>(0n)
  const cancelledRef = useRef(false)
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

  useEffect(() => {
    cancelledRef.current = false
    let timer: ReturnType<typeof setTimeout> | null = null

    async function loop() {
      while (!cancelledRef.current) {
        try {
          const result = await getAgentEvents({
            workspaceId,
            workflowId,
            since: sinceRef.current,
          })
          if (result.success && result.events) {
            ingest(result.events)
            if (result.latest !== undefined) sinceRef.current = result.latest
          }
        } catch {
          // tolerate transient failures
        }
        if (cancelledRef.current) break
        await new Promise<void>((resolve) => {
          timer = setTimeout(resolve, POLL_INTERVAL_MS)
        })
      }
    }

    loop()
    return () => {
      cancelledRef.current = true
      if (timer) clearTimeout(timer)
    }
  }, [workspaceId, workflowId, ingest])

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

        {proposal && <ProposalBlock proposal={proposal} />}

        {pendingApprovals.map((a) => (
          <Card key={a.approvalId} className="border-amber-500/40 bg-amber-50/40">
            <CardContent className="space-y-3 py-4">
              <div>
                <p className="text-xs uppercase text-amber-600 font-medium">{a.kind} • approval required</p>
                <h3 className="font-semibold">{a.title}</h3>
              </div>
              <pre className="whitespace-pre-wrap text-sm font-sans">{a.bodyMarkdown}</pre>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => onApprove(a.approvalId)} disabled={pending}>
                  Approve
                </Button>
                <Button size="sm" variant="outline" onClick={() => onReject(a.approvalId)} disabled={pending}>
                  Reject
                </Button>
              </div>
            </CardContent>
          </Card>
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
