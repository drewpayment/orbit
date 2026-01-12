import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  getDefaultGracePeriodDays,
  calculateGracePeriodEnd,
  isGracePeriodExpired,
  getRemainingGracePeriodDays,
  calculateLifecycleState,
} from './lifecycle'

describe('Lifecycle Utilities', () => {
  describe('Default Grace Periods', () => {
    it('should return correct defaults for all environments', () => {
      expect(getDefaultGracePeriodDays('dev')).toBe(7)
      expect(getDefaultGracePeriodDays('stage')).toBe(14)
      expect(getDefaultGracePeriodDays('prod')).toBe(30)
    })

    it('should return safe default for unknown environment', () => {
      expect(getDefaultGracePeriodDays('unknown')).toBe(30)
      expect(getDefaultGracePeriodDays('sandbox')).toBe(30)
      expect(getDefaultGracePeriodDays('')).toBe(30)
    })
  })

  describe('Grace Period Calculation', () => {
    it('should use max grace period across environments', () => {
      const startDate = new Date('2026-01-10T00:00:00Z')
      const environments = ['dev', 'stage', 'prod']

      const endDate = calculateGracePeriodEnd(startDate, environments)

      // Should use prod's 30 days as max
      const expected = new Date('2026-02-09T00:00:00Z')
      expect(endDate.toISOString()).toBe(expected.toISOString())
    })

    it('should handle dev-only environment', () => {
      const startDate = new Date('2026-01-10T00:00:00Z')
      const environments = ['dev']

      const endDate = calculateGracePeriodEnd(startDate, environments)

      // Should use dev's 7 days
      const expected = new Date('2026-01-17T00:00:00Z')
      expect(endDate.toISOString()).toBe(expected.toISOString())
    })

    it('should respect override even when smaller than default', () => {
      const startDate = new Date('2026-01-10T00:00:00Z')
      const environments = ['prod'] // Default would be 30 days

      const endDate = calculateGracePeriodEnd(startDate, environments, 5)

      // Should use override of 5 days
      const expected = new Date('2026-01-15T00:00:00Z')
      expect(endDate.toISOString()).toBe(expected.toISOString())
    })

    it('should use prod default when no environments provided', () => {
      const startDate = new Date('2026-01-10T00:00:00Z')
      const environments: string[] = []

      const endDate = calculateGracePeriodEnd(startDate, environments)

      // Should fallback to prod's 30 days
      const expected = new Date('2026-02-09T00:00:00Z')
      expect(endDate.toISOString()).toBe(expected.toISOString())
    })

    it('should ignore zero or negative override', () => {
      const startDate = new Date('2026-01-10T00:00:00Z')
      const environments = ['dev']

      const endDateZero = calculateGracePeriodEnd(startDate, environments, 0)
      const endDateNegative = calculateGracePeriodEnd(startDate, environments, -5)

      // Should use dev's 7 days for both
      const expected = new Date('2026-01-17T00:00:00Z')
      expect(endDateZero.toISOString()).toBe(expected.toISOString())
      expect(endDateNegative.toISOString()).toBe(expected.toISOString())
    })
  })

  describe('Grace Period Status', () => {
    beforeEach(() => {
      // Mock Date.now to return a fixed time: 2026-01-10T12:00:00Z
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-01-10T12:00:00Z'))
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should correctly identify expired grace period', () => {
      // Grace period ended yesterday
      const gracePeriodEndsAt = new Date('2026-01-09T00:00:00Z')

      expect(isGracePeriodExpired(gracePeriodEndsAt)).toBe(true)
    })

    it('should correctly identify active grace period', () => {
      // Grace period ends tomorrow
      const gracePeriodEndsAt = new Date('2026-01-11T00:00:00Z')

      expect(isGracePeriodExpired(gracePeriodEndsAt)).toBe(false)
    })

    it('should calculate remaining days correctly', () => {
      // Grace period ends in 5 days
      const gracePeriodEndsAt = new Date('2026-01-15T12:00:00Z')

      expect(getRemainingGracePeriodDays(gracePeriodEndsAt)).toBe(5)
    })

    it('should return 0 for expired grace period', () => {
      // Grace period ended 3 days ago
      const gracePeriodEndsAt = new Date('2026-01-07T00:00:00Z')

      expect(getRemainingGracePeriodDays(gracePeriodEndsAt)).toBe(0)
    })

    it('should round up partial days remaining', () => {
      // Grace period ends in 2.5 days
      const gracePeriodEndsAt = new Date('2026-01-13T00:00:00Z')

      // From 2026-01-10T12:00:00Z to 2026-01-13T00:00:00Z is 2.5 days
      expect(getRemainingGracePeriodDays(gracePeriodEndsAt)).toBe(3)
    })
  })

  describe('Lifecycle State Calculation', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-01-10T12:00:00Z'))
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should return active state for active application', () => {
      const state = calculateLifecycleState('active')

      expect(state).toEqual({
        status: 'active',
        isDecommissioning: false,
        isDeleted: false,
        canCancel: false,
        canForceDelete: true,
      })
    })

    it('should return deleted state for deleted application', () => {
      const state = calculateLifecycleState('deleted')

      expect(state).toEqual({
        status: 'deleted',
        isDecommissioning: false,
        isDeleted: true,
        canCancel: false,
        canForceDelete: false,
      })
    })

    it('should return decommissioning state with active grace period', () => {
      const decommissioningStartedAt = '2026-01-05T00:00:00Z'
      const gracePeriodEndsAt = '2026-01-20T00:00:00Z' // 10 days from now

      const state = calculateLifecycleState(
        'decommissioning',
        decommissioningStartedAt,
        gracePeriodEndsAt
      )

      expect(state.status).toBe('decommissioning')
      expect(state.isDecommissioning).toBe(true)
      expect(state.isDeleted).toBe(false)
      expect(state.canCancel).toBe(true)
      expect(state.canForceDelete).toBe(true)
      expect(state.gracePeriod).toBeDefined()
      expect(state.gracePeriod?.isExpired).toBe(false)
      expect(state.gracePeriod?.remainingDays).toBe(10)
    })

    it('should return grace_period_expired status when grace period has expired', () => {
      const decommissioningStartedAt = '2026-01-01T00:00:00Z'
      const gracePeriodEndsAt = '2026-01-08T00:00:00Z' // 2 days ago

      const state = calculateLifecycleState(
        'decommissioning',
        decommissioningStartedAt,
        gracePeriodEndsAt
      )

      expect(state.status).toBe('grace_period_expired')
      expect(state.isDecommissioning).toBe(true)
      expect(state.canCancel).toBe(false)
      expect(state.gracePeriod?.isExpired).toBe(true)
      expect(state.gracePeriod?.remainingDays).toBe(0)
    })

    it('should handle Date objects as parameters', () => {
      const decommissioningStartedAt = new Date('2026-01-05T00:00:00Z')
      const gracePeriodEndsAt = new Date('2026-01-20T00:00:00Z')

      const state = calculateLifecycleState(
        'decommissioning',
        decommissioningStartedAt,
        gracePeriodEndsAt
      )

      expect(state.gracePeriod?.startedAt.toISOString()).toBe(
        decommissioningStartedAt.toISOString()
      )
      expect(state.gracePeriod?.endsAt.toISOString()).toBe(
        gracePeriodEndsAt.toISOString()
      )
    })

    it('should use current date as startedAt when not provided', () => {
      const gracePeriodEndsAt = '2026-01-20T00:00:00Z'

      const state = calculateLifecycleState(
        'decommissioning',
        null,
        gracePeriodEndsAt
      )

      // startedAt should be the mocked current time
      expect(state.gracePeriod?.startedAt.toISOString()).toBe(
        '2026-01-10T12:00:00.000Z'
      )
    })

    it('should return active state when decommissioning but no grace period end date', () => {
      const state = calculateLifecycleState(
        'decommissioning',
        '2026-01-05T00:00:00Z',
        null
      )

      expect(state.status).toBe('active')
      expect(state.isDecommissioning).toBe(false)
      expect(state.gracePeriod).toBeUndefined()
    })
  })
})
