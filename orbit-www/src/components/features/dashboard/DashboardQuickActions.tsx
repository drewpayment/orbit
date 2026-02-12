import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CirclePlus, Radio, FileCode, BookOpen, LayoutTemplate } from 'lucide-react'
import Link from 'next/link'

const actions = [
  {
    label: 'Create Application',
    href: '/apps/new',
    icon: CirclePlus,
    iconBg: 'bg-orange-500/10',
    iconColor: 'text-orange-500',
  },
  {
    label: 'Request Kafka Topic',
    href: '/workspaces',
    icon: Radio,
    iconBg: 'bg-blue-500/10',
    iconColor: 'text-blue-500',
  },
  {
    label: 'Register API Schema',
    href: '/catalog/apis',
    icon: FileCode,
    iconBg: 'bg-green-500/10',
    iconColor: 'text-green-500',
  },
  {
    label: 'Write Documentation',
    href: '/workspaces',
    icon: BookOpen,
    iconBg: 'bg-purple-500/10',
    iconColor: 'text-purple-500',
  },
  {
    label: 'Use Template',
    href: '/templates',
    icon: LayoutTemplate,
    iconBg: 'bg-yellow-500/10',
    iconColor: 'text-yellow-500',
  },
]

export function DashboardQuickActions() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">Quick Actions</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-1">
          {actions.map((action) => (
            <Link
              key={action.label}
              href={action.href}
              className="flex items-center gap-3 rounded-lg p-2.5 transition-colors hover:bg-muted/50"
            >
              <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${action.iconBg}`}>
                <action.icon className={`h-4 w-4 ${action.iconColor}`} />
              </div>
              <span className="text-sm font-medium">{action.label}</span>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
