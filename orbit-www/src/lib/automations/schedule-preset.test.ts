import { describe, it, expect } from 'vitest'
import {
  presetToCron,
  cronToPreset,
  type PresetState,
} from './schedule-preset'

describe('presetToCron', () => {
  it('maps each frequency to its canonical cron', () => {
    expect(presetToCron({ frequency: 'daily', time: '09:00' })).toBe('0 9 * * *')
    expect(presetToCron({ frequency: 'weekday', time: '09:00' })).toBe('0 9 * * 1-5')
    expect(presetToCron({ frequency: 'weekly', time: '09:00', weekday: 1 })).toBe('0 9 * * 1')
    expect(presetToCron({ frequency: 'weekly', time: '17:30', weekday: 0 })).toBe('30 17 * * 0')
    expect(presetToCron({ frequency: 'monthly', time: '09:00', dayOfMonth: 1 })).toBe('0 9 1 * *')
    expect(presetToCron({ frequency: 'monthly', time: '08:15', dayOfMonth: 15 })).toBe('15 8 15 * *')
    expect(presetToCron({ frequency: 'hourly' })).toBe('0 * * * *')
    expect(presetToCron({ frequency: 'every-15-min' })).toBe('*/15 * * * *')
    expect(presetToCron({ frequency: 'advanced', cron: '0 9 * * 1,3,5' })).toBe('0 9 * * 1,3,5')
  })

  it('defaults an absent time to 09:00', () => {
    expect(presetToCron({ frequency: 'daily' })).toBe('0 9 * * *')
  })

  it('returns null for incomplete presets', () => {
    expect(presetToCron({ frequency: 'weekly', time: '09:00' })).toBeNull() // no weekday
    expect(presetToCron({ frequency: 'monthly', time: '09:00' })).toBeNull() // no dayOfMonth
    expect(presetToCron({ frequency: 'advanced' })).toBeNull() // no cron
    expect(presetToCron({ frequency: 'advanced', cron: '   ' })).toBeNull()
    expect(presetToCron({ frequency: 'daily', time: '99:99' })).toBeNull() // invalid time
    expect(presetToCron({ frequency: 'daily', time: '' })).toBeNull()
  })

  it('rejects out-of-range weekday / day-of-month', () => {
    expect(presetToCron({ frequency: 'weekly', time: '09:00', weekday: 7 })).toBeNull()
    expect(presetToCron({ frequency: 'monthly', time: '09:00', dayOfMonth: 0 })).toBeNull()
    expect(presetToCron({ frequency: 'monthly', time: '09:00', dayOfMonth: 32 })).toBeNull()
  })
})

describe('cronToPreset', () => {
  it('recovers each canonical preset shape', () => {
    expect(cronToPreset('0 9 * * *')).toEqual({ frequency: 'daily', time: '09:00' })
    expect(cronToPreset('0 9 * * 1-5')).toEqual({ frequency: 'weekday', time: '09:00' })
    expect(cronToPreset('0 9 * * 1')).toEqual({ frequency: 'weekly', time: '09:00', weekday: 1 })
    expect(cronToPreset('30 17 * * 0')).toEqual({ frequency: 'weekly', time: '17:30', weekday: 0 })
    expect(cronToPreset('0 9 1 * *')).toEqual({ frequency: 'monthly', time: '09:00', dayOfMonth: 1 })
    expect(cronToPreset('15 8 15 * *')).toEqual({ frequency: 'monthly', time: '08:15', dayOfMonth: 15 })
    expect(cronToPreset('0 * * * *')).toEqual({ frequency: 'hourly' })
    expect(cronToPreset('*/15 * * * *')).toEqual({ frequency: 'every-15-min' })
  })

  it('falls back to advanced for non-matching crons (never coerces)', () => {
    for (const cron of [
      '*/15 9-17 * * 1-5', // step minute with hour range
      '0 9 * * 1,3,5', // weekday list
      '0 9,17 * * *', // hour list
      '0 9 1,15 * *', // dom list
      '0 9 * 6 *', // restricted month
      '0 9 1 * 1', // both dom and dow restricted
      '*/30 * * * *', // unsupported step
      '0 0 * * 7', // weekday out of range
      '09 9 * * *', // non-canonical leading zero
      'not a cron',
      '0 9 * *', // too few fields
    ]) {
      expect(cronToPreset(cron)).toEqual({ frequency: 'advanced', cron })
    }
  })

  it('preserves the raw cron on the advanced fallback', () => {
    expect(cronToPreset('0 9 * * 1,3,5').cron).toBe('0 9 * * 1,3,5')
  })
})

describe('round-trip preset → cron → preset', () => {
  const table: PresetState[] = [
    { frequency: 'daily', time: '09:00' },
    { frequency: 'weekday', time: '09:00' },
    { frequency: 'weekly', time: '09:00', weekday: 1 },
    { frequency: 'weekly', time: '17:30', weekday: 0 },
    { frequency: 'weekly', time: '06:05', weekday: 6 },
    { frequency: 'monthly', time: '09:00', dayOfMonth: 1 },
    { frequency: 'monthly', time: '08:15', dayOfMonth: 15 },
    { frequency: 'monthly', time: '23:59', dayOfMonth: 31 },
    { frequency: 'hourly' },
    { frequency: 'every-15-min' },
  ]

  it.each(table)('round-trips %o', (preset) => {
    const cron = presetToCron(preset)
    expect(cron).not.toBeNull()
    expect(cronToPreset(cron as string)).toEqual(preset)
  })
})
