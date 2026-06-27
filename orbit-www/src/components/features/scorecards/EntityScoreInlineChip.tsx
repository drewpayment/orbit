'use client'

import { useEffect, useState } from 'react'
import { ScoreChip } from './ScoreChip'
import type { LevelDef } from './scorecard-ui'
import { getEntityScoreSummary } from '@/app/(frontend)/scorecards/actions'

/**
 * A self-fetching, fail-silent score chip for the catalog list (IDP refocus P2).
 *
 * Renders nothing until/unless the entity has scorecard results, so it never
 * breaks the list for unscored entities. When an entity is on multiple
 * scorecards it surfaces the *lowest* achieved level (the actionable signal),
 * with a +N suffix indicating how many scorecards apply.
 */
export function EntityScoreInlineChip({ entityId }: { entityId: string }) {
  const [state, setState] = useState<{ level: LevelDef | null; count: number } | null>(null)

  useEffect(() => {
    let active = true
    getEntityScoreSummary(undefined, entityId)
      .then((summary) => {
        if (!active) return
        if (summary.scorecards.length === 0) {
          setState(null)
          return
        }
        // Lowest level wins: unranked (null) is worst, else min rank.
        let lowest: LevelDef | null = summary.scorecards[0].level
        let sawUnranked = lowest === null
        for (const sc of summary.scorecards.slice(1)) {
          if (sc.level === null) {
            sawUnranked = true
          } else if (lowest && sc.level.rank < lowest.rank) {
            lowest = sc.level
          }
        }
        setState({ level: sawUnranked ? null : lowest, count: summary.scorecards.length })
      })
      .catch(() => {
        if (active) setState(null)
      })
    return () => {
      active = false
    }
  }, [entityId])

  if (!state) return null

  return (
    <span className="inline-flex items-center gap-1">
      <ScoreChip level={state.level} showRatio={false} />
      {state.count > 1 && (
        <span className="text-[10px] text-muted-foreground">+{state.count - 1}</span>
      )}
    </span>
  )
}
