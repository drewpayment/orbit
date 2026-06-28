import { describe, it, expect } from 'vitest'
import { nextCronRun, parseCronExpression } from './next-run'

// All dates use the local-time Date constructor (year, monthIndex, day, h, m) so
// the assertions are timezone-independent — nextCronRun works in local time.

describe('parseCronExpression', () => {
  it('parses a valid 5-field expression', () => {
    expect(parseCronExpression('0 9 * * 1')).not.toBeNull()
  })
  it('rejects wrong field counts', () => {
    expect(parseCronExpression('0 9 * *')).toBeNull()
    expect(parseCronExpression('0 9 * * 1 2')).toBeNull()
    expect(parseCronExpression('')).toBeNull()
  })
  it('rejects out-of-range and malformed fields', () => {
    expect(parseCronExpression('99 * * * *')).toBeNull()
    expect(parseCronExpression('* 24 * * *')).toBeNull()
    expect(parseCronExpression('* * 0 * *')).toBeNull() // day-of-month min is 1
    expect(parseCronExpression('* * * 13 *')).toBeNull()
    expect(parseCronExpression('a * * * *')).toBeNull()
  })
})

describe('nextCronRun', () => {
  it('returns null for an invalid expression', () => {
    expect(nextCronRun('not a cron', new Date(2026, 5, 27, 12, 0))).toBeNull()
  })

  it('every 15 minutes → next quarter hour (strictly after now)', () => {
    const from = new Date(2026, 5, 27, 12, 7)
    expect(nextCronRun('*/15 * * * *', from)).toEqual(new Date(2026, 5, 27, 12, 15))
  })

  it('every 15 minutes → rolls the hour at :45+', () => {
    const from = new Date(2026, 5, 27, 12, 50)
    expect(nextCronRun('*/15 * * * *', from)).toEqual(new Date(2026, 5, 27, 13, 0))
  })

  it('is strict: an exact match advances to the next occurrence', () => {
    const from = new Date(2026, 5, 27, 12, 15, 0)
    expect(nextCronRun('*/15 * * * *', from)).toEqual(new Date(2026, 5, 27, 12, 30))
  })

  it('weekly Monday 09:00 (Sat Jun 27 2026 → Mon Jun 29)', () => {
    const from = new Date(2026, 5, 27, 10, 0) // Saturday
    expect(nextCronRun('0 9 * * 1', from)).toEqual(new Date(2026, 5, 29, 9, 0))
  })

  it('day-of-month 14:30 rolls to next month when past', () => {
    const from = new Date(2026, 5, 2, 0, 0) // Jun 2
    expect(nextCronRun('30 14 1 * *', from)).toEqual(new Date(2026, 6, 1, 14, 30))
  })

  it('hour range 9-17 → next top of an in-range hour', () => {
    const from = new Date(2026, 5, 27, 8, 30)
    expect(nextCronRun('0 9-17 * * *', from)).toEqual(new Date(2026, 5, 27, 9, 0))
    const from2 = new Date(2026, 5, 27, 18, 30)
    expect(nextCronRun('0 9-17 * * *', from2)).toEqual(new Date(2026, 5, 28, 9, 0))
  })

  it('comma list of hours', () => {
    const from = new Date(2026, 5, 27, 6, 0)
    expect(nextCronRun('0 0,12 * * *', from)).toEqual(new Date(2026, 5, 27, 12, 0))
  })

  it('dom AND dow both restricted → OR semantics (1st OR Monday)', () => {
    // From Tue Jun 2 2026: next match is the soonest of "1st of month" or "Monday".
    // Mondays: Jun 8. 1st: Jul 1. So Jun 8 wins.
    const from = new Date(2026, 5, 2, 0, 0)
    expect(nextCronRun('0 0 1 * 1', from)).toEqual(new Date(2026, 5, 8, 0, 0))
  })

  it('returns null when no occurrence within ~a year (Feb 30)', () => {
    expect(nextCronRun('0 0 30 2 *', new Date(2026, 0, 1, 0, 0))).toBeNull()
  })
})
