import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export type LaunchStatus =
  | 'pending'
  | 'awaiting_approval'
  | 'launching'
  | 'active'
  | 'failed'
  | 'deorbiting'
  | 'deorbited'
  | 'aborted'

const statusConfig: Record<LaunchStatus, { label: string; className: string }> = {
  active: {
    label: 'Active',
    className: 'bg-green-500/15 text-green-400 border-green-500/25',
  },
  launching: {
    label: 'Launching',
    className: 'bg-blue-500/15 text-blue-400 border-blue-500/25 animate-pulse',
  },
  awaiting_approval: {
    label: 'Awaiting Approval',
    className: 'bg-amber-500/15 text-amber-400 border-amber-500/25',
  },
  failed: {
    label: 'Failed',
    className: 'bg-red-500/15 text-red-400 border-red-500/25',
  },
  deorbited: {
    label: 'Deorbited',
    className: 'bg-muted text-muted-foreground border-border',
  },
  pending: {
    label: 'Pending',
    className: 'border-border text-muted-foreground bg-transparent',
  },
  deorbiting: {
    label: 'Deorbiting',
    className: 'bg-orange-500/15 text-orange-400 border-orange-500/25',
  },
  aborted: {
    label: 'Aborted',
    className: 'bg-muted text-muted-foreground border-border',
  },
}

interface LaunchStatusBadgeProps {
  status: string
  className?: string
}

export function LaunchStatusBadge({ status, className }: LaunchStatusBadgeProps) {
  const config = statusConfig[status as LaunchStatus] ?? {
    label: status,
    className: 'bg-muted text-muted-foreground border-border',
  }

  return (
    <Badge
      variant="outline"
      className={cn(config.className, className)}
    >
      {config.label}
    </Badge>
  )
}
