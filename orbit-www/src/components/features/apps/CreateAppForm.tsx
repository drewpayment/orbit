'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, ChevronDown, AlertCircle } from 'lucide-react'
import { createManualApp } from '@/app/actions/apps'

const formSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().max(500).optional(),
  workspaceId: z.string().min(1, 'Workspace is required'),
  repositoryUrl: z.string().url().optional().or(z.literal('')),
  healthUrl: z.string().url('Must be a valid URL').optional().or(z.literal('')),
  healthInterval: z.coerce.number().min(30).max(3600).optional(),
  healthTimeout: z.coerce.number().min(1).max(60).optional(),
  healthMethod: z.enum(['GET', 'HEAD', 'POST']).optional(),
  healthExpectedStatus: z.coerce.number().min(100).max(599).optional(),
})

type FormData = z.infer<typeof formSchema>

interface CreateAppFormProps {
  workspaces: Array<{ id: string; name: string }>
}

export function CreateAppForm({ workspaces }: CreateAppFormProps) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      description: '',
      workspaceId: workspaces.length === 1 ? workspaces[0].id : '',
      repositoryUrl: '',
      healthUrl: '',
      healthInterval: 60,
      healthTimeout: 10,
      healthMethod: 'GET',
      healthExpectedStatus: 200,
    },
  })

  const onSubmit = async (data: FormData) => {
    setIsSubmitting(true)
    setError(null)

    try {
      const result = await createManualApp({
        name: data.name,
        description: data.description,
        workspaceId: data.workspaceId,
        repositoryUrl: data.repositoryUrl || undefined,
        healthConfig: {
          url: data.healthUrl || undefined,
          interval: data.healthInterval || 60,
          timeout: data.healthTimeout || 10,
          method: data.healthMethod || 'GET',
          expectedStatus: data.healthExpectedStatus || 200,
        },
      })

      if (result.success) {
        router.push(`/apps/${result.appId}`)
      } else {
        setError(result.error || 'Failed to create application')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Basic Information</CardTitle>
          <CardDescription>
            Provide the essential details for your application
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="workspaceId">Workspace</Label>
            <Select
              value={form.watch('workspaceId')}
              onValueChange={(value) => form.setValue('workspaceId', value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a workspace" />
              </SelectTrigger>
              <SelectContent>
                {workspaces.map((workspace) => (
                  <SelectItem key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.formState.errors.workspaceId && (
              <p className="text-sm text-destructive">
                {form.formState.errors.workspaceId.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="name">Application Name</Label>
            <Input
              id="name"
              placeholder="my-application"
              {...form.register('name')}
            />
            {form.formState.errors.name && (
              <p className="text-sm text-destructive">
                {form.formState.errors.name.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea
              id="description"
              placeholder="A brief description of your application..."
              rows={3}
              {...form.register('description')}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Repository (Optional)</CardTitle>
          <CardDescription>
            Link a Git repository to store configuration and track changes
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label htmlFor="repositoryUrl">Repository URL</Label>
            <Input
              id="repositoryUrl"
              placeholder="https://github.com/org/repo"
              {...form.register('repositoryUrl')}
            />
            <p className="text-sm text-muted-foreground">
              Optional. Link to the application's source repository.
            </p>
          </div>
        </CardContent>
      </Card>

      <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Health Check Configuration</CardTitle>
                  <CardDescription>
                    Configure how the application's health is monitored
                  </CardDescription>
                </div>
                <ChevronDown
                  className={`h-5 w-5 transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
                />
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="space-y-4 pt-0">
              <div className="space-y-2">
                <Label htmlFor="healthUrl">Health Check URL</Label>
                <Input
                  id="healthUrl"
                  placeholder="https://api.example.com/health"
                  {...form.register('healthUrl')}
                />
                <p className="text-sm text-muted-foreground">
                  Full URL to monitor for application health
                </p>
                {form.formState.errors.healthUrl && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.healthUrl.message}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="healthMethod">HTTP Method</Label>
                  <Select
                    value={form.watch('healthMethod')}
                    onValueChange={(value) => form.setValue('healthMethod', value as 'GET' | 'HEAD' | 'POST')}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select method" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="GET">GET</SelectItem>
                      <SelectItem value="HEAD">HEAD</SelectItem>
                      <SelectItem value="POST">POST</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="healthExpectedStatus">Expected Status</Label>
                  <Input
                    id="healthExpectedStatus"
                    type="number"
                    min={100}
                    max={599}
                    {...form.register('healthExpectedStatus')}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="healthInterval">Check Interval (seconds)</Label>
                  <Input
                    id="healthInterval"
                    type="number"
                    min={30}
                    max={3600}
                    {...form.register('healthInterval')}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="healthTimeout">Timeout (seconds)</Label>
                  <Input
                    id="healthTimeout"
                    type="number"
                    min={1}
                    max={60}
                    {...form.register('healthTimeout')}
                  />
                </div>
              </div>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      <div className="flex justify-end gap-4">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push('/apps')}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Creating...
            </>
          ) : (
            'Create Application'
          )}
        </Button>
      </div>
    </form>
  )
}
