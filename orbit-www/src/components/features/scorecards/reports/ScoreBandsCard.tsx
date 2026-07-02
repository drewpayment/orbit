import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { ReportEmptyState } from './ReportEmptyState'
import type { ScoreBand } from '@/lib/scorecards/reporting'

/** Tailwind fill classes per band, worst (red) to best (emerald) — mirrors
 *  `passRatioTone`'s red/amber/emerald scale used elsewhere on this page. */
const BAND_COLOR: Record<string, string> = {
  '0-25': 'bg-red-500',
  '26-50': 'bg-amber-500',
  '51-75': 'bg-amber-400',
  '76-100': 'bg-emerald-500',
}

/**
 * Org score-band distribution (UAC-2): a horizontal bar per band (0-25 /
 * 26-50 / 51-75 / 76-100) sized relative to the largest band's count.
 */
export function ScoreBandsCard({ bands }: { bands: ScoreBand[] }) {
  const total = bands.reduce((sum, b) => sum + b.count, 0)
  const max = Math.max(1, ...bands.map((b) => b.count))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Score distribution</CardTitle>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <ReportEmptyState>
            No scored entities yet — run an evaluation to populate scores.
          </ReportEmptyState>
        ) : (
          <div className="space-y-3">
            {bands.map((band) => (
              <div key={band.label} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{band.label}</span>
                  <span className="font-medium tabular-nums">{band.count}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn('h-full rounded-full', BAND_COLOR[band.label] ?? 'bg-primary')}
                    style={{ width: `${(band.count / max) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
