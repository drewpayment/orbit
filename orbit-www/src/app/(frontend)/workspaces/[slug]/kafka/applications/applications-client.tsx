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
  ClipboardList,
  AlertTriangle,
} from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { toast } from 'sonner'
import Link from 'next/link'
import {
  listApplications,
  ApplicationData,
  retryVirtualClusterProvisioning,
} from '@/app/actions/kafka-applications'
import { getWorkspaceAdminStatus } from '@/app/actions/kafka-application-requests'
import { CreateApplicationDialog, MyRequestsList } from '@/components/features/kafka'

interface ApplicationsClientProps {
  workspaceId: string
  workspaceSlug: string
}

const statusConfig = {
  active: {
    icon: CheckCircle2,
    label: 'Active',
    className: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  },
  decommissioning: {
    icon: Clock,
    label: 'Decommissioning',
    className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  },
  deleted: {
    icon: AlertCircle,
    label: 'Deleted',
    className: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  },
}

const envColors: Record<string, string> = {
  dev: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200',
  stage: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-200',
  prod: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-200',
}

const provisioningStatusConfig = {
  pending: {
    icon: Clock,
    label: 'Pending',
    className: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
  },
  in_progress: {
    icon: RefreshCw,
    label: 'Provisioning',
    className: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  },
  completed: {
    icon: CheckCircle2,
    label: 'Ready',
    className: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  },
  partial: {
    icon: AlertTriangle,
    label: 'Partial',
    className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  },
  failed: {
    icon: AlertCircle,
    label: 'Failed',
    className: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  },
}

export function ApplicationsClient({ workspaceId, workspaceSlug }: ApplicationsClientProps) {
  const [applications, setApplications] = useState<ApplicationData[]>([])
  const [loading, setLoading] = useState(true)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [retryingApps, setRetryingApps] = useState<Set<string>>(new Set())
  const [adminStatus, setAdminStatus] = useState<{ isAdmin: boolean; pendingCount: number }>({
    isAdmin: false,
    pendingCount: 0,
  })

  const loadAdminStatus = useCallback(async () => {
    const status = await getWorkspaceAdminStatus(workspaceId)
    setAdminStatus(status)
  }, [workspaceId])

  const loadApplications = useCallback(async () => {
    setLoading(true)
    try {
      const result = await listApplications({ workspaceId })
      if (result.success && result.applications) {
        setApplications(result.applications)
      } else {
        toast.error(result.error || 'Failed to load applications')
      }
    } catch (error) {
      toast.error('Failed to load applications')
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    loadApplications()
    loadAdminStatus()
  }, [loadApplications, loadAdminStatus])

  const handleCreateSuccess = () => {
    setCreateDialogOpen(false)
    loadApplications()
    toast.success('Application created successfully')
  }

  const handleRetryProvisioning = async (applicationId: string) => {
    setRetryingApps((prev) => new Set(prev).add(applicationId))
    try {
      const result = await retryVirtualClusterProvisioning(applicationId)
      if (result.success) {
        toast.success('Provisioning restarted successfully')
        loadApplications()
      } else {
        toast.error(result.error || 'Failed to retry provisioning')
      }
    } catch {
      toast.error('Failed to retry provisioning')
    } finally {
      setRetryingApps((prev) => {
        const next = new Set(prev)
        next.delete(applicationId)
        return next
      })
    }
  }

  const renderStatusBadge = (status: ApplicationData['status']) => {
    const config = statusConfig[status]
    const StatusIcon = config.icon
    return (
      <Badge variant="secondary" className={config.className}>
        <StatusIcon className="h-3 w-3 mr-1" />
        {config.label}
      </Badge>
    )
  }

  const getProvisioningTooltipContent = (app: ApplicationData) => {
    if (!app.provisioningDetails) {
      return app.provisioningError || 'No details available'
    }

    const details = app.provisioningDetails
    const lines: string[] = []

    for (const env of ['dev', 'stage', 'prod'] as const) {
      const result = details[env]
      if (result) {
        const statusEmoji =
          result.status === 'success' ? '✓' : result.status === 'failed' ? '✗' : '○'
        const message = result.error || result.message || result.status
        lines.push(`${statusEmoji} ${env}: ${message}`)
      }
    }

    return lines.length > 0 ? lines.join('\n') : app.provisioningError || 'No details available'
  }

  const renderProvisioningStatus = (app: ApplicationData) => {
    const config = provisioningStatusConfig[app.provisioningStatus]
    const StatusIcon = config.icon
    const isRetrying = retryingApps.has(app.id)
    const showRetry =
      (app.provisioningStatus === 'failed' || app.provisioningStatus === 'partial') && !isRetrying

    const badge = (
      <Badge variant="secondary" className={config.className}>
        <StatusIcon
          className={`h-3 w-3 mr-1 ${app.provisioningStatus === 'in_progress' || isRetrying ? 'animate-spin' : ''}`}
        />
        {isRetrying ? 'Retrying...' : config.label}
      </Badge>
    )

    // Wrap with tooltip for partial/failed status
    const badgeWithTooltip =
      app.provisioningStatus === 'partial' || app.provisioningStatus === 'failed' ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>{badge}</TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <pre className="text-xs whitespace-pre-wrap font-sans">
                {getProvisioningTooltipContent(app)}
              </pre>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        badge
      )

    return (
      <div className="flex items-center gap-2">
        {badgeWithTooltip}
        {showRetry && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => handleRetryProvisioning(app.id)}
          >
            <RefreshCw className="h-3 w-3 mr-1" />
            Retry
          </Button>
        )}
      </div>
    )
  }

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Kafka Applications</h1>
          <p className="text-muted-foreground">
            Manage your Kafka applications and virtual clusters
          </p>
        </div>
        <div className="flex items-center gap-2">
          {adminStatus.isAdmin && (
            <Button variant="outline" size="sm" asChild>
              <Link href={`/workspaces/${workspaceSlug}/kafka/pending-approvals`}>
                <ClipboardList className="h-4 w-4 mr-1" />
                Pending Approvals
                {adminStatus.pendingCount > 0 && (
                  <Badge variant="secondary" className="ml-1 bg-orange-100 text-orange-800">
                    {adminStatus.pendingCount}
                  </Badge>
                )}
              </Link>
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={loadApplications} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button onClick={() => setCreateDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Create Application
          </Button>
        </div>
      </div>

      <MyRequestsList workspaceId={workspaceId} />

      {applications.length === 0 && !loading ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Server className="h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-xl font-semibold mb-2">No Applications Yet</h3>
            <p className="text-muted-foreground text-center max-w-md mb-4">
              Kafka applications provide isolated virtual clusters for your services. Each
              application gets dev, stage, and prod environments.
            </p>
            <Button onClick={() => setCreateDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Create Your First Application
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Applications</CardTitle>
            <CardDescription>
              {applications.length} application{applications.length !== 1 ? 's' : ''}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Virtual Clusters</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {applications.map((app) => (
                  <TableRow key={app.id}>
                    <TableCell>
                      <div>
                        <Link
                          href={`/workspaces/${workspaceSlug}/kafka/applications/${app.slug}`}
                          className="font-medium hover:underline"
                        >
                          {app.name}
                        </Link>
                        <p className="text-sm text-muted-foreground">{app.slug}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1 flex-wrap items-center">
                        {app.provisioningStatus === 'completed' && app.virtualClusters?.length ? (
                          app.virtualClusters.map((vc) => (
                            <Badge
                              key={vc.id}
                              variant="secondary"
                              className={envColors[vc.environment]}
                            >
                              {vc.environment.toUpperCase()}
                            </Badge>
                          ))
                        ) : (
                          renderProvisioningStatus(app)
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{renderStatusBadge(app.status)}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link
                              href={`/workspaces/${workspaceSlug}/kafka/applications/${app.slug}`}
                            >
                              View Details
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link
                              href={`/workspaces/${workspaceSlug}/kafka/applications/${app.slug}/settings`}
                            >
                              Settings
                            </Link>
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

      <CreateApplicationDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        workspaceId={workspaceId}
        onSuccess={handleCreateSuccess}
      />
    </>
  )
}
