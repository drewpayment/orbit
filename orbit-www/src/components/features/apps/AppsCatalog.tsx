'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { LayoutGrid, Network, Plus, Search } from 'lucide-react'
import { AppCard } from './AppCard'
import type { App } from '@/payload-types'

interface AppsCatalogProps {
  apps: App[]
}

type ViewMode = 'grid' | 'graph'
type StatusFilter = 'all' | 'healthy' | 'degraded' | 'down' | 'unknown'

export function AppsCatalog({ apps }: AppsCatalogProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const filteredApps = apps.filter((app) => {
    const matchesSearch = app.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      app.description?.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesStatus = statusFilter === 'all' || app.status === statusFilter
    return matchesSearch && matchesStatus
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Applications</h1>
          <p className="text-muted-foreground">
            {apps.length} application{apps.length !== 1 ? 's' : ''} in your catalog
          </p>
        </div>
        <Button asChild>
          <Link href="/apps/new">
            <Plus className="mr-2 h-4 w-4" />
            New App
          </Link>
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search applications..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="healthy">Healthy</SelectItem>
            <SelectItem value="degraded">Degraded</SelectItem>
            <SelectItem value="down">Down</SelectItem>
            <SelectItem value="unknown">Unknown</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex border rounded-md">
          <Button
            variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
            size="icon"
            onClick={() => setViewMode('grid')}
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === 'graph' ? 'secondary' : 'ghost'}
            size="icon"
            onClick={() => setViewMode('graph')}
            disabled // Graph view in Phase 3
          >
            <Network className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Content */}
      {filteredApps.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-muted-foreground">
            {apps.length === 0
              ? 'No applications yet. Create one from a template or import an existing repository.'
              : 'No applications match your filters.'}
          </p>
          {apps.length === 0 && (
            <div className="flex gap-4 justify-center mt-4">
              <Button asChild variant="outline">
                <Link href="/templates">Browse Templates</Link>
              </Button>
              <Button asChild>
                <Link href="/apps/import">Import Repository</Link>
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredApps.map((app) => (
            <AppCard key={app.id} app={app} />
          ))}
        </div>
      )}
    </div>
  )
}
