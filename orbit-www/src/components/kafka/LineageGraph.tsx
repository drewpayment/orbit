'use client'

import { useCallback, useMemo } from 'react'
import type { LineageGraph as LineageGraphData, LineageNode, LineageEdgeGraph } from '@/lib/kafka/lineage'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { ArrowRight, ArrowLeft, Database, AppWindow, Key, ExternalLink } from 'lucide-react'

interface LineageGraphProps {
  graph: LineageGraphData
  title?: string
  description?: string
  onNodeClick?: (node: LineageNode) => void
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

function NodeIcon({ type }: { type: LineageNode['type'] }) {
  switch (type) {
    case 'topic':
      return <Database className="h-4 w-4" />
    case 'application':
      return <AppWindow className="h-4 w-4" />
    case 'service-account':
      return <Key className="h-4 w-4" />
  }
}

function NodeCard({
  node,
  isCenter,
  onClick,
}: {
  node: LineageNode
  isCenter: boolean
  onClick?: () => void
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg border p-3 transition-colors',
        isCenter
          ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
          : 'border-border bg-card hover:border-primary/50',
        onClick && 'cursor-pointer'
      )}
      onClick={onClick}
    >
      <div
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded-md',
          node.type === 'topic' && 'bg-blue-500/10 text-blue-500',
          node.type === 'application' && 'bg-green-500/10 text-green-500',
          node.type === 'service-account' && 'bg-orange-500/10 text-orange-500'
        )}
      >
        <NodeIcon type={node.type} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{node.name}</span>
          {node.environment && (
            <Badge variant="outline" className="text-xs">
              {node.environment}
            </Badge>
          )}
        </div>
        {node.workspaceName && (
          <div className="text-xs text-muted-foreground truncate">{node.workspaceName}</div>
        )}
      </div>
    </div>
  )
}

function EdgeLabel({ edge }: { edge: LineageEdgeGraph }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <Badge
        variant={edge.direction === 'produce' ? 'default' : 'secondary'}
        className="text-xs"
      >
        {edge.direction === 'produce' ? 'produces' : 'consumes'}
      </Badge>
      <span>{formatBytes(edge.bytesLast24h)}/24h</span>
      <span>{formatNumber(edge.messagesLast24h)} msgs</span>
      {edge.isCrossWorkspace && (
        <Badge variant="outline" className="text-xs">
          <ExternalLink className="h-3 w-3 mr-1" />
          cross-workspace
        </Badge>
      )}
    </div>
  )
}

export function LineageGraph({
  graph,
  title = 'Data Lineage',
  description,
  onNodeClick,
}: LineageGraphProps) {
  const { producers, consumers, centerNode } = useMemo(() => {
    const center = graph.nodes.find(n => n.id === graph.centerNode)
    const producerEdges = graph.edges.filter(e => e.direction === 'produce')
    const consumerEdges = graph.edges.filter(e => e.direction === 'consume')

    // For topic-centered view: producers write TO the topic, consumers read FROM the topic
    // For app-centered view: producesTo shows topics app writes to, consumesFrom shows topics app reads from
    const producers = producerEdges.map(edge => {
      const sourceNode = graph.nodes.find(n => n.id === edge.source)
      return { node: sourceNode, edge }
    }).filter(p => p.node)

    const consumers = consumerEdges.map(edge => {
      const sourceNode = graph.nodes.find(n => n.id === edge.source)
      return { node: sourceNode, edge }
    }).filter(c => c.node)

    return { producers, consumers, centerNode: center }
  }, [graph])

  const handleNodeClick = useCallback(
    (node: LineageNode) => {
      if (onNodeClick) {
        onNodeClick(node)
      }
    },
    [onNodeClick]
  )

  if (!centerNode) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CardContent>
          <div className="text-center text-muted-foreground py-8">
            No lineage data available
          </div>
        </CardContent>
      </Card>
    )
  }

  const isCenterTopic = centerNode.type === 'topic'

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-[1fr,auto,1fr] gap-4 items-start">
          {/* Left column - Producers (or topics produced to) */}
          <div className="space-y-3">
            <div className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <ArrowRight className="h-4 w-4" />
              {isCenterTopic ? 'Producers' : 'Produces To'}
              <Badge variant="secondary" className="text-xs">
                {producers.length}
              </Badge>
            </div>
            {producers.length === 0 ? (
              <div className="text-sm text-muted-foreground py-4 text-center border rounded-lg border-dashed">
                No {isCenterTopic ? 'producers' : 'outbound topics'}
              </div>
            ) : (
              <div className="space-y-2">
                {producers.map(({ node, edge }) => (
                  <div key={edge.id} className="space-y-1">
                    <NodeCard
                      node={node!}
                      isCenter={false}
                      onClick={() => handleNodeClick(node!)}
                    />
                    <EdgeLabel edge={edge} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Center column - Main node */}
          <div className="flex flex-col items-center justify-center px-4">
            <div className="w-px h-8 bg-border" />
            <NodeCard node={centerNode} isCenter={true} />
            <div className="w-px h-8 bg-border" />
          </div>

          {/* Right column - Consumers (or topics consumed from) */}
          <div className="space-y-3">
            <div className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <ArrowLeft className="h-4 w-4" />
              {isCenterTopic ? 'Consumers' : 'Consumes From'}
              <Badge variant="secondary" className="text-xs">
                {consumers.length}
              </Badge>
            </div>
            {consumers.length === 0 ? (
              <div className="text-sm text-muted-foreground py-4 text-center border rounded-lg border-dashed">
                No {isCenterTopic ? 'consumers' : 'inbound topics'}
              </div>
            ) : (
              <div className="space-y-2">
                {consumers.map(({ node, edge }) => (
                  <div key={edge.id} className="space-y-1">
                    <NodeCard
                      node={node!}
                      isCenter={false}
                      onClick={() => handleNodeClick(node!)}
                    />
                    <EdgeLabel edge={edge} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Summary stats */}
        <div className="mt-6 pt-4 border-t flex items-center justify-center gap-8 text-sm text-muted-foreground">
          <div>
            <span className="font-medium text-foreground">{graph.nodes.length}</span> nodes
          </div>
          <div>
            <span className="font-medium text-foreground">{graph.edges.length}</span> edges
          </div>
          <div>
            <span className="font-medium text-foreground">
              {graph.edges.filter(e => e.isCrossWorkspace).length}
            </span>{' '}
            cross-workspace
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
