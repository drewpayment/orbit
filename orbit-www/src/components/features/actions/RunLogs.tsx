import { cn } from '@/lib/utils'

/**
 * Append-only log view for an Action Run. The `logs` column is free-form JSON;
 * the runner writes an array of `{ ts, level, message }` entries, but we parse
 * defensively so a malformed/partial shape still renders something useful.
 */

interface LogEntry {
  ts?: string
  level?: string
  message: string
}

const LEVEL_TONE: Record<string, string> = {
  error: 'text-red-500',
  warn: 'text-amber-500',
  warning: 'text-amber-500',
  info: 'text-muted-foreground',
  debug: 'text-muted-foreground/70',
}

function parseLogs(raw: unknown): LogEntry[] {
  if (!Array.isArray(raw)) return []
  const out: LogEntry[] = []
  for (const entry of raw) {
    if (typeof entry === 'string') {
      out.push({ message: entry })
      continue
    }
    if (entry && typeof entry === 'object') {
      const e = entry as Record<string, unknown>
      const message =
        typeof e.message === 'string'
          ? e.message
          : typeof e.msg === 'string'
            ? e.msg
            : JSON.stringify(e)
      out.push({
        message,
        ts: typeof e.ts === 'string' ? e.ts : typeof e.time === 'string' ? e.time : undefined,
        level: typeof e.level === 'string' ? e.level : undefined,
      })
    }
  }
  return out
}

function formatTs(ts?: string): string {
  if (!ts) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts
  return d.toLocaleTimeString()
}

export function RunLogs({ logs }: { logs: unknown }) {
  const entries = parseLogs(logs)

  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">No logs yet.</p>
  }

  return (
    <div className="max-h-96 overflow-y-auto rounded-md border bg-muted/30 p-3 font-mono text-xs leading-relaxed">
      {entries.map((entry, i) => (
        <div key={i} className="flex gap-2">
          {entry.ts && <span className="shrink-0 text-muted-foreground/60">{formatTs(entry.ts)}</span>}
          {entry.level && (
            <span className={cn('shrink-0 uppercase', LEVEL_TONE[entry.level.toLowerCase()] ?? 'text-muted-foreground')}>
              {entry.level}
            </span>
          )}
          <span className="whitespace-pre-wrap break-words">{entry.message}</span>
        </div>
      ))}
    </div>
  )
}
