'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ReportEmptyState } from './ReportEmptyState'
import { buildLinePath, niceTicks, projectPoints, type Domain } from './chart-paths'
import type { TrendPoint } from '@/lib/scorecards/reporting'

/**
 * Org average-score trend chart (UAC-5): a dependency-free SVG line chart
 * with a 7/30/90-day segmented control. The geometry (scaling, path/point
 * building, nice tick values) all comes from `chart-paths.ts` (WP2, pure and
 * unit-tested) — this component only lays that geometry out inside an
 * `<svg>`. Renders via a `viewBox` so the chart scales to its container
 * while keeping a fixed aspect ratio.
 */

const VIEW_WIDTH = 640
const VIEW_HEIGHT = 200
const PADDING_LEFT = 34
const PADDING_BOTTOM = 8

const WINDOW_OPTIONS: ReadonlyArray<{ label: string; days: number }> = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
]

export function TrendChart({
  trend,
  windowDays,
  onWindowDaysChange,
}: {
  trend: TrendPoint[]
  windowDays: number
  onWindowDaysChange: (days: number) => void
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
        <CardTitle className="text-base">Org average score trend</CardTitle>
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {WINDOW_OPTIONS.map((opt) => (
            <Button
              key={opt.days}
              type="button"
              size="sm"
              variant={opt.days === windowDays ? 'default' : 'ghost'}
              className="h-7 px-2.5 text-xs"
              onClick={() => onWindowDaysChange(opt.days)}
              aria-pressed={opt.days === windowDays}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        <TrendChartBody trend={trend} />
      </CardContent>
    </Card>
  )
}

function TrendChartBody({ trend }: { trend: TrendPoint[] }) {
  if (trend.length === 0) {
    return (
      <ReportEmptyState>No history yet — snapshots appear after evaluations.</ReportEmptyState>
    )
  }

  const plotWidth = VIEW_WIDTH - PADDING_LEFT
  const plotHeight = VIEW_HEIGHT - PADDING_BOTTOM
  // Scores are always 0-100 by construction (computeOverallScore), so the y
  // axis is fixed rather than data-driven — a flat or near-flat series still
  // reads against a stable 0-100 scale instead of an exaggerated one.
  const domain: Domain = { x: [trend[0].t, trend[trend.length - 1].t], y: [0, 100] }
  const yTicks = niceTicks(domain.y, 5)

  if (trend.length === 1) {
    const [{ x, y }] = projectPoints(trend, plotWidth, plotHeight, domain)
    return (
      <div className="space-y-2">
        <svg
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          width="100%"
          height={VIEW_HEIGHT}
          role="img"
          aria-label="Org average score trend"
        >
          <g transform={`translate(${PADDING_LEFT}, 0)`}>
            <GridLines ticks={yTicks} plotWidth={plotWidth} plotHeight={plotHeight} />
            <circle cx={x} cy={y} r={4} className="fill-primary" />
          </g>
        </svg>
        <p className="text-center text-xs text-muted-foreground">
          Only one snapshot so far — avg score {trend[0].v}. The trend line appears after the next
          capture.
        </p>
      </div>
    )
  }

  const path = buildLinePath(trend, plotWidth, plotHeight, domain)

  return (
    <svg
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      width="100%"
      height={VIEW_HEIGHT}
      role="img"
      aria-label="Org average score trend"
    >
      <g transform={`translate(${PADDING_LEFT}, 0)`}>
        <GridLines ticks={yTicks} plotWidth={plotWidth} plotHeight={plotHeight} />
        <path d={path} fill="none" className="stroke-primary" strokeWidth={2} />
      </g>
    </svg>
  )
}

function GridLines({
  ticks,
  plotWidth,
  plotHeight,
}: {
  ticks: number[]
  plotWidth: number
  plotHeight: number
}) {
  return (
    <>
      {ticks.map((tick) => {
        const y = plotHeight - (tick / 100) * plotHeight
        return (
          <g key={tick}>
            <line
              x1={0}
              x2={plotWidth}
              y1={y}
              y2={y}
              className={cn('stroke-border', tick === 0 && 'stroke-muted-foreground/40')}
              strokeWidth={1}
            />
            <text
              x={-6}
              y={y}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-muted-foreground text-[10px]"
            >
              {tick}
            </text>
          </g>
        )
      })}
    </>
  )
}
