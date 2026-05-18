import Link from 'next/link'
import {
  Plus,
  Sparkles,
  Layers,
  Radio,
  FileCode,
  ShieldCheck,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

interface QuickAction {
  label: string
  href: string
  icon: LucideIcon
  tone: 'accent' | 'info' | 'ok' | 'warn' | 'pend' | 'muted'
  shortcut: string
}

const actions: QuickAction[] = [
  { label: 'New workspace', href: '/admin/workspaces', icon: Plus, tone: 'accent', shortcut: '⌘ ⇧ N' },
  { label: 'Ask the agent', href: '/agent', icon: Sparkles, tone: 'info', shortcut: '⌘ K' },
  { label: 'Create application', href: '/apps/new', icon: Layers, tone: 'ok', shortcut: '⌘ ⇧ A' },
  { label: 'Request topic', href: '/platform/kafka', icon: Radio, tone: 'pend', shortcut: '⌘ ⇧ T' },
  { label: 'Register schema', href: '/catalog/apis', icon: FileCode, tone: 'warn', shortcut: '⌘ ⇧ R' },
  { label: 'Invite member', href: '/admin/workspaces', icon: ShieldCheck, tone: 'muted', shortcut: '⌘ ⇧ I' },
]

const toneClass: Record<QuickAction['tone'], string> = {
  accent: 'bg-primary/10 text-primary',
  info: 'bg-blue-500/10 text-blue-500',
  ok: 'bg-green-500/10 text-green-500',
  warn: 'bg-yellow-500/10 text-yellow-500',
  pend: 'bg-purple-500/10 text-purple-500',
  muted: 'bg-muted text-foreground/70',
}

export function DashboardQuickActions() {
  return (
    <div className="grid grid-cols-2 gap-2">
      {actions.map((a) => {
        const Icon = a.icon
        return (
          <Link
            key={a.label}
            href={a.href}
            className="group flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5 text-foreground/80 no-underline transition-all hover:-translate-y-px hover:border-foreground/20 hover:bg-muted/40 hover:text-foreground"
          >
            <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-md ${toneClass[a.tone]}`}>
              <Icon className="h-3.5 w-3.5" />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="text-[12.5px] font-medium text-foreground">{a.label}</span>
              <span className="font-mono text-[10.5px] text-muted-foreground/80">{a.shortcut}</span>
            </span>
          </Link>
        )
      })}
    </div>
  )
}
