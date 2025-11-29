'use client'

import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  MoreVertical
} from 'lucide-react'
import type { App, Template } from '@/payload-types'

interface AppCardProps {
  app: App
}

type StatusType = 'healthy' | 'degraded' | 'down' | 'unknown'

const statusConfig: Record<StatusType, { icon: React.ComponentType<{ className?: string }>, color: string, bg: string }> = {
  healthy: { icon: CheckCircle2, color: 'text-green-500', bg: 'bg-green-500' },
  degraded: { icon: AlertTriangle, color: 'text-yellow-500', bg: 'bg-yellow-500' },
  down: { icon: XCircle, color: 'text-red-500', bg: 'bg-red-500' },
  unknown: { icon: HelpCircle, color: 'text-gray-400', bg: 'bg-gray-400' },
}

export function AppCard({ app }: AppCardProps) {
  const status: StatusType = (app.status as StatusType) || 'unknown'
  const StatusIcon = statusConfig[status].icon
  const template = app.origin?.template as Template | undefined

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${statusConfig[status].bg}`} />
            <CardTitle className="text-lg">{app.name}</CardTitle>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <MoreVertical className="h-4 w-4" />
          </Button>
        </div>
        {app.description && (
          <CardDescription className="line-clamp-2">
            {app.description}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {app.origin?.type === 'template' && template ? (
            <Badge variant="secondary">Template: {template.name}</Badge>
          ) : (
            <Badge variant="outline">Imported</Badge>
          )}
        </div>

        <div className="flex items-center justify-between pt-2">
          <div className="flex items-center gap-1">
            <StatusIcon className={`h-4 w-4 ${statusConfig[status].color}`} />
            <span className="text-sm capitalize">{status}</span>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={`/apps/${app.id}`}>View</Link>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
