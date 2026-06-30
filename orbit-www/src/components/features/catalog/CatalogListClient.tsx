'use client'

import React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { CatalogEntity } from '@/payload-types'
import { EntityList } from './EntityList'
import { ENTITY_KIND_VALUES, KIND_LABELS, type EntityKind } from './catalog-query'

interface CatalogListClientProps {
  entities: CatalogEntity[]
  totalPages: number
  currentPage: number
  /** All + per-kind counts, used to choose which tabs to render and their badges. */
  counts: { all: number; byKind: Record<EntityKind, number> }
  initialQuery?: string
  /** Active kind tab ('all' or a specific kind). */
  activeKind: EntityKind | 'all'
}

export function CatalogListClient({
  entities,
  totalPages,
  currentPage,
  counts,
  initialQuery,
  activeKind,
}: CatalogListClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [query, setQuery] = React.useState(initialQuery ?? '')

  const updateSearchParams = React.useCallback(
    (updates: Record<string, string | undefined>, resetPage = true) => {
      const params = new URLSearchParams(searchParams.toString())
      Object.entries(updates).forEach(([key, value]) => {
        if (value) params.set(key, value)
        else params.delete(key)
      })
      if (resetPage && !('page' in updates)) params.delete('page')
      const qs = params.toString()
      router.push(qs ? `/catalog?${qs}` : '/catalog')
    },
    [router, searchParams],
  )

  const handleSearch = () => updateSearchParams({ q: query.trim() || undefined })
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch()
  }
  const handleClear = () => {
    setQuery('')
    updateSearchParams({ q: undefined })
  }

  const handleTabChange = (value: string) => {
    updateSearchParams({ kind: value === 'all' ? undefined : value })
  }

  // Only surface tabs for kinds that actually have entities (within the current
  // query), but always keep the active kind visible so a deep-link never lands
  // on a missing tab.
  const visibleKinds = ENTITY_KIND_VALUES.filter(
    (k) => counts.byKind[k] > 0 || k === activeKind,
  )

  const activeLabel =
    activeKind === 'all' ? 'entities' : (KIND_LABELS[activeKind] ?? 'entities').toLowerCase()

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search the catalog by name or description..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="pl-9"
          />
        </div>
        <div className="flex gap-2">
          <Button onClick={handleSearch}>Search</Button>
          {initialQuery && (
            <Button variant="ghost" onClick={handleClear}>
              <X className="mr-1 h-4 w-4" />
              Clear
            </Button>
          )}
        </div>
      </div>

      <Tabs value={activeKind} onValueChange={handleTabChange}>
        <TabsList className="flex h-auto flex-wrap justify-start gap-1">
          <TabsTrigger value="all">
            All
            <span className="ml-1.5 text-xs text-muted-foreground">{counts.all}</span>
          </TabsTrigger>
          {visibleKinds.map((kind) => (
            <TabsTrigger key={kind} value={kind}>
              {KIND_LABELS[kind]}
              <span className="ml-1.5 text-xs text-muted-foreground">{counts.byKind[kind]}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <EntityList
        entities={entities}
        emptyTitle={initialQuery ? 'No matching entities' : `No ${activeLabel} yet`}
        emptyHint={
          initialQuery
            ? 'Try a different search term or switch tabs.'
            : 'Entities appear here automatically as services, APIs and topics are registered.'
        }
      />

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button
            variant="outline"
            disabled={currentPage <= 1}
            onClick={() => updateSearchParams({ page: String(currentPage - 1) }, false)}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {currentPage} of {totalPages}
          </span>
          <Button
            variant="outline"
            disabled={currentPage >= totalPages}
            onClick={() => updateSearchParams({ page: String(currentPage + 1) }, false)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  )
}
