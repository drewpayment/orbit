/**
 * Cron "next run" computation (IDP refocus P4.1) — pure, fully unit-tested.
 *
 * Supports standard 5-field cron — `minute hour day-of-month month day-of-week`
 * — with `*`, single values, comma lists, ranges (`a-b`), and steps (`*​/n`,
 * `a-b/n`). Day-of-week is 0–6 with 0 = Sunday. When BOTH day-of-month and
 * day-of-week are restricted (neither is `*`), a day matches if EITHER matches
 * (standard Vixie-cron OR semantics).
 *
 * {@link nextCronRun} returns the next matching instant strictly after `from`,
 * computed in the server's local time, or `null` for an invalid expression or
 * when no occurrence falls within ~366 days (a cheap minute-stepping search with
 * a hard cap — schedule execution is the deferred Temporal path, so this is for
 * display only and never on a hot path).
 */

interface CronField {
  /** Allowed values for this field. */
  values: Set<number>
  /** Whether the source token was `*` (used for the dom/dow OR rule). */
  isWildcard: boolean
}

interface ParsedCron {
  minute: CronField
  hour: CronField
  dom: CronField
  month: CronField
  dow: CronField
}

const RANGES = {
  minute: [0, 59],
  hour: [0, 23],
  dom: [1, 31],
  month: [1, 12],
  dow: [0, 6],
} as const

/** Parse one cron field (e.g. `*​/15`, `9-17`, `0,12`) into its allowed values. */
function parseField(token: string, min: number, max: number): CronField | null {
  if (!token) return null
  const values = new Set<number>()
  const isWildcard = token === '*'

  for (const part of token.split(',')) {
    if (!part) return null
    // Split optional step: "<range>/<step>".
    const [rangePart, stepPart, ...rest] = part.split('/')
    if (rest.length > 0) return null
    let step = 1
    if (stepPart !== undefined) {
      step = Number(stepPart)
      if (!Number.isInteger(step) || step <= 0) return null
    }

    let lo: number
    let hi: number
    if (rangePart === '*') {
      lo = min
      hi = max
    } else if (rangePart.includes('-')) {
      const [a, b, ...more] = rangePart.split('-')
      if (more.length > 0) return null
      lo = Number(a)
      hi = Number(b)
    } else {
      lo = Number(rangePart)
      hi = lo
    }

    if (!Number.isInteger(lo) || !Number.isInteger(hi)) return null
    if (lo < min || hi > max || lo > hi) return null

    for (let v = lo; v <= hi; v += step) values.add(v)
  }

  if (values.size === 0) return null
  return { values, isWildcard }
}

/** Parse a 5-field cron expression, or null if malformed/out-of-range. */
export function parseCronExpression(expr: string): ParsedCron | null {
  if (typeof expr !== 'string') return null
  const fields = expr.trim().split(/\s+/)
  if (fields.length !== 5 || fields[0] === '') return null

  const minute = parseField(fields[0], ...RANGES.minute)
  const hour = parseField(fields[1], ...RANGES.hour)
  const dom = parseField(fields[2], ...RANGES.dom)
  const month = parseField(fields[3], ...RANGES.month)
  const dow = parseField(fields[4], ...RANGES.dow)
  if (!minute || !hour || !dom || !month || !dow) return null

  return { minute, hour, dom, month, dow }
}

/** True if `date` (local time) satisfies the parsed cron schedule. */
function matches(date: Date, cron: ParsedCron): boolean {
  if (!cron.minute.values.has(date.getMinutes())) return false
  if (!cron.hour.values.has(date.getHours())) return false
  if (!cron.month.values.has(date.getMonth() + 1)) return false

  const domMatch = cron.dom.values.has(date.getDate())
  const dowMatch = cron.dow.values.has(date.getDay())
  // OR semantics when both are restricted; otherwise the non-wildcard one governs.
  if (cron.dom.isWildcard && cron.dow.isWildcard) return true
  if (cron.dom.isWildcard) return dowMatch
  if (cron.dow.isWildcard) return domMatch
  return domMatch || dowMatch
}

const MAX_MINUTES = 366 * 24 * 60

/**
 * The next instant matching `expr` strictly after `from` (local time), or null
 * for an invalid expression or no match within ~366 days.
 */
export function nextCronRun(expr: string, from: Date): Date | null {
  const cron = parseCronExpression(expr)
  if (!cron) return null

  // Start at the next whole minute strictly after `from`.
  const candidate = new Date(from.getTime())
  candidate.setSeconds(0, 0)
  candidate.setMinutes(candidate.getMinutes() + 1)

  for (let i = 0; i < MAX_MINUTES; i++) {
    if (matches(candidate, cron)) return new Date(candidate.getTime())
    candidate.setMinutes(candidate.getMinutes() + 1)
  }
  return null
}
