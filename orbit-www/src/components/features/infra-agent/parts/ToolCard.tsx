'use client'

import { useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  GitBranch,
  Globe,
  Orbit,
  TerminalSquare,
  TriangleAlert,
} from 'lucide-react'

import { cn } from '@/lib/utils'

import type { ParsedToolTurn, ToolCategory } from '../lib/tool-parsing'

interface Props {
  parsed: ParsedToolTurn
  showRaw?: boolean
}

export function ToolCard({ parsed, showRaw = false }: Props) {
  const [open, setOpen] = useState(false)
  const CategoryIcon = CATEGORY_ICONS[parsed.category]
  return (
    <div
      className={cn(
        'rounded-lg border bg-muted/20 transition-colors hover:border-foreground/15',
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left cursor-pointer"
      >
        <div
          className={cn(
            'flex h-6 w-6 shrink-0 items-center justify-center rounded-md',
            CATEGORY_BG[parsed.category],
          )}
        >
          <CategoryIcon className={cn('h-3.5 w-3.5', CATEGORY_FG[parsed.category])} />
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13px] font-medium text-muted-foreground">
            {parsed.toolName ?? 'tool'}
          </span>
          {parsed.arg && (
            <code className="truncate max-w-[280px] rounded bg-muted px-1.5 py-0.5 text-[11.5px] text-foreground">
              {parsed.arg}
            </code>
          )}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2 text-[11px] tabular-nums text-muted-foreground">
          {parsed.status === 'ok' && (
            <span className="rounded-full bg-emerald-500/12 px-1.5 py-0.5 text-[10.5px] text-emerald-400">
              ok
            </span>
          )}
          {parsed.status === 'error' && (
            <span className="rounded-full bg-red-500/12 px-1.5 py-0.5 text-[10.5px] text-red-400">
              error
            </span>
          )}
          {parsed.status === 'running' && (
            <span className="rounded-full bg-sky-500/12 px-1.5 py-0.5 text-[10.5px] text-sky-400">
              running
            </span>
          )}
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </div>
      </button>
      {!open && parsed.summary && (
        <div className="px-3 pb-2 text-[12.5px] leading-relaxed text-muted-foreground">
          {parsed.summary}
        </div>
      )}
      {open && (
        <div className="border-t bg-background/40 px-3 py-2.5 text-[12.5px]">
          {showRaw ? (
            <pre className="max-h-80 overflow-auto rounded border bg-zinc-950 p-2.5 font-mono text-[11.5px] whitespace-pre-wrap break-words text-foreground/80">
              {prettyJson(parsed.raw)}
            </pre>
          ) : (
            <ToolBody parsed={parsed} />
          )}
        </div>
      )}
    </div>
  )
}

function ToolBody({ parsed }: { parsed: ParsedToolTurn }) {
  const v = parsed.view
  if (v.kind === 'kv') {
    return (
      <dl className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-1 text-[12.5px]">
        {v.rows.map(([k, val]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="font-mono text-foreground break-words">{val}</dd>
          </div>
        ))}
      </dl>
    )
  }
  if (v.kind === 'files') {
    return (
      <div className="flex flex-col gap-0.5 font-mono text-[11.5px]">
        {v.rows.map((r, i) => (
          <div
            key={i}
            className="grid grid-cols-[80px_60px_1fr] gap-3 rounded px-1 py-0.5 hover:bg-muted/40"
          >
            <span className="text-muted-foreground">{r.perm ?? ''}</span>
            <span className="text-right text-amber-400">{r.size ?? ''}</span>
            <span className={r.isDir ? 'text-sky-400' : 'text-foreground'}>{r.name}</span>
          </div>
        ))}
      </div>
    )
  }
  if (v.kind === 'code') {
    return (
      <pre className="max-h-80 overflow-auto rounded border bg-zinc-950 p-2.5 font-mono text-[11.5px] whitespace-pre-wrap break-words text-foreground/85">
        {v.text}
      </pre>
    )
  }
  if (v.kind === 'error') {
    return (
      <div className="flex items-start gap-2.5">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
        <div>
          <div className="text-[13px] font-medium text-red-400">{v.message}</div>
          {v.detail && (
            <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-words font-mono text-[11.5px] text-muted-foreground">
              {v.detail}
            </pre>
          )}
        </div>
      </div>
    )
  }
  if (v.kind === 'json') {
    return (
      <pre className="max-h-80 overflow-auto rounded border bg-zinc-950 p-2.5 font-mono text-[11.5px] whitespace-pre-wrap break-words text-foreground/85">
        {v.text}
      </pre>
    )
  }
  return null
}

const CATEGORY_ICONS: Record<ToolCategory, typeof Orbit> = {
  orbit: Orbit,
  git: GitBranch,
  shell: TerminalSquare,
  http: Globe,
  read: FileText,
  unknown: Folder,
}

const CATEGORY_BG: Record<ToolCategory, string> = {
  orbit: 'bg-muted',
  git: 'bg-orange-500/12',
  shell: 'bg-violet-500/12',
  http: 'bg-sky-500/12',
  read: 'bg-emerald-500/12',
  unknown: 'bg-muted',
}

const CATEGORY_FG: Record<ToolCategory, string> = {
  orbit: 'text-foreground',
  git: 'text-orange-400',
  shell: 'text-violet-400',
  http: 'text-sky-400',
  read: 'text-emerald-400',
  unknown: 'text-muted-foreground',
}

function prettyJson(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2)
  } catch {
    return s
  }
}
