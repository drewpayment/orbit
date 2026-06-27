import Link from 'next/link'
import { ListChecks } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { RollupSummary } from './RollupSummary'
import type { ScorecardSummary } from '@/app/(frontend)/scorecards/actions'

/**
 * A scorecard rendered as a clickable card for the landing grid: name,
 * applies-to/disabled badges, rule count and the org rollup. Links to
 * `/scorecards/{id}`.
 */
export function ScorecardCard({ summary }: { summary: ScorecardSummary }) {
  return (
    <Link href={`/scorecards/${summary.id}`} className="block focus:outline-none">
      <Card className="h-full transition-colors hover:border-primary/50 hover:bg-accent/40">
        <CardHeader className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="truncate text-base" title={summary.name}>
              {summary.name}
            </CardTitle>
            {!summary.enabled && (
              <Badge variant="outline" className="shrink-0 font-normal">
                Disabled
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary" className="font-normal capitalize">
              {summary.appliesToKind ?? 'all kinds'}
            </Badge>
            <Badge variant="outline" className="gap-1 font-normal">
              <ListChecks className="h-3 w-3" />
              {summary.rulesCount} {summary.rulesCount === 1 ? 'rule' : 'rules'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {summary.description && (
            <p className="line-clamp-2 text-sm text-muted-foreground">{summary.description}</p>
          )}
          <RollupSummary
            passed={summary.passed}
            total={summary.total}
            entitiesEvaluated={summary.entitiesEvaluated}
            distribution={summary.distribution}
            unranked={summary.unranked}
          />
        </CardContent>
      </Card>
    </Link>
  )
}
