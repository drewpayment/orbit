import { cn } from '@/lib/utils'
import { Progress } from '@/components/ui/progress'
import { progressTone, type InitiativeProgressView } from './initiative-ui'

/**
 * Completion bar for an initiative: the done+waived / total percentage plus a
 * "x of y done" caption, toned by completion. Reuses the shared <Progress>
 * primitive so it reads identically to the scorecard rollups.
 */
export function InitiativeProgressBar({
  progress,
  className,
  showCounts = true,
}: {
  progress: InitiativeProgressView
  className?: string
  showCounts?: boolean
}) {
  const { pctComplete, done, waived, total } = progress
  const resolved = done + waived

  return (
    <div className={cn('space-y-1', className)}>
      {showCounts && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            {resolved} of {total} done
          </span>
          <span className={cn('font-semibold tabular-nums', progressTone(pctComplete))}>
            {pctComplete}%
          </span>
        </div>
      )}
      <Progress value={pctComplete} className="h-1.5" />
    </div>
  )
}
