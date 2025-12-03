'use client'

import { useState } from 'react'
import { TableCell, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  ChevronDown,
  ChevronRight,
  Play,
  Pencil,
  Trash2,
  Loader2,
} from 'lucide-react'
import type { Deployment } from '@/payload-types'
import { DeploymentProgressPanel } from './DeploymentProgressPanel'

const statusConfig = {
  healthy: { icon: CheckCircle2, color: 'text-green-500' },
  degraded: { icon: AlertTriangle, color: 'text-yellow-500' },
  down: { icon: XCircle, color: 'text-red-500' },
  unknown: { icon: HelpCircle, color: 'text-gray-400' },
}

const deploymentStatusColors: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-800',
  deploying: 'bg-blue-100 text-blue-800',
  generated: 'bg-purple-100 text-purple-800',
  deployed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
}

interface DeploymentRowProps {
  deployment: Deployment
  onDeploy: (id: string) => Promise<void>
  onEdit: (id: string) => void
  onDelete: (id: string) => void
}

export function DeploymentRow({
  deployment,
  onDeploy,
  onEdit,
  onDelete,
}: DeploymentRowProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [isDeploying, setIsDeploying] = useState(false)

  const healthStatus = deployment.healthStatus || 'unknown'
  const HealthIcon = statusConfig[healthStatus].icon
  const status = deployment.status || 'pending'

  const handleDeploy = async () => {
    setIsDeploying(true)
    setIsExpanded(true)
    try {
      await onDeploy(deployment.id)
    } finally {
      setIsDeploying(false)
    }
  }

  const canDeploy = status === 'pending' || status === 'failed' || status === 'generated'

  return (
    <>
      <TableRow className="cursor-pointer" onClick={() => setIsExpanded(!isExpanded)}>
        <TableCell className="w-8">
          {isExpanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </TableCell>
        <TableCell className="font-medium">{deployment.name}</TableCell>
        <TableCell>
          <Badge variant="outline">{deployment.generator}</Badge>
        </TableCell>
        <TableCell>{deployment.target?.type || '-'}</TableCell>
        <TableCell>
          <Badge className={deploymentStatusColors[status]}>
            {status}
          </Badge>
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-1">
            <HealthIcon className={`h-4 w-4 ${statusConfig[healthStatus].color}`} />
            <span className="capitalize">{healthStatus}</span>
          </div>
        </TableCell>
        <TableCell>
          {deployment.lastDeployedAt
            ? new Date(deployment.lastDeployedAt).toLocaleString()
            : 'Never'}
        </TableCell>
        <TableCell onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-1">
            {canDeploy && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleDeploy}
                disabled={isDeploying}
              >
                {isDeploying ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => onEdit(deployment.id)}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onDelete(deployment.id)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </TableCell>
      </TableRow>
      {isExpanded && (
        <TableRow>
          <TableCell colSpan={8} className="bg-muted/50 p-0">
            <DeploymentProgressPanel
              deployment={deployment}
              isExpanded={isExpanded}
              onRetry={handleDeploy}
            />
          </TableCell>
        </TableRow>
      )}
    </>
  )
}
