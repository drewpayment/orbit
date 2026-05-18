import { Check } from 'lucide-react'

import { cn } from '@/lib/utils'

import type { Phase } from '../lib/phases'

interface Props {
  phases: Phase[]
}

export function PhaseTimeline({ phases }: Props) {
  return (
    <div className="flex items-center rounded-xl border bg-muted/30 px-3 py-2.5">
      {phases.map((phase, i) => (
        <div key={phase.key} className="flex flex-1 items-center min-w-0">
          {i > 0 && (
            <div
              className={cn(
                'h-px flex-1 mx-1.5',
                phases[i - 1].status === 'done'
                  ? 'bg-emerald-500/40'
                  : 'bg-border',
              )}
            />
          )}
          <PhaseDot phase={phase} index={i + 1} />
        </div>
      ))}
    </div>
  )
}

function PhaseDot({ phase, index }: { phase: Phase; index: number }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span
        className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold tabular-nums',
          phase.status === 'done' &&
            'bg-emerald-500/15 border-emerald-500/40 text-emerald-400',
          phase.status === 'active' &&
            'bg-orange-500 border-orange-500 text-white shadow-[0_0_0_3px_rgba(255,106,44,0.18)]',
          phase.status === 'pending' &&
            'bg-muted border-border text-muted-foreground',
        )}
      >
        {phase.status === 'done' ? <Check className="h-3 w-3" /> : index}
      </span>
      <span
        className={cn(
          'truncate text-xs font-medium',
          phase.status === 'active' && 'text-foreground',
          phase.status === 'done' && 'text-foreground/80',
          phase.status === 'pending' && 'text-muted-foreground',
        )}
      >
        {phase.label}
      </span>
    </div>
  )
}
