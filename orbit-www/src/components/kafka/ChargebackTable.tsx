'use client'

import { useState } from 'react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ChevronDown, ChevronUp, Search } from 'lucide-react'
import type { ChargebackLineItem } from '@/lib/billing/types'

interface ChargebackTableProps {
  data: ChargebackLineItem[]
  pageSize?: number
}

type SortField = 'workspaceName' | 'applicationName' | 'ingressGB' | 'egressGB' | 'totalCost'
type SortDirection = 'asc' | 'desc'

function formatGB(value: number): string {
  if (value >= 1024) {
    return `${(value / 1024).toFixed(1)} TB`
  }
  return `${value.toFixed(1)} GB`
}

function formatCost(value: number): string {
  return `$${value.toFixed(2)}`
}

export function ChargebackTable({ data, pageSize = 25 }: ChargebackTableProps) {
  const [search, setSearch] = useState('')
  const [sortField, setSortField] = useState<SortField>('totalCost')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [page, setPage] = useState(0)

  // Filter
  const filtered = data.filter(
    item =>
      item.workspaceName.toLowerCase().includes(search.toLowerCase()) ||
      item.applicationName.toLowerCase().includes(search.toLowerCase())
  )

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    const aVal = a[sortField]
    const bVal = b[sortField]
    const modifier = sortDirection === 'asc' ? 1 : -1

    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return aVal.localeCompare(bVal) * modifier
    }
    return ((aVal as number) - (bVal as number)) * modifier
  })

  // Paginate
  const totalPages = Math.ceil(sorted.length / pageSize)
  const paginated = sorted.slice(page * pageSize, (page + 1) * pageSize)

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDirection('desc')
    }
  }

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null
    return sortDirection === 'asc' ? (
      <ChevronUp className="h-4 w-4 inline ml-1" />
    ) : (
      <ChevronDown className="h-4 w-4 inline ml-1" />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search workspace or application..."
            value={search}
            onChange={e => {
              setSearch(e.target.value)
              setPage(0)
            }}
            className="pl-9"
          />
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead
              className="cursor-pointer"
              onClick={() => handleSort('workspaceName')}
            >
              Workspace
              <SortIcon field="workspaceName" />
            </TableHead>
            <TableHead
              className="cursor-pointer"
              onClick={() => handleSort('applicationName')}
            >
              Application
              <SortIcon field="applicationName" />
            </TableHead>
            <TableHead
              className="text-right cursor-pointer"
              onClick={() => handleSort('ingressGB')}
            >
              Ingress
              <SortIcon field="ingressGB" />
            </TableHead>
            <TableHead
              className="text-right cursor-pointer"
              onClick={() => handleSort('egressGB')}
            >
              Egress
              <SortIcon field="egressGB" />
            </TableHead>
            <TableHead
              className="text-right cursor-pointer"
              onClick={() => handleSort('totalCost')}
            >
              Cost
              <SortIcon field="totalCost" />
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {paginated.map(item => (
            <TableRow key={item.applicationId}>
              <TableCell>{item.workspaceName}</TableCell>
              <TableCell className="font-medium">{item.applicationName}</TableCell>
              <TableCell className="text-right">{formatGB(item.ingressGB)}</TableCell>
              <TableCell className="text-right">{formatGB(item.egressGB)}</TableCell>
              <TableCell className="text-right">{formatCost(item.totalCost)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {page * pageSize + 1}-{Math.min((page + 1) * pageSize, sorted.length)} of{' '}
            {sorted.length}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => p - 1)}
              disabled={page === 0}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => p + 1)}
              disabled={page >= totalPages - 1}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
