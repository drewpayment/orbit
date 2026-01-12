/**
 * Application lifecycle management utilities for Bifrost Kafka Gateway.
 *
 * Provides functions for managing application decommissioning grace periods
 * and lifecycle status calculations.
 */

/** Milliseconds per day constant */
const MS_PER_DAY = 1000 * 60 * 60 * 24

/**
 * Default grace period in days per environment.
 * Production environments have longer grace periods to allow for
 * thorough migration and verification.
 */
const DEFAULT_GRACE_PERIODS: Record<string, number> = {
  dev: 7,
  stage: 14,
  prod: 30,
}

/**
 * Get the default grace period for an environment.
 *
 * @param environment - The environment name (dev, stage, prod)
 * @returns The default grace period in days (defaults to 30 for unknown environments)
 */
export function getDefaultGracePeriodDays(environment: string): number {
  return DEFAULT_GRACE_PERIODS[environment] ?? 30
}

/**
 * Calculate grace period end date.
 *
 * Uses the maximum grace period across all environments unless override is specified.
 * This ensures adequate time for cleanup across all environments.
 *
 * @param startDate - The date when decommissioning started
 * @param environments - Array of environment names the application uses
 * @param overrideDays - Optional override for the grace period in days
 * @returns The calculated grace period end date
 */
export function calculateGracePeriodEnd(
  startDate: Date,
  environments: string[],
  overrideDays?: number
): Date {
  let gracePeriodDays: number

  if (overrideDays !== undefined && overrideDays > 0) {
    gracePeriodDays = overrideDays
  } else {
    const maxGracePeriod = environments.length > 0
      ? Math.max(...environments.map((env) => getDefaultGracePeriodDays(env)))
      : DEFAULT_GRACE_PERIODS.prod // Fallback to prod default (30 days)
    gracePeriodDays = maxGracePeriod
  }

  const endDate = new Date(startDate)
  endDate.setDate(endDate.getDate() + gracePeriodDays)
  return endDate
}

/**
 * Check if grace period has expired.
 *
 * @param gracePeriodEndsAt - The date when the grace period ends
 * @returns True if the grace period has expired
 */
export function isGracePeriodExpired(gracePeriodEndsAt: Date): boolean {
  return new Date() >= gracePeriodEndsAt
}

/**
 * Get remaining grace period in days.
 *
 * @param gracePeriodEndsAt - The date when the grace period ends
 * @returns The number of days remaining (0 if expired)
 */
export function getRemainingGracePeriodDays(gracePeriodEndsAt: Date): number {
  const now = new Date()
  const diffMs = gracePeriodEndsAt.getTime() - now.getTime()
  return Math.max(0, Math.ceil(diffMs / MS_PER_DAY))
}

/**
 * Lifecycle status for an application.
 */
export type ApplicationLifecycleStatus =
  | 'active'
  | 'decommissioning'
  | 'grace_period_expired'
  | 'deleted'

/**
 * Detailed lifecycle state information.
 */
export interface LifecycleState {
  status: ApplicationLifecycleStatus
  isDecommissioning: boolean
  isDeleted: boolean
  canCancel: boolean
  canForceDelete: boolean
  gracePeriod?: {
    startedAt: Date
    endsAt: Date
    remainingDays: number
    isExpired: boolean
  }
}

/**
 * Calculate detailed lifecycle state from application data.
 *
 * @param status - The current application status
 * @param decommissioningStartedAt - When decommissioning started (if applicable)
 * @param gracePeriodEndsAt - When the grace period ends (if applicable)
 * @returns Detailed lifecycle state information
 */
export function calculateLifecycleState(
  status: string,
  decommissioningStartedAt?: string | Date | null,
  gracePeriodEndsAt?: string | Date | null
): LifecycleState {
  const isDecommissioning = status === 'decommissioning'
  const isDeleted = status === 'deleted'

  if (isDeleted) {
    return {
      status: 'deleted',
      isDecommissioning: false,
      isDeleted: true,
      canCancel: false,
      canForceDelete: false,
    }
  }

  if (isDecommissioning && gracePeriodEndsAt) {
    const endsAt = new Date(gracePeriodEndsAt)
    const startedAt = decommissioningStartedAt
      ? new Date(decommissioningStartedAt)
      : new Date()
    const isExpired = isGracePeriodExpired(endsAt)
    const remainingDays = getRemainingGracePeriodDays(endsAt)

    return {
      status: isExpired ? 'grace_period_expired' : 'decommissioning',
      isDecommissioning: true,
      isDeleted: false,
      canCancel: !isExpired,
      canForceDelete: true,
      gracePeriod: {
        startedAt,
        endsAt,
        remainingDays,
        isExpired,
      },
    }
  }

  return {
    status: 'active',
    isDecommissioning: false,
    isDeleted: false,
    canCancel: false,
    canForceDelete: true,
  }
}
