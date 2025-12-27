'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import {
  ArrowLeft,
  FileCode,
  Activity,
  Users,
  Settings,
  Trash2,
  Loader2,
  Share2,
  GitBranch,
} from 'lucide-react'
import { toast } from 'sonner'
import Link from 'next/link'
import {
  getTopic,
  listSchemas,
  listTopicShares,
  getTopicMetrics,
  getTopicLineage,
  type KafkaTopic,
  type KafkaSchema,
  type KafkaTopicShare,
  type TopicMetrics,
  type LineageNode,
} from '../actions'
import { TopicDetailsCard, SchemaViewer } from '@/components/features/kafka'

interface TopicDetailClientProps {
  workspaceId: string
  workspaceSlug: string
  topicId: string
}

export function TopicDetailClient({
  workspaceId,
  workspaceSlug,
  topicId,
}: TopicDetailClientProps) {
  const [topic, setTopic] = useState<KafkaTopic | null>(null)
  const [schemas, setSchemas] = useState<KafkaSchema[]>([])
  const [shares, setShares] = useState<KafkaTopicShare[]>([])
  const [metrics, setMetrics] = useState<TopicMetrics[]>([])
  const [lineage, setLineage] = useState<{ producers: LineageNode[]; consumers: LineageNode[] }>({
    producers: [],
    consumers: [],
  })
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')

  const loadTopic = useCallback(async () => {
    setLoading(true)
    try {
      const result = await getTopic(topicId)
      if (result.success && result.topic) {
        setTopic(result.topic)
      } else {
        toast.error(result.error || 'Topic not found')
      }
    } catch (error) {
      toast.error('Failed to load topic')
    } finally {
      setLoading(false)
    }
  }, [topicId])

  const loadSchemas = useCallback(async () => {
    const result = await listSchemas(topicId)
    if (result.success && result.schemas) {
      setSchemas(result.schemas)
    }
  }, [topicId])

  const loadShares = useCallback(async () => {
    const result = await listTopicShares({ topicId })
    if (result.success && result.shares) {
      setShares(result.shares)
    }
  }, [topicId])

  const loadMetrics = useCallback(async () => {
    const result = await getTopicMetrics({ topicId, periodType: 'day', periods: 7 })
    if (result.success && result.metrics) {
      setMetrics(result.metrics)
    }
  }, [topicId])

  const loadLineage = useCallback(async () => {
    const result = await getTopicLineage(topicId)
    if (result.success) {
      setLineage({
        producers: result.producers || [],
        consumers: result.consumers || [],
      })
    }
  }, [topicId])

  useEffect(() => {
    loadTopic()
    loadSchemas()
    loadShares()
    loadMetrics()
    loadLineage()
  }, [loadTopic, loadSchemas, loadShares, loadMetrics, loadLineage])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    )
  }

  if (!topic) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16">
          <h3 className="text-xl font-semibold mb-2">Topic Not Found</h3>
          <p className="text-gray-600 mb-4">
            The topic you&apos;re looking for doesn&apos;t exist or has been deleted.
          </p>
          <Link href={`/workspaces/${workspaceSlug}/kafka`}>
            <Button>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Topics
            </Button>
          </Link>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href={`/workspaces/${workspaceSlug}`}>Workspace</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink href={`/workspaces/${workspaceSlug}/kafka`}>Kafka</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{topic.name}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Link
            href={`/workspaces/${workspaceSlug}/kafka`}
            className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1 mb-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Topics
          </Link>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">{topic.name}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline">
            <Share2 className="h-4 w-4 mr-2" />
            Share
          </Button>
          <Button variant="outline" className="text-red-600 hover:text-red-700">
            <Trash2 className="h-4 w-4 mr-2" />
            Delete
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview" className="flex items-center gap-2">
            <Settings className="h-4 w-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="schemas" className="flex items-center gap-2">
            <FileCode className="h-4 w-4" />
            Schemas
            {schemas.length > 0 && (
              <Badge variant="secondary" className="ml-1">
                {schemas.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="metrics" className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Metrics
          </TabsTrigger>
          <TabsTrigger value="lineage" className="flex items-center gap-2">
            <GitBranch className="h-4 w-4" />
            Lineage
          </TabsTrigger>
          <TabsTrigger value="sharing" className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Sharing
            {shares.length > 0 && (
              <Badge variant="secondary" className="ml-1">
                {shares.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6">
          <TopicDetailsCard topic={topic} />
        </TabsContent>

        <TabsContent value="schemas" className="mt-6">
          <SchemaViewer schemas={schemas} topicName={topic.name} />
        </TabsContent>

        <TabsContent value="metrics" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                Topic Metrics
              </CardTitle>
              <CardDescription>
                Usage statistics for the last 7 days
              </CardDescription>
            </CardHeader>
            <CardContent>
              {metrics.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <Activity className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                  <p>No metrics data available</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {metrics.slice(0, 1).map((m) => (
                    <>
                      <div key={`${m.id}-in`} className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                        <p className="text-sm text-gray-500">Messages In</p>
                        <p className="text-2xl font-bold">{formatNumber(m.messageCountIn)}</p>
                      </div>
                      <div key={`${m.id}-out`} className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                        <p className="text-sm text-gray-500">Messages Out</p>
                        <p className="text-2xl font-bold">{formatNumber(m.messageCountOut)}</p>
                      </div>
                      <div key={`${m.id}-bytes`} className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                        <p className="text-sm text-gray-500">Bytes In</p>
                        <p className="text-2xl font-bold">{formatBytes(m.bytesIn)}</p>
                      </div>
                      <div key={`${m.id}-storage`} className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                        <p className="text-sm text-gray-500">Storage</p>
                        <p className="text-2xl font-bold">{formatBytes(m.storageBytes)}</p>
                      </div>
                    </>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="lineage" className="mt-6">
          <div className="grid md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Producers</CardTitle>
                <CardDescription>
                  Services producing messages to this topic
                </CardDescription>
              </CardHeader>
              <CardContent>
                {lineage.producers.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <p>No producers detected</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {lineage.producers.map((node, i) => (
                      <div key={i} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                        <div>
                          <p className="font-medium">{node.serviceAccountName}</p>
                          <p className="text-sm text-gray-500">{node.workspaceName}</p>
                        </div>
                        <Badge variant="outline">{formatBytes(node.bytesTransferred)}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Consumers</CardTitle>
                <CardDescription>
                  Services consuming messages from this topic
                </CardDescription>
              </CardHeader>
              <CardContent>
                {lineage.consumers.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <p>No consumers detected</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {lineage.consumers.map((node, i) => (
                      <div key={i} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                        <div>
                          <p className="font-medium">{node.serviceAccountName}</p>
                          <p className="text-sm text-gray-500">{node.workspaceName}</p>
                        </div>
                        <Badge variant="outline">{formatBytes(node.bytesTransferred)}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="sharing" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Shared Access
              </CardTitle>
              <CardDescription>
                Workspaces and users with access to this topic
              </CardDescription>
            </CardHeader>
            <CardContent>
              {shares.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <Users className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                  <p>This topic is not shared with any other workspaces</p>
                  <Button variant="outline" size="sm" className="mt-4">
                    <Share2 className="h-4 w-4 mr-2" />
                    Share Topic
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {shares.map((share) => (
                    <div
                      key={share.id}
                      className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg"
                    >
                      <div>
                        <p className="font-medium">
                          {share.sharedWithWorkspaceId || share.sharedWithUserId}
                        </p>
                        <p className="text-sm text-gray-500">{share.justification}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="capitalize">
                          {share.permission.replace('_', ' ')}
                        </Badge>
                        <Badge
                          variant="secondary"
                          className={
                            share.status === 'approved'
                              ? 'bg-green-100 text-green-800'
                              : share.status === 'pending_request'
                                ? 'bg-yellow-100 text-yellow-800'
                                : 'bg-gray-100 text-gray-800'
                          }
                        >
                          {share.status.replace('_', ' ')}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`
  return num.toString()
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}
