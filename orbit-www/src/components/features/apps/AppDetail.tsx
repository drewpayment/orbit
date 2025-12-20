'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
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
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  ExternalLink,
  GitBranch,
  Plus,
  Settings,
} from 'lucide-react'
import type { App, Deployment, Template, HealthCheck } from '@/payload-types'
import { AddDeploymentModal } from './AddDeploymentModal'
import { AppSettingsSheet } from './AppSettingsSheet'
import { BuildSection } from './BuildSection'
import { AppEnvironmentVariables } from './AppEnvironmentVariables'
import { getHealthHistory } from '@/app/actions/apps'
import { DeploymentRow } from './DeploymentRow'
import { startDeployment, deleteDeployment } from '@/app/actions/deployments'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'

interface AppDetailProps {
  app: App
  deployments: Deployment[]
}

const statusConfig = {
  healthy: { icon: CheckCircle2, color: 'text-green-500', label: 'Healthy' },
  degraded: { icon: AlertTriangle, color: 'text-yellow-500', label: 'Degraded' },
  down: { icon: XCircle, color: 'text-red-500', label: 'Down' },
  unknown: { icon: HelpCircle, color: 'text-gray-400', label: 'Unknown' },
}

const deploymentStatusColors: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-800',
  deploying: 'bg-blue-100 text-blue-800',
  generated: 'bg-purple-100 text-purple-800',
  deployed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
}

export function AppDetail({ app, deployments }: AppDetailProps) {
  const router = useRouter()
  const [showAddDeployment, setShowAddDeployment] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [healthHistory, setHealthHistory] = useState<HealthCheck[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const status = app.status || 'unknown'
  const StatusIcon = statusConfig[status].icon
  const template = app.origin?.template as Template | undefined

  const handleDeploy = async (deploymentId: string) => {
    const result = await startDeployment(deploymentId)
    if (result.success) {
      toast.success('Deployment started')
      router.refresh()
    } else {
      toast.error(result.error || 'Failed to start deployment')
    }
  }

  const handleEditDeployment = (deploymentId: string) => {
    console.log('Edit deployment:', deploymentId)
  }

  const handleDeleteDeployment = async (deploymentId: string) => {
    if (!confirm('Are you sure you want to delete this deployment?')) {
      return
    }
    const result = await deleteDeployment(deploymentId)
    if (result.success) {
      toast.success('Deployment deleted')
      router.refresh()
    } else {
      toast.error(result.error || 'Failed to delete deployment')
    }
  }

  useEffect(() => {
    if (app.healthConfig?.url) {
      setLoadingHistory(true)
      getHealthHistory({ appId: app.id, limit: 10 })
        .then(result => {
          if (result.success) {
            setHealthHistory(result.data as HealthCheck[])
          }
        })
        .finally(() => setLoadingHistory(false))
    }
  }, [app.id, app.healthConfig?.url])

  return (
    <div className="container mx-auto py-8 px-4 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/apps">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold">{app.name}</h1>
            <div className="flex items-center gap-1">
              <StatusIcon className={`h-5 w-5 ${statusConfig[status].color}`} />
              <span className="text-sm text-muted-foreground">{statusConfig[status].label}</span>
            </div>
          </div>
          {app.description && (
            <p className="text-muted-foreground mt-1">{app.description}</p>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowSettings(true)}>
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Origin</CardDescription>
          </CardHeader>
          <CardContent>
            {app.origin?.type === 'template' && template ? (
              <div>
                <div className="font-medium">{template.name}</div>
                <div className="text-sm text-muted-foreground">
                  Created {app.origin.instantiatedAt
                    ? new Date(app.origin.instantiatedAt).toLocaleDateString()
                    : 'from template'}
                </div>
              </div>
            ) : app.origin?.type === 'manual' ? (
              <div className="font-medium">Manually Created</div>
            ) : (
              <div className="font-medium">Imported Repository</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Repository</CardDescription>
          </CardHeader>
          <CardContent>
            {app.repository?.url ? (
              <div className="flex items-center gap-2">
                <GitBranch className="h-4 w-4 text-muted-foreground" />
                <a
                  href={app.repository.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium hover:underline flex items-center gap-1"
                >
                  {app.repository.owner && app.repository.name
                    ? `${app.repository.owner}/${app.repository.name}`
                    : app.repository.url}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            ) : (
              <div className="text-muted-foreground">No repository linked</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Health Check</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <StatusIcon className={`h-5 w-5 ${statusConfig[status].color}`} />
              <span className="font-medium capitalize">{status}</span>
            </div>
            {app.healthConfig?.url ? (
              <div className="text-sm text-muted-foreground mt-1">
                <span className="font-mono text-xs">{app.healthConfig.method || 'GET'}</span>{' '}
                {app.healthConfig.url} every {app.healthConfig.interval || 60}s
              </div>
            ) : (
              <div className="text-sm text-muted-foreground mt-1">
                No health check URL configured
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Build Section */}
      <BuildSection
        appId={app.id}
        appName={app.name}
        hasRepository={!!app.repository?.url}
      />

      {/* Environment Variables */}
      <AppEnvironmentVariables
        appId={app.id}
        workspaceId={typeof app.workspace === 'string' ? app.workspace : app.workspace.id}
      />

      {/* Deployments */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Deployments</CardTitle>
            <Button size="sm" onClick={() => setShowAddDeployment(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Deployment
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {deployments.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No deployments yet. Add a deployment to start monitoring.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Generator</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Health</TableHead>
                  <TableHead>Last Deployed</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deployments.map((deployment) => (
                  <DeploymentRow
                    key={deployment.id}
                    deployment={deployment}
                    onDeploy={handleDeploy}
                    onEdit={handleEditDeployment}
                    onDelete={handleDeleteDeployment}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Health History */}
      {app.healthConfig?.url && (
        <Card>
          <CardHeader>
            <CardTitle>Health History</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingHistory ? (
              <div className="text-center py-4 text-muted-foreground">Loading...</div>
            ) : healthHistory.length === 0 ? (
              <div className="text-center py-4 text-muted-foreground">
                No health checks recorded yet
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Response Time</TableHead>
                    <TableHead>Status Code</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {healthHistory.map((check) => {
                    const checkStatus = check.status || 'unknown'
                    const CheckIcon = statusConfig[checkStatus as keyof typeof statusConfig]?.icon || HelpCircle
                    return (
                      <TableRow key={check.id}>
                        <TableCell>
                          {check.checkedAt
                            ? new Date(check.checkedAt).toLocaleString()
                            : '-'}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <CheckIcon className={`h-4 w-4 ${statusConfig[checkStatus as keyof typeof statusConfig]?.color || 'text-gray-400'}`} />
                            <span className="capitalize">{checkStatus}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          {check.responseTime ? `${check.responseTime}ms` : '-'}
                        </TableCell>
                        <TableCell>{check.statusCode || '-'}</TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      <AddDeploymentModal
        open={showAddDeployment}
        onOpenChange={setShowAddDeployment}
        appId={app.id}
        appName={app.name}
      />

      <AppSettingsSheet
        app={app}
        open={showSettings}
        onOpenChange={setShowSettings}
      />
    </div>
  )
}
