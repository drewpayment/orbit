'use client'

import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { Loader2, ExternalLink, AlertTriangle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from '@/components/ui/form'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'
import type { App } from '@/payload-types'
import { updateAppSettings, deleteApp } from '@/app/actions/apps'
import { getRepositoryBranches } from '@/app/actions/github'

const appSettingsSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(100, 'Name must be less than 100 characters'),
  description: z
    .string()
    .max(500, 'Description must be less than 500 characters')
    .optional()
    .or(z.literal('')),
  healthConfig: z.object({
    url: z
      .string()
      .url('Must be a valid URL')
      .optional()
      .or(z.literal('')),
    method: z.enum(['GET', 'HEAD', 'POST']).default('GET'),
    interval: z.coerce.number().min(30, 'Minimum 30 seconds').default(60),
    timeout: z.coerce.number().min(1, 'Minimum 1 second').default(10),
    expectedStatus: z.coerce.number().min(100).max(599).default(200),
  }),
  branch: z.string().optional(),
})

type AppSettingsFormData = z.infer<typeof appSettingsSchema>

interface AppSettingsSheetProps {
  app: App
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AppSettingsSheet({ app, open, onOpenChange }: AppSettingsSheetProps) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [branches, setBranches] = useState<string[]>([])
  const [loadingBranches, setLoadingBranches] = useState(false)
  const [deleteConfirmName, setDeleteConfirmName] = useState('')

  const form = useForm<AppSettingsFormData>({
    resolver: zodResolver(appSettingsSchema),
    defaultValues: {
      name: app.name,
      description: app.description || '',
      healthConfig: {
        url: app.healthConfig?.url || '',
        method: (app.healthConfig?.method as 'GET' | 'HEAD' | 'POST') || 'GET',
        interval: app.healthConfig?.interval || 60,
        timeout: app.healthConfig?.timeout || 10,
        expectedStatus: app.healthConfig?.expectedStatus || 200,
      },
      branch: app.repository?.branch || 'main',
    },
  })

  // Reset form when app changes
  useEffect(() => {
    form.reset({
      name: app.name,
      description: app.description || '',
      healthConfig: {
        url: app.healthConfig?.url || '',
        method: (app.healthConfig?.method as 'GET' | 'HEAD' | 'POST') || 'GET',
        interval: app.healthConfig?.interval || 60,
        timeout: app.healthConfig?.timeout || 10,
        expectedStatus: app.healthConfig?.expectedStatus || 200,
      },
      branch: app.repository?.branch || 'main',
    })
  }, [app, form])

  // Load branches when sheet opens
  useEffect(() => {
    if (open && app.repository?.installationId && app.repository?.owner && app.repository?.name) {
      setLoadingBranches(true)
      getRepositoryBranches(app.repository.installationId, app.repository.owner, app.repository.name)
        .then((result) => {
          if (result.success && result.branches) {
            setBranches(result.branches)
          }
        })
        .finally(() => setLoadingBranches(false))
    }
  }, [open, app.repository?.installationId, app.repository?.owner, app.repository?.name])

  // Handle open change with unsaved changes warning
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen && form.formState.isDirty) {
      if (!confirm('You have unsaved changes. Discard?')) {
        return
      }
    }
    setDeleteConfirmName('')
    onOpenChange(newOpen)
  }

  const onSubmit = async (data: AppSettingsFormData) => {
    try {
      setIsSubmitting(true)

      // Build health config - only include if URL is provided
      const healthConfig = data.healthConfig.url
        ? {
            url: data.healthConfig.url,
            method: data.healthConfig.method,
            interval: data.healthConfig.interval,
            timeout: data.healthConfig.timeout,
            expectedStatus: data.healthConfig.expectedStatus,
          }
        : undefined

      const result = await updateAppSettings(app.id, {
        name: data.name,
        description: data.description || undefined,
        healthConfig,
        branch: data.branch,
      })

      if (result.success) {
        toast.success('Settings saved', {
          description: 'App settings have been updated',
        })
        onOpenChange(false)
        router.refresh()
      } else {
        toast.error('Failed to save settings', {
          description: result.error || 'An unexpected error occurred',
        })
      }
    } catch (error) {
      toast.error('Failed to save settings', {
        description: error instanceof Error ? error.message : 'An unexpected error occurred',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (deleteConfirmName !== app.name) {
      return
    }

    try {
      setIsDeleting(true)
      const result = await deleteApp(app.id, deleteConfirmName)

      if (result.success) {
        toast.success('App deleted', {
          description: `${app.name} has been permanently deleted`,
        })
        router.push('/apps')
      } else {
        toast.error('Failed to delete app', {
          description: result.error || 'An unexpected error occurred',
        })
      }
    } catch (error) {
      toast.error('Failed to delete app', {
        description: error instanceof Error ? error.message : 'An unexpected error occurred',
      })
    } finally {
      setIsDeleting(false)
    }
  }

  const hasRepository = !!(app.repository?.owner && app.repository?.name)
  const canSelectBranch = hasRepository && !!app.repository?.installationId

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent className="sm:max-w-lg flex flex-col">
        <SheetHeader>
          <SheetTitle>Settings</SheetTitle>
          <SheetDescription>
            Configure app settings, health checks, and repository options.
          </SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col flex-1 overflow-hidden">
            <div className="flex-1 overflow-y-auto space-y-6 px-4 py-4">
            {/* General Section */}
            <div className="space-y-4">
              <h3 className="text-sm font-medium">General</h3>
              <Separator />

              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input placeholder="my-app" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="A brief description of your application"
                        className="resize-none"
                        rows={3}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Health Check Section */}
            <div className="space-y-4">
              <h3 className="text-sm font-medium">Health Check</h3>
              <Separator />

              <FormField
                control={form.control}
                name="healthConfig.url"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>URL</FormLabel>
                    <FormControl>
                      <Input placeholder="https://api.example.com/health" {...field} />
                    </FormControl>
                    <FormDescription>
                      Leave empty to disable health monitoring
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="healthConfig.method"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Method</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select method" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="GET">GET</SelectItem>
                          <SelectItem value="HEAD">HEAD</SelectItem>
                          <SelectItem value="POST">POST</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="healthConfig.interval"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Interval (seconds)</FormLabel>
                      <FormControl>
                        <Input type="number" min={30} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="healthConfig.timeout"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Timeout (seconds)</FormLabel>
                      <FormControl>
                        <Input type="number" min={1} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="healthConfig.expectedStatus"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Expected Status</FormLabel>
                      <FormControl>
                        <Input type="number" min={100} max={599} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* Repository Section */}
            <div className="space-y-4">
              <h3 className="text-sm font-medium">Repository</h3>
              <Separator />

              <div className="space-y-2">
                <label className="text-sm font-medium">URL</label>
                {hasRepository ? (
                  <div className="flex items-center gap-2">
                    <a
                      href={app.repository?.url || `https://github.com/${app.repository?.owner}/${app.repository?.name}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-muted-foreground hover:underline flex items-center gap-1"
                    >
                      {app.repository?.owner}/{app.repository?.name}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No repository linked</p>
                )}
              </div>

              <FormField
                control={form.control}
                name="branch"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Branch</FormLabel>
                    {canSelectBranch ? (
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                        disabled={loadingBranches}
                      >
                        <FormControl>
                          <SelectTrigger>
                            {loadingBranches ? (
                              <span className="flex items-center gap-2">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Loading branches...
                              </span>
                            ) : (
                              <SelectValue placeholder="Select branch" />
                            )}
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {branches.map((branch) => (
                            <SelectItem key={branch} value={branch}>
                              {branch}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <FormControl>
                        <Input
                          {...field}
                          disabled={!hasRepository}
                          placeholder={hasRepository ? 'main' : 'No repository linked'}
                        />
                      </FormControl>
                    )}
                    {!canSelectBranch && hasRepository && (
                      <FormDescription>
                        Link a GitHub installation to select branches
                      </FormDescription>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Danger Zone */}
            <div className="space-y-4 rounded-lg border border-destructive/50 bg-destructive/5 p-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                <h3 className="text-sm font-medium text-destructive">Danger Zone</h3>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">Delete Application</p>
                <p className="text-sm text-muted-foreground">
                  This action cannot be undone. This will permanently delete the app and all
                  associated deployments.
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm">
                  Type <span className="font-mono font-medium">{app.name}</span> to confirm
                </label>
                <Input
                  value={deleteConfirmName}
                  onChange={(e) => setDeleteConfirmName(e.target.value)}
                  placeholder={app.name}
                />
              </div>

              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={handleDelete}
                disabled={deleteConfirmName !== app.name || isDeleting}
              >
                {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Delete Application
              </Button>
            </div>
            </div>

            <SheetFooter className="border-t px-4 py-4">
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Changes
              </Button>
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  )
}
