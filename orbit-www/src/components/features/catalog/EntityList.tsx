'use client'

import { useEffect, useState } from 'react'
import { PackageOpen } from 'lucide-react'
import type { CatalogEntity } from '@/payload-types'
import { EntityListItem } from './EntityListItem'
import { getOverallEntityScores, type EntityOverallScore } from '@/app/(frontend)/catalog/actions'

/**
 * Grid of catalog entities with a friendly empty state.
 *
 * Owns a single batched fetch of every listed entity's overall score
 * (`entity-scores` scope='overall') — one round-trip for the whole visible
 * page instead of each card self-fetching (Entity Scores & Golden Paths,
 * docs/plans/2026-07-01-entity-scores-and-golden-paths.md). Everything else
 * about rendering stays presentational; only the score map is stateful.
 * `scores === null` means the batch hasn't resolved yet, so per-entity chips
 * render nothing rather than flashing "No score" before the fetch completes.
 */
export function EntityList({
  entities,
  emptyTitle = 'No entities found',
  emptyHint,
}: {
  entities: CatalogEntity[]
  emptyTitle?: string
  emptyHint?: string
}) {
  const [scores, setScores] = useState<Record<string, EntityOverallScore> | null>(null)

  useEffect(() => {
    let active = true
    setScores(null)
    if (entities.length === 0) return

    getOverallEntityScores(entities.map((e) => e.id))
      .then((map) => {
        if (active) setScores(map)
      })
      .catch(() => {
        if (active) setScores({})
      })
    return () => {
      active = false
    }
  }, [entities])

  if (entities.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
        <PackageOpen className="mb-4 h-12 w-12 text-muted-foreground" />
        <h3 className="text-lg font-semibold">{emptyTitle}</h3>
        {emptyHint && <p className="mt-1 text-sm text-muted-foreground">{emptyHint}</p>}
      </div>
    )
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {entities.map((entity) => (
        <EntityListItem
          key={entity.id}
          entity={entity}
          score={scores ? (scores[entity.id]?.score ?? null) : undefined}
          scoreIsBaseline={scores ? (scores[entity.id]?.baseline ?? false) : false}
        />
      ))}
    </div>
  )
}
