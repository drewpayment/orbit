'use client'

import { useEffect, useState, useTransition } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { LineageGraph } from './LineageGraph'
import { LineageTable } from './LineageTable'
import {
  getTopicLineage,
  getTopicLineageSummaryAction,
  getTopicLineageEdges,
} from '@/app/actions/kafka-lineage'
import type { LineageGraph as LineageGraphData, TopicLineageSummary } from '@/lib/kafka/lineage'
import type { KafkaLineageEdge } from '@/payload-types'
import {
  ArrowUpRight,
  ArrowDownLeft,
  Activity,
  AlertCircle,
  Database,
  ExternalLink,
} from 'lucide-react'

interface TopicLineagePanelProps {
  topicId: string
  topicName?: string
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function formatNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`
  return num.toString()
}

function StatCard({
  title,
  value,
  icon: Icon,
  description,
}: {
  title: string
  value: string | number
  icon: React.ElementType
  description?: string
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
            <Icon className="h-6 w-6 text-primary" />
          </div>
          <div>
            <div className="text-2xl font-bold">{value}</div>
            <div className="text-sm text-muted-foreground">{title}</div>
            {description && <div className="text-xs text-muted-foreground">{description}</div>}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function TopicLineagePanel({ topicId, topicName }: TopicLineagePanelProps) {
  const [isPending, startTransition] = useTransition()
  const [graph, setGraph] = useState<LineageGraphData | null>(null)
  const [summary, setSummary] = useState<TopicLineageSummary | null>(null)
  const [edges, setEdges] = useState<KafkaLineageEdge[]>([])
  const [error, setError] = useState<string | null>(null)
  const [includeInactive, setIncludeInactive] = useState(false)
  const [activeTab, setActiveTab] = useState('graph')

  useEffect(() => {
    startTransition(async () => {
      setError(null)

      // Fetch all data in parallel
      const [graphResult, summaryResult, edgesResult] = await Promise.all([
        getTopicLineage(topicId, { includeInactive }),
        getTopicLineageSummaryAction(topicId),
        getTopicLineageEdges(topicId, { includeInactive }),
      ])

      if (!graphResult.success) {
        setError(graphResult.error || 'Failed to load lineage graph')
        return
      }

      if (!summaryResult.success) {
        setError(summaryResult.error || 'Failed to load lineage summary')
        return
      }

      setGraph(graphResult.graph || null)
      setSummary(summaryResult.summary || null)
      setEdges(edgesResult.edges || [])
    })
  }, [topicId, includeInactive])

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  }

  if (isPending && !graph) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-[400px]" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Producers"
            value={summary.producerCount}
            icon={ArrowUpRight}
            description={
              summary.crossWorkspaceProducers > 0
                ? `${summary.crossWorkspaceProducers} cross-workspace`
                : undefined
            }
          />
          <StatCard
            title="Consumers"
            value={summary.consumerCount}
            icon={ArrowDownLeft}
            description={
              summary.crossWorkspaceConsumers > 0
                ? `${summary.crossWorkspaceConsumers} cross-workspace`
                : undefined
            }
          />
          <StatCard
            title="24h Volume"
            value={formatBytes(summary.totalBytesLast24h)}
            icon={Database}
          />
          <StatCard
            title="24h Messages"
            value={formatNumber(summary.totalMessagesLast24h)}
            icon={Activity}
          />
        </div>
      )}

      {/* Cross-workspace alert */}
      {summary &&
        (summary.crossWorkspaceProducers > 0 || summary.crossWorkspaceConsumers > 0) && (
          <Alert>
            <ExternalLink className="h-4 w-4" />
            <AlertDescription>
              This topic has{' '}
              <strong>
                {summary.crossWorkspaceProducers + summary.crossWorkspaceConsumers}
              </strong>{' '}
              cross-workspace connections. Applications from other workspaces are
              {summary.crossWorkspaceProducers > 0 && ' producing to'}
              {summary.crossWorkspaceProducers > 0 && summary.crossWorkspaceConsumers > 0 && ' and'}
              {summary.crossWorkspaceConsumers > 0 && ' consuming from'} this topic.
            </AlertDescription>
          </Alert>
        )}

      {/* Main Content */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                Data Lineage
                {isPending && (
                  <Badge variant="outline" className="font-normal">
                    Refreshing...
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                View which applications produce to and consume from{' '}
                {topicName ? `"${topicName}"` : 'this topic'}
              </CardDescription>
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                id="include-inactive"
                checked={includeInactive}
                onCheckedChange={setIncludeInactive}
              />
              <Label htmlFor="include-inactive" className="text-sm text-muted-foreground">
                Show inactive
              </Label>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="graph">Graph View</TabsTrigger>
              <TabsTrigger value="table">Table View</TabsTrigger>
            </TabsList>

            <TabsContent value="graph" className="mt-4">
              {graph ? (
                <LineageGraph
                  graph={graph}
                  title=""
                  description=""
                />
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  No lineage data available for this topic
                </div>
              )}
            </TabsContent>

            <TabsContent value="table" className="mt-4">
              {edges.length > 0 ? (
                <LineageTable edges={edges} viewType="topic" />
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  No lineage data available for this topic
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}
