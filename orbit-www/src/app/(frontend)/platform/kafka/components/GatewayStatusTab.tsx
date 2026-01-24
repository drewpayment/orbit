'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { RefreshCw, Activity, Server, Users, Shield } from 'lucide-react'
import type { GatewayStatus } from '@/app/actions/bifrost-admin'

interface GatewayStatusTabProps {
  status: GatewayStatus | null
  onRefresh: () => Promise<void>
}

function getStatusBadge(status: string): { variant: 'default' | 'secondary' | 'destructive'; className?: string } {
  switch (status.toLowerCase()) {
    case 'healthy':
    case 'ok':
      return { variant: 'default', className: 'bg-green-500 hover:bg-green-500/80 text-white' }
    case 'degraded':
      return { variant: 'secondary', className: 'bg-yellow-500 hover:bg-yellow-500/80 text-white' }
    case 'unhealthy':
    case 'error':
      return { variant: 'destructive' }
    default:
      return { variant: 'secondary' }
  }
}

export function GatewayStatusTab({
  status,
  onRefresh,
}: GatewayStatusTabProps) {
  const [isRefreshing, setIsRefreshing] = useState(false)

  const handleRefresh = async () => {
    setIsRefreshing(true)
    try {
      await onRefresh()
    } finally {
      setIsRefreshing(false)
    }
  }

  // Unreachable state
  if (!status) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4">
        <div className="rounded-full bg-destructive/10 p-4 mb-4">
          <Activity className="h-8 w-8 text-destructive" />
        </div>
        <h3 className="text-lg font-semibold mb-2">Gateway Unreachable</h3>
        <p className="text-muted-foreground text-center mb-6 max-w-md">
          Unable to connect to the Bifrost gateway. Check that the service is running
          and accessible.
        </p>
        <Button onClick={handleRefresh} disabled={isRefreshing}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          Retry Connection
        </Button>
      </div>
    )
  }

  const statusBadge = getStatusBadge(status.status)

  return (
    <div className="space-y-6">
      {/* Header with refresh */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            Gateway health and configuration overview
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={isRefreshing}
        >
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Status cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Gateway Status
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Badge variant={statusBadge.variant} className={statusBadge.className}>
              {status.status}
            </Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Active Connections
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{status.activeConnections}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Server className="h-4 w-4" />
              Virtual Clusters
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{status.virtualClusterCount}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Version
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm font-mono">
              {status.versionInfo?.version || status.versionInfo?.['bifrost.version'] || 'Unknown'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Version info details */}
      {Object.keys(status.versionInfo).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Version Information</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
              {Object.entries(status.versionInfo).map(([key, value]) => (
                <div key={key} className="text-sm">
                  <p className="text-muted-foreground">{key}</p>
                  <p className="font-mono">{value}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
