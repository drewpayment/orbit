import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { MessageSquare, Plus, ChevronRight, AlertCircle, CheckCircle2, Clock, Loader2 } from 'lucide-react'
import Link from 'next/link'

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'active':
      return <CheckCircle2 className="h-4 w-4 text-green-500" />
    case 'provisioning':
    case 'deleting':
      return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
    case 'pending-approval':
      return <Clock className="h-4 w-4 text-yellow-500" />
    case 'failed':
      return <AlertCircle className="h-4 w-4 text-red-500" />
    default:
      return <Clock className="h-4 w-4 text-muted-foreground" />
  }
}

function EnvironmentBadge({ environment }: { environment: string }) {
  const colors: Record<string, string> = {
    dev: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    development: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    staging: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    prod: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    production: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  }

  const labels: Record<string, string> = {
    dev: 'DEV',
    development: 'DEV',
    staging: 'STG',
    prod: 'PROD',
    production: 'PROD',
  }

  return (
    <Badge
      variant="secondary"
      className={`text-xs font-medium ${colors[environment] || 'bg-gray-100 text-gray-700'}`}
    >
      {labels[environment] || environment.toUpperCase()}
    </Badge>
  )
}

interface KafkaTopicSummary {
  id: string
  name: string
  environment: string
  status: string
}

interface WorkspaceKafkaTopicsCardProps {
  topics: KafkaTopicSummary[]
  workspaceSlug: string
  totalCount?: number
}

export function WorkspaceKafkaTopicsCard({
  topics,
  workspaceSlug,
  totalCount,
}: WorkspaceKafkaTopicsCardProps) {
  const displayTopics = topics.slice(0, 5)
  const hasMore = (totalCount ?? topics.length) > 5

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            <CardTitle className="text-base">Kafka Topics</CardTitle>
          </div>
          <Button size="sm" className="bg-orange-500 hover:bg-orange-600" asChild>
            <Link href={`/workspaces/${workspaceSlug}/kafka?action=new`}>
              <Plus className="h-4 w-4 mr-1" />
              Create Topic
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {topics.length === 0 ? (
          <div className="text-center py-8">
            <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
              <MessageSquare className="h-6 w-6 text-muted-foreground" />
            </div>
            <h4 className="text-sm font-medium mb-2">Stream your data</h4>
            <p className="text-sm text-muted-foreground mb-4 max-w-[280px] mx-auto">
              Create Kafka topics to enable real-time data streaming between your services.
            </p>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/workspaces/${workspaceSlug}/kafka`}>
                Get Started
              </Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-1">
            {displayTopics.map((topic) => (
              <Link
                key={topic.id}
                href={`/workspaces/${workspaceSlug}/kafka?topic=${topic.id}`}
                className="flex items-center gap-3 px-2 py-3 rounded-lg hover:bg-muted/50 group"
              >
                <StatusIcon status={topic.status} />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{topic.name}</p>
                </div>
                <EnvironmentBadge environment={topic.environment} />
                <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
              </Link>
            ))}
            {hasMore && (
              <div className="pt-2 border-t mt-2">
                <Link
                  href={`/workspaces/${workspaceSlug}/kafka`}
                  className="flex items-center justify-center gap-1 text-sm text-muted-foreground hover:text-foreground py-2"
                >
                  View all {totalCount ?? topics.length} topics
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
