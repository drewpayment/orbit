'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Check, ClipboardCheck, Loader2, X } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { ScoreChip, ScoreNumberChip } from '@/components/features/scorecards/ScoreChip'
import { passRatioTone } from '@/components/features/scorecards/scorecard-ui'
import {
  getEntityScoreSummary,
  type EntityScoreSummary,
} from '@/app/(frontend)/scorecards/actions'
import type { EntityScoreBreakdown } from '@/app/(frontend)/catalog/[id]/actions'

/**
 * Entity scorecards tab (IDP refocus P2; overall score + golden-path
 * alignment added by Entity Scores & Golden Paths,
 * docs/plans/2026-07-01-entity-scores-and-golden-paths.md).
 *
 * Self-fetches this entity's score summary (per-scorecard level + per-rule
 * pass/fail, via the workspace-scoped `getEntityScoreSummary`), using the
 * `[id]` route param by default (or the `entityId` prop, when the parent
 * already knows it). The overall/golden-path `breakdown` is fetched ONCE by
 * the parent `EntityDetail` (which also surfaces it prominently in the page
 * header) and handed down here as a prop, rather than fetched again — the tab
 * is lazily mounted (Radix `TabsContent` unmounts inactive panes), so this
 * still avoids any redundant round-trip in practice.
 */
export function EntityScorecardsTab({
  entityId: entityIdProp,
  breakdown,
}: {
  entityId?: string
  breakdown: EntityScoreBreakdown | null
}) {
  const params = useParams<{ id: string }>()
  const entityId = entityIdProp ?? params?.id
  const [summary, setSummary] = useState<EntityScoreSummary | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    if (!entityId) return
    setLoading(true)
    getEntityScoreSummary(undefined, entityId)
      .then((data) => {
        if (active) setSummary(data)
      })
      .catch(() => {
        if (active) setSummary({ scorecards: [] })
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [entityId])

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  const hasScorecards = !!summary && summary.scorecards.length > 0

  return (
    <div className="space-y-4">
      <OverallScoreCard breakdown={breakdown} />

      {!hasScorecards ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <ClipboardCheck className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">No scorecards apply to this entity</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Once a scorecard targets this entity&apos;s kind and is evaluated, its level and
              per-rule results will appear here. The overall score above reflects the entity
              type&apos;s inherited baseline until then.
            </p>
          </CardContent>
        </Card>
      ) : (
        summary!.scorecards.map((sc) => (
          <Card key={sc.scorecardId}>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-base">{sc.scorecardName}</CardTitle>
              <div className="flex items-center gap-2">
                <ScoreNumberChip score={breakdown?.byScorecard[sc.scorecardId] ?? null} />
                <ScoreChip level={sc.level} passed={sc.passed} total={sc.total} />
              </div>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {sc.rules.map((rule) => (
                <div
                  key={rule.ruleId}
                  className="flex items-start gap-2 border-b py-1.5 text-sm last:border-b-0"
                >
                  {rule.passed ? (
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-label="Pass" />
                  ) : (
                    <X className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-label="Fail" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn(!rule.passed && 'font-medium')}>{rule.title}</span>
                      {rule.level && (
                        <span className="text-xs text-muted-foreground">{rule.level}</span>
                      )}
                    </div>
                    {rule.detail && (
                      <p className="text-xs text-muted-foreground">{rule.detail}</p>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  )
}

/**
 * Overall score + golden-path alignment card, shown above the per-scorecard
 * rows. `breakdown === null` covers both "still loading" (parent shows its
 * own spinner first) and "fetch failed"; `breakdown.overall === null` is the
 * real empty state — the entity hasn't been through `recomputeWorkspaceScores`
 * yet (e.g. no catalog entities have been evaluated in this workspace).
 */
function OverallScoreCard({ breakdown }: { breakdown: EntityScoreBreakdown | null }) {
  if (!breakdown || !breakdown.overall) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          Not yet scored — run a scorecard evaluation to populate this entity&apos;s overall
          score.
        </CardContent>
      </Card>
    )
  }

  const { score, baseValue, goldenPathAlignment } = breakdown.overall
  const scorecardCount = Object.keys(breakdown.byScorecard).length

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Overall score</CardTitle>
        <ScoreNumberChip score={score} />
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          {breakdown.baselineOnly
            ? `Inherited from the entity type's baseline (${baseValue ?? score}) — no scorecard has evaluated this entity yet.`
            : `Base value ${baseValue ?? '—'}, replaced by the mean of ${scorecardCount} applicable scorecard ${scorecardCount === 1 ? 'score' : 'scores'} once standards exist to measure against.`}
        </p>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Golden-path alignment</span>
            <span
              className={cn(
                'font-semibold',
                passRatioTone((goldenPathAlignment ?? 0) / 100),
              )}
            >
              {goldenPathAlignment === null ? '—' : `${goldenPathAlignment}%`}
            </span>
          </div>
          <Progress value={goldenPathAlignment ?? 0} className="h-1.5" />
          <p className="text-xs text-muted-foreground">
            {breakdown.goldenPathSummary ?? 'No golden path defined for this entity type yet.'}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
