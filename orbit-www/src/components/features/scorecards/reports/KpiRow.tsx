import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { passRatioTone } from '@/components/features/scorecards/scorecard-ui'
import type { ScorecardReportKpis } from '@/app/(frontend)/scorecards/reports/actions'

/**
 * The reports page's top-of-page KPI row (UAC-1): four stat tiles — avg
 * overall score, avg golden-path alignment, entities scored (x of y), and
 * active scorecards. Server-safe (no hooks) — `computeOrgKpis` already
 * guarantees zeros (never NaN) for a workspace with no scored entities, so
 * every tile renders cleanly with no special empty-state handling needed.
 */
export function KpiRow({ kpis }: { kpis: ScorecardReportKpis }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <KpiTile
        label="Avg overall score"
        value={kpis.avgScore}
        tone={passRatioTone(kpis.avgScore / 100)}
        suffix="/ 100"
      />
      <KpiTile
        label="Avg golden-path alignment"
        value={kpis.avgAlignment}
        tone={passRatioTone(kpis.avgAlignment / 100)}
        suffix="%"
      />
      <KpiTile
        label="Entities scored"
        value={kpis.scoredCount}
        sub={`of ${kpis.entityTotal} total`}
      />
      <KpiTile label="Active scorecards" value={kpis.activeScorecards} />
    </div>
  )
}

function KpiTile({
  label,
  value,
  suffix,
  sub,
  tone,
}: {
  label: string
  value: number
  suffix?: string
  sub?: string
  tone?: string
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className={cn('flex items-baseline gap-1 text-3xl font-bold tabular-nums', tone)}>
          {value}
          {suffix && <span className="text-sm font-medium text-muted-foreground">{suffix}</span>}
        </div>
        {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  )
}
