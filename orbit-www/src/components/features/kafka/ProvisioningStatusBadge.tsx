'use client'

import { Badge } from '@/components/ui/badge'
import { CheckCircle2, Clock, Loader2, AlertTriangle, XCircle } from 'lucide-react'

type ProvisioningStatus = 'pending' | 'in_progress' | 'completed' | 'partial' | 'failed'

interface ProvisioningStatusBadgeProps {
  status: ProvisioningStatus
  showLabel?: boolean
}

const statusConfig: Record<ProvisioningStatus, {
  icon: typeof CheckCircle2
  label: string
  className: string
  animate?: boolean
}> = {
  pending: {
    icon: Clock,
    label: 'Pending',
    className: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
  },
  in_progress: {
    icon: Loader2,
    label: 'In Progress',
    className: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    animate: true,
  },
  completed: {
    icon: CheckCircle2,
    label: 'Completed',
    className: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  },
  partial: {
    icon: AlertTriangle,
    label: 'Partial',
    className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  },
  failed: {
    icon: XCircle,
    label: 'Failed',
    className: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  },
}

export function ProvisioningStatusBadge({ status, showLabel = true }: ProvisioningStatusBadgeProps) {
  const config = statusConfig[status]
  const Icon = config.icon

  return (
    <Badge variant="secondary" className={config.className}>
      <Icon className={`h-3 w-3 ${showLabel ? 'mr-1' : ''} ${config.animate ? 'animate-spin' : ''}`} />
      {showLabel && config.label}
    </Badge>
  )
}
