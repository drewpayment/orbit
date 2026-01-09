'use client'

import { useState } from 'react'
import { startOfMonth, endOfMonth } from 'date-fns'
import { Download, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { UsageSummaryCards } from '@/components/kafka/UsageSummaryCards'
import { MonthPicker } from '@/components/kafka/MonthPicker'
import { ChargebackTable } from '@/components/kafka/ChargebackTable'
import { exportPlatformChargebackCSV } from './actions'
import type { ChargebackLineItem } from '@/lib/billing/types'

// Mock data for MVP demonstration
const mockLineItems: ChargebackLineItem[] = [
  {
    workspaceId: 'ws-1',
    workspaceName: 'Team Alpha',
    applicationId: 'app-1',
    applicationName: 'order-service',
    ingressGB: 150.5,
    egressGB: 45.2,
    messageCount: 12500000,
    ingressCost: 15.05,
    egressCost: 2.26,
    messageCost: 0.13,
    totalCost: 17.44,
  },
  {
    workspaceId: 'ws-2',
    workspaceName: 'Team Beta',
    applicationId: 'app-2',
    applicationName: 'analytics-pipeline',
    ingressGB: 520.8,
    egressGB: 1250.3,
    messageCount: 85000000,
    ingressCost: 52.08,
    egressCost: 62.52,
    messageCost: 0.85,
    totalCost: 115.45,
  },
]

export function PlatformBillingClient() {
  const [selectedMonth, setSelectedMonth] = useState(new Date())
  const [isExporting, setIsExporting] = useState(false)

  // Calculate totals from mock data
  const totalIngressGB = mockLineItems.reduce((sum, item) => sum + item.ingressGB, 0)
  const totalEgressGB = mockLineItems.reduce((sum, item) => sum + item.egressGB, 0)
  const totalMessages = mockLineItems.reduce((sum, item) => sum + item.messageCount, 0)
  const totalIngressCost = mockLineItems.reduce((sum, item) => sum + item.ingressCost, 0)
  const totalEgressCost = mockLineItems.reduce((sum, item) => sum + item.egressCost, 0)
  const totalMessageCost = mockLineItems.reduce((sum, item) => sum + item.messageCost, 0)
  const totalCost = mockLineItems.reduce((sum, item) => sum + item.totalCost, 0)

  const handleMonthChange = (start: Date, _end: Date) => {
    setSelectedMonth(start)
    // In production, would refetch data for new period
  }

  const handleExport = async () => {
    setIsExporting(true)
    try {
      const periodStart = startOfMonth(selectedMonth)
      const periodEnd = endOfMonth(selectedMonth)
      const { filename, content } = await exportPlatformChargebackCSV(periodStart, periodEnd)

      // Trigger download
      const blob = new Blob([content], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Platform Kafka Billing</h1>
          <p className="text-muted-foreground">Usage and chargeback across all workspaces</p>
        </div>
        <div className="flex items-center gap-4">
          <MonthPicker value={selectedMonth} onChange={handleMonthChange} />
          <Button onClick={handleExport} disabled={isExporting}>
            {isExporting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            Export CSV
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Summary</CardTitle>
          <CardDescription>Platform-wide usage for the selected period</CardDescription>
        </CardHeader>
        <CardContent>
          <UsageSummaryCards
            ingressGB={totalIngressGB}
            egressGB={totalEgressGB}
            messageCount={totalMessages}
            ingressCost={totalIngressCost}
            egressCost={totalEgressCost}
            messageCost={totalMessageCost}
            totalCost={totalCost}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>By Application</CardTitle>
          <CardDescription>
            {mockLineItems.length} application{mockLineItems.length !== 1 ? 's' : ''} with usage
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChargebackTable data={mockLineItems} />
        </CardContent>
      </Card>
    </div>
  )
}
