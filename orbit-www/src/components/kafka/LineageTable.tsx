'use client'

import { useState, useMemo } from 'react'
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
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ChevronDown,
  ChevronUp,
  Search,
  ArrowUpRight,
  ArrowDownLeft,
  ExternalLink,
  Clock,
} from 'lucide-react'
import type { KafkaLineageEdge } from '@/payload-types'

interface LineageTableProps {
  edges: KafkaLineageEdge[]
  viewType: 'topic' | 'application'
  pageSize?: number
  onEdgeClick?: (edge: KafkaLineageEdge) => void
}

type SortField =
  | 'name'
  | 'direction'
  | 'bytesLast24h'
  | 'messagesLast24h'
  | 'bytesAllTime'
  | 'lastSeen'
type SortDirection = 'asc' | 'desc'
type FilterDirection = 'all' | 'produce' | 'consume'

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function formatNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`
  return num.toString()
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

function getEntityName(edge: KafkaLineageEdge, viewType: 'topic' | 'application'): string {
  if (viewType === 'topic') {
    // When viewing a topic, show the application/service account name
    const app =
      typeof edge.sourceApplication === 'object' ? edge.sourceApplication : null
    const sa =
      typeof edge.sourceServiceAccount === 'object' ? edge.sourceServiceAccount : null
    return app?.name || sa?.name || 'Unknown'
  } else {
    // When viewing an application, show the topic name
    const topic = typeof edge.topic === 'object' ? edge.topic : null
    return topic?.name || 'Unknown Topic'
  }
}

function getWorkspaceName(edge: KafkaLineageEdge, viewType: 'topic' | 'application'): string | null {
  if (viewType === 'topic') {
    const workspace =
      typeof edge.sourceWorkspace === 'object' ? edge.sourceWorkspace : null
    return workspace?.name || null
  } else {
    const workspace =
      typeof edge.targetWorkspace === 'object' ? edge.targetWorkspace : null
    return workspace?.name || null
  }
}

export function LineageTable({
  edges,
  viewType,
  pageSize = 10,
  onEdgeClick,
}: LineageTableProps) {
  const [search, setSearch] = useState('')
  const [sortField, setSortField] = useState<SortField>('bytesLast24h')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [filterDirection, setFilterDirection] = useState<FilterDirection>('all')
  const [page, setPage] = useState(0)

  const processedEdges = useMemo(() => {
    // Filter by direction
    let filtered = edges.filter(edge => {
      if (filterDirection === 'all') return true
      return edge.direction === filterDirection
    })

    // Filter by search
    if (search) {
      const searchLower = search.toLowerCase()
      filtered = filtered.filter(edge => {
        const name = getEntityName(edge, viewType).toLowerCase()
        const workspace = getWorkspaceName(edge, viewType)?.toLowerCase() || ''
        return name.includes(searchLower) || workspace.includes(searchLower)
      })
    }

    // Sort
    const sorted = [...filtered].sort((a, b) => {
      const modifier = sortDirection === 'asc' ? 1 : -1

      switch (sortField) {
        case 'name':
          return getEntityName(a, viewType).localeCompare(getEntityName(b, viewType)) * modifier
        case 'direction':
          return a.direction.localeCompare(b.direction) * modifier
        case 'bytesLast24h':
          return ((a.bytesLast24h || 0) - (b.bytesLast24h || 0)) * modifier
        case 'messagesLast24h':
          return ((a.messagesLast24h || 0) - (b.messagesLast24h || 0)) * modifier
        case 'bytesAllTime':
          return ((a.bytesAllTime || 0) - (b.bytesAllTime || 0)) * modifier
        case 'lastSeen':
          return (
            (new Date(a.lastSeen || 0).getTime() - new Date(b.lastSeen || 0).getTime()) *
            modifier
          )
        default:
          return 0
      }
    })

    return sorted
  }, [edges, search, sortField, sortDirection, filterDirection, viewType])

  const totalPages = Math.ceil(processedEdges.length / pageSize)
  const paginatedEdges = processedEdges.slice(page * pageSize, (page + 1) * pageSize)

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
            placeholder={`Search ${viewType === 'topic' ? 'applications' : 'topics'}...`}
            value={search}
            onChange={e => {
              setSearch(e.target.value)
              setPage(0)
            }}
            className="pl-9"
          />
        </div>
        <Select
          value={filterDirection}
          onValueChange={(value: FilterDirection) => {
            setFilterDirection(value)
            setPage(0)
          }}
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Direction" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Directions</SelectItem>
            <SelectItem value="produce">Producers</SelectItem>
            <SelectItem value="consume">Consumers</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => handleSort('name')}
              >
                {viewType === 'topic' ? 'Application / Service Account' : 'Topic'}
                <SortIcon field="name" />
              </TableHead>
              <TableHead
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => handleSort('direction')}
              >
                Direction
                <SortIcon field="direction" />
              </TableHead>
              <TableHead
                className="cursor-pointer hover:bg-muted/50 text-right"
                onClick={() => handleSort('bytesLast24h')}
              >
                24h Volume
                <SortIcon field="bytesLast24h" />
              </TableHead>
              <TableHead
                className="cursor-pointer hover:bg-muted/50 text-right"
                onClick={() => handleSort('messagesLast24h')}
              >
                24h Messages
                <SortIcon field="messagesLast24h" />
              </TableHead>
              <TableHead
                className="cursor-pointer hover:bg-muted/50 text-right"
                onClick={() => handleSort('bytesAllTime')}
              >
                All Time
                <SortIcon field="bytesAllTime" />
              </TableHead>
              <TableHead
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => handleSort('lastSeen')}
              >
                Last Active
                <SortIcon field="lastSeen" />
              </TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedEdges.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                  No lineage data found
                </TableCell>
              </TableRow>
            ) : (
              paginatedEdges.map(edge => (
                <TableRow
                  key={edge.id}
                  className={onEdgeClick ? 'cursor-pointer hover:bg-muted/50' : ''}
                  onClick={() => onEdgeClick?.(edge)}
                >
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">{getEntityName(edge, viewType)}</span>
                      {getWorkspaceName(edge, viewType) && (
                        <span className="text-xs text-muted-foreground">
                          {getWorkspaceName(edge, viewType)}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={edge.direction === 'produce' ? 'default' : 'secondary'}
                      className="flex items-center gap-1 w-fit"
                    >
                      {edge.direction === 'produce' ? (
                        <ArrowUpRight className="h-3 w-3" />
                      ) : (
                        <ArrowDownLeft className="h-3 w-3" />
                      )}
                      {edge.direction === 'produce' ? 'Producer' : 'Consumer'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatBytes(edge.bytesLast24h || 0)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatNumber(edge.messagesLast24h || 0)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatBytes(edge.bytesAllTime || 0)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {edge.lastSeen ? formatRelativeTime(edge.lastSeen) : 'Never'}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Badge variant={edge.isActive ? 'default' : 'outline'}>
                        {edge.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                      {edge.isCrossWorkspace && (
                        <Badge variant="outline" className="text-xs">
                          <ExternalLink className="h-3 w-3 mr-1" />
                          Cross-WS
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            Showing {page * pageSize + 1}-{Math.min((page + 1) * pageSize, processedEdges.length)}{' '}
            of {processedEdges.length}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
            >
              Previous
            </Button>
            <div className="text-sm">
              Page {page + 1} of {totalPages}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
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
