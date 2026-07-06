'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { nextCronRun } from '@/lib/automations/next-run'
import {
  presetToCron,
  type Frequency,
  type PresetState,
  DEFAULT_TIME,
  DEFAULT_WEEKDAY,
  DEFAULT_DAY_OF_MONTH,
} from '@/lib/automations/schedule-preset'

const FREQUENCY_OPTIONS: ReadonlyArray<{ value: Frequency; label: string }> = [
  { value: 'daily', label: 'Every day' },
  { value: 'weekday', label: 'Every weekday (Mon–Fri)' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'hourly', label: 'Every hour' },
  { value: 'every-15-min', label: 'Every 15 minutes' },
  { value: 'advanced', label: 'Advanced (raw cron)' },
]

const WEEKDAYS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
]

const WEEKDAY_SHORT = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** 'HH:MM' (24h) → '9:00 AM'. Falls back to the raw value if unparseable. */
export function formatTime12h(time: string | undefined): string {
  const t = time ?? DEFAULT_TIME
  const m = /^(\d{1,2}):(\d{2})$/.exec(t)
  if (!m) return t
  const h = Number(m[1])
  const min = m[2]
  const period = h < 12 ? 'AM' : 'PM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${min} ${period}`
}

/**
 * The next cron occurrence interpreted in **UTC** — which is what the Temporal
 * automation worker actually does (`AUTOMATION_SCHEDULE_TZ` defaults to `UTC`).
 *
 * `nextCronRun` matches the cron against a Date's LOCAL wall-clock fields. To get
 * UTC-field matching without forking that helper, we shift the timeline by the
 * zone offset: the local wall-clock of `t + offsetMs` equals the UTC wall-clock
 * of `t`, so we search on the shifted timeline and unshift the result. (Offset is
 * sampled at `from`; for a short-horizon display preview any DST drift is
 * immaterial.)
 */
export function nextCronRunUtc(expr: string, from: Date): Date | null {
  const offsetMs = from.getTimezoneOffset() * 60_000
  const shifted = nextCronRun(expr, new Date(from.getTime() + offsetMs))
  return shifted ? new Date(shifted.getTime() - offsetMs) : null
}

/**
 * A short "next run" stamp for the live preview / summary, formatted in **UTC**
 * to match the real (Temporal) fire time. Pair with {@link nextCronRunUtc}.
 */
export function formatNextRun(date: Date): string {
  return date.toLocaleString(undefined, {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** Plain-English phrase for a schedule preset (used by the live summary). */
export function scheduleSummary(state: PresetState): string {
  switch (state.frequency) {
    case 'daily':
      return `Every day at ${formatTime12h(state.time)}`
    case 'weekday':
      return `Every weekday at ${formatTime12h(state.time)}`
    case 'weekly':
      return `Every ${WEEKDAY_SHORT[state.weekday ?? DEFAULT_WEEKDAY]} at ${formatTime12h(state.time)}`
    case 'monthly':
      return `On day ${state.dayOfMonth ?? DEFAULT_DAY_OF_MONTH} of every month at ${formatTime12h(state.time)}`
    case 'hourly':
      return 'Every hour'
    case 'every-15-min':
      return 'Every 15 minutes'
    case 'advanced':
      return state.cron ? `On schedule ${state.cron}` : 'On a custom schedule'
  }
}

/**
 * Friendly schedule builder: a Frequency select drives contextual controls that
 * resolve to a canonical cron (via `presetToCron`), with a live "next run"
 * preview. `presetToCron` is the single source of truth — the parent reads the
 * same function on submit, so what the author sees here is exactly what is stored.
 */
export function SchedulePicker({
  state,
  setState,
  error,
  invalid,
}: {
  state: PresetState
  setState: (next: PresetState) => void
  error?: string
  invalid?: boolean
}) {
  const cron = presetToCron(state)
  const next = cron ? nextCronRunUtc(cron, new Date()) : null

  const onFrequency = (value: Frequency) => {
    // Seed sensible defaults so each frequency is immediately complete.
    setState({
      frequency: value,
      time: state.time ?? DEFAULT_TIME,
      weekday: state.weekday ?? DEFAULT_WEEKDAY,
      dayOfMonth: state.dayOfMonth ?? DEFAULT_DAY_OF_MONTH,
      cron: value === 'advanced' ? (state.cron ?? cron ?? '') : state.cron,
    })
  }

  const showTime = ['daily', 'weekday', 'weekly', 'monthly'].includes(state.frequency)

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="auto-schedule">Frequency</Label>
        <Select value={state.frequency} onValueChange={(v) => onFrequency(v as Frequency)}>
          <SelectTrigger id="auto-schedule" aria-invalid={invalid} className={invalid ? 'border-destructive' : ''}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FREQUENCY_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        {showTime && (
          <div className="space-y-1.5">
            <Label htmlFor="auto-schedule-time">Time (UTC)</Label>
            <Input
              id="auto-schedule-time"
              type="time"
              value={state.time ?? DEFAULT_TIME}
              onChange={(e) => setState({ ...state, time: e.target.value })}
              className="w-[140px]"
            />
          </div>
        )}

        {state.frequency === 'weekly' && (
          <div className="space-y-1.5">
            <Label htmlFor="auto-schedule-weekday">Day</Label>
            <Select
              value={String(state.weekday ?? DEFAULT_WEEKDAY)}
              onValueChange={(v) => setState({ ...state, weekday: Number(v) })}
            >
              <SelectTrigger id="auto-schedule-weekday" className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WEEKDAYS.map((d) => (
                  <SelectItem key={d.value} value={String(d.value)}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {state.frequency === 'monthly' && (
          <div className="space-y-1.5">
            <Label htmlFor="auto-schedule-dom">Day of month</Label>
            <Select
              value={String(state.dayOfMonth ?? DEFAULT_DAY_OF_MONTH)}
              onValueChange={(v) => setState({ ...state, dayOfMonth: Number(v) })}
            >
              <SelectTrigger id="auto-schedule-dom" className="w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                  <SelectItem key={d} value={String(d)}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {state.frequency === 'advanced' && (
        <div className="space-y-1.5">
          <Label htmlFor="auto-schedule-cron">Cron expression</Label>
          <Input
            id="auto-schedule-cron"
            value={state.cron ?? ''}
            onChange={(e) => setState({ ...state, cron: e.target.value })}
            placeholder="0 9 * * 1   (Mondays 09:00)"
            className={invalid ? 'border-destructive' : ''}
            aria-invalid={invalid}
          />
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {next ? (
          <>
            Next run: <span className="font-medium text-foreground">{formatNextRun(next)}</span>{' '}
            UTC
          </>
        ) : (
          'Next run: —'
        )}
        <span className="ml-1">· Times are in UTC.</span>
      </p>
      {error && (
        <p id="auto-schedule-error" role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
