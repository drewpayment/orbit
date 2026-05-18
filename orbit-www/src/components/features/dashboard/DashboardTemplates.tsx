import Link from 'next/link'
import { Box, ChevronRight, FileCode, GitBranch, Radio } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export interface TemplateRow {
  id: string
  name: string
  description: string
  icon?: 'box' | 'git' | 'wave' | 'doc'
  href?: string
}

const iconMap: Record<NonNullable<TemplateRow['icon']>, LucideIcon> = {
  box: Box,
  git: GitBranch,
  wave: Radio,
  doc: FileCode,
}

interface DashboardTemplatesProps {
  templates: TemplateRow[]
  browseHref?: string
}

export function DashboardTemplates({ templates, browseHref = '/templates' }: DashboardTemplatesProps) {
  if (templates.length === 0) return null
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3.5">
      <h3 className="mb-3 flex items-center justify-between text-[13px] font-semibold tracking-[-0.005em] text-foreground">
        Start from a template
        <Link href={browseHref} className="text-[11.5px] font-normal text-primary hover:text-primary/80">
          Browse →
        </Link>
      </h3>
      <div className="flex flex-col gap-0.5">
        {templates.map((t) => {
          const Icon = iconMap[t.icon ?? 'box']
          return (
            <Link
              key={t.id}
              href={t.href ?? `${browseHref}/${t.id}`}
              className="group flex items-center gap-2.5 rounded-md px-2 py-2 text-foreground no-underline transition-colors hover:bg-muted/40"
            >
              <span className="grid h-6.5 w-6.5 shrink-0 place-items-center rounded-md bg-muted text-foreground/70" style={{ height: 26, width: 26 }}>
                <Icon className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] font-medium text-foreground">{t.name}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{t.description}</span>
              </span>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground/80" />
            </Link>
          )
        })}
      </div>
    </div>
  )
}
