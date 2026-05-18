import Link from 'next/link'
import { Building2, ChevronRight, Clock, FileCode, Layers, Radio } from 'lucide-react'
import type { WorkspaceMember } from '@/payload-types'

export interface WorkspaceRowMeta {
  apps: number
  topics: number
  schemas: number
  lastActive?: string
}

interface DashboardWorkspacesCardProps {
  memberships: WorkspaceMember[]
  metaById?: Record<string, WorkspaceRowMeta>
}

const avatarColors = [
  'bg-blue-500/70',
  'bg-purple-500/70',
  'bg-emerald-500/70',
  'bg-orange-500/70',
  'bg-rose-500/70',
  'bg-amber-500/70',
]

const roleStyles: Record<string, string> = {
  owner: 'border-green-500/30 bg-green-500/10 text-green-500',
  admin: 'border-blue-500/30 bg-blue-500/10 text-blue-500',
  member: 'border-border bg-muted text-muted-foreground',
}

export function DashboardWorkspacesCard({ memberships, metaById = {} }: DashboardWorkspacesCardProps) {
  if (memberships.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card px-5 py-10 text-center">
        <Building2 className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">No workspaces yet</p>
        <Link href="/workspaces" className="mt-1 inline-block text-xs font-medium text-primary hover:underline">
          Browse workspaces
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
      {memberships.map((membership, i) => {
        const ws = typeof membership.workspace === 'object' ? membership.workspace : null
        if (!ws) return null
        const meta = metaById[ws.id]
        const role = membership.role || 'member'
        const roleClass = roleStyles[role] ?? roleStyles.member
        const avatarClass = avatarColors[i % avatarColors.length]

        return (
          <Link
            key={membership.id}
            href={`/workspaces/${ws.slug}`}
            className="grid grid-cols-[28px_1fr_auto_auto] items-center gap-3.5 border-b border-border px-4 py-3 text-foreground no-underline transition-colors last:border-b-0 hover:bg-muted/40 group"
          >
            <div
              className={`grid h-7 w-7 place-items-center rounded-md text-[11px] font-semibold uppercase text-white ${avatarClass}`}
            >
              {ws.name.charAt(0)}
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[13.5px] font-medium text-foreground">
                <span className="truncate">{ws.name}</span>
                <span className="font-mono text-[11.5px] font-normal text-muted-foreground">/{ws.slug}</span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-2.5 text-[11.5px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Layers className="h-3 w-3 text-muted-foreground/70" />
                  {meta?.apps ?? 0} app{(meta?.apps ?? 0) === 1 ? '' : 's'}
                </span>
                <span className="h-[3px] w-[3px] rounded-full bg-border" />
                <span className="inline-flex items-center gap-1">
                  <Radio className="h-3 w-3 text-muted-foreground/70" />
                  {meta?.topics ?? 0} topic{(meta?.topics ?? 0) === 1 ? '' : 's'}
                </span>
                <span className="h-[3px] w-[3px] rounded-full bg-border" />
                <span className="inline-flex items-center gap-1">
                  <FileCode className="h-3 w-3 text-muted-foreground/70" />
                  {meta?.schemas ?? 0} schema{(meta?.schemas ?? 0) === 1 ? '' : 's'}
                </span>
                {meta?.lastActive && (
                  <>
                    <span className="h-[3px] w-[3px] rounded-full bg-border" />
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3 text-muted-foreground/70" />
                      {meta.lastActive}
                    </span>
                  </>
                )}
              </div>
            </div>

            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] font-medium ${roleClass}`}>
              <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
              {role}
            </span>

            <ChevronRight className="h-4 w-4 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground/80" />
          </Link>
        )
      })}
    </div>
  )
}
