'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Check, ClipboardCheck, Loader2, X } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { ScoreChip } from '@/components/features/scorecards/ScoreChip'
import {
  getEntityScoreSummary,
  type EntityScoreSummary,
} from '@/app/(frontend)/scorecards/actions'

/**
 * Entity scorecards tab (IDP refocus P2). Self-fetches this entity's score
 * summary via the workspace-scoped server action (identity resolved server-side)
 * using the `[id]` route param, then renders each scorecard's computed level and
 * per-rule pass/fail. Falls back to an informative empty state when the entity
 * has no scorecard results.
 */
export function EntityScorecardsTab() {
  const params = useParams<{ id: string }>()
  const entityId = params?.id
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

  if (!summary || summary.scorecards.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
          <ClipboardCheck className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">No scorecards apply to this entity</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Once a scorecard targets this entity&apos;s kind and is evaluated, its level and per-rule
            results will appear here.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {summary.scorecards.map((sc) => (
        <Card key={sc.scorecardId}>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base">{sc.scorecardName}</CardTitle>
            <ScoreChip level={sc.level} passed={sc.passed} total={sc.total} />
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
      ))}
    </div>
  )
}
