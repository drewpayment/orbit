import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/session'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { RollupSummary } from '@/components/features/scorecards/RollupSummary'
import { RuleResultsTable } from '@/components/features/scorecards/RuleResultsTable'
import { EvaluateButton } from '@/components/features/scorecards/EvaluateButton'
import { ScoreChip } from '@/components/features/scorecards/ScoreChip'
import { ruleTypeLabel } from '@/components/features/scorecards/scorecard-ui'
import { getScorecardDetail } from '../actions'

interface PageProps {
  params: Promise<{ id: string }>
}

/**
 * Scorecard detail (IDP refocus P2): the ladder, every rule, an entities × rules
 * pass/fail matrix with per-entity computed levels, and an "Evaluate now" action.
 */
export default async function ScorecardDetailPage({ params }: PageProps) {
  const { id } = await params
  const user = await getCurrentUser()
  const detail = await getScorecardDetail(user?.id, id)
  if (!detail) notFound()

  const { scorecard, levels, rules, rows, summary } = detail

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex-1 space-y-6 p-8 pt-6">
          <div>
            <Link
              href="/scorecards"
              className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Scorecards
            </Link>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-2">
                <h1 className="text-3xl font-bold">{scorecard.name}</h1>
                {scorecard.description && (
                  <p className="max-w-2xl text-muted-foreground">{scorecard.description}</p>
                )}
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="secondary" className="font-normal capitalize">
                    {summary.appliesToKind ?? 'all kinds'}
                  </Badge>
                  {!summary.enabled && (
                    <Badge variant="outline" className="font-normal">
                      Disabled
                    </Badge>
                  )}
                  {levels.map((lvl) => (
                    <ScoreChip key={lvl.name} level={lvl} showRatio={false} />
                  ))}
                </div>
              </div>
              <EvaluateButton scorecardId={scorecard.id} />
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Organization rollup</CardTitle>
            </CardHeader>
            <CardContent>
              <RollupSummary
                passed={summary.passed}
                total={summary.total}
                entitiesEvaluated={summary.entitiesEvaluated}
                distribution={summary.distribution}
                unranked={summary.unranked}
              />
            </CardContent>
          </Card>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Rules ({rules.length})</h2>
            {rules.length === 0 ? (
              <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
                This scorecard has no rules yet.
              </p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {rules.map((rule) => (
                  <Card key={rule.id}>
                    <CardHeader className="space-y-1 pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-sm">{rule.title}</CardTitle>
                        <Badge variant="outline" className="shrink-0 font-normal">
                          {ruleTypeLabel(rule.type)}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-1 text-xs text-muted-foreground">
                      {rule.description && <p>{rule.description}</p>}
                      <div className="flex flex-wrap gap-2">
                        {rule.level && <span>Level: {rule.level}</span>}
                        <span>Weight: {rule.weight ?? 1}</span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Results</h2>
            <RuleResultsTable rules={rules} rows={rows} />
          </section>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
