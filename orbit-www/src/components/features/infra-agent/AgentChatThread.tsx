'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

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
  type PatternCategory,
} from '@/app/actions/infra-agent'

import { RunHeader } from './parts/RunHeader'
import { PhaseTimeline } from './parts/PhaseTimeline'
import { ContextStrip } from './parts/ContextStrip'
import { ToolCard } from './parts/ToolCard'
import { AgentThought } from './parts/AgentThought'
import { Composer } from './parts/Composer'
import { RecoveryBanner } from './parts/RecoveryBanner'
import { FloatingStatusBar } from './parts/FloatingStatusBar'
import { LiveUnavailableBanner } from './parts/LiveUnavailableBanner'
import { parseToolTurn } from './lib/tool-parsing'
import { derivePhases } from './lib/phases'
import { type AgentEventDTO } from './lib/agent-event-dto'

// Matches the workflow's recoverableErrorPrefix constant — stays in sync
// with temporal-workflows/internal/workflows/infrastructure_agent_workflow.go.
// When the AgentStatusUpdate proto gains a structured payload field this
// sentinel goes away in favor of a typed flag.
const RECOVERABLE_LLM_ERROR_PREFIX = '[recoverable_llm_error] '

interface RunContext {
  title: string
  startedAtIso: string
  workspaceName: string
  appName?: string
  appFramework?: string
  cloudName?: string
  cloudProvider?: string
  cloudRegion?: string
  llmModel?: string
}

interface Props {
  workspaceId: string
  workflowId: string
  /**
   * Persisted transcript loaded by the SSR page. Ingested on mount before the
   * SSE connects so reopening a run renders immediately; the live stream then
   * resumes from the max persisted sequence so nothing duplicates.
   */
  initialEvents?: AgentEventDTO[]
  /**
   * The run's Mongo status at SSR time. When terminal, history renders without
   * opening an SSE connection.
   */
  initialStatus?: string
  /** Optional run/workspace context used by RunHeader + ContextStrip. */
  context?: RunContext
}

interface ChatTurn {
  turnId: string
  role: string
  content: string
  toolName?: string
  toolCallId?: string
}

interface PendingApproval {
  approvalId: string
  kind: string
  title: string
  bodyMarkdown: string
  // Structured editable payload — populated for tool_registration and
  // pattern_registration kinds. displayName + category are
  // pattern-specific; the rest are shared.
  name?: string
  displayName?: string
  description?: string
  category?: string
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
// After this many consecutive failed reconnects (no successful open in
// between), give up and degrade to saved-history mode instead of looping
// forever — covers a workflow that vanished without a clean `gone` signal.
const MAX_RECONNECT_ATTEMPTS = RECONNECT_BACKOFF_MS.length

interface ToolOutputBuffer {
  callId: string
  // Accumulated stdout/stderr; rendered as a single code block under the
  // tool call so the user can read CLI prompts (e.g. az login device codes)
  // before the activity has returned.
  text: string
}

const TERMINAL_STATUSES = ['completed', 'aborted', 'failed', 'timeout']

export function AgentChatThread({
  workspaceId,
  workflowId,
  initialEvents,
  initialStatus,
  context,
}: Props) {
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [streamingTurns, setStreamingTurns] = useState<Record<string, string>>({})
  const [toolOutputs, setToolOutputs] = useState<Record<string, ToolOutputBuffer>>({})
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([])
  const [status, setStatus] = useState(initialStatus ?? 'starting')
  const [statusMessage, setStatusMessage] = useState('')
  // Set when the stream reports the workflow is gone (Temporal history purged)
  // — we stop reconnecting and surface a "showing saved history" banner.
  const [liveUnavailable, setLiveUnavailable] = useState(false)
  // Highest sequence we've ingested. Tracked in a ref so the SSE effect reads
  // the post-backfill cursor without re-subscribing when it changes.
  const maxSeqRef = useRef(0n)
  // Guard so the initial-events backfill runs exactly once.
  const backfilledRef = useRef(false)

  // The run was already finished when the page loaded: render the persisted
  // transcript without opening a live connection.
  const startedTerminal = initialStatus ? TERMINAL_STATUSES.includes(initialStatus) : false
  // Read inside the stable ingest() callback so a replayed historical
  // status_update can't downgrade a terminal SSR status (BUG-1). Kept in a
  // ref so ingest stays referentially stable (empty dep array).
  const startedTerminalRef = useRef(startedTerminal)
  startedTerminalRef.current = startedTerminal
  // Set when the workflow signals a recoverable LLM error — see issue #42.
  // Cleared when any subsequent status_update arrives without the sentinel
  // prefix (e.g. status goes back to "running" after /retry).
  const [recoveryError, setRecoveryError] = useState<string | null>(null)
  const [connection, setConnection] = useState<'connecting' | 'live' | 'reconnecting' | 'closed'>('connecting')
  const [input, setInput] = useState('')
  const [pending, startTransition] = useTransition()
  const scrollRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  // True while the run header is scrolled out of the viewport — drives the
  // floating status indicator so a long transcript still shows live status
  // without a scroll back to the top.
  const [headerVisible, setHeaderVisible] = useState(true)

  // Sequences already ingested, so a replayed batch (initial backfill overlap
  // with the first SSE frames, or an EventSource reconnect) is a no-op.
  const seenSequencesRef = useRef<Set<string>>(new Set())

  const ingest = useCallback((incoming: AgentEventDTO[]) => {
    // Belt-and-suspenders idempotency: drop any event whose sequence we've
    // already applied. token_delta events share a turn's sequence space but
    // are additive and ephemeral, so we never want to replay them either.
    const events: AgentEventDTO[] = []
    for (const e of incoming) {
      if (e.sequence && e.sequence !== '0') {
        if (seenSequencesRef.current.has(e.sequence)) continue
        seenSequencesRef.current.add(e.sequence)
        try {
          const s = BigInt(e.sequence)
          if (s > maxSeqRef.current) maxSeqRef.current = s
        } catch {
          // non-numeric sequence — ignore for cursor tracking
        }
      }
      events.push(e)
    }
    if (events.length === 0) return

    setTurns((prev) => {
      const next = [...prev]
      const indexByTurnId = new Map(next.map((t, i) => [t.turnId, i]))
      let modified = false
      for (const e of events) {
        if (e.kind === 'conversation_turn' && e.conversationTurn) {
          const ct = e.conversationTurn
          const idx = indexByTurnId.get(ct.turnId)
          const turn: ChatTurn = {
            turnId: ct.turnId,
            role: ct.role,
            content: ct.content,
            toolName: ct.toolName,
            toolCallId: ct.toolCallId,
          }
          if (idx === undefined) {
            indexByTurnId.set(ct.turnId, next.length)
            next.push(turn)
          } else {
            next[idx] = turn
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
            displayName: ar.displayName,
            description: ar.description,
            category: ar.category,
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
        // When the run was already terminal at SSR time, a replayed
        // historical status_update (e.g. the last persisted "running") must
        // not downgrade the effective state back to non-terminal — that would
        // re-enable the composer and hide the ended treatment against a dead
        // workflow (BUG-1). Ignore status/message mutations from backfill in
        // that case; the SSR-provided terminal status stands.
        if (startedTerminalRef.current) continue
        setStatus(e.statusUpdate.status)
        const msg = e.statusUpdate.message ?? ''
        if (msg.startsWith(RECOVERABLE_LLM_ERROR_PREFIX)) {
          const errText = msg.slice(RECOVERABLE_LLM_ERROR_PREFIX.length)
          setRecoveryError(errText)
          setStatusMessage(errText)
        } else {
          setRecoveryError(null)
          setStatusMessage(msg)
        }
      }
    }
  }, [])

  // Backfill the persisted transcript on mount, before SSE connects. Runs
  // once; the seenSequences guard inside ingest makes the subsequent SSE
  // resume idempotent even if the stream replays an overlapping frame.
  useEffect(() => {
    if (backfilledRef.current) return
    backfilledRef.current = true
    if (initialEvents && initialEvents.length > 0) {
      ingest(initialEvents)
    }
  }, [initialEvents, ingest])

  // SSE subscription. EventSource auto-reconnects with Last-Event-ID; we
  // also handle our own reconnect-on-error path with exponential backoff
  // (capped) since EventSource's built-in retry doesn't surface auth or
  // server-side close events to us cleanly. The `done` event from the
  // proxy means the workflow finished — we treat that as a clean close
  // and do not reconnect. The `gone` event means the Temporal workflow no
  // longer exists: we stop reconnecting and show the saved-history banner.
  //
  // Skipped entirely when the run was already terminal at SSR time — there's
  // nothing live to stream, so we render the persisted history only.
  useEffect(() => {
    if (startedTerminal) {
      setConnection('closed')
      return
    }

    let cancelled = false
    let attempt = 0
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let es: EventSource | null = null

    const stopForGone = () => {
      cancelled = true
      setConnection('closed')
      setLiveUnavailable(true)
      es?.close()
    }

    const connect = () => {
      if (cancelled) return
      setConnection(attempt === 0 ? 'connecting' : 'reconnecting')

      // Resume from the highest sequence we've already ingested (initial
      // backfill + any prior stream frames) so the server doesn't resend the
      // persisted history.
      const since = maxSeqRef.current.toString()
      const url = `/api/agent/${encodeURIComponent(workflowId)}/stream?since=${since}`
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

      // The workflow history is gone (Temporal retention expired / workflow
      // terminated). The server already reconciled the run status; stop
      // reconnecting and keep the rendered history with a notice.
      es.addEventListener('gone', stopForGone)

      es.addEventListener('error', () => {
        // EventSource will retry on its own, but we want to disambiguate
        // "transient network blip" from "server gave up". Close + reopen
        // ourselves with a backoff so reconnects don't hammer the server
        // when the workflow is genuinely gone. After a capped number of
        // failed attempts with no successful open, treat the connection as
        // unavailable instead of looping forever on an empty thread.
        es?.close()
        if (cancelled) return
        if (attempt >= MAX_RECONNECT_ATTEMPTS) {
          stopForGone()
          return
        }
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
  }, [workflowId, ingest, startedTerminal])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns, streamingTurns, proposal, pendingApprovals.length])

  // Watch the run header — the floating status bar appears only when it's
  // off-screen, so we don't double-render the same info at the top of the page.
  useEffect(() => {
    const el = headerRef.current
    if (!el) return
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setHeaderVisible(entry.isIntersecting)
      },
      { threshold: 0, rootMargin: '-48px 0px 0px 0px' },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const onSend = () => {
    const text = input.trim()
    if (!text) return
    setInput('')
    startTransition(async () => {
      const result = await sendAgentMessage({ workspaceId, workflowId, message: text })
      if (!result.success) setStatusMessage(result.error)
    })
  }

  // Recoverable-LLM-error actions. Both are just user-message signals
  // with sentinel content the workflow special-cases.
  const sendControl = (control: '/retry' | '/done') =>
    startTransition(async () => {
      const result = await sendAgentMessage({ workspaceId, workflowId, message: control })
      if (!result.success) {
        setStatusMessage(result.error)
        return
      }
      // Optimistic: hide the banner immediately; if the workflow surfaces
      // another recoverable error, the status_update handler will reset it.
      setRecoveryError(null)
    })
  const onRetryLastTurn = () => sendControl('/retry')
  const onMarkDone = () => sendControl('/done')

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

  // The run is "ended" for UI purposes when its status is terminal or when
  // the live feed is gone (workflow purged) — either way there's nothing more
  // to stream and the composer can't reach a live workflow.
  const terminal = TERMINAL_STATUSES.includes(status) || liveUnavailable

  // Live elapsed-time counter for the header. Tick once a second; pause
  // when the run is terminal so we don't keep re-rendering forever.
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    if (terminal) return
    const id = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [terminal])
  const elapsedLabel = useMemo(() => {
    if (!context?.startedAtIso) return null
    const startedMs = new Date(context.startedAtIso).getTime()
    if (Number.isNaN(startedMs)) return null
    return formatElapsed(Math.max(0, nowMs - startedMs))
  }, [context?.startedAtIso, nowMs])

  // Derive phase timeline from observable state.
  const phases = useMemo(() => {
    const toolTurnCount = turns.filter((t) => t.role === 'tool').length
    const approvalOpen = pendingApprovals.length > 0
    const approvalResolved = !approvalOpen && (proposal != null || statusHasExecutedHint(status))
    return derivePhases({
      status,
      toolTurnCount,
      proposalSeen: proposal != null,
      approvalOpen,
      approvalResolved,
      // Approximated: tool turns *after* a proposal indicates execution
      // is underway. Refined in Phase 2 when the workflow emits explicit
      // phase markers.
      executingToolCount: approvalResolved ? toolTurnCount : 0,
    })
  }, [turns, proposal, pendingApprovals.length, status])

  const contextChips = useMemo(() => buildContextChips(context), [context])

  // Active phase for the floating status bar. Falls back to the last "done"
  // phase on terminal runs so the bar still says something useful.
  const activePhase = useMemo(() => {
    return (
      phases.find((p) => p.status === 'active') ??
      [...phases].reverse().find((p) => p.status === 'done') ??
      phases[0] ??
      null
    )
  }, [phases])

  return (
    <div className="flex flex-col h-full gap-4">
      {context && (
        <div ref={headerRef}>
          <RunHeader
            title={context.title}
            status={status}
            startedAt={new Date(context.startedAtIso).toLocaleString()}
            elapsedLabel={elapsedLabel}
            runId={workflowId}
            terminal={terminal}
            busy={pending}
            onAbort={onAbort}
          />
        </div>
      )}

      <PhaseTimeline phases={phases} />

      {contextChips.length > 0 && <ContextStrip chips={contextChips} />}

      {liveUnavailable && <LiveUnavailableBanner />}

      {(connection !== 'live' || statusMessage) && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {connection !== 'live' && connection !== 'closed' && (
            <Badge variant="outline" className="text-amber-500 border-amber-500/40">
              {connection === 'connecting' ? 'connecting…' : 'reconnecting…'}
            </Badge>
          )}
          {statusMessage && (
            <span className="text-muted-foreground truncate">{statusMessage}</span>
          )}
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto pr-2">
        <ActivityRail>
          {turns.map((t) => {
            if (t.role === 'tool') {
              const parsed = parseToolTurn(t.content, { toolName: t.toolName })
              return (
                <ActivityRailItem
                  key={t.turnId}
                  variant={parsed.status === 'error' ? 'error' : 'ok'}
                >
                  <ToolCard parsed={parsed} />
                </ActivityRailItem>
              )
            }
            if (t.role === 'assistant') {
              return (
                <ActivityRailItem key={t.turnId} variant="thought">
                  <AgentThought content={t.content} />
                </ActivityRailItem>
              )
            }
            if (t.role === 'user') {
              return (
                <ActivityRailItem key={t.turnId} variant="user">
                  <UserBubble content={t.content} />
                </ActivityRailItem>
              )
            }
            return null
          })}
          {Object.entries(streamingTurns).map(([turnId, content]) => (
            <ActivityRailItem key={`stream-${turnId}`} variant="thought">
              <AgentThought content={content + '▍'} />
            </ActivityRailItem>
          ))}

          {Object.values(toolOutputs).map((buf) => (
            <ActivityRailItem key={`out-${buf.callId}`} variant="running">
              <ToolOutputBubble text={buf.text} />
            </ActivityRailItem>
          ))}

          {proposal && (
            <ActivityRailItem variant="accent">
              <ProposalBlock proposal={proposal} />
            </ActivityRailItem>
          )}

          {pendingApprovals.map((a) => (
            <ActivityRailItem key={a.approvalId} variant="accent">
              <ApprovalCard
                approval={a}
                workspaceId={workspaceId}
                workflowId={workflowId}
                disabled={pending}
                onApprove={() => onApprove(a.approvalId)}
                onReject={() => onReject(a.approvalId)}
              />
            </ActivityRailItem>
          ))}
        </ActivityRail>
      </div>

      {recoveryError && !terminal && (
        <RecoveryBanner
          errorText={recoveryError}
          onRetry={onRetryLastTurn}
          onMarkDone={onMarkDone}
          busy={pending}
        />
      )}

      <Composer
        value={input}
        onChange={setInput}
        onSend={onSend}
        awaiting={status === 'awaiting_user'}
        disabled={terminal}
        sending={pending}
      />

      <FloatingStatusBar
        visible={!headerVisible}
        status={status}
        elapsedLabel={elapsedLabel}
        activePhase={activePhase}
        terminal={terminal}
        busy={pending}
        onAbort={onAbort}
      />
    </div>
  )
}

// ──────────────────────────── Activity rail ────────────────────────────
// Vertical timeline rail with a colored node per item — gives the
// transcript a thread of execution to scan down.
function ActivityRail({ children }: { children: React.ReactNode }) {
  return <div className="relative pl-5">
    <div className="absolute left-[10px] top-1 bottom-1 w-px bg-border" aria-hidden />
    <div className="flex flex-col gap-2">{children}</div>
  </div>
}

function ActivityRailItem({
  variant = 'ok',
  children,
}: {
  variant?: 'ok' | 'error' | 'running' | 'thought' | 'user' | 'accent'
  children: React.ReactNode
}) {
  const nodeClass = ({
    ok: 'bg-emerald-500 border-emerald-500',
    error: 'bg-red-500 border-red-500',
    running: 'bg-sky-500 border-sky-500 shadow-[0_0_0_3px_rgba(56,189,248,0.18)]',
    thought: 'bg-background border-orange-500/70 border-dashed',
    user: 'bg-foreground/60 border-foreground/60',
    accent: 'bg-orange-500 border-orange-500 shadow-[0_0_0_3px_rgba(255,106,44,0.22)]',
  })[variant]
  return (
    <div className="relative">
      <span
        className={`absolute -left-[14px] top-2 h-2.5 w-2.5 rounded-full border-[1.5px] ${nodeClass}`}
        aria-hidden
      />
      {children}
    </div>
  )
}

function UserBubble({ content }: { content: string }) {
  return (
    <div className="rounded-lg bg-muted/40 border border-border/60 px-3 py-2 text-sm whitespace-pre-wrap">
      <div className="mb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">You</div>
      {content}
    </div>
  )
}

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function statusHasExecutedHint(status: string): boolean {
  return status === 'running' || status === 'completed'
}

function buildContextChips(ctx?: RunContext) {
  if (!ctx) return []
  const chips: Array<{ key: string; label: string; suffix?: string; icon: 'workspace' | 'github' | 'cloud' | 'model'; accent?: boolean }> = []
  chips.push({ key: 'workspace', label: ctx.workspaceName, icon: 'workspace', accent: true })
  if (ctx.appName) {
    chips.push({ key: 'app', label: ctx.appName, suffix: ctx.appFramework, icon: 'github' })
  }
  if (ctx.cloudName) {
    chips.push({
      key: 'cloud',
      label: ctx.cloudName,
      suffix: [ctx.cloudProvider, ctx.cloudRegion].filter(Boolean).join(' · ') || undefined,
      icon: 'cloud',
    })
  }
  if (ctx.llmModel) {
    chips.push({ key: 'model', label: ctx.llmModel, icon: 'model' })
  }
  return chips
}

function ProposalBlock({ proposal }: { proposal: Proposal }) {
  const [open, setOpen] = useState(true)
  return (
    <Card className="border-orange-500/30 bg-orange-500/[0.04]">
      <CardContent className="space-y-2 py-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-start gap-2 text-left cursor-pointer"
        >
          <span className="mt-1 inline-flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground">
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-wider text-orange-400 font-semibold">
              Latest proposal
            </p>
            <h3 className="text-sm font-semibold">{proposal.title}</h3>
            {(!open || !proposal.summary) ? null : (
              <p className="mt-0.5 text-xs text-muted-foreground">{proposal.summary}</p>
            )}
          </div>
        </button>
        {open && proposal.bodyMarkdown && (
          <pre className="whitespace-pre-wrap pt-1 pl-6 text-sm font-sans">
            {proposal.bodyMarkdown}
          </pre>
        )}
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
  const isPatternReg = approval.kind === 'pattern_registration'
  const isEditable = isToolReg || isPatternReg
  const [editing, setEditing] = useState(false)
  const [replying, setReplying] = useState(false)
  const [reviewerMessage, setReviewerMessage] = useState('')
  const [editName, setEditName] = useState(approval.name ?? '')
  const [editDisplayName, setEditDisplayName] = useState(approval.displayName ?? '')
  const [editDescription, setEditDescription] = useState(approval.description ?? '')
  const [editCategory, setEditCategory] = useState(approval.category ?? 'other')
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
          // Pattern-specific edit fields. Ignored server-side for
          // tool_registration; honored for pattern_registration.
          displayName: isPatternReg && editDisplayName !== (approval.displayName ?? '')
            ? editDisplayName
            : undefined,
          category: isPatternReg && editCategory !== (approval.category ?? '')
            ? (editCategory as PatternCategory)
            : undefined,
        },
      })
      if (!res.success) setError(res.error)
    })
  }

  const [bodyOpen, setBodyOpen] = useState(true)

  return (
    <Card className="border-orange-500/40 bg-orange-500/[0.04]">
      <CardContent className="space-y-3 py-3">
        <div className="flex items-start justify-between gap-2">
          <button
            type="button"
            onClick={() => setBodyOpen((o) => !o)}
            className="flex min-w-0 flex-1 items-start gap-2 text-left cursor-pointer"
          >
            <span className="mt-1 inline-flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground">
              {bodyOpen ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
            </span>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-orange-400 font-semibold">
                {approval.kind} • approval required
              </p>
              <h3 className="text-sm font-semibold">{approval.title}</h3>
            </div>
          </button>
          {isEditable && (
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

        {bodyOpen && !editing && approval.bodyMarkdown && (
          <pre className="whitespace-pre-wrap pl-6 text-sm font-sans">{approval.bodyMarkdown}</pre>
        )}

        {editing && isEditable && (
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
            {isPatternReg && (
              <div className="space-y-1">
                <label className="font-medium block">Display name</label>
                <input
                  className="w-full rounded border bg-white px-2 py-1"
                  value={editDisplayName}
                  onChange={(e) => setEditDisplayName(e.target.value)}
                  disabled={disabled || submitting}
                />
              </div>
            )}
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
            {isPatternReg && (
              <div className="space-y-1">
                <label className="font-medium block">Category</label>
                <select
                  className="w-full rounded border bg-white px-2 py-1 font-mono"
                  value={editCategory}
                  onChange={(e) => setEditCategory(e.target.value)}
                  disabled={disabled || submitting}
                >
                  <option value="compute">compute</option>
                  <option value="data">data</option>
                  <option value="cache">cache</option>
                  <option value="queue">queue</option>
                  <option value="observability">observability</option>
                  <option value="edge">edge</option>
                  <option value="static-site">static-site</option>
                  <option value="other">other</option>
                </select>
              </div>
            )}
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
                <summary className="cursor-pointer">Agent&apos;s reasoning</summary>
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
