'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Brain,
  Clock,
  Eye,
  Check,
  Building2,
  Github,
  Sparkles,
  Rocket,
  Shield,
  ChevronDown,
  ChevronUp,
  ArrowUpRight,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type AttentionRunKind = 'awaiting' | 'running' | 'approval'

export interface AttentionPhase {
  key: string
  label: string
  status: 'done' | 'active' | 'pending'
}

export interface AttentionRun {
  id: string
  kind: AttentionRunKind
  title: string
  workspace: string
  app?: string
  startedRel: string
  elapsed?: string
  lastThought?: string
  phases?: AttentionPhase[]
  href: string
  model?: string
}

interface DashboardAttentionProps {
  runs: AttentionRun[]
  /** Total pending approvals available server-side (may exceed the fetched slice). */
  approvalsTotal?: number
  /** Total active agent runs available server-side (may exceed the fetched slice). */
  runsTotal?: number
}

const COLLAPSED_KEY = 'orbit.attentionHub.collapsed'
const SEEN_IDS_KEY = 'orbit.attentionHub.seenIds'
const MAX_VISIBLE_QUEUE = 4

// Higher-priority kinds rank first: something awaiting your input outranks a pending
// approval, which outranks a run that's merely executing.
const KIND_RANK: Record<AttentionRunKind, number> = { awaiting: 0, approval: 1, running: 2 }

const kindShortLabel: Record<AttentionRunKind, string> = {
  awaiting: 'awaiting input',
  running: 'running',
  approval: 'needs approval',
}

/**
 * Order by kind priority, then oldest-first within a kind. The incoming `runs` arrive
 * newest-first within each source (page.tsx sorts approvals `-createdAt` and runs
 * `-startedAt` desc), so oldest-first within a kind is the reverse of input order —
 * achieved by tiebreaking on the original index descending.
 */
function prioritize(runs: AttentionRun[]): AttentionRun[] {
  return runs
    .map((run, index) => ({ run, index }))
    .sort((a, b) => {
      const rankDiff = KIND_RANK[a.run.kind] - KIND_RANK[b.run.kind]
      if (rankDiff !== 0) return rankDiff
      return b.index - a.index
    })
    .map((entry) => entry.run)
}

export function DashboardAttention({ runs, approvalsTotal, runsTotal }: DashboardAttentionProps) {
  // UAC-1: nothing to show. UAC-2: a lone item keeps the original rich card with no
  // hub chrome. UAC-3: two or more consolidate into a single bounded hub.
  if (runs.length === 0) return null
  if (runs.length === 1) return <AttentionCard run={runs[0]} />
  return <AttentionHub runs={runs} approvalsTotal={approvalsTotal} runsTotal={runsTotal} />
}

function AttentionHub({ runs, approvalsTotal, runsTotal }: Required<Pick<DashboardAttentionProps, 'runs'>> & Pick<DashboardAttentionProps, 'approvalsTotal' | 'runsTotal'>) {
  const prioritized = useMemo(() => prioritize(runs), [runs])

  // Render expanded on the server and on the first client render to avoid a hydration
  // mismatch; the persisted collapse preference is reconciled in an effect after mount
  // (a brief flash of the expanded panel is acceptable and deliberate).
  const [collapsed, setCollapsed] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const [spotlightId, setSpotlightId] = useState<string>(prioritized[0].id)
  const [queueExpanded, setQueueExpanded] = useState(false)

  const runIdsKey = useMemo(() => runs.map((r) => r.id).join('|'), [runs])

  // Mount: reconcile persisted collapse state and auto-expand if any current item was
  // not previously seen (UAC-7 / UAC-8). Also refresh the persisted seen-id set.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const currentIds = runIdsKey ? runIdsKey.split('|') : []

    let stored = false
    try {
      stored = window.localStorage.getItem(COLLAPSED_KEY) === 'true'
    } catch {
      stored = false
    }

    let seen: string[] = []
    try {
      const raw = window.localStorage.getItem(SEEN_IDS_KEY)
      const parsed = raw ? JSON.parse(raw) : []
      if (Array.isArray(parsed)) seen = parsed.filter((x): x is string => typeof x === 'string')
    } catch {
      seen = []
    }

    const hasNewItem = currentIds.some((id) => !seen.includes(id))
    setCollapsed(hasNewItem ? false : stored)

    try {
      window.localStorage.setItem(SEEN_IDS_KEY, JSON.stringify(currentIds))
    } catch {
      /* storage unavailable — non-fatal */
    }
    setHydrated(true)
  }, [runIdsKey])

  // Persist collapse preference on change, but only after the mount reconcile has run
  // so we never clobber a stored value with the initial expanded default.
  useEffect(() => {
    if (!hydrated || typeof window === 'undefined') return
    try {
      window.localStorage.setItem(COLLAPSED_KEY, String(collapsed))
    } catch {
      /* storage unavailable — non-fatal */
    }
  }, [collapsed, hydrated])

  const spotlight = prioritized.find((r) => r.id === spotlightId) ?? prioritized[0]
  const queue = prioritized.filter((r) => r.id !== spotlight.id)

  const hasOverflow = queue.length > MAX_VISIBLE_QUEUE
  const visibleQueue = queueExpanded || !hasOverflow ? queue : queue.slice(0, MAX_VISIBLE_QUEUE)
  const hiddenCount = queue.length - visibleQueue.length

  // Per-kind counts, folding in server-side overflow totals (UAC-5). approvalsTotal maps
  // cleanly to approvals; runsTotal covers running + awaiting combined, and since we
  // can't know the split of unfetched runs we surface any overflow on the running count.
  const fetchedApproval = runs.filter((r) => r.kind === 'approval').length
  const fetchedAwaiting = runs.filter((r) => r.kind === 'awaiting').length
  const fetchedRunning = runs.filter((r) => r.kind === 'running').length
  const fetchedRunKinds = fetchedAwaiting + fetchedRunning

  const approvalCount = Math.max(fetchedApproval, approvalsTotal ?? 0)
  const runOverflow = Math.max(0, (runsTotal ?? 0) - fetchedRunKinds)
  const runningCount = fetchedRunning + runOverflow
  const awaitingCount = fetchedAwaiting

  const summaryParts: string[] = []
  if (approvalCount > 0) summaryParts.push(`${approvalCount} approval${approvalCount === 1 ? '' : 's'}`)
  if (awaitingCount > 0) summaryParts.push(`${awaitingCount} awaiting input`)
  if (runningCount > 0) summaryParts.push(`${runningCount} running`)
  const summary = summaryParts.join(' · ')

  const showApprovalsLink = (approvalsTotal ?? 0) > fetchedApproval
  const showRunsLink = (runsTotal ?? 0) > fetchedRunKinds

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <header className="flex h-11 items-center gap-3 px-4">
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60 motion-reduce:animate-none" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
        </span>
        <span className="text-[13px] font-semibold tracking-[-0.005em] text-foreground">Needs your attention</span>
        {summary && (
          <span className="min-w-0 truncate text-[12px] text-muted-foreground">
            <span className="text-muted-foreground/60">·</span> {summary}
          </span>
        )}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand attention panel' : 'Collapse attention panel'}
          className="ml-auto shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground motion-reduce:transition-none"
        >
          {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        </button>
      </header>

      {!collapsed && (
        <div className="flex flex-col gap-3 border-t border-border p-4">
          {/* Spotlight — keyed by id so a swap re-renders the rich card cleanly. */}
          <div key={spotlight.id} className="transition-all duration-200 motion-reduce:transition-none">
            <AttentionCard run={spotlight} />
          </div>

          {queue.length > 0 && (
            // Bound the queue so the panel stays within its ~420px envelope (UAC-16);
            // excess rows scroll here rather than growing the panel.
            <div className="flex max-h-[196px] flex-col gap-1.5 overflow-y-auto">
              {visibleQueue.map((run) => (
                <QueueRow key={run.id} run={run} onPromote={() => setSpotlightId(run.id)} />
              ))}
            </div>
          )}

          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setQueueExpanded(true)}
              className="self-start rounded-md px-1.5 py-0.5 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground motion-reduce:transition-none"
            >
              Show {hiddenCount} more
            </button>
          )}
          {hasOverflow && queueExpanded && (
            <button
              type="button"
              onClick={() => setQueueExpanded(false)}
              className="self-start rounded-md px-1.5 py-0.5 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground motion-reduce:transition-none"
            >
              Show less
            </button>
          )}

          {(showApprovalsLink || showRunsLink) && (
            <div className="flex flex-wrap items-center gap-4 border-t border-dashed border-border pt-3 text-[12px]">
              {showApprovalsLink && (
                <Link href="/platform/approvals" className="font-medium text-primary hover:underline">
                  View all approvals →
                </Link>
              )}
              {showRunsLink && (
                <Link href="/agent" className="font-medium text-primary hover:underline">
                  View all runs →
                </Link>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function QueueRow({ run, onPromote }: { run: AttentionRun; onPromote: () => void }) {
  const cfg = kindConfig[run.kind]
  return (
    <div className="group flex items-center gap-2 rounded-lg border border-border/60 bg-background/40 pr-1.5 transition-colors duration-200 hover:bg-accent/40 motion-reduce:transition-none">
      <button
        type="button"
        onClick={onPromote}
        aria-label={`${run.title} — ${kindShortLabel[run.kind]} — promote to spotlight`}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-3 py-2 text-left"
      >
        <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md ${cfg.iconWrapClass}`}>
          <cfg.Icon className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium tracking-[-0.005em] text-foreground">{run.title}</span>
          <span className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
            <Building2 className="h-3 w-3 shrink-0 opacity-60" />
            <span className="truncate">{run.workspace}</span>
            <span className="text-muted-foreground/60">·</span>
            <Clock className="h-3 w-3 shrink-0 opacity-60" />
            <span className="whitespace-nowrap">{run.startedRel}</span>
          </span>
        </span>
        <span className="hidden shrink-0 sm:block">
          <StatusPill kind={run.kind} />
        </span>
      </button>
      <Link
        href={run.href}
        aria-label={`Open ${run.title}`}
        className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground motion-reduce:transition-none"
      >
        <ArrowUpRight className="h-4 w-4" />
      </Link>
    </div>
  )
}

interface KindConfig {
  highlighted: boolean
  iconWrapClass: string
  Icon: LucideIcon
  pillClass: string
  pillDotClass: string
  pillLabel: string
  ctaLabel: string
  CtaIcon: LucideIcon
  thoughtLabelClass: string
  thoughtBorderClass: string
  bannerCopy: string
}

const kindConfig: Record<AttentionRunKind, KindConfig> = {
  awaiting: {
    highlighted: true,
    iconWrapClass: 'bg-primary/10 text-primary',
    Icon: Sparkles,
    pillClass: 'border-primary/30 bg-primary/10 text-primary',
    pillDotClass: 'bg-primary',
    pillLabel: 'Awaiting your input',
    ctaLabel: 'Review & approve',
    CtaIcon: Check,
    thoughtLabelClass: 'text-primary',
    thoughtBorderClass: 'border-primary/40',
    bannerCopy: 'Plan ready — review the proposed changes before they execute.',
  },
  running: {
    highlighted: false,
    iconWrapClass: 'bg-blue-500/10 text-blue-500',
    Icon: Rocket,
    pillClass: 'border-blue-500/30 bg-blue-500/10 text-blue-500',
    pillDotClass: 'bg-blue-500',
    pillLabel: 'Running',
    ctaLabel: 'Open run',
    CtaIcon: Eye,
    thoughtLabelClass: 'text-blue-500',
    thoughtBorderClass: 'border-blue-500/40',
    bannerCopy: "Executing autonomously — I'll surface anything that needs your call.",
  },
  approval: {
    highlighted: true,
    iconWrapClass: 'bg-amber-500/10 text-amber-500',
    Icon: Shield,
    pillClass: 'border-amber-500/30 bg-amber-500/10 text-amber-500',
    pillDotClass: 'bg-amber-500',
    pillLabel: 'Needs approval',
    ctaLabel: 'Review & approve',
    CtaIcon: Check,
    thoughtLabelClass: 'text-amber-500',
    thoughtBorderClass: 'border-amber-500/40',
    bannerCopy: 'Approval requested — review before this proceeds.',
  },
}

function AttentionCard({ run }: { run: AttentionRun }) {
  const cfg = kindConfig[run.kind]
  const hasAside = run.lastThought !== undefined || run.model !== undefined

  return (
    <article
      className={
        cfg.highlighted
          ? `grid grid-cols-1 overflow-hidden rounded-xl border border-primary/30 bg-card shadow-[0_1px_0_rgba(255,255,255,0.02)_inset,_0_8px_24px_rgba(0,0,0,0.35)] ${hasAside ? 'lg:grid-cols-[1fr_320px]' : ''}`
          : `grid grid-cols-1 overflow-hidden rounded-xl border border-border bg-card ${hasAside ? 'lg:grid-cols-[1fr_320px]' : ''}`
      }
    >
      <div className={hasAside ? 'min-w-0 border-b border-border p-5 lg:border-b-0 lg:border-r' : 'min-w-0 p-5'}>
        <div className="mb-3.5 flex items-start gap-3">
          <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${cfg.iconWrapClass}`}>
            <cfg.Icon className="h-[18px] w-[18px]" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="mb-1 flex flex-wrap items-center gap-2 text-[15px] font-semibold tracking-[-0.005em] text-foreground">
              {run.title}
              <span className="font-mono text-[12px] font-normal text-muted-foreground">· {run.id}</span>
            </h3>
            <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
              <StatusPill kind={run.kind} />
              <span className="text-muted-foreground/60">·</span>
              <span className="inline-flex items-center gap-1">
                <Building2 className="h-3 w-3 opacity-60" />
                {run.workspace}
              </span>
              {run.app && (
                <>
                  <span className="text-muted-foreground/60">·</span>
                  <span className="inline-flex items-center gap-1">
                    <Github className="h-3 w-3 opacity-60" />
                    {run.app}
                  </span>
                </>
              )}
              <span className="text-muted-foreground/60">·</span>
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3 opacity-60" />
                Started {run.startedRel}
                {run.elapsed ? ` · ${run.elapsed} elapsed` : ''}
              </span>
            </div>
          </div>
        </div>

        {run.phases && run.phases.length > 0 && <MiniPhases phases={run.phases} />}

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-dashed border-border pt-3.5">
          <span className="text-[12px] text-muted-foreground">{cfg.bannerCopy}</span>
          <div className="ml-auto flex gap-1.5">
            <Button size="sm" variant="outline" asChild>
              <Link href={run.href}>View transcript</Link>
            </Button>
            <Button size="sm" asChild>
              <Link href={run.href}>
                <cfg.CtaIcon className="mr-1.5 h-3.5 w-3.5" />
                {cfg.ctaLabel}
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {hasAside && (
        <aside className="flex flex-col p-5">
          {run.lastThought && (
            <>
              <h4 className="mb-2.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Latest thought
              </h4>
              <div className={`mb-3.5 border-l-2 ${cfg.thoughtBorderClass} pl-3 text-[12.5px] leading-[1.5] text-foreground/80`}>
                <span className={`mb-0.5 block text-[10px] font-semibold uppercase tracking-[0.08em] ${cfg.thoughtLabelClass}`}>
                  Agent
                </span>
                {run.lastThought}
              </div>
            </>
          )}
          {run.model && (
            <div className="mt-auto flex items-center gap-2 text-[11.5px] text-muted-foreground">
              <Brain className="h-3.5 w-3.5" />
              <span>{run.model}</span>
            </div>
          )}
        </aside>
      )}
    </article>
  )
}

function MiniPhases({ phases }: { phases: AttentionPhase[] }) {
  return (
    <div className="flex flex-wrap items-center">
      {phases.map((p, i) => (
        <span key={p.key} className="flex items-center">
          <span
            className={
              p.status === 'active'
                ? 'inline-flex items-center gap-1.5 whitespace-nowrap text-[11.5px] font-medium text-foreground'
                : p.status === 'done'
                  ? 'inline-flex items-center gap-1.5 whitespace-nowrap text-[11.5px] text-foreground/80'
                  : 'inline-flex items-center gap-1.5 whitespace-nowrap text-[11.5px] text-muted-foreground'
            }
          >
            <span
              className={
                p.status === 'active'
                  ? 'h-[7px] w-[7px] rounded-full bg-primary shadow-[0_0_0_3px_rgb(var(--primary)/0.15)] animate-pulse'
                  : p.status === 'done'
                    ? 'h-[7px] w-[7px] rounded-full bg-green-500'
                    : 'h-[7px] w-[7px] rounded-full border border-border bg-muted'
              }
              style={
                p.status === 'active'
                  ? { boxShadow: '0 0 0 3px color-mix(in oklab, var(--primary) 20%, transparent)' }
                  : undefined
              }
            />
            <span>{p.label}</span>
          </span>
          {i < phases.length - 1 && (
            <span
              className={
                p.status === 'done'
                  ? 'mx-2 inline-block h-px w-5 bg-green-500/40'
                  : 'mx-2 inline-block h-px w-5 bg-border'
              }
            />
          )}
        </span>
      ))}
    </div>
  )
}

function StatusPill({ kind }: { kind: AttentionRunKind }) {
  const cfg = kindConfig[kind]
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11.5px] font-medium ${cfg.pillClass}`}>
      <span className={`h-1.5 w-1.5 animate-pulse rounded-full ${cfg.pillDotClass}`} />
      {cfg.pillLabel}
    </span>
  )
}
