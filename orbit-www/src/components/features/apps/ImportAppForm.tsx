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
import { RepositoryBrowser } from './RepositoryBrowser'
import { InstallationPicker } from './InstallationPicker'

const formSchema = z.object({
  workspaceId: z.string().min(1, 'Please select a workspace'),
  repositoryUrl: z.string().url('Please enter a valid GitHub URL').optional().or(z.literal('')),
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().max(500).optional(),
})

type FormData = z.infer<typeof formSchema>

interface ImportAppFormProps {
  workspaces: { id: string; name: string }[]
}

export function ImportAppForm({ workspaces }: ImportAppFormProps) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [installations, setInstallations] = useState<GitHubInstallation[]>([])
  const [selectedInstallation, setSelectedInstallation] = useState<GitHubInstallation | null>(null)
  const [selectedRepo, setSelectedRepo] = useState<Repository | null>(null)
  const [isLoadingInstallations, setIsLoadingInstallations] = useState(true)
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

  // Fetch installations when workspace changes
  useEffect(() => {
    async function loadInstallations() {
      if (!workspaceId) return

      setIsLoadingInstallations(true)
      setSelectedInstallation(null)
      setSelectedRepo(null)

      const result = await getWorkspaceGitHubInstallations(workspaceId)
      if (result.success) {
        setInstallations(result.installations)
        // Auto-select if only one installation
        if (result.installations.length === 1) {
          setSelectedInstallation(result.installations[0])
        }
        // Show manual input by default if no installations
        if (result.installations.length === 0) {
          setShowManualInput(true)
        } else {
          setShowManualInput(false)
        }
      }
      setIsLoadingInstallations(false)
    }
    loadInstallations()
  }, [workspaceId])

  const handleRepoSelect = (repo: Repository) => {
    setSelectedRepo(repo)
    form.setValue('name', repo.name)
    form.setValue('repositoryUrl', `https://github.com/${repo.fullName}`)
  }

  const onSubmit = async (data: FormData) => {
    setIsSubmitting(true)
    try {
      const result = await importRepository({
        workspaceId: data.workspaceId,
        repositoryUrl: data.repositoryUrl || `https://github.com/${selectedRepo?.fullName}`,
        name: data.name,
        description: data.description,
        installationId: selectedInstallation?.id,
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

  // Auto-fill name from URL (for manual input)
  const handleUrlChange = (url: string) => {
    form.setValue('repositoryUrl', url)
    const match = url.match(/github\.com\/[^/]+\/([^/]+)/)
    if (match && !form.getValues('name')) {
      form.setValue('name', match[1].replace(/\.git$/, ''))
    }
  }

  const hasInstallations = installations.length > 0
  const hasMultipleInstallations = installations.length > 1

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
            {isLoadingInstallations && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading GitHub integrations...
              </div>
            )}

            {/* No installations message */}
            {!isLoadingInstallations && !hasInstallations && (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  No GitHub integrations available.{' '}
                  <a href="/settings/github" className="underline hover:no-underline">
                    Install a GitHub App
                  </a>{' '}
                  in Settings, or enter a URL manually below.
                </AlertDescription>
              </Alert>
            )}

            {/* Installation picker (only if multiple) */}
            {!isLoadingInstallations && hasMultipleInstallations && (
              <FormItem>
                <FormLabel>GitHub Installation</FormLabel>
                <InstallationPicker
                  installations={installations}
                  selected={selectedInstallation}
                  onSelect={setSelectedInstallation}
                />
              </FormItem>
            )}

            {/* Repository Browser */}
            {!isLoadingInstallations && hasInstallations && selectedInstallation && !showManualInput && (
              <FormItem>
                <FormLabel>Repository</FormLabel>
                <RepositoryBrowser
                  installationId={selectedInstallation.id}
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
            {!isLoadingInstallations && hasInstallations && !showManualInput && (
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
            {(!isLoadingInstallations && showManualInput) && (
              <>
                {hasInstallations && (
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
                        The GitHub repository to import
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
