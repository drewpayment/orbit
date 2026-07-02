import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { RollupSummary } from '@/components/features/scorecards/RollupSummary'
import { ReportEmptyState } from './ReportEmptyState'
import type { ScorecardSectionReport } from '@/app/(frontend)/scorecards/reports/actions'

/**
 * One enabled scorecard's report section (UAC-4): level distribution (via
 * `RollupSummary`, the same piece used on the scorecards landing page and
 * detail page), its top-5 failing rules (fail count + fail %), and its top
 * failing entities linking to their catalog page. Header links to the
 * scorecard detail page.
 */
export function ScorecardSection({ section }: { section: ScorecardSectionReport }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">
            <Link href={`/scorecards/${section.scorecardId}`} className="hover:underline">
              {section.scorecardName}
            </Link>
          </CardTitle>
          <Link
            href={`/scorecards/${section.scorecardId}`}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            Open scorecard
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <RollupSummary
          passed={section.passed}
          total={section.total}
          entitiesEvaluated={section.entitiesEvaluated}
          distribution={section.distribution}
          unranked={section.unranked}
        />

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Top failing rules
            </h4>
            {section.topFailingRules.length === 0 ? (
              <ReportEmptyState className="py-4">No failing rules — nice work.</ReportEmptyState>
            ) : (
              <ul className="space-y-1.5">
                {section.topFailingRules.map((rule) => (
                  <li
                    key={rule.ruleId}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <span className="truncate" title={rule.title}>
                      {rule.title}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-red-600">
                      {rule.failCount} failing · {rule.failPct}%
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Top failing entities
            </h4>
            {section.topFailingEntities.length === 0 ? (
              <ReportEmptyState className="py-4">No scored entities yet.</ReportEmptyState>
            ) : (
              <ul className="space-y-1.5">
                {section.topFailingEntities.map((entity) => (
                  <li key={entity.id} className="flex items-center justify-between gap-2 text-sm">
                    <Link href={`/catalog/${entity.id}`} className="truncate hover:underline">
                      {entity.name}
                    </Link>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {entity.score}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
