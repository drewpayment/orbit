# Template Import: Searchable Repository Selector — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the plain text GitHub Repository URL field on the Import Template form with a searchable combobox that lists repos accessible via the workspace's GitHub App installation.

**Architecture:** New `RepositoryCombobox` client component using shadcn Command + Popover. Pre-loads first page of repos on open, switches to server-side search on 3+ character input with 300ms debounce. Form restructured to put workspace first (repo list depends on it). No backend changes — existing server actions in `github.ts` provide all needed APIs.

**Tech Stack:** React 19, shadcn/ui (Command, Popover), Next.js server actions, cmdk

---

### Task 1: Create RepositoryCombobox Component

**Files:**
- Create: `orbit-www/src/components/features/templates/RepositoryCombobox.tsx`

**Step 1: Create the component**

```tsx
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
  value: string // fullName of selected repo
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

  // Resolve installation when workspace changes
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

  // Pre-load repos when popover opens
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

  // Debounced search when query changes
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
```

**Step 2: Verify no lint/type errors**

Run: `cd orbit-www && bun run tsc --noEmit --pretty 2>&1 | grep -i 'RepositoryCombobox\|error' | head -20`
Expected: No errors related to RepositoryCombobox

**Step 3: Commit**

```bash
git add orbit-www/src/components/features/templates/RepositoryCombobox.tsx
git commit -m "feat: add RepositoryCombobox component for template import"
```

---

### Task 2: Update ImportTemplateForm to Use RepositoryCombobox

**Files:**
- Modify: `orbit-www/src/components/features/templates/ImportTemplateForm.tsx`

**Step 1: Rewrite the form**

Replace the entire `ImportTemplateForm` component. Key changes:
- Move workspace selector to the top
- Replace the URL text input with `RepositoryCombobox`
- Store selected repo as `Repository | null` state, derive `repoUrl` from `repo.fullName`
- Keep manifest path field unchanged

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Loader2, AlertCircle, CheckCircle2, AlertTriangle } from 'lucide-react'
import { importTemplate, checkManifestExists, CheckManifestResult } from '@/app/actions/templates'
import { ManifestBuilderForm } from './ManifestBuilderForm'
import { RepositoryCombobox } from './RepositoryCombobox'
import type { Repository } from '@/app/actions/github'

interface Workspace {
  id: string
  name: string
}

interface ImportTemplateFormProps {
  workspaces: Workspace[]
}

export function ImportTemplateForm({ workspaces }: ImportTemplateFormProps) {
  const router = useRouter()
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id || '')
  const [selectedRepo, setSelectedRepo] = useState<Repository | null>(null)
  const [manifestPath, setManifestPath] = useState('orbit-template.yaml')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [success, setSuccess] = useState(false)
  const [step, setStep] = useState<'input' | 'wizard' | 'import'>('input')
  const [repoInfo, setRepoInfo] = useState<CheckManifestResult['repoInfo'] | null>(null)

  const repoUrl = selectedRepo ? `https://github.com/${selectedRepo.fullName}` : ''

  const handleImport = async () => {
    setError(null)
    setWarnings([])
    setSuccess(false)
    setIsSubmitting(true)

    try {
      const result = await importTemplate({
        repoUrl,
        workspaceId,
        manifestPath: manifestPath || undefined,
      })

      if (result.success) {
        setSuccess(true)
        if (result.warnings) {
          setWarnings(result.warnings)
        }
        setTimeout(() => {
          router.push('/templates')
        }, 1500)
      } else {
        setError(result.error || 'Import failed')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setWarnings([])
    setSuccess(false)
    setIsSubmitting(true)

    try {
      const result = await checkManifestExists(repoUrl, workspaceId, manifestPath || undefined)

      if (result.error) {
        setError(result.error)
        setIsSubmitting(false)
        return
      }

      setRepoInfo(result.repoInfo || null)

      if (result.exists) {
        await handleImport()
      } else {
        setStep('wizard')
        setIsSubmitting(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
      setIsSubmitting(false)
    }
  }

  const handleManifestCreated = () => {
    setStep('input')
    handleImport()
  }

  const handleCancel = () => {
    setStep('input')
    setRepoInfo(null)
  }

  const handleWorkspaceChange = (newWorkspaceId: string) => {
    setWorkspaceId(newWorkspaceId)
    setSelectedRepo(null) // Reset repo when workspace changes
  }

  // Render wizard if no manifest exists
  if (step === 'wizard' && repoInfo) {
    return (
      <ManifestBuilderForm
        repoUrl={repoUrl}
        workspaceId={workspaceId}
        repoInfo={repoInfo}
        onManifestCreated={handleManifestCreated}
        onCancel={handleCancel}
      />
    )
  }

  return (
    <Card className="max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>Import Template</CardTitle>
        <CardDescription>
          Import a GitHub repository as a template. The repository must contain an
          orbit-template.yaml manifest file.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Error Alert */}
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Warnings Alert */}
          {warnings.length > 0 && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Warnings</AlertTitle>
              <AlertDescription>
                <ul className="list-disc list-inside">
                  {warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {/* Success Alert */}
          {success && (
            <Alert className="border-green-500 bg-green-50 dark:bg-green-950">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertTitle className="text-green-600">Success!</AlertTitle>
              <AlertDescription className="text-green-600">
                Template imported successfully. Redirecting...
              </AlertDescription>
            </Alert>
          )}

          {/* Workspace Selection (moved to top) */}
          <div className="space-y-2">
            <Label htmlFor="workspace">
              Workspace <span className="text-red-500">*</span>
            </Label>
            <Select
              value={workspaceId}
              onValueChange={handleWorkspaceChange}
              disabled={isSubmitting || success}
            >
              <SelectTrigger id="workspace">
                <SelectValue placeholder="Select a workspace" />
              </SelectTrigger>
              <SelectContent>
                {workspaces.map((ws) => (
                  <SelectItem key={ws.id} value={ws.id}>
                    {ws.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Repository Selector */}
          <div className="space-y-2">
            <Label>
              GitHub Repository <span className="text-red-500">*</span>
            </Label>
            <RepositoryCombobox
              workspaceId={workspaceId}
              value={selectedRepo?.fullName || ''}
              onSelect={setSelectedRepo}
              disabled={isSubmitting || success}
            />
          </div>

          {/* Manifest Path */}
          <div className="space-y-2">
            <Label htmlFor="manifestPath">Manifest File Path</Label>
            <Input
              id="manifestPath"
              placeholder="orbit-template.yaml"
              value={manifestPath}
              onChange={(e) => setManifestPath(e.target.value)}
              disabled={isSubmitting || success}
            />
            <p className="text-xs text-muted-foreground">
              Path to the manifest file. Defaults to orbit-template.yaml in the repository root.
            </p>
          </div>

          {/* Submit Button */}
          <div className="flex gap-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.back()}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || success || !selectedRepo || !workspaceId}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Importing...
                </>
              ) : (
                'Import Template'
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
```

**Step 2: Verify no lint/type errors**

Run: `cd orbit-www && bun run tsc --noEmit --pretty 2>&1 | grep -i 'ImportTemplateForm\|error' | head -20`
Expected: No errors

**Step 3: Commit**

```bash
git add orbit-www/src/components/features/templates/ImportTemplateForm.tsx
git commit -m "feat: replace URL text input with searchable repo selector"
```

---

### Task 3: Smoke Test and Visual Verification

**Step 1: Run the dev server locally (or check build)**

Run: `cd orbit-www && bun run build 2>&1 | tail -20`
Expected: Build succeeds with no errors

**Step 2: Commit final**

If any adjustments were needed during build verification, commit them:

```bash
git add -u
git commit -m "fix: address build issues from repo selector integration"
```

**Step 3: Push and deploy**

```bash
git push origin main
```

Wait for CI, then restart orbit-www in K8s.
