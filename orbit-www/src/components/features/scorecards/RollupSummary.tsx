import { cn } from '@/lib/utils'
import { Progress } from '@/components/ui/progress'
import {
  formatPct,
  levelPresentation,
  passRatio,
  passRatioTone,
  type LevelBucket,
} from './scorecard-ui'

/**
 * Org-visibility rollup for one scorecard: the overall pass ratio plus a
 * per-level distribution bar (how many entities sit at each maturity rung,
 * highest first, with the unranked remainder). The exec-facing deliverable.
 */
export function RollupSummary({
  passed,
  total,
  entitiesEvaluated,
  distribution,
  unranked,
  className,
}: {
  passed: number
  total: number
  entitiesEvaluated: number
  distribution: LevelBucket[]
  unranked: number
  className?: string
}) {
  const ratio = passRatio(passed, total)

  if (entitiesEvaluated === 0) {
    return (
      <p className={cn('text-xs text-muted-foreground', className)}>
        Not yet evaluated — run an evaluation to populate scores.
      </p>
    )
  }

  return (
    <div className={cn('space-y-3', className)}>
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            {entitiesEvaluated} {entitiesEvaluated === 1 ? 'entity' : 'entities'} scored
          </span>
          <span className={cn('font-semibold', passRatioTone(ratio))}>
            {formatPct(ratio)} checks passing
          </span>
        </div>
        <Progress value={Math.round(ratio * 100)} className="h-1.5" />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {distribution.map((bucket) => (
          <LevelCount key={bucket.name} bucket={bucket} />
        ))}
        {unranked > 0 && <LevelCount unranked count={unranked} />}
      </div>
    </div>
  )
}

function LevelCount({
  bucket,
  unranked,
  count,
}: {
  bucket?: LevelBucket
  unranked?: boolean
  count?: number
}) {
  const p = levelPresentation(unranked ? null : bucket ?? null)
  const n = unranked ? count ?? 0 : bucket?.count ?? 0

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs',
        p.className,
      )}
    >
      {p.swatch && (
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: p.swatch }}
          aria-hidden
        />
      )}
      <span className="font-medium">{p.label}</span>
      <span className="tabular-nums opacity-80">{n}</span>
    </span>
  )
}
