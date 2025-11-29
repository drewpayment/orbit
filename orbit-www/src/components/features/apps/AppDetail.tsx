'use client'

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
import type { App, Deployment, Template } from '@/payload-types'

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

const deploymentStatusColors = {
  pending: 'bg-gray-100 text-gray-800',
  deploying: 'bg-blue-100 text-blue-800',
  deployed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
}

export function AppDetail({ app, deployments }: AppDetailProps) {
  const status = app.status || 'unknown'
  const StatusIcon = statusConfig[status].icon
  const template = app.origin?.template as Template | undefined

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
          <Button variant="outline" size="sm">
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
            <div className="flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-muted-foreground" />
              <a
                href={app.repository?.url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium hover:underline flex items-center gap-1"
              >
                {app.repository?.owner}/{app.repository?.name}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
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
            <div className="text-sm text-muted-foreground mt-1">
              {app.healthConfig?.endpoint || '/health'} every {app.healthConfig?.interval || 60}s
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Deployments */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Deployments</CardTitle>
            <Button size="sm">
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
                {deployments.map((deployment) => {
                  const healthStatus = deployment.healthStatus || 'unknown'
                  const HealthIcon = statusConfig[healthStatus].icon
                  return (
                    <TableRow key={deployment.id}>
                      <TableCell className="font-medium">{deployment.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{deployment.generator}</Badge>
                      </TableCell>
                      <TableCell>{deployment.target?.type || '-'}</TableCell>
                      <TableCell>
                        <Badge className={deploymentStatusColors[deployment.status || 'pending']}>
                          {deployment.status}
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
                      <TableCell>
                        <Button variant="ghost" size="sm">View</Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
