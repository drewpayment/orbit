/**
 * Schedule presets (IDP refocus P4 — authoring UX) — pure, fully unit-tested.
 *
 * The single source of truth between the friendly Frequency picker and a
 * canonical 5-field cron string. `presetToCron` builds the cron the server
 * stores; `cronToPreset` recovers the picker state for edit-mode hydration,
 * matching the canonical shapes EXACTLY and falling back to `advanced` (raw
 * cron) for anything it doesn't recognise — it never coerces a non-matching
 * cron into a wrong preset, and never blanks it.
 *
 * Cron mapping (minute m, hour h taken from `time`):
 *   daily         → `m h * * *`
 *   weekday       → `m h * * 1-5`
 *   weekly        → `m h * * <weekday>`   (0=Sun..6=Sat)
 *   monthly       → `m h <dayOfMonth> * *`
 *   hourly        → `0 * * * *`
 *   every-15-min  → `*​/15 * * * *`
 *   advanced      → raw cron
 */

export type Frequency =
  | 'daily'
  | 'weekday'
  | 'weekly'
  | 'monthly'
  | 'hourly'
  | 'every-15-min'
  | 'advanced'

export interface PresetState {
  frequency: Frequency
  /** 'HH:MM' 24h — used by daily/weekday/weekly/monthly. */
  time?: string
  /** 0=Sun..6=Sat — used by weekly. */
  weekday?: number
  /** 1-31 — used by monthly. */
  dayOfMonth?: number
  /** Raw cron — used by advanced. */
  cron?: string
}

/** Default time when the picker hasn't been given one. */
export const DEFAULT_TIME = '09:00'
/** Default weekday (Monday) for the weekly preset. */
export const DEFAULT_WEEKDAY = 1
/** Default day-of-month for the monthly preset. */
export const DEFAULT_DAY_OF_MONTH = 1

/** Parse 'HH:MM' (defaulting absent → 09:00) into minute/hour, or null. */
function parseTime(time: string | undefined): { m: number; h: number } | null {
  const t = time ?? DEFAULT_TIME
  const match = /^(\d{1,2}):(\d{2})$/.exec(t)
  if (!match) return null
  const h = Number(match[1])
  const m = Number(match[2])
  if (h < 0 || h > 23 || m < 0 || m > 59) return null
  return { m, h }
}

/** A field that must be a canonical non-negative integer (no leading zeros). */
function numField(x: string): number | null {
  if (!/^\d+$/.test(x)) return null
  const n = Number(x)
  if (String(n) !== x) return null // reject '09', '00', etc.
  return n
}

function fmtTime(h: number, m: number): string {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * Build the canonical cron for a preset, or `null` when it's incomplete (e.g.
 * weekly with no weekday, monthly with no day-of-month, advanced with no cron,
 * or an invalid time).
 */
export function presetToCron(s: PresetState): string | null {
  switch (s.frequency) {
    case 'hourly':
      return '0 * * * *'
    case 'every-15-min':
      return '*/15 * * * *'
    case 'advanced': {
      const c = s.cron?.trim()
      return c ? c : null
    }
    case 'daily':
    case 'weekday':
    case 'weekly':
    case 'monthly': {
      const t = parseTime(s.time)
      if (!t) return null
      const { m, h } = t
      if (s.frequency === 'daily') return `${m} ${h} * * *`
      if (s.frequency === 'weekday') return `${m} ${h} * * 1-5`
      if (s.frequency === 'weekly') {
        const wd = s.weekday
        if (wd == null || !Number.isInteger(wd) || wd < 0 || wd > 6) return null
        return `${m} ${h} * * ${wd}`
      }
      // monthly
      const dom = s.dayOfMonth
      if (dom == null || !Number.isInteger(dom) || dom < 1 || dom > 31) return null
      return `${m} ${h} ${dom} * *`
    }
    default:
      return null
  }
}

/**
 * Recover picker state from a cron string. Returns a typed preset only for an
 * EXACT canonical-shape match; otherwise `{ frequency: 'advanced', cron }`.
 */
export function cronToPreset(cron: string): PresetState {
  const raw = typeof cron === 'string' ? cron : String(cron ?? '')
  const advanced: PresetState = { frequency: 'advanced', cron: raw }

  const fields = raw.trim().split(/\s+/)
  if (fields.length !== 5) return advanced
  const [m, h, dom, mon, dow] = fields

  // Interval presets first — their minute fields aren't plain integers.
  if (m === '0' && h === '*' && dom === '*' && mon === '*' && dow === '*') {
    return { frequency: 'hourly' }
  }
  if (m === '*/15' && h === '*' && dom === '*' && mon === '*' && dow === '*') {
    return { frequency: 'every-15-min' }
  }

  // The time-based presets all need a canonical minute+hour and an unrestricted month.
  const minute = numField(m)
  const hour = numField(h)
  if (minute == null || hour == null || hour > 23 || minute > 59 || mon !== '*') return advanced
  const time = fmtTime(hour, minute)

  // daily: m h * * *
  if (dom === '*' && dow === '*') return { frequency: 'daily', time }
  // weekday: m h * * 1-5
  if (dom === '*' && dow === '1-5') return { frequency: 'weekday', time }
  // weekly: m h * * <0-6>
  if (dom === '*') {
    const wd = numField(dow)
    if (wd != null && wd >= 0 && wd <= 6) return { frequency: 'weekly', time, weekday: wd }
    return advanced
  }
  // monthly: m h <1-31> * *
  if (dow === '*') {
    const d = numField(dom)
    if (d != null && d >= 1 && d <= 31) return { frequency: 'monthly', time, dayOfMonth: d }
    return advanced
  }
  return advanced
}
