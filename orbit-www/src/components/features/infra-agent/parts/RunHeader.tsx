'use client'

import { Clock, Octagon, RotateCcw } from 'lucide-react'

import { Button } from '@/components/ui/button'

import { StatusPill } from './StatusPill'

interface Props {
  title: string
  status: string
  startedAt: string
  elapsedLabel: string | null
  runId: string
  terminal: boolean
  onRestart?: () => void
  onAbort?: () => void
  busy?: boolean
}

export function RunHeader({
  title,
  status,
  startedAt,
  elapsedLabel,
  runId,
  terminal,
  onRestart,
  onAbort,
  busy,
}: Props) {
  return (
    <div className="mb-4">
      <h1 className="mb-2 text-2xl font-semibold tracking-tight">{title}</h1>
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <StatusPill status={status} />
        <span className="inline-flex items-center gap-1.5">
          <Clock className="h-3 w-3 opacity-60" />
          Started {startedAt}
          {elapsedLabel ? ` · ${elapsedLabel} elapsed` : ''}
        </span>
        <span className="font-mono text-[11.5px] text-muted-foreground/70">{runId}</span>
        <div className="ml-auto flex gap-2">
          {onRestart && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2.5 text-xs"
              onClick={onRestart}
              disabled={busy}
            >
              <RotateCcw className="mr-1 h-3 w-3" /> Restart from here
            </Button>
          )}
          {onAbort && !terminal && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2.5 text-xs text-red-400 hover:text-red-300 hover:border-red-500/40"
              onClick={onAbort}
              disabled={busy}
            >
              <Octagon className="mr-1 h-3 w-3" /> Abort
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
