import { Activity as ActivityIcon } from 'lucide-react'
import { formatDistanceToNow, isToday, isYesterday } from 'date-fns'

export type ActivityKind = 'accent' | 'ok' | 'info' | 'warn' | 'err'

export interface Activity {
  type: 'app' | 'topic' | 'schema' | 'doc' | 'agent'
  kind?: ActivityKind
  title: string
  description: string
  workspace?: string
  timestamp: string
}

interface DashboardActivityFeedProps {
  activities: Activity[]
}

const typeKind: Record<Activity['type'], ActivityKind> = {
  agent: 'accent',
  app: 'info',
  topic: 'info',
  schema: 'ok',
  doc: 'ok',
}

const nodeClass: Record<ActivityKind, string> = {
  accent: 'bg-primary border-primary shadow-[0_0_0_3px_color-mix(in_oklab,_var(--primary)_20%,_transparent)]',
  ok: 'bg-green-500 border-green-500',
  info: 'bg-blue-500 border-blue-500',
  warn: 'bg-yellow-500 border-yellow-500',
  err: 'bg-red-500 border-red-500',
}

export function DashboardActivityFeed({ activities }: DashboardActivityFeedProps) {
  if (activities.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card px-5 py-10 text-center">
        <ActivityIcon className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">No recent activity</p>
      </div>
    )
  }

  const grouped = groupByDay(activities)

  return (
    <div className="rounded-xl border border-border bg-card px-4 pt-3.5 pb-3">
      {grouped.today.length > 0 && <DayBlock label="Today" items={grouped.today} first />}
      {grouped.yesterday.length > 0 && <DayBlock label="Yesterday" items={grouped.yesterday} />}
      {grouped.earlier.length > 0 && <DayBlock label="Earlier" items={grouped.earlier} />}
    </div>
  )
}

function DayBlock({ label, items, first }: { label: string; items: Activity[]; first?: boolean }) {
  return (
    <>
      <div
        className={`flex items-center gap-2.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground ${
          first ? 'mt-1 mb-2' : 'mt-3.5 mb-2'
        }`}
      >
        <span>{label}</span>
        <span className="h-px flex-1 bg-border" />
      </div>
      <div className="relative pl-5.5" style={{ paddingLeft: 22 }}>
        <span className="absolute bottom-2 left-2.5 top-2 w-px bg-border" />
        {items.map((it, i) => {
          const kind = it.kind ?? typeKind[it.type]
          return (
            <div key={`${it.type}-${i}-${it.timestamp}`} className="relative py-1.5 text-[12.5px] leading-[1.5] text-foreground/80">
              <span
                className={`absolute left-[-16px] top-[10px] h-[9px] w-[9px] rounded-full border-[1.5px] ${nodeClass[kind]}`}
              />
              <div>
                <span className="font-medium text-foreground">{it.title}</span>{' '}
                <span className="text-foreground/70">{it.description}</span>
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                {it.workspace && <span className="text-foreground/60">{it.workspace}</span>}
                {it.workspace && <span className="h-[3px] w-[3px] rounded-full bg-border" />}
                <span>{relTime(it.timestamp)}</span>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

function groupByDay(items: Activity[]): { today: Activity[]; yesterday: Activity[]; earlier: Activity[] } {
  const out = { today: [] as Activity[], yesterday: [] as Activity[], earlier: [] as Activity[] }
  for (const item of items) {
    const date = new Date(item.timestamp)
    if (isToday(date)) out.today.push(item)
    else if (isYesterday(date)) out.yesterday.push(item)
    else out.earlier.push(item)
  }
  return out
}

function relTime(timestamp: string): string {
  try {
    return formatDistanceToNow(new Date(timestamp), { addSuffix: true })
  } catch {
    return ''
  }
}
