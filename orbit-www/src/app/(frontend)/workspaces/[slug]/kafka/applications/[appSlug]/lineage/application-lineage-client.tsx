'use client'

import { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { LineageGraph } from '@/components/kafka/LineageGraph'
import { LineageTable } from '@/components/kafka/LineageTable'
import {
  getApplicationLineage,
  getApplicationLineageSummaryAction,
  getApplicationLineageEdges,
} from '@/app/actions/kafka-lineage'
import type {
  LineageGraph as LineageGraphData,
  ApplicationLineageSummary,
} from '@/lib/kafka/lineage'
import type { KafkaLineageEdge } from '@/payload-types'
import {
  ArrowLeft,
  ArrowUpRight,
  ArrowDownLeft,
  Activity,
  AlertCircle,
  Database,
  ExternalLink,
  GitBranch,
} from 'lucide-react'

interface ApplicationLineageClientProps {
  workspaceSlug: string
  application: {
    id: string
    name: string
    slug: string
  }
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

export function ApplicationLineageClient({
  workspaceSlug,
  application,
}: ApplicationLineageClientProps) {
  const [isPending, startTransition] = useTransition()
  const [graph, setGraph] = useState<LineageGraphData | null>(null)
  const [summary, setSummary] = useState<ApplicationLineageSummary | null>(null)
  const [edges, setEdges] = useState<KafkaLineageEdge[]>([])
  const [error, setError] = useState<string | null>(null)
  const [includeInactive, setIncludeInactive] = useState(false)
  const [activeTab, setActiveTab] = useState('graph')

  useEffect(() => {
    startTransition(async () => {
      setError(null)

      // Fetch all data in parallel
      const [graphResult, summaryResult, edgesResult] = await Promise.all([
        getApplicationLineage(application.id, { includeInactive }),
        getApplicationLineageSummaryAction(application.id),
        getApplicationLineageEdges(application.id, { includeInactive }),
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
  }, [application.id, includeInactive])

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
            <BreadcrumbLink href={`/workspaces/${workspaceSlug}/kafka/applications`}>
              Applications
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink
              href={`/workspaces/${workspaceSlug}/kafka/applications/${application.slug}`}
            >
              {application.name}
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Lineage</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/workspaces/${workspaceSlug}/kafka/applications/${application.slug}`}>
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <GitBranch className="h-5 w-5 text-muted-foreground" />
              <h1 className="text-2xl font-bold">Data Lineage</h1>
            </div>
            <p className="text-muted-foreground">
              View topics that {application.name} produces to and consumes from
            </p>
          </div>
        </div>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : isPending && !graph ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
          <Skeleton className="h-[400px]" />
        </div>
      ) : (
        <>
          {/* Summary Stats */}
          {summary && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                title="Topics Produced To"
                value={summary.producesToCount}
                icon={ArrowUpRight}
              />
              <StatCard
                title="Topics Consumed From"
                value={summary.consumesFromCount}
                icon={ArrowDownLeft}
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
          {summary && summary.crossWorkspaceTopics > 0 && (
            <Alert>
              <ExternalLink className="h-4 w-4" />
              <AlertDescription>
                This application has access to{' '}
                <strong>{summary.crossWorkspaceTopics}</strong> topic
                {summary.crossWorkspaceTopics > 1 ? 's' : ''} from other workspaces.
              </AlertDescription>
            </Alert>
          )}

          {/* Main Content */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    Topic Connections
                    {isPending && (
                      <Badge variant="outline" className="font-normal">
                        Refreshing...
                      </Badge>
                    )}
                  </CardTitle>
                  <CardDescription>
                    All Kafka topics this application interacts with
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
                  {graph && graph.edges.length > 0 ? (
                    <LineageGraph graph={graph} title="" description="" />
                  ) : (
                    <div className="text-center py-12 text-muted-foreground">
                      <GitBranch className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>No lineage data available for this application</p>
                      <p className="text-sm mt-2">
                        Lineage data will appear once the application starts producing or consuming
                        messages.
                      </p>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="table" className="mt-4">
                  {edges.length > 0 ? (
                    <LineageTable edges={edges} viewType="application" />
                  ) : (
                    <div className="text-center py-12 text-muted-foreground">
                      <GitBranch className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>No lineage data available for this application</p>
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
