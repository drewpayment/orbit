'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Plus, RefreshCw, Server, Database, Globe, Link2 } from 'lucide-react'
import type { KafkaClusterConfig, KafkaProviderConfig } from '@/app/actions/kafka-admin'

interface ClustersTabProps {
  clusters: KafkaClusterConfig[]
  providers?: KafkaProviderConfig[]
  onSelectCluster: (clusterId: string) => void
  onAddCluster: () => void
  onRefresh: () => Promise<void>
}

/**
 * Gets the appropriate badge variant and label for a cluster status.
 */
function getStatusBadge(status: KafkaClusterConfig['status']): {
  variant: 'default' | 'secondary' | 'destructive' | 'outline'
  label: string
  className?: string
} {
  switch (status) {
    case 'valid':
      return {
        variant: 'default',
        label: 'Healthy',
        className: 'bg-green-500 hover:bg-green-500/80 text-white',
      }
    case 'pending':
      return {
        variant: 'secondary',
        label: 'Pending',
        className: 'bg-yellow-500 hover:bg-yellow-500/80 text-white',
      }
    case 'invalid':
      return {
        variant: 'destructive',
        label: 'Offline',
      }
    case 'unknown':
    default:
      return {
        variant: 'outline',
        label: 'Unknown',
      }
  }
}

/**
 * Gets a display name for a provider ID.
 */
function getProviderDisplayName(
  providerId: string,
  providers?: KafkaProviderConfig[]
): string {
  if (providers) {
    const provider = providers.find((p) => p.id === providerId)
    if (provider) {
      return provider.displayName || provider.name
    }
  }
  // Fallback: format the provider ID for display
  return providerId
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export function ClustersTab({
  clusters,
  providers,
  onSelectCluster,
  onAddCluster,
  onRefresh,
}: ClustersTabProps) {
  const [isRefreshing, setIsRefreshing] = useState(false)

  const handleRefresh = async () => {
    setIsRefreshing(true)
    try {
      await onRefresh()
    } finally {
      setIsRefreshing(false)
    }
  }

  // Empty state
  if (clusters.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4">
        <div className="rounded-full bg-muted p-4 mb-4">
          <Server className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold mb-2">No Kafka Clusters</h3>
        <p className="text-muted-foreground text-center mb-6 max-w-md">
          You haven&apos;t configured any Kafka clusters yet. Add your first cluster to
          start managing your Kafka infrastructure.
        </p>
        <Button onClick={onAddCluster}>
          <Plus className="mr-2 h-4 w-4" />
          Add First Cluster
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header with actions */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            {clusters.length} cluster{clusters.length !== 1 ? 's' : ''} configured
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw
              className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`}
            />
            Refresh
          </Button>
          <Button size="sm" onClick={onAddCluster}>
            <Plus className="h-4 w-4" />
            Add Cluster
          </Button>
        </div>
      </div>

      {/* Clusters grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {clusters.map((cluster) => {
          const statusBadge = getStatusBadge(cluster.status)
          const providerName = getProviderDisplayName(cluster.providerId, providers)

          return (
            <Card
              key={cluster.id}
              className="cursor-pointer transition-colors hover:bg-accent/50"
              onClick={() => onSelectCluster(cluster.id)}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <Database className="h-5 w-5 text-muted-foreground" />
                    <CardTitle className="text-base">{cluster.name}</CardTitle>
                  </div>
                  <Badge
                    variant={statusBadge.variant}
                    className={statusBadge.className}
                  >
                    {statusBadge.label}
                  </Badge>
                </div>
                <CardDescription className="text-xs">
                  {providerName}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Bootstrap Servers */}
                <div className="flex items-start gap-2 text-sm">
                  <Server className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground mb-0.5">
                      Bootstrap Servers
                    </p>
                    <p className="font-mono text-xs truncate" title={cluster.bootstrapServers}>
                      {cluster.bootstrapServers}
                    </p>
                  </div>
                </div>

                {/* Environment */}
                <div className="flex items-start gap-2 text-sm">
                  <Globe className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground mb-0.5">
                      Environment
                    </p>
                    <Badge variant="outline" className="text-xs">
                      {cluster.environment || 'Not specified'}
                    </Badge>
                  </div>
                </div>

                {/* Schema Registry (if present) */}
                {cluster.schemaRegistryUrl && (
                  <div className="flex items-start gap-2 text-sm">
                    <Link2 className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground mb-0.5">
                        Schema Registry
                      </p>
                      <p
                        className="font-mono text-xs truncate"
                        title={cluster.schemaRegistryUrl}
                      >
                        {cluster.schemaRegistryUrl}
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
