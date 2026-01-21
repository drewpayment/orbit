import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Server, MessageSquare, GitPullRequest, ChevronRight } from 'lucide-react'
import Link from 'next/link'

interface WorkspaceKafkaOverviewCardProps {
  workspaceSlug: string
  virtualClusterCount: number
  topicCount: number
  pendingShareCount: number
}

export function WorkspaceKafkaOverviewCard({
  workspaceSlug,
  virtualClusterCount,
  topicCount,
  pendingShareCount,
}: WorkspaceKafkaOverviewCardProps) {
  const isEmpty = virtualClusterCount === 0 && topicCount === 0 && pendingShareCount === 0
  const kafkaUrl = `/workspaces/${workspaceSlug}/kafka`

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <Link
            href={kafkaUrl}
            className="flex items-center gap-2 hover:text-foreground/80 transition-colors"
          >
            <MessageSquare className="h-5 w-5" />
            <CardTitle className="text-base">Kafka Overview</CardTitle>
          </Link>
          <Button variant="ghost" size="sm" asChild>
            <Link href={kafkaUrl} className="flex items-center gap-1">
              Manage
              <ChevronRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isEmpty ? (
          <div className="text-center py-8">
            <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
              <Server className="h-6 w-6 text-muted-foreground" />
            </div>
            <h4 className="text-sm font-medium mb-2">Get started with Kafka</h4>
            <p className="text-sm text-muted-foreground mb-4 max-w-[280px] mx-auto">
              Create virtual clusters to organize your Kafka topics and enable real-time data
              streaming.
            </p>
            <Button variant="outline" size="sm" asChild>
              <Link href={kafkaUrl}>Get Started</Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                  <Server className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                </div>
                <span className="text-sm">
                  <span className="font-medium">{virtualClusterCount}</span>{' '}
                  {virtualClusterCount === 1 ? 'virtual cluster' : 'virtual clusters'}
                </span>
              </div>

              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                  <MessageSquare className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                </div>
                <span className="text-sm">
                  <span className="font-medium">{topicCount}</span>{' '}
                  {topicCount === 1 ? 'topic' : 'topics'}
                </span>
              </div>

              {pendingShareCount > 0 && (
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-lg bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center">
                    <GitPullRequest className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
                  </div>
                  <span className="text-sm">
                    <span className="font-medium">{pendingShareCount}</span> pending share{' '}
                    {pendingShareCount === 1 ? 'request' : 'requests'}
                  </span>
                </div>
              )}
            </div>

            <Button variant="outline" size="sm" className="w-full" asChild>
              <Link href={kafkaUrl}>View Virtual Clusters</Link>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
