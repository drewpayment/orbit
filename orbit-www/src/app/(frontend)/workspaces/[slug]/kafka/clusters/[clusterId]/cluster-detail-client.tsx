'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  AlertCircle,
  Loader2,
  Database,
  FileJson,
  Users,
  Key,
  Settings,
  Copy,
  Check,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { TopicsPanel } from '@/components/features/kafka/TopicsPanel'
import { ServiceAccountsPanel } from '@/components/features/kafka/ServiceAccountsPanel'
import { ConsumerGroupsPanel } from '@/components/features/kafka/ConsumerGroupsPanel'

interface VirtualCluster {
  id: string
  name: string
  environment: 'dev' | 'staging' | 'qa' | 'prod'
  status: 'provisioning' | 'active' | 'read_only' | 'deleting' | 'deleted'
  advertisedHost: string
  advertisedPort: number
  topicPrefix: string
  groupPrefix: string
}

interface ClusterDetailClientProps {
  workspaceSlug: string
  cluster: VirtualCluster
  applicationId: string
  applicationSlug: string
  canManage: boolean
  canApprove: boolean
  userId: string
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

const envConfig: Record<string, { label: string; className: string }> = {
  dev: {
    label: 'Development',
    className: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200',
  },
  staging: {
    label: 'Staging',
    className: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-200',
  },
  qa: {
    label: 'QA',
    className: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-200',
  },
  prod: {
    label: 'Production',
    className: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-200',
  },
  // Support old schema values
  stage: {
    label: 'Staging',
    className: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-200',
  },
}

export function ClusterDetailClient({
  workspaceSlug,
  cluster,
  applicationId,
  applicationSlug,
  canManage,
  canApprove,
  userId,
}: ClusterDetailClientProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null)

  const StatusIcon = statusConfig[cluster.status].icon
  const statusCfg = statusConfig[cluster.status]
  const envCfg = envConfig[cluster.environment] || envConfig.dev

  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedField(field)
      toast.success('Copied to clipboard')
      setTimeout(() => setCopiedField(null), 2000)
    } catch {
      toast.error('Failed to copy')
    }
  }

  const bootstrapServers = `${cluster.advertisedHost}:${cluster.advertisedPort}`

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/workspaces/${workspaceSlug}/kafka`}>
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">{cluster.name}</h1>
              <Badge variant="secondary" className={statusCfg.className}>
                <StatusIcon className={`h-3 w-3 mr-1 ${statusCfg.animate ? 'animate-spin' : ''}`} />
                {statusCfg.label}
              </Badge>
              <Badge variant="secondary" className={envCfg.className}>
                {envCfg.label}
              </Badge>
            </div>
            <p className="text-muted-foreground">{cluster.topicPrefix}*</p>
          </div>
        </div>
      </div>

      {/* Provisioning state */}
      {cluster.status === 'provisioning' && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Loader2 className="h-16 w-16 text-blue-500 animate-spin mb-4" />
            <h3 className="text-xl font-semibold mb-2">Provisioning Virtual Cluster</h3>
            <p className="text-muted-foreground text-center max-w-md">
              Your virtual cluster is being set up. This usually takes a few minutes.
              The page will automatically update when provisioning completes.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Main content - only show when active or read_only */}
      {(cluster.status === 'active' || cluster.status === 'read_only') && (
        <Tabs defaultValue="topics" className="space-y-4">
          <TabsList>
            <TabsTrigger value="topics">
              <Database className="h-4 w-4 mr-2" />
              Topics
            </TabsTrigger>
            <TabsTrigger value="schemas">
              <FileJson className="h-4 w-4 mr-2" />
              Schemas
            </TabsTrigger>
            <TabsTrigger value="consumer-groups">
              <Users className="h-4 w-4 mr-2" />
              Consumer Groups
            </TabsTrigger>
            <TabsTrigger value="service-accounts">
              <Key className="h-4 w-4 mr-2" />
              Service Accounts
            </TabsTrigger>
            <TabsTrigger value="settings">
              <Settings className="h-4 w-4 mr-2" />
              Settings
            </TabsTrigger>
          </TabsList>

          {/* Topics Tab */}
          <TabsContent value="topics">
            <TopicsPanel
              virtualClusterId={cluster.id}
              virtualClusterName={cluster.name}
              environment={cluster.environment}
              canManage={canManage && cluster.status === 'active'}
              canApprove={canApprove}
              userId={userId}
              workspaceSlug={workspaceSlug}
              applicationSlug={applicationSlug || workspaceSlug}
            />
          </TabsContent>

          {/* Schemas Tab */}
          <TabsContent value="schemas">
            <Card>
              <CardHeader>
                <CardTitle>Schemas</CardTitle>
                <CardDescription>
                  Schema registry integration for this virtual cluster
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <FileJson className="h-16 w-16 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">Schema Registry Coming Soon</h3>
                <p className="text-muted-foreground text-center max-w-md">
                  Schema management and validation will be available in a future update.
                  You&apos;ll be able to register, view, and validate Avro, JSON, and Protobuf schemas.
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Consumer Groups Tab */}
          <TabsContent value="consumer-groups">
            <ConsumerGroupsPanel
              virtualClusterId={cluster.id}
              canManage={canManage && cluster.status === 'active'}
            />
          </TabsContent>

          {/* Service Accounts Tab */}
          <TabsContent value="service-accounts">
            <ServiceAccountsPanel
              virtualClusterId={cluster.id}
              applicationId={applicationId}
              environment={cluster.environment}
            />
          </TabsContent>

          {/* Settings Tab */}
          <TabsContent value="settings">
            <div className="space-y-6">
              {/* Connection Details Card */}
              <Card>
                <CardHeader>
                  <CardTitle>Connection Details</CardTitle>
                  <CardDescription>
                    Use these details to connect to this virtual cluster
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-sm text-muted-foreground">Bootstrap Servers</Label>
                    <div className="flex gap-2">
                      <Input
                        value={bootstrapServers}
                        readOnly
                        className="font-mono text-sm"
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => copyToClipboard(bootstrapServers, 'bootstrap')}
                      >
                        {copiedField === 'bootstrap' ? (
                          <Check className="h-4 w-4 text-green-500" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm text-muted-foreground">Topic Prefix</Label>
                    <div className="flex gap-2">
                      <Input
                        value={cluster.topicPrefix}
                        readOnly
                        className="font-mono text-sm"
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => copyToClipboard(cluster.topicPrefix, 'topicPrefix')}
                      >
                        {copiedField === 'topicPrefix' ? (
                          <Check className="h-4 w-4 text-green-500" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      All topics in this cluster will be prefixed with this value
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm text-muted-foreground">Consumer Group Prefix</Label>
                    <div className="flex gap-2">
                      <Input
                        value={cluster.groupPrefix}
                        readOnly
                        className="font-mono text-sm"
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => copyToClipboard(cluster.groupPrefix, 'groupPrefix')}
                      >
                        {copiedField === 'groupPrefix' ? (
                          <Check className="h-4 w-4 text-green-500" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      All consumer groups in this cluster will be prefixed with this value
                    </p>
                  </div>

                  <div className="flex gap-4 pt-2">
                    <div className="space-y-2">
                      <Label className="text-sm text-muted-foreground">Authentication</Label>
                      <Badge variant="outline">SASL/SCRAM-SHA-256</Badge>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm text-muted-foreground">TLS</Label>
                      <Badge variant="default">Enabled</Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Cluster Configuration Card */}
              <Card>
                <CardHeader>
                  <CardTitle>Cluster Configuration</CardTitle>
                  <CardDescription>
                    Advanced settings for this virtual cluster
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Settings className="h-16 w-16 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2">Configuration Coming Soon</h3>
                  <p className="text-muted-foreground text-center max-w-md">
                    Advanced cluster configuration options will be available in a future update.
                    You&apos;ll be able to manage quotas, ACLs, and cluster-wide settings.
                  </p>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      )}

      {/* Deleted state */}
      {cluster.status === 'deleted' && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <AlertCircle className="h-16 w-16 text-red-500 mb-4" />
            <h3 className="text-xl font-semibold mb-2">Virtual Cluster Deleted</h3>
            <p className="text-muted-foreground text-center max-w-md mb-4">
              This virtual cluster has been deleted and is no longer accessible.
            </p>
            <Button asChild>
              <Link href={`/workspaces/${workspaceSlug}/kafka`}>
                Return to Clusters
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Deleting state */}
      {cluster.status === 'deleting' && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Loader2 className="h-16 w-16 text-gray-500 animate-spin mb-4" />
            <h3 className="text-xl font-semibold mb-2">Deleting Virtual Cluster</h3>
            <p className="text-muted-foreground text-center max-w-md">
              This virtual cluster is being deleted. This process may take a few minutes.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
