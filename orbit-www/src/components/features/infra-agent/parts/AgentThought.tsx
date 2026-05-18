'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

interface Props {
  content: string
  defaultOpen?: boolean
}

// Renders an assistant text turn as the design's "thought" treatment:
// a small uppercase label + the prose itself. The whole row is a button
// that collapses to a one-line preview when long — symmetric with the
// ToolCard's expand/collapse affordance so the transcript scans the
// same way whether the agent is thinking or running tools.
export function AgentThought({ content, defaultOpen }: Props) {
  const trimmed = content.trim()
  // Long messages default to collapsed; short ones expanded.
  const isLong = trimmed.length > 280 || trimmed.split('\n').length > 3
  const [open, setOpen] = useState(defaultOpen ?? !isLong)
  const preview = firstLine(trimmed)

  return (
    <button
      type="button"
      onClick={() => setOpen((o) => !o)}
      className="flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left text-[13.5px] leading-relaxed hover:bg-muted/40 cursor-pointer"
    >
      <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground">
        {open ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
      </span>
      <span className="mt-1 shrink-0 text-[10px] font-semibold uppercase tracking-wider text-orange-400">
        Agent
      </span>
      <span className="min-w-0 flex-1 whitespace-pre-wrap text-foreground/90">
        {open ? trimmed : preview}
        {!open && trimmed.length > preview.length && (
          <span className="ml-1 text-muted-foreground">…</span>
        )}
      </span>
    </button>
  )
}

function firstLine(s: string): string {
  const idx = s.indexOf('\n')
  const first = idx === -1 ? s : s.slice(0, idx)
  if (first.length <= 180) return first
  return first.slice(0, 180).trimEnd() + '…'
}
