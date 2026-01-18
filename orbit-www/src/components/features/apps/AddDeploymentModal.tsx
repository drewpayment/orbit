'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { Loader2 } from 'lucide-react'
import { createDeployment, getDeploymentGenerators } from '@/app/actions/deployments'

const formSchema = z.object({
  name: z.string().min(1, 'Name is required').max(50),
  generator: z.enum(['docker-compose', 'terraform', 'helm', 'custom']),
  serviceName: z.string().min(1, 'Service name is required'),
  port: z.number().min(1).max(65535),
})

type FormData = z.infer<typeof formSchema>

interface AddDeploymentModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  appId: string
  appName: string
}

export function AddDeploymentModal({
  open,
  onOpenChange,
  appId,
  appName,
}: AddDeploymentModalProps) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [generators, setGenerators] = useState<Array<{
    id: string
    name: string
    slug: string
    type: 'docker-compose' | 'terraform' | 'helm' | 'custom'
    description?: string
  }>>([])
  const [loadingGenerators, setLoadingGenerators] = useState(true)

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: 'production',
      generator: 'docker-compose',
      serviceName: appName.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
      port: 3000,
    },
  })

  useEffect(() => {
    if (open) {
      setLoadingGenerators(true)
      getDeploymentGenerators().then((result) => {
        if (result.success) {
          setGenerators(result.generators.map(g => ({
            id: g.id,
            name: g.name,
            slug: g.slug,
            type: g.type,
            description: g.description ?? undefined,
          })))
        }
        setLoadingGenerators(false)
      })
    }
  }, [open])

  const onSubmit = async (data: FormData) => {
    setIsSubmitting(true)
    try {
      // Image will be derived from app's repository in the backend
      const config = {
        serviceName: data.serviceName,
        port: data.port,
      }

      const result = await createDeployment({
        appId,
        name: data.name,
        generator: data.generator,
        config,
        target: {
          type: 'repository', // Generate files for repository commit
        },
      })

      if (result.success && result.deploymentId) {
        form.reset()
        onOpenChange(false)
        router.refresh()
      } else {
        form.setError('root', { message: result.error || 'Failed to create deployment' })
      }
    } catch {
      form.setError('root', { message: 'An unexpected error occurred' })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Deployment</DialogTitle>
          <DialogDescription>
            Configure a new deployment for {appName}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Deployment Name</FormLabel>
                  <FormControl>
                    <Input placeholder="production" {...field} />
                  </FormControl>
                  <FormDescription>
                    e.g., production, staging, development
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="generator"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Deployment Method</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={loadingGenerators ? "Loading..." : "Select method"} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {loadingGenerators ? (
                        <SelectItem value="loading" disabled>Loading generators...</SelectItem>
                      ) : generators.length > 0 ? (
                        generators.map((gen) => (
                          <SelectItem key={gen.id} value={gen.type}>
                            {gen.name}
                          </SelectItem>
                        ))
                      ) : (
                        <SelectItem value="docker-compose">Docker Compose</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
              This will generate a <code className="font-mono text-xs">docker-compose.yml</code> file using your app&apos;s repository image that you can review and commit.
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="serviceName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Service Name</FormLabel>
                    <FormControl>
                      <Input placeholder="my-app" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="port"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Port</FormLabel>
                    <FormControl>
                      <Input type="number" placeholder="3000" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {form.formState.errors.root && (
              <p className="text-sm text-destructive">
                {form.formState.errors.root.message}
              </p>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
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
                  'Create Deployment'
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
