import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { LayoutGrid, Plus, AlertTriangle, CheckCircle2, XCircle, HelpCircle } from 'lucide-react'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import type { App } from '@/payload-types'

interface WorkspaceApplicationsCardProps {
  apps: App[]
}

const statusConfig = {
  healthy: {
    icon: CheckCircle2,
    label: 'Healthy',
    className: 'text-green-500',
  },
  degraded: {
    icon: AlertTriangle,
    label: 'Warning',
    className: 'text-yellow-500',
  },
  down: {
    icon: XCircle,
    label: 'Down',
    className: 'text-red-500',
  },
  unknown: {
    icon: HelpCircle,
    label: 'Unknown',
    className: 'text-gray-500',
  },
} as const

export function WorkspaceApplicationsCard({
  apps,
}: WorkspaceApplicationsCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <Link href="/apps" className="flex items-center gap-2 hover:text-foreground/80 transition-colors">
            <LayoutGrid className="h-5 w-5" />
            <CardTitle className="text-base">Applications</CardTitle>
          </Link>
          <Button size="sm" className="bg-orange-500 hover:bg-orange-600" asChild>
            <Link href="/apps/new">
              <Plus className="h-4 w-4 mr-1" />
              New App
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {apps.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-muted-foreground mb-4">No applications yet</p>
            <Button variant="outline" size="sm" asChild>
              <Link href="/apps/new">
                Create your first app
              </Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-1">
            {/* Header row */}
            <div className="grid grid-cols-[1fr_auto_auto] gap-4 px-2 py-1 text-xs font-medium text-muted-foreground uppercase">
              <span>Status</span>
              <span>Last Deployed</span>
              <span></span>
            </div>
            {/* App rows */}
            {apps.map((app) => {
              const status = app.status || 'unknown'
              const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.unknown
              const StatusIcon = config.icon
              const lastDeployed = app.latestBuild?.builtAt
                ? formatDistanceToNow(new Date(app.latestBuild.builtAt), { addSuffix: true })
                : 'Never'

              return (
                <div
                  key={app.id}
                  className="grid grid-cols-[1fr_auto_auto] gap-4 items-center px-2 py-3 rounded-lg hover:bg-muted/50"
                >
                  <div>
                    <p className="font-medium text-sm">{app.name}</p>
                    <div className="flex items-center gap-1 mt-0.5">
                      <StatusIcon className={`h-3.5 w-3.5 ${config.className}`} />
                      <span className={`text-xs ${config.className}`}>{config.label}</span>
                    </div>
                  </div>
                  <span className="text-sm text-muted-foreground">{lastDeployed}</span>
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/apps/${app.id}`}>
                      Manage
                    </Link>
                  </Button>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
