'use client'

import { Badge } from '@/components/ui/badge'
import { Clock, CheckCircle, XCircle, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'

type RequestStatus = 'pending_workspace' | 'pending_platform' | 'approved' | 'rejected'

interface RequestStatusBadgeProps {
  status: RequestStatus
  className?: string
}

const statusConfig: Record<
  RequestStatus,
  {
    label: string
    variant: 'default' | 'secondary' | 'destructive' | 'outline'
    icon: React.ComponentType<{ className?: string }>
    className: string
  }
> = {
  pending_workspace: {
    label: 'Pending WS Approval',
    variant: 'outline',
    icon: Clock,
    className: 'border-yellow-500 text-yellow-700 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-950/20',
  },
  pending_platform: {
    label: 'Pending Platform Approval',
    variant: 'outline',
    icon: ArrowRight,
    className: 'border-blue-500 text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/20',
  },
  approved: {
    label: 'Approved',
    variant: 'outline',
    icon: CheckCircle,
    className: 'border-green-500 text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/20',
  },
  rejected: {
    label: 'Rejected',
    variant: 'outline',
    icon: XCircle,
    className: 'border-red-500 text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/20',
  },
}

export function RequestStatusBadge({ status, className }: RequestStatusBadgeProps) {
  const config = statusConfig[status]
  const Icon = config.icon

  return (
    <Badge
      variant={config.variant}
      className={cn('gap-1 font-medium', config.className, className)}
    >
      <Icon className="h-3 w-3" />
      {config.label}
    </Badge>
  )
}
