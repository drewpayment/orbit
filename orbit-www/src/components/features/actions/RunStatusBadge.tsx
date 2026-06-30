import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { runStatusPresentation } from './action-ui'

/**
 * Status pill for an Action Run, coloured by lifecycle state (pending →
 * awaiting-approval → running → succeeded|failed). Pure presentation; the
 * tone mapping lives in {@link runStatusPresentation}.
 */
export function RunStatusBadge({ status, className }: { status: string; className?: string }) {
  const { label, className: tone } = runStatusPresentation(status)
  return (
    <Badge variant="outline" className={cn(tone, className)}>
      {label}
    </Badge>
  )
}
