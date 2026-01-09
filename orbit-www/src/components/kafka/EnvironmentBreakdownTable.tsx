import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

interface EnvironmentBreakdown {
  environment: string
  ingressGB: number
  egressGB: number
  messageCount: number
  cost: number
}

interface EnvironmentBreakdownTableProps {
  data: EnvironmentBreakdown[]
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
  return `${value.toFixed(1)} GB`
}

function formatCost(value: number): string {
  return `$${value.toFixed(2)}`
}

export function EnvironmentBreakdownTable({ data }: EnvironmentBreakdownTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Environment</TableHead>
          <TableHead className="text-right">Ingress</TableHead>
          <TableHead className="text-right">Egress</TableHead>
          <TableHead className="text-right">Messages</TableHead>
          <TableHead className="text-right">Cost</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map(row => (
          <TableRow key={row.environment}>
            <TableCell className="font-medium">{row.environment}</TableCell>
            <TableCell className="text-right">{formatGB(row.ingressGB)}</TableCell>
            <TableCell className="text-right">{formatGB(row.egressGB)}</TableCell>
            <TableCell className="text-right">{formatNumber(row.messageCount)}</TableCell>
            <TableCell className="text-right">{formatCost(row.cost)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
