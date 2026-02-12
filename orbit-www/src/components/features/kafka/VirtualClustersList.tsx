'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Plus,
  RefreshCw,
  MoreHorizontal,
  Server,
  CheckCircle2,
  Clock,
  AlertCircle,
  Loader2,
  Eye,
  Settings,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import Link from 'next/link'
import { CreateVirtualClusterDialog } from './CreateVirtualClusterDialog'
import { ProvisioningAlert } from './ProvisioningAlert'
import { listVirtualClusters, type VirtualClusterData } from '@/app/actions/kafka-virtual-clusters'

export type { VirtualClusterData }

interface VirtualClustersListProps {
  workspaceId: string
  workspaceSlug: string
}

const statusConfig = {
  provisioning: {
    icon: Loader2,
    label: 'Provisioning',
    className: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    animate: true,
  },
  active: {
    icon: CheckCircle2,
    label: 'Active',
    className: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    animate: false,
  },
  read_only: {
    icon: Clock,
    label: 'Read Only',
    className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    animate: false,
  },
  deleting: {
    icon: Loader2,
    label: 'Deleting',
    className: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
    animate: true,
  },
  deleted: {
    icon: AlertCircle,
    label: 'Deleted',
    className: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    animate: false,
  },
}

const envColors: Record<string, string> = {
  dev: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200',
  staging: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-200',
  qa: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-200',
  prod: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-200',
}

export function VirtualClustersList({ workspaceId, workspaceSlug }: VirtualClustersListProps) {
  const [clusters, setClusters] = useState<VirtualClusterData[]>([])
  const [loading, setLoading] = useState(true)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)

  const loadClusters = useCallback(async () => {
    setLoading(true)
    try {
      const result = await listVirtualClusters({ workspaceId })
      if (result.success && result.clusters) {
        setClusters(result.clusters)
      } else {
        toast.error(result.error || 'Failed to load virtual clusters')
      }
    } catch {
      toast.error('Failed to load virtual clusters')
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    loadClusters()
  }, [loadClusters])

  const handleCreateSuccess = () => {
    setCreateDialogOpen(false)
    loadClusters()
    toast.success('Virtual cluster created successfully')
  }

  const renderStatusBadge = (status: VirtualClusterData['status']) => {
    const config = statusConfig[status]
    const StatusIcon = config.icon
    return (
      <Badge variant="secondary" className={config.className}>
        <StatusIcon className={`h-3 w-3 mr-1 ${config.animate ? 'animate-spin' : ''}`} />
        {config.label}
      </Badge>
    )
  }

  const renderEnvironmentBadge = (environment: string) => {
    const colorClass = envColors[environment.toLowerCase()] || 'bg-gray-100 text-gray-700 dark:bg-gray-900 dark:text-gray-200'
    return (
      <Badge variant="secondary" className={colorClass}>
        {environment.toUpperCase()}
      </Badge>
    )
  }

  return (
    <>
      <ProvisioningAlert workspaceId={workspaceId} />

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Virtual Clusters</h1>
          <p className="text-muted-foreground">
            Manage isolated Kafka environments for your workspace
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadClusters} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button onClick={() => setCreateDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Create Virtual Cluster
          </Button>
        </div>
      </div>

      {loading ? (
        <Card>
          <CardContent className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      ) : clusters.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Server className="h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-xl font-semibold mb-2">No Virtual Clusters Yet</h3>
            <p className="text-muted-foreground text-center max-w-md mb-4">
              Virtual clusters provide isolated Kafka environments with dedicated topic and consumer
              group namespaces. Create your first virtual cluster to get started.
            </p>
            <Button onClick={() => setCreateDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Create Your First Virtual Cluster
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Virtual Clusters</CardTitle>
            <CardDescription>
              {clusters.length} virtual cluster{clusters.length !== 1 ? 's' : ''} in this workspace
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Environment</TableHead>
                  <TableHead>Topics</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clusters.map((cluster) => (
                  <TableRow key={cluster.id}>
                    <TableCell>
                      <div>
                        <Link
                          href={`/workspaces/${workspaceSlug}/kafka/clusters/${cluster.id}`}
                          className="font-medium hover:underline"
                        >
                          {cluster.name}
                        </Link>
                        <p className="text-sm text-muted-foreground">
                          {cluster.topicPrefix}.*
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>{renderEnvironmentBadge(cluster.environment)}</TableCell>
                    <TableCell>
                      <span className="text-muted-foreground">
                        {cluster.topicCount ?? 0} topic{(cluster.topicCount ?? 0) !== 1 ? 's' : ''}
                      </span>
                    </TableCell>
                    <TableCell>{renderStatusBadge(cluster.status)}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link href={`/workspaces/${workspaceSlug}/kafka/clusters/${cluster.id}`}>
                              <Eye className="h-4 w-4 mr-2" />
                              View Details
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link href={`/workspaces/${workspaceSlug}/kafka/clusters/${cluster.id}/settings`}>
                              <Settings className="h-4 w-4 mr-2" />
                              Settings
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-red-600">
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <CreateVirtualClusterDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        workspaceId={workspaceId}
        workspaceSlug={workspaceSlug}
        onSuccess={handleCreateSuccess}
      />
    </>
  )
}
