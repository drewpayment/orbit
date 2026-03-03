'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MoreHorizontal, Plus, Rocket, Search, XCircle, Trash2 } from 'lucide-react'
import { LaunchStatusBadge } from './LaunchStatusBadge'
import { deorbitLaunchAction, abortLaunchAction } from '@/app/actions/launches'
import { toast } from 'sonner'

// Local type matching Launches collection since payload-types hasn't been regenerated
interface LaunchDoc {
  id: string
  name: string
  provider: 'aws' | 'gcp' | 'azure' | 'digitalocean'
  region: string
  status: string
  template?: { id: string; name?: string; slug?: string } | string
  workspace?: { id: string; name?: string } | string
  cloudAccount?: { id: string; name?: string } | string
  workflowId?: string | null
  updatedAt: string
  createdAt: string
  lastLaunchedAt?: string | null
}

interface LaunchesTableProps {
  launches: LaunchDoc[]
}

type StatusFilter = 'all' | 'active' | 'launching' | 'awaiting_approval' | 'failed' | 'pending' | 'deorbited' | 'deorbiting' | 'aborted'

const providerLabels: Record<string, string> = {
  aws: 'AWS',
  gcp: 'GCP',
  azure: 'Azure',
  digitalocean: 'DigitalOcean',
}

function getTemplateName(template: LaunchDoc['template']): string {
  if (!template) return '-'
  if (typeof template === 'string') return template
  return template.name || template.slug || template.id
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHours = Math.floor(diffMin / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffSec < 60) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

export function LaunchesTable({ launches }: LaunchesTableProps) {
  const router = useRouter()
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const filteredLaunches = launches.filter((launch) => {
    const matchesSearch =
      launch.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      launch.region.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesStatus = statusFilter === 'all' || launch.status === statusFilter
    return matchesSearch && matchesStatus
  })

  async function handleDeorbit(launch: LaunchDoc) {
    if (!launch.workflowId) {
      toast.error('No workflow ID found for this launch')
      return
    }
    const result = await deorbitLaunchAction(launch.workflowId)
    if (result.success) {
      toast.success(`Deorbit initiated for "${launch.name}"`)
      router.refresh()
    } else {
      toast.error(result.error || 'Failed to deorbit launch')
    }
  }

  async function handleAbort(launch: LaunchDoc) {
    if (!launch.workflowId) {
      toast.error('No workflow ID found for this launch')
      return
    }
    const result = await abortLaunchAction(launch.workflowId)
    if (result.success) {
      toast.success(`Abort initiated for "${launch.name}"`)
      router.refresh()
    } else {
      toast.error(result.error || 'Failed to abort launch')
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Launches</h1>
          <p className="text-muted-foreground">
            {launches.length} launch{launches.length !== 1 ? 'es' : ''} across your workspaces
          </p>
        </div>
        <Button asChild>
          <Link href="/launches/new">
            <Rocket className="mr-2 h-4 w-4" />
            New Launch
          </Link>
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search launches..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="launching">Launching</SelectItem>
            <SelectItem value="awaiting_approval">Awaiting Approval</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="deorbiting">Deorbiting</SelectItem>
            <SelectItem value="deorbited">Deorbited</SelectItem>
            <SelectItem value="aborted">Aborted</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      {filteredLaunches.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-muted-foreground">
            {launches.length === 0
              ? 'No launches yet. Deploy your first infrastructure from a template.'
              : 'No launches match your filters.'}
          </p>
          {launches.length === 0 && (
            <div className="flex gap-4 justify-center mt-4">
              <Button asChild>
                <Link href="/launches/new">
                  <Rocket className="mr-2 h-4 w-4" />
                  New Launch
                </Link>
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[250px]">Name</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Template</TableHead>
                <TableHead>Region</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Activity</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredLaunches.map((launch) => (
                <TableRow key={launch.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/launches/${launch.id}`}
                      className="hover:underline"
                    >
                      {launch.name}
                    </Link>
                  </TableCell>
                  <TableCell>{providerLabels[launch.provider] ?? launch.provider}</TableCell>
                  <TableCell>{getTemplateName(launch.template)}</TableCell>
                  <TableCell className="font-mono text-sm">{launch.region}</TableCell>
                  <TableCell>
                    <LaunchStatusBadge status={launch.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatRelativeTime(launch.updatedAt)}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="h-4 w-4" />
                          <span className="sr-only">Open menu</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <Link href={`/launches/${launch.id}`}>
                            View Details
                          </Link>
                        </DropdownMenuItem>
                        {launch.status === 'active' && (
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => handleDeorbit(launch)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Deorbit
                          </DropdownMenuItem>
                        )}
                        {(launch.status === 'launching' || launch.status === 'awaiting_approval') && (
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => handleAbort(launch)}
                          >
                            <XCircle className="mr-2 h-4 w-4" />
                            Abort
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
