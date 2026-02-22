'use client'

import React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { APICard } from '@/components/features/api-catalog/APICard'
import { Search, X, FileCode } from 'lucide-react'
import type { APISchema } from '@/types/api-catalog'

interface Workspace {
  id: string
  name: string
  slug: string
}

interface APICatalogClientProps {
  initialApis: APISchema[]
  totalPages: number
  currentPage: number
  workspaces: Workspace[]
  allTags: string[]
  initialQuery?: string
  initialStatus?: string
  initialWorkspace?: string
  initialTags?: string[]
}

export function APICatalogClient({
  initialApis,
  totalPages,
  currentPage,
  workspaces,
  allTags,
  initialQuery,
  initialStatus,
  initialWorkspace,
  initialTags,
}: APICatalogClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [query, setQuery] = React.useState(initialQuery || '')
  const [status, setStatus] = React.useState(initialStatus || '')
  const [workspace, setWorkspace] = React.useState(initialWorkspace || '')
  const [selectedTags, setSelectedTags] = React.useState<string[]>(initialTags || [])

  const updateSearchParams = React.useCallback(
    (updates: Record<string, string | undefined>) => {
      const params = new URLSearchParams(searchParams.toString())

      Object.entries(updates).forEach(([key, value]) => {
        if (value) {
          params.set(key, value)
        } else {
          params.delete(key)
        }
      })

      // Reset to page 1 when filters change
      if (!updates.page) {
        params.delete('page')
      }

      router.push(`/catalog/apis?${params.toString()}`)
    },
    [router, searchParams]
  )

  const handleSearch = () => {
    updateSearchParams({
      q: query || undefined,
      status: status || undefined,
      workspace: workspace || undefined,
      tags: selectedTags.length > 0 ? selectedTags.join(',') : undefined,
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch()
    }
  }

  const handleClearFilters = () => {
    setQuery('')
    setStatus('')
    setWorkspace('')
    setSelectedTags([])
    router.push('/catalog/apis')
  }

  const toggleTag = (tag: string) => {
    const newTags = selectedTags.includes(tag)
      ? selectedTags.filter((t) => t !== tag)
      : [...selectedTags, tag]
    setSelectedTags(newTags)
    updateSearchParams({
      q: query || undefined,
      status: status || undefined,
      workspace: workspace || undefined,
      tags: newTags.length > 0 ? newTags.join(',') : undefined,
    })
  }

  const hasFilters = query || status || workspace || selectedTags.length > 0

  return (
    <div className="space-y-6">
      {/* Search and filters */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
        <div className="flex-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search APIs by name or description..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              className="pl-9"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Select value={status} onValueChange={(v) => {
            setStatus(v)
            updateSearchParams({
              q: query || undefined,
              status: v || undefined,
              workspace: workspace || undefined,
              tags: selectedTags.length > 0 ? selectedTags.join(',') : undefined,
            })
          }}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="published">Published</SelectItem>
              <SelectItem value="deprecated">Deprecated</SelectItem>
            </SelectContent>
          </Select>

          <Select value={workspace} onValueChange={(v) => {
            setWorkspace(v)
            updateSearchParams({
              q: query || undefined,
              status: status || undefined,
              workspace: v || undefined,
              tags: selectedTags.length > 0 ? selectedTags.join(',') : undefined,
            })
          }}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Workspace" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Workspaces</SelectItem>
              {workspaces.map((ws) => (
                <SelectItem key={ws.id} value={ws.id}>
                  {ws.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button onClick={handleSearch}>Search</Button>

          {hasFilters && (
            <Button variant="ghost" onClick={handleClearFilters}>
              <X className="h-4 w-4 mr-1" />
              Clear
            </Button>
          )}
        </div>
      </div>

      {/* Tags filter */}
      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <span className="text-sm text-muted-foreground py-1">Tags:</span>
          {allTags.slice(0, 10).map((tag) => (
            <Badge
              key={tag}
              variant={selectedTags.includes(tag) ? 'default' : 'outline'}
              className="cursor-pointer"
              onClick={() => toggleTag(tag)}
            >
              {tag}
            </Badge>
          ))}
          {allTags.length > 10 && (
            <span className="text-sm text-muted-foreground py-1">
              +{allTags.length - 10} more
            </span>
          )}
        </div>
      )}

      {/* Results */}
      {initialApis.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <FileCode className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold">No APIs found</h3>
          <p className="text-muted-foreground mt-1">
            {hasFilters
              ? 'Try adjusting your filters or search query'
              : 'Be the first to add an API to the catalog'}
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {initialApis.map((api) => (
              <APICard
                key={api.id}
                id={api.id}
                name={api.name}
                description={api.description ?? undefined}
                version={api.currentVersion ?? undefined}
                status={api.status}
                visibility={api.visibility}
                workspaceName={
                  typeof api.workspace === 'object' ? api.workspace.name ?? undefined : undefined
                }
                endpointCount={api.endpointCount ?? undefined}
                tags={api.tags?.map(t => ({ tag: t.tag })) ?? undefined}
                updatedAt={api.updatedAt}
              />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-4">
              <Button
                variant="outline"
                disabled={currentPage <= 1}
                onClick={() =>
                  updateSearchParams({ page: String(currentPage - 1) })
                }
              >
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                variant="outline"
                disabled={currentPage >= totalPages}
                onClick={() =>
                  updateSearchParams({ page: String(currentPage + 1) })
                }
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
