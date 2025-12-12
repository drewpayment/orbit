'use client'

import { useState, useEffect, useMemo } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { Search, Lock, Globe, Loader2 } from 'lucide-react'
import {
  listInstallationRepositories,
  searchInstallationRepositories,
  type Repository,
} from '@/app/actions/github'

interface RepositoryBrowserProps {
  installationId: string
  onSelect: (repo: Repository) => void
}

export function RepositoryBrowser({ installationId, onSelect }: RepositoryBrowserProps) {
  const [repos, setRepos] = useState<Repository[]>([])
  const [searchResults, setSearchResults] = useState<Repository[] | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [isSearching, setIsSearching] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [page, setPage] = useState(1)
  const [searchQuery, setSearchQuery] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Initial load
  useEffect(() => {
    async function loadRepos() {
      setIsLoading(true)
      setError(null)
      setSearchResults(null)
      setSearchQuery('')
      const result = await listInstallationRepositories(installationId)
      if (result.success) {
        setRepos(result.repos)
        setHasMore(result.hasMore)
      } else {
        setError(result.error || 'Failed to load repositories')
      }
      setIsLoading(false)
    }
    loadRepos()
  }, [installationId])

  // Load more
  const handleLoadMore = async () => {
    setIsLoadingMore(true)
    const nextPage = page + 1
    const result = await listInstallationRepositories(installationId, nextPage)
    if (result.success) {
      setRepos((prev) => [...prev, ...result.repos])
      setHasMore(result.hasMore)
      setPage(nextPage)
    }
    setIsLoadingMore(false)
  }

  // Search all repositories
  const handleSearchAll = async () => {
    if (searchQuery.length < 3) return
    setIsSearching(true)
    const result = await searchInstallationRepositories(installationId, searchQuery)
    if (result.success) {
      setSearchResults(result.repos)
    }
    setIsSearching(false)
  }

  // Client-side filter
  const filteredRepos = useMemo(() => {
    // If we have search results from API, use those
    if (searchResults !== null) {
      return searchResults
    }
    // Otherwise filter locally
    if (!searchQuery) return repos
    const query = searchQuery.toLowerCase()
    return repos.filter(
      (repo) =>
        repo.name.toLowerCase().includes(query) ||
        repo.fullName.toLowerCase().includes(query) ||
        repo.description?.toLowerCase().includes(query)
    )
  }, [repos, searchQuery, searchResults])

  // Reset search results when query changes
  const handleSearchChange = (value: string) => {
    setSearchQuery(value)
    setSearchResults(null)
  }

  // Show "Search all" button when local filter has no results and query is long enough
  const showSearchAllButton =
    searchResults === null &&
    searchQuery.length >= 3 &&
    filteredRepos.length === 0

  if (isLoading) {
    return (
      <div className="space-y-2" data-testid="repository-skeleton">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
        {error}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search repositories..."
          value={searchQuery}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="pl-9"
        />
      </div>

      <ScrollArea className="h-[240px] rounded-md border">
        {filteredRepos.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-4">
            <p className="text-sm text-muted-foreground">No repositories found</p>
            {showSearchAllButton && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleSearchAll}
                disabled={isSearching}
              >
                {isSearching ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Searching...
                  </>
                ) : (
                  'Search all repositories'
                )}
              </Button>
            )}
          </div>
        ) : (
          <div className="p-1">
            {filteredRepos.map((repo) => (
              <button
                key={repo.fullName}
                onClick={() => onSelect(repo)}
                className="flex w-full items-start gap-3 rounded-md p-3 text-left hover:bg-accent"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{repo.name}</span>
                    <Badge variant={repo.private ? 'secondary' : 'outline'} className="text-xs">
                      {repo.private ? (
                        <>
                          <Lock className="mr-1 h-3 w-3" />
                          private
                        </>
                      ) : (
                        <>
                          <Globe className="mr-1 h-3 w-3" />
                          public
                        </>
                      )}
                    </Badge>
                  </div>
                  {repo.description && (
                    <p className="mt-1 text-sm text-muted-foreground truncate">
                      {repo.description}
                    </p>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </ScrollArea>

      {hasMore && !searchQuery && (
        <Button
          variant="outline"
          size="sm"
          onClick={handleLoadMore}
          disabled={isLoadingMore}
          className="w-full"
        >
          {isLoadingMore ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading...
            </>
          ) : (
            'Load more'
          )}
        </Button>
      )}
    </div>
  )
}
