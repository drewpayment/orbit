'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, ChevronDown, ChevronUp, Info } from 'lucide-react'
import { importRepository } from '@/app/actions/apps'
import {
  getWorkspaceGitHubInstallations,
  type GitHubInstallation,
  type Repository,
} from '@/app/actions/github'
import {
  getWorkspaceGitConnections,
  type GitConnectionSource,
} from '@/app/actions/azure-devops'
import { buildAdoRepoUrl, parseAdoRepoUrl } from '@/lib/connections/ado-url'
import { RepositoryBrowser } from './RepositoryBrowser'
import { InstallationPicker } from './InstallationPicker'

const formSchema = z.object({
  workspaceId: z.string().min(1, 'Please select a workspace'),
  repositoryUrl: z.string().url('Please enter a valid repository URL').optional().or(z.literal('')),
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().max(500).optional(),
})

type FormData = z.infer<typeof formSchema>

/** Unified repo source across providers, so one selector can list both. */
type ImportSource =
  | { kind: 'github'; id: string; label: string; installation: GitHubInstallation }
  | { kind: 'azure-devops'; id: string; label: string; connection: GitConnectionSource }

interface ImportAppFormProps {
  workspaces: { id: string; name: string }[]
}

export function ImportAppForm({ workspaces }: ImportAppFormProps) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [installations, setInstallations] = useState<GitHubInstallation[]>([])
  const [sources, setSources] = useState<ImportSource[]>([])
  const [selectedSource, setSelectedSource] = useState<ImportSource | null>(null)
  const [selectedRepo, setSelectedRepo] = useState<Repository | null>(null)
  const [isLoadingSources, setIsLoadingSources] = useState(true)
  const [showManualInput, setShowManualInput] = useState(false)

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      workspaceId: workspaces[0]?.id || '',
      repositoryUrl: '',
      name: '',
      description: '',
    },
  })

  const workspaceId = form.watch('workspaceId')

  // Fetch both GitHub installations and Azure DevOps connections when the
  // workspace changes, then build the unified source list.
  useEffect(() => {
    async function loadSources() {
      if (!workspaceId) return

      setIsLoadingSources(true)
      setSelectedSource(null)
      setSelectedRepo(null)

      const [ghResult, adoResult] = await Promise.all([
        getWorkspaceGitHubInstallations(workspaceId),
        getWorkspaceGitConnections(workspaceId),
      ])

      const ghInstallations = ghResult.success ? ghResult.installations : []
      const adoConnections = adoResult.success ? adoResult.connections : []
      setInstallations(ghInstallations)

      const next: ImportSource[] = [
        ...ghInstallations.map((installation): ImportSource => ({
          kind: 'github',
          id: installation.id,
          label: `GitHub · ${installation.accountLogin}`,
          installation,
        })),
        ...adoConnections.map((connection): ImportSource => ({
          kind: 'azure-devops',
          id: connection.id,
          label: `Azure DevOps · ${connection.name}`,
          connection,
        })),
      ]
      setSources(next)

      // Preselect a lone source; default to manual entry when there are none.
      if (next.length === 1) {
        setSelectedSource(next[0])
        setShowManualInput(false)
      } else if (next.length === 0) {
        setShowManualInput(true)
      } else {
        setShowManualInput(false)
      }

      setIsLoadingSources(false)
    }
    loadSources()
  }, [workspaceId])

  const handleRepoSelect = (repo: Repository) => {
    setSelectedRepo(repo)
    form.setValue('name', repo.name)
    if (selectedSource?.kind === 'azure-devops') {
      const { organization, baseUrl } = selectedSource.connection
      form.setValue('repositoryUrl', buildAdoRepoUrl(baseUrl, organization, repo.project ?? '', repo.name))
    } else {
      form.setValue('repositoryUrl', `https://github.com/${repo.fullName}`)
    }
  }

  const onSubmit = async (data: FormData) => {
    setIsSubmitting(true)
    try {
      const fallbackUrl =
        selectedSource?.kind === 'github' && selectedRepo
          ? `https://github.com/${selectedRepo.fullName}`
          : ''
      const result = await importRepository({
        workspaceId: data.workspaceId,
        repositoryUrl: data.repositoryUrl || fallbackUrl,
        name: data.name,
        description: data.description,
        ...(selectedSource?.kind === 'azure-devops'
          ? { connectionId: selectedSource.id }
          : { installationId: selectedSource?.id }),
      })
      if (result.success && result.appId) {
        router.push(`/apps/${result.appId}`)
      } else {
        form.setError('root', { message: result.error || 'Failed to import repository' })
      }
    } catch (_error) {
      form.setError('root', { message: 'An unexpected error occurred' })
    } finally {
      setIsSubmitting(false)
    }
  }

  // Auto-fill name from a manually entered URL (GitHub or Azure DevOps).
  const handleUrlChange = (url: string) => {
    form.setValue('repositoryUrl', url)
    if (form.getValues('name')) return
    const ghMatch = url.match(/github\.com\/[^/]+\/([^/]+)/)
    if (ghMatch) {
      form.setValue('name', ghMatch[1].replace(/\.git$/, ''))
      return
    }
    const ado = parseAdoRepoUrl(url)
    if (ado) form.setValue('name', ado.repo)
  }

  const hasSources = sources.length > 0
  const hasAdo = sources.some((s) => s.kind === 'azure-devops')
  const hasMultipleInstallations = installations.length > 1
  // Unified source selector: shown whenever an ADO connection exists and there
  // is more than one source to choose from. A single-provider GitHub workspace
  // keeps its existing InstallationPicker; a lone source is auto-selected.
  const showSourceSelector = hasAdo && sources.length > 1

  return (
    <Card>
      <CardContent className="pt-6">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Workspace Selector */}
            <FormField
              control={form.control}
              name="workspaceId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Workspace</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger aria-label="Workspace">
                        <SelectValue placeholder="Select a workspace" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {workspaces.map((ws) => (
                        <SelectItem key={ws.id} value={ws.id}>
                          {ws.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Loading state */}
            {isLoadingSources && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading repository sources...
              </div>
            )}

            {/* No sources message */}
            {!isLoadingSources && !hasSources && (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  No repository sources available.{' '}
                  <a href="/settings/connections" className="underline hover:no-underline">
                    Connect GitHub or Azure DevOps
                  </a>{' '}
                  in Settings, or enter a URL manually below.
                </AlertDescription>
              </Alert>
            )}

            {/* Unified source selector (GitHub installations + ADO connections) */}
            {!isLoadingSources && showSourceSelector && (
              <FormItem>
                <FormLabel>Repository Source</FormLabel>
                <Select
                  value={selectedSource?.id ?? ''}
                  onValueChange={(id) => {
                    setSelectedSource(sources.find((s) => s.id === id) ?? null)
                    setSelectedRepo(null)
                  }}
                >
                  <SelectTrigger aria-label="Repository Source">
                    <SelectValue placeholder="Select a source" />
                  </SelectTrigger>
                  <SelectContent>
                    {sources.map((source) => (
                      <SelectItem key={source.id} value={source.id}>
                        {source.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormItem>
            )}

            {/* GitHub-only installation picker (preserved for single-provider GitHub) */}
            {!isLoadingSources && !hasAdo && hasMultipleInstallations && (
              <FormItem>
                <FormLabel>GitHub Installation</FormLabel>
                <InstallationPicker
                  installations={installations}
                  selected={selectedSource?.kind === 'github' ? selectedSource.installation : null}
                  onSelect={(installation) =>
                    setSelectedSource({
                      kind: 'github',
                      id: installation.id,
                      label: `GitHub · ${installation.accountLogin}`,
                      installation,
                    })
                  }
                />
              </FormItem>
            )}

            {/* Repository Browser */}
            {!isLoadingSources && hasSources && selectedSource && !showManualInput && (
              <FormItem>
                <FormLabel>Repository</FormLabel>
                <RepositoryBrowser
                  installationId={selectedSource.kind === 'github' ? selectedSource.id : undefined}
                  connectionId={selectedSource.kind === 'azure-devops' ? selectedSource.id : undefined}
                  onSelect={handleRepoSelect}
                />
                {selectedRepo && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Selected: <span className="font-medium">{selectedRepo.fullName}</span>
                  </p>
                )}
              </FormItem>
            )}

            {/* Manual input toggle */}
            {!isLoadingSources && hasSources && !showManualInput && (
              <button
                type="button"
                onClick={() => setShowManualInput(true)}
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              >
                <ChevronDown className="h-4 w-4" />
                Or enter a repository URL manually
              </button>
            )}

            {/* Manual URL input */}
            {(!isLoadingSources && showManualInput) && (
              <>
                {hasSources && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowManualInput(false)
                      setSelectedRepo(null)
                      form.setValue('repositoryUrl', '')
                    }}
                    className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                  >
                    <ChevronUp className="h-4 w-4" />
                    Back to repository browser
                  </button>
                )}

                <FormField
                  control={form.control}
                  name="repositoryUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Repository URL</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="https://github.com/org/repo"
                          {...field}
                          onChange={(e) => handleUrlChange(e.target.value)}
                        />
                      </FormControl>
                      <FormDescription>
                        A GitHub (github.com/owner/repo) or Azure DevOps
                        (dev.azure.com/org/project/_git/repo) repository URL
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}

            {/* Application Name */}
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Application Name</FormLabel>
                  <FormControl>
                    <Input placeholder="my-service" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Description */}
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description (optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="What does this application do?"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {form.formState.errors.root && (
              <p className="text-sm text-destructive">
                {form.formState.errors.root.message}
              </p>
            )}

            <div className="flex gap-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.back()}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting || (!selectedRepo && !form.getValues('repositoryUrl'))}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Importing...
                  </>
                ) : (
                  'Import Repository'
                )}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
