'use client'

import { Badge } from '@/components/ui/badge'
import { CloudOff, RefreshCw, AlertTriangle } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

interface SyncStatusBadgeProps {
  syncEnabled: boolean
  conflictDetected: boolean
  lastSyncAt?: string | null
}

const statusConfig = {
  off: {
    label: 'Not synced',
    icon: CloudOff,
    variant: 'outline' as const,
    className: 'text-muted-foreground',
  },
  synced: {
    label: 'Synced',
    icon: RefreshCw,
    variant: 'outline' as const,
    className: 'border-green-300 text-green-700 bg-green-50',
  },
  conflict: {
    label: 'Conflict',
    icon: AlertTriangle,
    variant: 'destructive' as const,
    className: '',
  },
}

export function SyncStatusBadge({ syncEnabled, conflictDetected, lastSyncAt }: SyncStatusBadgeProps) {
  const status = !syncEnabled ? 'off' : conflictDetected ? 'conflict' : 'synced'
  const config = statusConfig[status]
  const Icon = config.icon

  return (
    <Badge
      variant={config.variant}
      className={`gap-1 font-medium ${config.className}`}
      title={
        lastSyncAt && syncEnabled
          ? `Last synced ${formatDistanceToNow(new Date(lastSyncAt), { addSuffix: true })}`
          : undefined
      }
    >
      <Icon className="h-3 w-3" />
      {config.label}
    </Badge>
  )
}
