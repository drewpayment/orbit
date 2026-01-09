import type {
  ChargebackLineItem,
  ChargebackRates,
  ChargebackSummary,
} from './types'
import { BYTES_PER_GB } from './types'

interface AggregatedMetric {
  applicationId: string
  applicationName: string
  workspaceId: string
  workspaceName: string
  bytesIn: number
  bytesOut: number
  messagesIn: number
  messagesOut: number
}

/**
 * Pure function to calculate chargeback from pre-aggregated metrics.
 *
 * This function aggregates metrics by application, calculates costs based on
 * the provided rates, and returns a summary with line items sorted by total
 * cost in descending order.
 */
export function calculateChargebackFromMetrics(
  metrics: AggregatedMetric[],
  rates: ChargebackRates
): Omit<ChargebackSummary, 'periodStart' | 'periodEnd' | 'rates'> {
  // Aggregate by application
  const byApp = new Map<string, AggregatedMetric>()

  for (const metric of metrics) {
    const key = metric.applicationId
    const existing = byApp.get(key)

    if (existing) {
      existing.bytesIn += metric.bytesIn
      existing.bytesOut += metric.bytesOut
      existing.messagesIn += metric.messagesIn
      existing.messagesOut += metric.messagesOut
    } else {
      byApp.set(key, { ...metric })
    }
  }

  // Calculate costs
  const lineItems: ChargebackLineItem[] = []
  let totalIngressGB = 0
  let totalEgressGB = 0
  let totalMessages = 0
  let totalCost = 0

  for (const agg of byApp.values()) {
    const ingressGB = agg.bytesIn / BYTES_PER_GB
    const egressGB = agg.bytesOut / BYTES_PER_GB
    const messageCount = agg.messagesIn + agg.messagesOut

    const ingressCost = ingressGB * rates.costPerGBIn
    const egressCost = egressGB * rates.costPerGBOut
    const messageCost = (messageCount / 1_000_000) * rates.costPerMillionMessages
    const itemTotal = ingressCost + egressCost + messageCost

    lineItems.push({
      workspaceId: agg.workspaceId,
      workspaceName: agg.workspaceName,
      applicationId: agg.applicationId,
      applicationName: agg.applicationName,
      ingressGB,
      egressGB,
      messageCount,
      ingressCost,
      egressCost,
      messageCost,
      totalCost: itemTotal,
    })

    totalIngressGB += ingressGB
    totalEgressGB += egressGB
    totalMessages += messageCount
    totalCost += itemTotal
  }

  // Sort by total cost descending
  lineItems.sort((a, b) => b.totalCost - a.totalCost)

  return {
    lineItems,
    totalIngressGB,
    totalEgressGB,
    totalMessages,
    totalCost,
  }
}
