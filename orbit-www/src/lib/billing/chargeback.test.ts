import { describe, it, expect } from 'vitest'
import { calculateChargebackFromMetrics } from './chargeback'
import { BYTES_PER_GB } from './types'

describe('calculateChargebackFromMetrics', () => {
  const mockRates = {
    costPerGBIn: 0.10,
    costPerGBOut: 0.05,
    costPerMillionMessages: 0.01,
    effectiveDate: new Date('2026-01-01'),
  }

  it('calculates costs correctly for a single application', () => {
    const metrics = [
      {
        applicationId: 'app-1',
        applicationName: 'test-app',
        workspaceId: 'ws-1',
        workspaceName: 'test-workspace',
        bytesIn: BYTES_PER_GB * 10, // 10 GB
        bytesOut: BYTES_PER_GB * 5,  // 5 GB
        messagesIn: 1_000_000,
        messagesOut: 500_000,
      },
    ]

    const result = calculateChargebackFromMetrics(metrics, mockRates)

    expect(result.lineItems).toHaveLength(1)
    expect(result.lineItems[0].ingressGB).toBeCloseTo(10)
    expect(result.lineItems[0].egressGB).toBeCloseTo(5)
    expect(result.lineItems[0].ingressCost).toBeCloseTo(1.0)  // 10 * 0.10
    expect(result.lineItems[0].egressCost).toBeCloseTo(0.25) // 5 * 0.05
    expect(result.lineItems[0].messageCost).toBeCloseTo(0.015) // 1.5M * 0.01
    expect(result.totalCost).toBeCloseTo(1.265)
  })

  it('aggregates metrics across multiple records for same application', () => {
    const metrics = [
      {
        applicationId: 'app-1',
        applicationName: 'test-app',
        workspaceId: 'ws-1',
        workspaceName: 'test-workspace',
        bytesIn: BYTES_PER_GB,
        bytesOut: 0,
        messagesIn: 100,
        messagesOut: 0,
      },
      {
        applicationId: 'app-1',
        applicationName: 'test-app',
        workspaceId: 'ws-1',
        workspaceName: 'test-workspace',
        bytesIn: BYTES_PER_GB,
        bytesOut: 0,
        messagesIn: 100,
        messagesOut: 0,
      },
    ]

    const result = calculateChargebackFromMetrics(metrics, mockRates)

    expect(result.lineItems).toHaveLength(1)
    expect(result.lineItems[0].ingressGB).toBeCloseTo(2)
    expect(result.totalIngressGB).toBeCloseTo(2)
  })

  it('returns empty result for no metrics', () => {
    const result = calculateChargebackFromMetrics([], mockRates)

    expect(result.lineItems).toHaveLength(0)
    expect(result.totalCost).toBe(0)
  })

  it('sorts line items by total cost descending', () => {
    const metrics = [
      {
        applicationId: 'app-1',
        applicationName: 'small-app',
        workspaceId: 'ws-1',
        workspaceName: 'workspace',
        bytesIn: BYTES_PER_GB,
        bytesOut: 0,
        messagesIn: 0,
        messagesOut: 0,
      },
      {
        applicationId: 'app-2',
        applicationName: 'large-app',
        workspaceId: 'ws-1',
        workspaceName: 'workspace',
        bytesIn: BYTES_PER_GB * 100,
        bytesOut: 0,
        messagesIn: 0,
        messagesOut: 0,
      },
    ]

    const result = calculateChargebackFromMetrics(metrics, mockRates)

    expect(result.lineItems[0].applicationName).toBe('large-app')
    expect(result.lineItems[1].applicationName).toBe('small-app')
  })
})
