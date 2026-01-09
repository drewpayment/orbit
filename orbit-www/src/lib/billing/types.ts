export interface ChargebackInput {
  workspaceId?: string
  applicationId?: string
  periodStart: Date
  periodEnd: Date
}

export interface ChargebackLineItem {
  workspaceId: string
  workspaceName: string
  applicationId: string
  applicationName: string
  ingressGB: number
  egressGB: number
  messageCount: number
  ingressCost: number
  egressCost: number
  messageCost: number
  totalCost: number
}

export interface ChargebackRates {
  costPerGBIn: number
  costPerGBOut: number
  costPerMillionMessages: number
  effectiveDate: Date
}

export interface ChargebackSummary {
  periodStart: Date
  periodEnd: Date
  rates: ChargebackRates
  lineItems: ChargebackLineItem[]
  totalIngressGB: number
  totalEgressGB: number
  totalMessages: number
  totalCost: number
}

export const BYTES_PER_GB = 1024 * 1024 * 1024
