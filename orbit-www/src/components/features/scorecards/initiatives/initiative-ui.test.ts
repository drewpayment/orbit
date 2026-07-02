import { describe, expect, it } from 'vitest'
import {
  formatDeadline,
  initiativeStatusPresentation,
  isOverdue,
  itemStatusPresentation,
  progressTone,
  targetLevelLabel,
} from './initiative-ui'

describe('initiativeStatusPresentation', () => {
  it('maps each lifecycle status to a distinct label + variant', () => {
    expect(initiativeStatusPresentation('active').label).toBe('Active')
    expect(initiativeStatusPresentation('completed').label).toBe('Completed')
    expect(initiativeStatusPresentation('cancelled').label).toBe('Cancelled')
    expect(initiativeStatusPresentation('completed').variant).toBe('default')
    expect(initiativeStatusPresentation('cancelled').variant).toBe('outline')
  })

  it('falls back to a neutral outline chip for an unknown status', () => {
    const p = initiativeStatusPresentation('mystery')
    expect(p.variant).toBe('outline')
    expect(p.label).toBe('mystery')
  })
})

describe('itemStatusPresentation', () => {
  it('labels the four item statuses', () => {
    expect(itemStatusPresentation('open').label).toBe('Open')
    expect(itemStatusPresentation('in-progress').label).toBe('In progress')
    expect(itemStatusPresentation('done').label).toBe('Done')
    expect(itemStatusPresentation('waived').label).toBe('Waived')
  })
})

describe('isOverdue', () => {
  const now = new Date('2026-07-02T12:00:00.000Z')

  it('is true when the deadline is strictly in the past', () => {
    expect(isOverdue('2026-07-01T00:00:00.000Z', now)).toBe(true)
  })

  it('is false for a future deadline', () => {
    expect(isOverdue('2026-07-03T00:00:00.000Z', now)).toBe(false)
  })

  it('is false when no deadline is set', () => {
    expect(isOverdue(null, now)).toBe(false)
    expect(isOverdue(undefined, now)).toBe(false)
  })
})

describe('formatDeadline', () => {
  it('renders a short UTC date', () => {
    expect(formatDeadline('2026-07-02T00:00:00.000Z')).toBe('Jul 2, 2026')
  })

  it('renders a placeholder when unset', () => {
    expect(formatDeadline(null)).toBe('No deadline')
    expect(formatDeadline(undefined)).toBe('No deadline')
  })
})

describe('progressTone', () => {
  it('greens a fully complete initiative and reds an untouched one', () => {
    expect(progressTone(100)).toBe('text-emerald-600')
    expect(progressTone(70)).toBe('text-amber-600')
    expect(progressTone(10)).toBe('text-red-600')
  })
})

describe('targetLevelLabel', () => {
  it('prefixes a target level', () => {
    expect(targetLevelLabel('Gold')).toBe('Target: Gold')
  })

  it('handles a missing target', () => {
    expect(targetLevelLabel(null)).toBe('No target level')
  })
})
