'use client'

import { Clock, Octagon } from 'lucide-react'

import { Button } from '@/components/ui/button'

import { StatusPill } from './StatusPill'
import type { Phase } from '../lib/phases'

interface Props {
  visible: boolean
  status: string
  elapsedLabel: string | null
  activePhase: Phase | null
  terminal: boolean
  busy?: boolean
  onAbort?: () => void
}

// Pinned status indicator shown when the RunHeader has scrolled out of view.
// Mirrors the key bits (status pill, current phase, elapsed time, abort) so
// the user always knows the run is alive without scrolling to the top.
export function FloatingStatusBar({
  visible,
  status,
  elapsedLabel,
  activePhase,
  terminal,
  busy,
  onAbort,
}: Props) {
  return (
    <div
      aria-hidden={!visible}
      className={[
        'pointer-events-none fixed bottom-24 left-1/2 z-30 -translate-x-1/2',
        'transition-all duration-200',
        visible
          ? 'translate-y-0 opacity-100'
          : 'translate-y-3 opacity-0',
      ].join(' ')}
    >
      <div
        className={[
          'pointer-events-auto inline-flex items-center gap-3 rounded-full border bg-background/90 px-3 py-1.5 shadow-lg backdrop-blur',
          'border-border/60',
        ].join(' ')}
      >
        <StatusPill status={status} />
        {activePhase && (
          <span className="hidden sm:inline-flex items-center gap-1.5 text-xs text-foreground/80">
            <span
              className={[
                'h-1.5 w-1.5 rounded-full',
                activePhase.status === 'active'
                  ? 'bg-orange-500 animate-pulse'
                  : activePhase.status === 'done'
                    ? 'bg-emerald-500'
                    : 'bg-muted-foreground/60',
              ].join(' ')}
              aria-hidden
            />
            <span className="font-medium">{activePhase.label}</span>
          </span>
        )}
        {elapsedLabel && (
          <span className="inline-flex items-center gap-1 text-[11.5px] tabular-nums text-muted-foreground">
            <Clock className="h-3 w-3 opacity-60" />
            {elapsedLabel}
          </span>
        )}
        {onAbort && !terminal && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11.5px] text-red-400 hover:text-red-300"
            onClick={onAbort}
            disabled={busy}
          >
            <Octagon className="mr-1 h-3 w-3" /> Abort
          </Button>
        )}
      </div>
    </div>
  )
}
