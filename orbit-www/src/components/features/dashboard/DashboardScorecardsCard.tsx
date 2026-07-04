import Link from 'next/link'
import { ShieldCheck, ListChecks, Target, ArrowUpRight } from 'lucide-react'

/** One point on the 30-day org-score trend line. `capturedAt` is a sortable timestamp. */
export interface ScorecardsTrendPoint {
  capturedAt: number
  avgScore: number
}

/** Worst-performing team/kind rollup shown under the headline. */
export interface ScorecardsWorstGroup {
  name: string
  avgScore: number
  entityCount: number
}

/**
 * Server-computed slice of `getScorecardReport()` this card renders.
 * `avgScore` is `null` when nothing has been scored yet (distinct from a real
 * score of 0) so the headline can show an em-dash rather than a misleading 0.
 */
export interface DashboardScorecardsCardReport {
  avgScore: number | null
  scoredCount: number
  entityTotal: number
  trend: ScorecardsTrendPoint[]
  worstGroups: ScorecardsWorstGroup[]
}

interface DashboardScorecardsCardProps {
  report: DashboardScorecardsCardReport
  openActionItems: number
  activeInitiatives: number
  hasScorecards: boolean
}

const WORST_GROUP_LIMIT = 3

export function DashboardScorecardsCard({
  report,
  openActionItems,
  activeInitiatives,
  hasScorecards,
}: DashboardScorecardsCardProps) {
  if (!hasScorecards) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card px-5 py-10 text-center">
        <ShieldCheck className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">No standards defined yet</p>
        <p className="mx-auto mt-1 max-w-[46ch] text-[12.5px] text-muted-foreground">
          Scorecards turn your engineering standards into a measurable compliance score across every entity.
        </p>
        <Link
          href="/scorecards/new"
          className="mt-3 inline-flex items-center gap-1 text-[12.5px] font-medium text-primary hover:text-primary/80"
        >
          Define your first standard <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    )
  }

  const worstGroups = report.worstGroups.slice(0, WORST_GROUP_LIMIT)

  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3.5">
      <h3 className="mb-3 flex items-center justify-between text-[13px] font-semibold tracking-[-0.005em] text-foreground">
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          Standards posture
        </span>
        <Link href="/scorecards/reports" className="text-[11.5px] font-normal text-primary hover:text-primary/80">
          View reports →
        </Link>
      </h3>

      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="flex items-baseline gap-1">
            <span className="text-[32px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-foreground">
              {report.avgScore === null ? '—' : report.avgScore}
            </span>
            {report.avgScore !== null && (
              <span className="text-[15px] font-medium text-muted-foreground">/100</span>
            )}
          </div>
          <p className="mt-1.5 text-[11.5px] text-muted-foreground">
            avg score across{' '}
            <span className="font-medium tabular-nums text-foreground">{report.scoredCount}</span> of{' '}
            <span className="font-medium tabular-nums text-foreground">{report.entityTotal}</span> entities
          </p>
        </div>
        <Sparkline points={report.trend} />
      </div>

      {worstGroups.length > 0 && (
        <div className="mt-3.5 border-t border-border pt-3">
          <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Needs attention
          </p>
          <div className="flex flex-col gap-1.5">
            {worstGroups.map((group) => (
              <div key={group.name} className="flex items-center gap-2.5 text-[12.5px]">
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">{group.name}</span>
                <span className="text-[11px] text-muted-foreground">
                  {group.entityCount} {group.entityCount === 1 ? 'entity' : 'entities'}
                </span>
                <span className="w-8 text-right font-semibold tabular-nums text-foreground">{group.avgScore}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3.5 grid grid-cols-2 gap-2 border-t border-border pt-3">
        <Link
          href="/scorecards/initiatives"
          className="group flex items-center gap-2 rounded-lg px-1 py-1 text-inherit no-underline"
        >
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-yellow-500/10 text-yellow-500">
            <ListChecks className="h-3.5 w-3.5" />
          </span>
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="text-[15px] font-semibold tabular-nums text-foreground">{openActionItems}</span>
            <span className="text-[11px] text-muted-foreground group-hover:text-foreground/70">
              open action item{openActionItems === 1 ? '' : 's'}
            </span>
          </span>
        </Link>
        <Link
          href="/scorecards/initiatives"
          className="group flex items-center gap-2 rounded-lg px-1 py-1 text-inherit no-underline"
        >
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
            <Target className="h-3.5 w-3.5" />
          </span>
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="text-[15px] font-semibold tabular-nums text-foreground">{activeInitiatives}</span>
            <span className="text-[11px] text-muted-foreground group-hover:text-foreground/70">
              active initiative{activeInitiatives === 1 ? '' : 's'}
            </span>
          </span>
        </Link>
      </div>
    </div>
  )
}

/**
 * Inline SVG polyline sparkline of the org-score trend — no chart library.
 * Needs at least two points to draw a line; renders nothing otherwise so the
 * headline still reads cleanly on a fresh workspace.
 */
function Sparkline({ points }: { points: ScorecardsTrendPoint[] }) {
  if (points.length < 2) return null

  const width = 96
  const height = 34
  const values = points.map((p) => p.avgScore)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const stepX = width / (points.length - 1)

  const coords = points.map((p, i) => {
    const x = i * stepX
    // Invert Y (SVG origin is top-left) and inset by 1px so the stroke isn't clipped.
    const y = height - 1 - ((p.avgScore - min) / span) * (height - 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })

  const rising = values[values.length - 1] >= values[0]

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={rising ? 'text-green-500' : 'text-yellow-500'}
      aria-hidden="true"
    >
      <polyline
        points={coords.join(' ')}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
