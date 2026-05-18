import { cn } from '@/lib/utils'

type RunStatus = 'starting' | 'running' | 'awaiting_user' | 'completed' | 'aborted' | 'failed' | 'timeout' | string

const STATUS_MAP: Record<string, { className: string; label: string; pulse: boolean }> = {
  starting: {
    className: 'bg-sky-500/10 text-sky-400 border-sky-500/25',
    label: 'Starting',
    pulse: true,
  },
  running: {
    className: 'bg-sky-500/10 text-sky-400 border-sky-500/25',
    label: 'Running',
    pulse: true,
  },
  awaiting_user: {
    className: 'bg-orange-500/12 text-orange-400 border-orange-500/30',
    label: 'Awaiting your input',
    pulse: true,
  },
  completed: {
    className: 'bg-emerald-500/12 text-emerald-400 border-emerald-500/25',
    label: 'Completed',
    pulse: false,
  },
  failed: {
    className: 'bg-red-500/12 text-red-400 border-red-500/25',
    label: 'Failed',
    pulse: false,
  },
  aborted: {
    className: 'bg-zinc-500/12 text-zinc-400 border-zinc-500/25',
    label: 'Aborted',
    pulse: false,
  },
  timeout: {
    className: 'bg-amber-500/12 text-amber-400 border-amber-500/25',
    label: 'Timed out',
    pulse: false,
  },
}

interface Props {
  status: RunStatus
  label?: string
}

export function StatusPill({ status, label }: Props) {
  const m = STATUS_MAP[status] ?? {
    className: 'bg-zinc-500/12 text-zinc-400 border-zinc-500/25',
    label: status,
    pulse: false,
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        m.className,
      )}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full bg-current',
          m.pulse && 'animate-pulse',
        )}
      />
      {label ?? m.label}
    </span>
  )
}
