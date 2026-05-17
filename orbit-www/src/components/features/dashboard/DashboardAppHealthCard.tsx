import Link from 'next/link'
import { Layers } from 'lucide-react'
import type { App } from '@/payload-types'

interface DashboardAppHealthCardProps {
  apps: App[]
}

const statusConfig: Record<string, { dot: string; ring: string }> = {
  healthy: { dot: 'bg-green-500', ring: 'shadow-[0_0_0_3px_rgba(34,197,94,0.18)]' },
  degraded: { dot: 'bg-yellow-500', ring: 'shadow-[0_0_0_3px_rgba(234,179,8,0.18)]' },
  down: { dot: 'bg-red-500', ring: 'shadow-[0_0_0_3px_rgba(239,68,68,0.18)]' },
  unknown: { dot: 'bg-muted-foreground/60', ring: '' },
}

export function DashboardAppHealthCard({ apps }: DashboardAppHealthCardProps) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3.5">
      <h3 className="mb-3 flex items-center justify-between text-[13px] font-semibold tracking-[-0.005em] text-foreground">
        Application health
        {apps.length > 0 && (
          <Link href="/apps" className="text-[11.5px] font-normal text-primary hover:text-primary/80">
            View all →
          </Link>
        )}
      </h3>
      {apps.length === 0 ? (
        <div className="py-5 text-center">
          <Layers className="mx-auto mb-1.5 h-7 w-7 text-muted-foreground" />
          <p className="text-[12.5px] text-muted-foreground">No applications yet</p>
          <Link href="/apps/new" className="mt-1 inline-block text-[11.5px] font-medium text-primary hover:underline">
            Create your first app
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {apps.map((app) => {
            const status = (app.status as keyof typeof statusConfig) || 'unknown'
            const cfg = statusConfig[status] ?? statusConfig.unknown
            const ws = typeof app.workspace === 'object' ? app.workspace : null
            return (
              <div key={app.id} className="flex items-center gap-2.5 rounded-md px-1 py-1.5">
                <span className={`h-2 w-2 shrink-0 rounded-full ${cfg.dot} ${cfg.ring}`} />
                <span className="flex-1 text-[12.5px] font-medium text-foreground">{app.name}</span>
                <span className="text-[11px] text-muted-foreground">{ws?.name}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
