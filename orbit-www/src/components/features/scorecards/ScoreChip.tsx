import { cn } from '@/lib/utils'
import { formatPct, levelPresentation, passRatio, type LevelDef } from './scorecard-ui'

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
