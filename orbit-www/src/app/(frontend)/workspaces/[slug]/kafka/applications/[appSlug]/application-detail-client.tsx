'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ArrowLeft, Settings, Server, CheckCircle2, Clock, AlertCircle, Network } from 'lucide-react'
import { TopicsPanel } from '@/components/features/kafka/TopicsPanel'
import { ServiceAccountsPanel } from '@/components/features/kafka/ServiceAccountsPanel'

interface VirtualCluster {
  id: string
  environment: 'dev' | 'stage' | 'prod'
  status: string
  advertisedHost: string
  topicPrefix: string
}

interface Application {
  id: string
  name: string
  slug: string
  description?: string
  status: 'active' | 'decommissioning' | 'deleted'
}

interface ApplicationDetailClientProps {
  workspaceSlug: string
  application: Application
  virtualClusters: VirtualCluster[]
  canManage: boolean
  canApprove: boolean
  userId: string
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

const envLabels: Record<string, string> = {
  dev: 'Development',
  stage: 'Staging',
  prod: 'Production',
}

const envColors: Record<string, string> = {
  dev: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200',
  stage: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-200',
  prod: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-200',
}

export function ApplicationDetailClient({
  workspaceSlug,
  application,
  virtualClusters,
  canManage,
  canApprove,
  userId,
}: ApplicationDetailClientProps) {
  const [selectedEnv, setSelectedEnv] = useState<string>(virtualClusters[0]?.environment ?? 'dev')
  const selectedVc = virtualClusters.find((vc) => vc.environment === selectedEnv)

  const StatusIcon = statusConfig[application.status].icon

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/workspaces/${workspaceSlug}/kafka/applications`}>
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">{application.name}</h1>
              <Badge variant="secondary" className={statusConfig[application.status].className}>
                <StatusIcon className="h-3 w-3 mr-1" />
                {statusConfig[application.status].label}
              </Badge>
            </div>
            {application.description && (
              <p className="text-muted-foreground">{application.description}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link href={`/workspaces/${workspaceSlug}/kafka/applications/${application.slug}/lineage`}>
              <Network className="h-4 w-4 mr-1" />
              Data Lineage
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href={`/workspaces/${workspaceSlug}/kafka/applications/${application.slug}/settings`}>
              <Settings className="h-4 w-4 mr-1" />
              Settings
            </Link>
          </Button>
        </div>
      </div>

      {/* Virtual Clusters Overview */}
      {virtualClusters.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Server className="h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-xl font-semibold mb-2">Provisioning Virtual Clusters</h3>
            <p className="text-muted-foreground text-center max-w-md">
              Your virtual clusters are being provisioned. This usually takes a few minutes.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Environment Tabs */}
          <Tabs value={selectedEnv} onValueChange={setSelectedEnv}>
            <TabsList>
              {virtualClusters.map((vc) => (
                <TabsTrigger key={vc.id} value={vc.environment}>
                  <Badge variant="secondary" className={`mr-2 ${envColors[vc.environment]}`}>
                    {vc.environment.toUpperCase()}
                  </Badge>
                  {envLabels[vc.environment]}
                </TabsTrigger>
              ))}
            </TabsList>

            {virtualClusters.map((vc) => (
              <TabsContent key={vc.id} value={vc.environment} className="space-y-6">
                {/* Connection Info */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Connection Details</CardTitle>
                    <CardDescription>
                      Use these settings to connect to your virtual cluster
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="text-sm font-medium text-muted-foreground">
                          Bootstrap Server
                        </div>
                        <code className="text-sm bg-muted px-2 py-1 rounded">
                          {vc.advertisedHost}
                        </code>
                      </div>
                      <div>
                        <div className="text-sm font-medium text-muted-foreground">Topic Prefix</div>
                        <code className="text-sm bg-muted px-2 py-1 rounded">{vc.topicPrefix}</code>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Topics Panel */}
                <TopicsPanel
                  virtualClusterId={vc.id}
                  virtualClusterName={`${application.name} - ${envLabels[vc.environment]}`}
                  environment={vc.environment}
                  canManage={canManage}
                  canApprove={canApprove}
                  userId={userId}
                  workspaceSlug={workspaceSlug}
                  applicationSlug={application.slug}
                />

                {/* Service Accounts Panel */}
                <ServiceAccountsPanel
                  virtualClusterId={vc.id}
                  applicationId={application.id}
                  environment={vc.environment}
                />
              </TabsContent>
            ))}
          </Tabs>
        </>
      )}
    </div>
  )
}
