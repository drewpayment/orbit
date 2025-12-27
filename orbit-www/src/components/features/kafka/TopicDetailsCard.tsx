'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Clock,
  Server,
  HardDrive,
  Layers,
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import type { KafkaTopic } from '@/app/(frontend)/workspaces/[slug]/kafka/actions'

interface TopicDetailsCardProps {
  topic: KafkaTopic
}

const statusConfig = {
  pending_approval: {
    icon: Clock,
    label: 'Pending Approval',
    className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  },
  provisioning: {
    icon: Loader2,
    label: 'Provisioning',
    className: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  },
  active: {
    icon: CheckCircle2,
    label: 'Active',
    className: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  },
  failed: {
    icon: XCircle,
    label: 'Failed',
    className: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  },
  deleting: {
    icon: AlertTriangle,
    label: 'Deleting',
    className: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
  },
}

function formatRetention(ms: number): string {
  if (ms === -1) return 'Forever'
  const hours = ms / 3600000
  if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''}`
  const days = hours / 24
  if (days < 30) return `${days} day${days !== 1 ? 's' : ''}`
  const months = Math.floor(days / 30)
  return `${months} month${months !== 1 ? 's' : ''}`
}

export function TopicDetailsCard({ topic }: TopicDetailsCardProps) {
  const config = statusConfig[topic.status] || statusConfig.active
  const StatusIcon = config.icon

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-2xl">{topic.name}</CardTitle>
            {topic.description && (
              <CardDescription className="mt-2">{topic.description}</CardDescription>
            )}
          </div>
          <Badge variant="secondary" className={config.className}>
            <StatusIcon
              className={`h-3 w-3 mr-1 ${topic.status === 'provisioning' ? 'animate-spin' : ''}`}
            />
            {config.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded-lg">
              <Layers className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Partitions</p>
              <p className="text-lg font-semibold">{topic.partitions}</p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="p-2 bg-green-100 dark:bg-green-900 rounded-lg">
              <Server className="h-5 w-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Replication</p>
              <p className="text-lg font-semibold">{topic.replicationFactor}x</p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="p-2 bg-purple-100 dark:bg-purple-900 rounded-lg">
              <Clock className="h-5 w-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Retention</p>
              <p className="text-lg font-semibold">{formatRetention(topic.retentionMs)}</p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="p-2 bg-orange-100 dark:bg-orange-900 rounded-lg">
              <HardDrive className="h-5 w-5 text-orange-600 dark:text-orange-400" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Cleanup</p>
              <p className="text-lg font-semibold capitalize">{topic.cleanupPolicy}</p>
            </div>
          </div>
        </div>

        <Separator className="my-6" />

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-gray-500">Environment</p>
            <Badge variant="outline" className="mt-1">
              {topic.environment}
            </Badge>
          </div>

          <div>
            <p className="text-gray-500">Compression</p>
            <p className="mt-1 font-medium capitalize">{topic.compression || 'None'}</p>
          </div>

          <div>
            <p className="text-gray-500">Created</p>
            <p className="mt-1 font-medium">
              {formatDistanceToNow(new Date(topic.createdAt), { addSuffix: true })}
            </p>
          </div>

          {topic.approvalRequired && (
            <div>
              <p className="text-gray-500">Approval</p>
              <p className="mt-1 font-medium">
                {topic.approvedBy ? (
                  <span className="text-green-600">Approved</span>
                ) : (
                  <span className="text-yellow-600">Pending</span>
                )}
              </p>
            </div>
          )}
        </div>

        {Object.keys(topic.config).length > 0 && (
          <>
            <Separator className="my-6" />
            <div>
              <h4 className="text-sm font-medium mb-3">Additional Configuration</h4>
              <div className="grid grid-cols-2 gap-2 text-sm">
                {Object.entries(topic.config).map(([key, value]) => (
                  <div key={key} className="flex justify-between">
                    <span className="text-gray-500">{key}</span>
                    <span className="font-mono">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
