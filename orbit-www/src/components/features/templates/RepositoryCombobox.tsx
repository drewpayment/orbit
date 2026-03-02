'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Check, ChevronsUpDown, Lock, Loader2, GitBranch } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import type { Repository } from '@/app/actions/github'
import {
  getWorkspaceGitHubInstallations,
  listInstallationRepositories,
  searchInstallationRepositories,
} from '@/app/actions/github'

interface RepositoryComboboxProps {
  workspaceId: string
  value: string
  onSelect: (repo: Repository) => void
  disabled?: boolean
}

export function RepositoryCombobox({
  workspaceId,
  value,
  onSelect,
  disabled,
}: RepositoryComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [repos, setRepos] = useState<Repository[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [installationId, setInstallationId] = useState<string | null>(null)
  const [noInstallation, setNoInstallation] = useState(false)
  const debounceRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (!workspaceId) {
      setInstallationId(null)
      setNoInstallation(false)
      return
    }

    let cancelled = false
    async function resolve() {
      const result = await getWorkspaceGitHubInstallations(workspaceId)
      if (cancelled) return
      if (result.success && result.installations.length > 0) {
        setInstallationId(result.installations[0].id)
        setNoInstallation(false)
      } else {
        setInstallationId(null)
        setNoInstallation(true)
      }
    }
    resolve()
    return () => { cancelled = true }
  }, [workspaceId])

  useEffect(() => {
    if (!open || !installationId) return

    let cancelled = false
    async function load() {
      setIsLoading(true)
      const result = await listInstallationRepositories(installationId!, 1, 30)
      if (cancelled) return
      if (result.success) {
        setRepos(result.repos)
      }
      setIsLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [open, installationId])

  const handleSearch = useCallback(
    (search: string) => {
      setQuery(search)

      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }

      if (search.length < 3 || !installationId) return

      debounceRef.current = setTimeout(async () => {
        setIsLoading(true)
        const result = await searchInstallationRepositories(installationId, search)
        if (result.success) {
          setRepos(result.repos)
        }
        setIsLoading(false)
      }, 300)
    },
    [installationId]
  )

  if (noInstallation) {
    return (
      <p className="text-sm text-muted-foreground">
        No GitHub App installed for this workspace.{' '}
        <a href="/settings" className="text-primary underline">
          Configure GitHub integration
        </a>
      </p>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
          disabled={disabled || !installationId}
        >
          {value ? (
            <span className="flex items-center gap-2 truncate">
              <GitBranch className="h-4 w-4 shrink-0 opacity-50" />
              {value}
            </span>
          ) : (
            <span className="text-muted-foreground">Select a repository...</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search repositories..."
            value={query}
            onValueChange={handleSearch}
          />
          <CommandList>
            {isLoading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <CommandEmpty>No repositories found.</CommandEmpty>
                <CommandGroup>
                  {repos.map((repo) => (
                    <CommandItem
                      key={repo.fullName}
                      value={repo.fullName}
                      onSelect={() => {
                        onSelect(repo)
                        setOpen(false)
                      }}
                    >
                      <Check
                        className={cn(
                          'mr-2 h-4 w-4',
                          value === repo.fullName ? 'opacity-100' : 'opacity-0'
                        )}
                      />
                      <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium truncate">{repo.fullName}</span>
                          {repo.private && (
                            <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />
                          )}
                        </div>
                        {repo.description && (
                          <span className="text-xs text-muted-foreground truncate">
                            {repo.description}
                          </span>
                        )}
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
