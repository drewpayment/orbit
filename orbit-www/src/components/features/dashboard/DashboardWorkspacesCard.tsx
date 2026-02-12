import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Building2 } from 'lucide-react'
import Link from 'next/link'
import type { WorkspaceMember } from '@/payload-types'

interface DashboardWorkspacesCardProps {
  memberships: WorkspaceMember[]
}

const roleColors: Record<string, { bg: string; text: string }> = {
  owner: { bg: 'bg-green-500/10', text: 'text-green-500' },
  admin: { bg: 'bg-blue-500/10', text: 'text-blue-500' },
  member: { bg: 'bg-secondary', text: 'text-muted-foreground' },
}

const avatarColors = [
  'bg-blue-500/20 text-blue-500',
  'bg-purple-500/20 text-purple-500',
  'bg-orange-500/20 text-orange-500',
  'bg-green-500/20 text-green-500',
  'bg-red-500/20 text-red-500',
  'bg-yellow-500/20 text-yellow-500',
]

export function DashboardWorkspacesCard({ memberships }: DashboardWorkspacesCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <CardTitle className="text-base font-semibold">My Workspaces</CardTitle>
            <p className="text-xs text-muted-foreground">Workspaces you belong to</p>
          </div>
          {memberships.length > 0 && (
            <Link href="/workspaces" className="text-xs font-medium text-primary hover:underline">
              View all →
            </Link>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {memberships.length === 0 ? (
          <div className="text-center py-6">
            <Building2 className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No workspaces yet</p>
            <Link href="/workspaces" className="text-xs text-primary hover:underline mt-1 inline-block">
              Browse workspaces
            </Link>
          </div>
        ) : (
          <div className="space-y-1">
            {memberships.map((membership, index) => {
              const ws = typeof membership.workspace === 'object' ? membership.workspace : null
              if (!ws) return null
              const role = membership.role || 'member'
              const colors = roleColors[role] || roleColors.member
              const avatarColor = avatarColors[index % avatarColors.length]
              return (
                <Link
                  key={membership.id}
                  href={`/workspaces/${ws.slug}`}
                  className="flex items-center gap-3 rounded-lg p-2.5 transition-colors hover:bg-muted/50"
                >
                  <div className={`flex h-9 w-9 items-center justify-center rounded-lg text-sm font-semibold ${avatarColor}`}>
                    {ws.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{ws.name}</p>
                    <p className="text-xs text-muted-foreground">/{ws.slug}</p>
                  </div>
                  <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${colors.bg} ${colors.text}`}>
                    {role}
                  </span>
                </Link>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
