'use client'

import { useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Plus, RefreshCw, Server, Lock, LockOpen, Filter, Check, X } from 'lucide-react'
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
  onVirtualClustersChange: _onVirtualClustersChange,
}: VirtualClustersTabProps) {
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editingCluster, setEditingCluster] = useState<VirtualClusterConfig | null>(null)
  const [selectedWorkspaces, setSelectedWorkspaces] = useState<string[]>([])
  const [workspaceFilterOpen, setWorkspaceFilterOpen] = useState(false)

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

  // Get unique workspaces for filter
  const availableWorkspaces = useMemo(() => {
    const workspaces = new Set(
      virtualClusters
        .map((c) => c.workspaceSlug)
        .filter((ws): ws is string => !!ws) // Filter out empty strings
    )
    return Array.from(workspaces).sort()
  }, [virtualClusters])

  // Filter clusters by selected workspaces
  const filteredClusters = useMemo(() => {
    if (selectedWorkspaces.length === 0) {
      return virtualClusters
    }
    return virtualClusters.filter((c) => c.workspaceSlug && selectedWorkspaces.includes(c.workspaceSlug))
  }, [virtualClusters, selectedWorkspaces])

  const toggleWorkspace = (workspace: string) => {
    setSelectedWorkspaces((prev) =>
      prev.includes(workspace) ? prev.filter((w) => w !== workspace) : [...prev, workspace]
    )
  }

  const clearFilters = () => {
    setSelectedWorkspaces([])
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
      {/* Header with filters and actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <p className="text-sm text-muted-foreground">
            {filteredClusters.length} of {virtualClusters.length} virtual cluster
            {virtualClusters.length !== 1 ? 's' : ''}
          </p>
          {selectedWorkspaces.length > 0 && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="h-7 px-2">
              <X className="h-3 w-3 mr-1" />
              Clear filters
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Workspace filter */}
          <Popover open={workspaceFilterOpen} onOpenChange={setWorkspaceFilterOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <Filter className="h-4 w-4" />
                Workspace
                {selectedWorkspaces.length > 0 && (
                  <Badge variant="secondary" className="ml-1 rounded-full px-1.5">
                    {selectedWorkspaces.length}
                  </Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[200px] p-0" align="end">
              <Command>
                <CommandInput placeholder="Search workspace..." />
                <CommandList>
                  <CommandEmpty>No workspace found.</CommandEmpty>
                  <CommandGroup>
                    {availableWorkspaces.map((workspace) => (
                      <CommandItem
                        key={workspace}
                        onSelect={() => toggleWorkspace(workspace)}
                        className="cursor-pointer"
                      >
                        <div className="flex items-center gap-2 flex-1">
                          <div
                            className={`flex h-4 w-4 items-center justify-center rounded-sm border ${
                              selectedWorkspaces.includes(workspace)
                                ? 'bg-primary border-primary'
                                : 'border-input'
                            }`}
                          >
                            {selectedWorkspaces.includes(workspace) && (
                              <Check className="h-3 w-3 text-primary-foreground" />
                            )}
                          </div>
                          <span>{workspace}</span>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

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
        {filteredClusters.map((cluster) => (
          <Card
            key={cluster.id}
            className="cursor-pointer transition-colors hover:bg-accent/50"
            onClick={() => {
              setEditingCluster(cluster)
              setShowForm(true)
            }}
          >
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <Server className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <CardTitle className="text-base truncate">
                      {cluster.workspaceSlug} / {cluster.environment}
                    </CardTitle>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs">
                      {cluster.workspaceSlug}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      {cluster.environment}
                    </Badge>
                  </div>
                </div>
                <div className="flex-shrink-0">
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
              <CardDescription className="text-xs font-mono truncate mt-2">
                {cluster.id}
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
