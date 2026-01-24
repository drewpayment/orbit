'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Plus, RefreshCw, Server, Lock, LockOpen } from 'lucide-react'
import type { VirtualClusterConfig } from '@/app/actions/bifrost-admin'
import { VirtualClusterForm } from './VirtualClusterForm'

interface VirtualClustersTabProps {
  virtualClusters: VirtualClusterConfig[]
  onRefresh: () => Promise<void>
  onVirtualClustersChange: (clusters: VirtualClusterConfig[]) => void
}

export function VirtualClustersTab({
  virtualClusters,
  onRefresh,
  onVirtualClustersChange,
}: VirtualClustersTabProps) {
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editingCluster, setEditingCluster] = useState<VirtualClusterConfig | null>(null)

  const handleRefresh = async () => {
    setIsRefreshing(true)
    try {
      await onRefresh()
    } finally {
      setIsRefreshing(false)
    }
  }

  const handleToggleReadOnly = async (cluster: VirtualClusterConfig) => {
    try {
      const { setVirtualClusterReadOnly } = await import('@/app/actions/bifrost-admin')
      const result = await setVirtualClusterReadOnly(cluster.id, !cluster.readOnly)
      if (result.success) {
        await onRefresh()
      }
    } catch (err) {
      console.error('Failed to toggle read-only:', err)
    }
  }

  const handleDelete = async (clusterId: string) => {
    if (!confirm('Are you sure you want to delete this virtual cluster? Associated credentials will become orphaned.')) {
      return
    }

    try {
      const { deleteVirtualCluster } = await import('@/app/actions/bifrost-admin')
      const result = await deleteVirtualCluster(clusterId)
      if (result.success) {
        await onRefresh()
      }
    } catch (err) {
      console.error('Failed to delete virtual cluster:', err)
    }
  }

  const handleFormClose = () => {
    setShowForm(false)
    setEditingCluster(null)
  }

  const handleFormSuccess = async () => {
    await onRefresh()
    handleFormClose()
  }

  // Empty state
  if (virtualClusters.length === 0 && !showForm) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4">
        <div className="rounded-full bg-muted p-4 mb-4">
          <Server className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold mb-2">No Virtual Clusters</h3>
        <p className="text-muted-foreground text-center mb-6 max-w-md">
          Virtual clusters provide tenant isolation for Kafka access. Create your first
          virtual cluster to start routing traffic through Bifrost.
        </p>
        <Button onClick={() => setShowForm(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Create Virtual Cluster
        </Button>
      </div>
    )
  }

  if (showForm) {
    return (
      <VirtualClusterForm
        cluster={editingCluster}
        onCancel={handleFormClose}
        onSuccess={handleFormSuccess}
      />
    )
  }

  return (
    <div className="space-y-6">
      {/* Header with actions */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            {virtualClusters.length} virtual cluster{virtualClusters.length !== 1 ? 's' : ''} configured
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4" />
            Create Virtual Cluster
          </Button>
        </div>
      </div>

      {/* Virtual clusters grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {virtualClusters.map((cluster) => (
          <Card
            key={cluster.id}
            className="cursor-pointer transition-colors hover:bg-accent/50"
            onClick={() => {
              setEditingCluster(cluster)
              setShowForm(true)
            }}
          >
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <Server className="h-5 w-5 text-muted-foreground" />
                  <CardTitle className="text-base">{cluster.id}</CardTitle>
                </div>
                <div className="flex items-center gap-2">
                  {cluster.readOnly ? (
                    <Badge variant="secondary" className="flex items-center gap-1">
                      <Lock className="h-3 w-3" />
                      Read-Only
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="flex items-center gap-1">
                      <LockOpen className="h-3 w-3" />
                      Read/Write
                    </Badge>
                  )}
                </div>
              </div>
              <CardDescription className="text-xs">
                {cluster.workspaceSlug} / {cluster.environment}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-sm">
                <p className="text-xs text-muted-foreground mb-0.5">Topic Prefix</p>
                <p className="font-mono text-xs truncate">{cluster.topicPrefix}</p>
              </div>
              <div className="text-sm">
                <p className="text-xs text-muted-foreground mb-0.5">Bootstrap Servers</p>
                <p className="font-mono text-xs truncate">{cluster.physicalBootstrapServers}</p>
              </div>
              <div className="flex items-center gap-2 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleToggleReadOnly(cluster)
                  }}
                >
                  {cluster.readOnly ? 'Enable Writes' : 'Set Read-Only'}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDelete(cluster.id)
                  }}
                >
                  Delete
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
