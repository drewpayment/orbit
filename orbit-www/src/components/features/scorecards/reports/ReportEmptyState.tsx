import { cn } from '@/lib/utils'

/**
 * A single-line friendly empty state used across the reports page's sections
 * (score bands, trend, breakdowns, per-scorecard rule/entity lists) — every
 * section renders one of these instead of erroring on a workspace with no
 * data yet (docs/plans/2026-07-01-scorecard-reports.md, UAC-1).
 */
export function ReportEmptyState({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn('py-8 text-center text-sm text-muted-foreground', className)}>{children}</p>
  )
}
