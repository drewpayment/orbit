import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Layers } from 'lucide-react'
import Link from 'next/link'
import type { App } from '@/payload-types'

interface DashboardAppHealthCardProps {
  apps: App[]
}

const statusConfig: Record<string, { dotColor: string; badgeBg: string; badgeText: string; label: string }> = {
  healthy: { dotColor: 'bg-green-500', badgeBg: 'bg-green-500/10', badgeText: 'text-green-500', label: 'healthy' },
  degraded: { dotColor: 'bg-yellow-500', badgeBg: 'bg-yellow-500/10', badgeText: 'text-yellow-500', label: 'degraded' },
  down: { dotColor: 'bg-red-500', badgeBg: 'bg-red-500/10', badgeText: 'text-red-500', label: 'down' },
  unknown: { dotColor: 'bg-gray-500', badgeBg: 'bg-secondary', badgeText: 'text-muted-foreground', label: 'unknown' },
}

export function DashboardAppHealthCard({ apps }: DashboardAppHealthCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <CardTitle className="text-base font-semibold">Application Health</CardTitle>
            <p className="text-xs text-muted-foreground">Across all workspaces</p>
          </div>
          {apps.length > 0 && (
            <Link href="/apps" className="text-xs font-medium text-primary hover:underline">
              View all →
            </Link>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {apps.length === 0 ? (
          <div className="text-center py-6">
            <Layers className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No applications yet</p>
            <Link href="/apps/new" className="text-xs text-primary hover:underline mt-1 inline-block">
              Create your first app
            </Link>
          </div>
        ) : (
          <div className="space-y-1">
            {apps.map((app) => {
              const status = app.status || 'unknown'
              const config = statusConfig[status] || statusConfig.unknown
              const ws = typeof app.workspace === 'object' ? app.workspace : null
              const version = app.latestBuild && typeof app.latestBuild === 'object'
                ? app.latestBuild.imageTag || ''
                : ''
              return (
                <div
                  key={app.id}
                  className="flex items-center gap-3 rounded-lg p-2.5 transition-colors hover:bg-muted/50"
                >
                  <span className={`h-2.5 w-2.5 rounded-full ${config.dotColor} shrink-0`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{app.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {ws?.name}{version ? ` · ${version}` : ''}
                    </p>
                  </div>
                  <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${config.badgeBg} ${config.badgeText}`}>
                    {config.label}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
