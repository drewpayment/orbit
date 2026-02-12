import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Activity as ActivityIcon } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

export interface Activity {
  type: 'app' | 'topic' | 'schema' | 'doc'
  title: string
  description: string
  timestamp: string
}

interface DashboardActivityFeedProps {
  activities: Activity[]
}

const typeColors: Record<Activity['type'], string> = {
  app: 'bg-green-500',
  topic: 'bg-blue-500',
  schema: 'bg-purple-500',
  doc: 'bg-green-500',
}

export function DashboardActivityFeed({ activities }: DashboardActivityFeedProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">Recent Activity</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {activities.length === 0 ? (
          <div className="text-center py-6">
            <ActivityIcon className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No recent activity</p>
          </div>
        ) : (
          <div className="space-y-1">
            {activities.map((activity, index) => (
              <div
                key={`${activity.type}-${index}`}
                className="flex gap-3 rounded-lg p-2.5 transition-colors hover:bg-muted/50"
              >
                <span className={`mt-1.5 h-2 w-2 rounded-full ${typeColors[activity.type]} shrink-0`} />
                <div className="flex-1 min-w-0 space-y-0.5">
                  <p className="text-sm font-medium">{activity.title}</p>
                  <p className="text-xs text-muted-foreground truncate">{activity.description}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatDistanceToNow(new Date(activity.timestamp), { addSuffix: true })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
