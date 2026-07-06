'use client'

import React from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Plus, Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { CatalogEntityWithAccess } from '@/app/(frontend)/catalog/actions'
import { EntityList } from './EntityList'
import { ENTITY_KIND_VALUES, KIND_LABELS, type EntityKind } from './catalog-query'

interface CatalogListClientProps {
  entities: CatalogEntityWithAccess[]
  totalPages: number
  currentPage: number
  /** All + per-kind counts, used to choose which tabs to render and their badges. */
  counts: { all: number; byKind: Record<EntityKind, number> }
  initialQuery?: string
  /** Active kind tab ('all' or a specific kind). */
  activeKind: EntityKind | 'all'
  /** Read scope: org-wide ('all') or the caller's workspaces ('mine'). */
  scope: 'all' | 'mine'
  /** Whether the caller can create an entity somewhere — gates the New button. */
  canCreate: boolean
  /** Active workspace filter (from ?workspace=), or undefined. Drives the filter chip. */
  workspaceFilter?: { id: string; name: string }
}

export function CatalogListClient({
  entities,
  totalPages,
  currentPage,
  counts,
  initialQuery,
  activeKind,
  scope,
  canCreate,
  workspaceFilter,
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

  // 'all' is the default, so it clears the param (keeps clean URLs + SSR default).
  const handleScopeChange = (value: string) => {
    updateSearchParams({ scope: value === 'mine' ? 'mine' : undefined })
  }

  // The read action attaches a server-computed `canManage` to each doc; fold
  // those into a Set for the per-card "Managed" badge.
  const canManageIds = React.useMemo(
    () => new Set(entities.filter((e) => e.canManage).map((e) => e.id)),
    [entities],
  )

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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={scope} onValueChange={handleScopeChange}>
          <TabsList>
            <TabsTrigger value="all">All entities</TabsTrigger>
            <TabsTrigger value="mine">My workspaces</TabsTrigger>
          </TabsList>
        </Tabs>
        {canCreate && (
          <Button asChild size="sm">
            <Link href="/catalog/new">
              <Plus className="h-4 w-4" />
              New entity
            </Link>
          </Button>
        )}
      </div>

      {workspaceFilter && (
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border bg-muted/50 px-3 py-1 text-sm">
            <span className="text-muted-foreground">Filtered to</span>
            <span className="font-medium">{workspaceFilter.name}</span>
            <button
              type="button"
              aria-label="Clear workspace filter"
              onClick={() => updateSearchParams({ workspace: undefined })}
              className="ml-0.5 rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        </div>
      )}

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
        canManageIds={canManageIds}
        emptyTitle={initialQuery ? 'No matching entities' : `No ${activeLabel} yet`}
        emptyHint={
          initialQuery
            ? 'Try a different search term or switch tabs.'
            : scope === 'mine'
              ? 'No entities in your workspaces yet. Create one, or switch to All entities to browse the org.'
              : 'Create your first entity, or connect a source to project services, APIs and topics automatically.'
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
