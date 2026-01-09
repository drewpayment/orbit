import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ArrowDown, ArrowUp, MessageSquare } from 'lucide-react'

interface UsageSummaryCardsProps {
  ingressGB: number
  egressGB: number
  messageCount: number
  ingressCost: number
  egressCost: number
  messageCost: number
  totalCost: number
}

function formatNumber(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`
  }
  return value.toFixed(0)
}

function formatGB(value: number): string {
  if (value >= 1024) {
    return `${(value / 1024).toFixed(1)} TB`
  }
  return `${value.toFixed(1)} GB`
}

function formatCost(value: number): string {
  return `$${value.toFixed(2)}`
}

export function UsageSummaryCards({
  ingressGB,
  egressGB,
  messageCount,
  ingressCost,
  egressCost,
  messageCost,
  totalCost,
}: UsageSummaryCardsProps) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Ingress</CardTitle>
            <ArrowUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatGB(ingressGB)}</div>
            <p className="text-xs text-muted-foreground">{formatCost(ingressCost)}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Egress</CardTitle>
            <ArrowDown className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatGB(egressGB)}</div>
            <p className="text-xs text-muted-foreground">{formatCost(egressCost)}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Messages</CardTitle>
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(messageCount)}</div>
            <p className="text-xs text-muted-foreground">{formatCost(messageCost)}</p>
          </CardContent>
        </Card>
      </div>

      <div className="text-right">
        <span className="text-sm text-muted-foreground">Estimated Total: </span>
        <span className="text-lg font-semibold">{formatCost(totalCost)}</span>
      </div>
    </div>
  )
}
