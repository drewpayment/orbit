import { cn } from '@/lib/utils'
import { formatPct, levelPresentation, passRatio, passRatioTone, type LevelDef } from './scorecard-ui'

/**
 * A compact level badge with an optional pass-ratio suffix. Server-safe (no
 * hooks) so it renders from server or client parents. The level chip colours
 * itself from the level's `color` (hex swatch or tailwind token), falling back
 * to a neutral primary tint and an "Unranked" label when no level is achieved.
 */
export function ScoreChip({
  level,
  passed,
  total,
  showRatio = true,
  className,
}: {
  level: LevelDef | null
  passed?: number
  total?: number
  showRatio?: boolean
  className?: string
}) {
  const p = levelPresentation(level)
  const hasRatio = showRatio && typeof passed === 'number' && typeof total === 'number' && total > 0

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-semibold',
        p.className,
        className,
      )}
    >
      {p.swatch && (
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: p.swatch }}
          aria-hidden
        />
      )}
      <span>{p.label}</span>
      {hasRatio && (
        <span className="font-normal opacity-80">{formatPct(passRatio(passed!, total!))}</span>
      )}
    </span>
  )
}

/**
 * A compact 0-100 numeric score chip, coloured with the same pass-ratio scale
 * as {@link passRatioTone} (RollupSummary's progress labels). Used wherever an
 * entity's persisted `entity-scores` value is surfaced directly — the catalog
 * list and the per-scorecard rows on the entity detail scorecards tab (Entity
 * Scores & Golden Paths, docs/plans/2026-07-01-entity-scores-and-golden-paths.md).
 *
 * `score` has three states: a number renders the coloured chip; `null` means
 * the caller has confirmed there is no entity-scores row yet ("No score");
 * `undefined` means that hasn't been determined yet (still loading) and
 * renders nothing, so callers don't have to flash "No score" before a batched
 * fetch resolves.
 */
export function ScoreNumberChip({
  score,
  className,
}: {
  score: number | null | undefined
  className?: string
}) {
  if (score === undefined) return null

  if (score === null) {
    return (
      <span
        className={cn(
          'inline-flex items-center rounded-md border border-transparent bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground',
          className,
        )}
      >
        No score
      </span>
    )
  }

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border border-border bg-background px-2 py-0.5 text-xs font-semibold tabular-nums',
        passRatioTone(score / 100),
        className,
      )}
    >
      {Math.round(score)}
    </span>
  )
}
