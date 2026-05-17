import Link from 'next/link'
import { ChevronRight } from 'lucide-react'

interface DashboardSectionProps {
  title: string
  count?: number
  moreLabel?: string
  moreHref?: string
}

export function DashboardSection({ title, count, moreLabel, moreHref }: DashboardSectionProps) {
  return (
    <div className="mt-7 mb-3 flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
      <span className="text-foreground/70">{title}</span>
      {typeof count === 'number' && (
        <span className="rounded-full bg-muted px-1.5 py-px text-[10.5px] font-semibold tracking-normal text-muted-foreground">
          {count}
        </span>
      )}
      <div className="h-px flex-1 bg-border" />
      {moreLabel && moreHref && (
        <Link
          href={moreHref}
          className="inline-flex items-center gap-1 text-[11.5px] font-normal normal-case tracking-normal text-primary hover:text-primary/80"
        >
          {moreLabel}
          <ChevronRight className="h-3 w-3" />
        </Link>
      )}
    </div>
  )
}
