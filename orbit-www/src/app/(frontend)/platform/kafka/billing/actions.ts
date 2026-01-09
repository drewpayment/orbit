'use server'

import { format } from 'date-fns'

export async function exportPlatformChargebackCSV(
  periodStart: Date,
  periodEnd: Date
): Promise<{ filename: string; content: string }> {
  // For now, return mock data until calculateChargeback is fully integrated with Payload
  const headers = [
    'Workspace',
    'Application',
    'Ingress (GB)',
    'Egress (GB)',
    'Messages',
    'Ingress Cost',
    'Egress Cost',
    'Message Cost',
    'Total Cost',
  ]

  // Placeholder - will be replaced with actual calculateChargeback call
  const rows: string[][] = []

  rows.push([
    'TOTAL',
    '',
    '0.00',
    '0.00',
    '0',
    '$0.00',
    '$0.00',
    '$0.00',
    '$0.00',
  ])

  const csv = [headers, ...rows]
    .map(row => row.map(cell => `"${cell}"`).join(','))
    .join('\n')

  const startStr = format(periodStart, 'yyyy-MM-dd')
  const endStr = format(periodEnd, 'yyyy-MM-dd')
  const filename = `kafka-chargeback-platform-${startStr}-to-${endStr}.csv`

  return { filename, content: csv }
}
