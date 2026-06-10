import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Brain, Clock, Eye, Check, Building2, Github, Sparkles, Rocket } from 'lucide-react'

export type AttentionRunKind = 'awaiting' | 'running'

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
  app: string
  startedRel: string
  elapsed: string
  lastThought: string
  phases: AttentionPhase[]
  href: string
  model?: string
}

interface DashboardAttentionProps {
  runs: AttentionRun[]
}

export function DashboardAttention({ runs }: DashboardAttentionProps) {
  if (runs.length === 0) return null
  return (
    <div className="flex flex-col gap-3">
      {runs.map((run) => (
        <AttentionCard key={run.id} run={run} />
      ))}
    </div>
  )
}

function AttentionCard({ run }: { run: AttentionRun }) {
  const awaiting = run.kind === 'awaiting'
  return (
    <article
      className={
        awaiting
          ? 'grid grid-cols-1 overflow-hidden rounded-xl border border-primary/30 bg-card shadow-[0_1px_0_rgba(255,255,255,0.02)_inset,_0_8px_24px_rgba(0,0,0,0.35)] lg:grid-cols-[1fr_320px]'
          : 'grid grid-cols-1 overflow-hidden rounded-xl border border-border bg-card lg:grid-cols-[1fr_320px]'
      }
    >
      <div className="min-w-0 border-b border-border p-5 lg:border-b-0 lg:border-r">
        <div className="mb-3.5 flex items-start gap-3">
          <div
            className={
              awaiting
                ? 'grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary'
                : 'grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-blue-500/10 text-blue-500'
            }
          >
            {awaiting ? <Sparkles className="h-[18px] w-[18px]" /> : <Rocket className="h-[18px] w-[18px]" />}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="mb-1 flex flex-wrap items-center gap-2 text-[15px] font-semibold tracking-[-0.005em] text-foreground">
              {run.title}
              <span className="font-mono text-[12px] font-normal text-muted-foreground">· {run.id}</span>
            </h3>
            <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
              <StatusPill kind={awaiting ? 'awaiting' : 'running'} />
              <span className="text-muted-foreground/60">·</span>
              <span className="inline-flex items-center gap-1">
                <Building2 className="h-3 w-3 opacity-60" />
                {run.workspace}
              </span>
              <span className="text-muted-foreground/60">·</span>
              <span className="inline-flex items-center gap-1">
                <Github className="h-3 w-3 opacity-60" />
                {run.app}
              </span>
              <span className="text-muted-foreground/60">·</span>
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3 opacity-60" />
                Started {run.startedRel} · {run.elapsed} elapsed
              </span>
            </div>
          </div>
        </div>

        <MiniPhases phases={run.phases} />

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-dashed border-border pt-3.5">
          <span className="text-[12px] text-muted-foreground">
            {awaiting
              ? 'Plan ready — review the proposed changes before they execute.'
              : "Executing autonomously — I'll surface anything that needs your call."}
          </span>
          <div className="ml-auto flex gap-1.5">
            <Button size="sm" variant="outline" asChild>
              <Link href={run.href}>View transcript</Link>
            </Button>
            <Button size="sm" asChild>
              <Link href={run.href}>
                {awaiting ? (
                  <>
                    <Check className="mr-1.5 h-3.5 w-3.5" />
                    Review &amp; approve
                  </>
                ) : (
                  <>
                    <Eye className="mr-1.5 h-3.5 w-3.5" />
                    Open run
                  </>
                )}
              </Link>
            </Button>
          </div>
        </div>
      </div>

      <aside className="flex flex-col p-5">
        <h4 className="mb-2.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Latest thought
        </h4>
        <div
          className={
            awaiting
              ? 'mb-3.5 border-l-2 border-primary/40 pl-3 text-[12.5px] leading-[1.5] text-foreground/80'
              : 'mb-3.5 border-l-2 border-blue-500/40 pl-3 text-[12.5px] leading-[1.5] text-foreground/80'
          }
        >
          <span
            className={
              awaiting
                ? 'mb-0.5 block text-[10px] font-semibold uppercase tracking-[0.08em] text-primary'
                : 'mb-0.5 block text-[10px] font-semibold uppercase tracking-[0.08em] text-blue-500'
            }
          >
            Agent
          </span>
          {run.lastThought}
        </div>
        <div className="mt-auto flex items-center gap-2 text-[11.5px] text-muted-foreground">
          <Brain className="h-3.5 w-3.5" />
          <span>{run.model ?? 'claude-opus-4-7'}</span>
        </div>
      </aside>
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
  if (kind === 'awaiting') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11.5px] font-medium text-primary">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
        Awaiting your input
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-[11.5px] font-medium text-blue-500">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
      Running
    </span>
  )
}
