import { Card, CardContent } from '@/components/ui/card'
import { Building2, Layers, Radio, FileCode, Server, TrendingUp } from 'lucide-react'

interface DashboardStatsRowProps {
  workspaceCount: number
  appCount: number
  healthyCount: number
  degradedCount: number
  kafkaTopicCount: number
  virtualClusterCount: number
  apiSchemaCount: number
  publishedApiCount: number
}

export function DashboardStatsRow({
  workspaceCount,
  appCount,
  healthyCount,
  degradedCount,
  kafkaTopicCount,
  virtualClusterCount,
  apiSchemaCount,
  publishedApiCount,
}: DashboardStatsRowProps) {
  const stats = [
    {
      label: 'Workspaces',
      value: workspaceCount,
      icon: Building2,
      subtitle: null,
    },
    {
      label: 'Applications',
      value: appCount,
      icon: Layers,
      subtitle: (
        <div className="flex items-center gap-1.5">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            <span className="text-xs font-medium text-green-500">{healthyCount} healthy</span>
          </span>
          <span className="text-xs text-muted-foreground">·</span>
          <span className="text-xs text-yellow-500">{degradedCount} degraded</span>
        </div>
      ),
    },
    {
      label: 'Kafka Topics',
      value: kafkaTopicCount,
      icon: Radio,
      subtitle: (
        <div className="flex items-center gap-1">
          <Server className="h-3 w-3 text-blue-500" />
          <span className="text-xs font-medium text-blue-500">{virtualClusterCount} virtual clusters</span>
        </div>
      ),
    },
    {
      label: 'API Schemas',
      value: apiSchemaCount,
      icon: FileCode,
      subtitle: (
        <div className="flex items-center gap-1">
          <TrendingUp className="h-3 w-3 text-green-500" />
          <span className="text-xs font-medium text-green-500">{publishedApiCount} published</span>
        </div>
      ),
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {stats.map((stat) => (
        <Card key={stat.label}>
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-muted-foreground">{stat.label}</span>
              <stat.icon className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-3xl font-bold text-foreground">{stat.value}</div>
            {stat.subtitle && <div className="mt-2">{stat.subtitle}</div>}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
