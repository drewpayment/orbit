'use client'

import { useState } from 'react'
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
import { createDeployment } from '@/app/actions/deployments'

const formSchema = z.object({
  name: z.string().min(1, 'Name is required').max(50),
  generator: z.enum(['docker-compose', 'terraform', 'helm', 'custom']),
  targetType: z.string().min(1, 'Target type is required'),
  hostUrl: z.string().optional(),
  serviceName: z.string().min(1, 'Service name is required'),
  imageRepository: z.string().min(1, 'Image repository is required'),
  imageTag: z.string().default('latest'),
  port: z.coerce.number().min(1).max(65535).default(3000),
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

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: 'production',
      generator: 'docker-compose',
      targetType: 'docker-host',
      hostUrl: 'unix:///var/run/docker.sock',
      serviceName: appName.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
      imageRepository: '',
      imageTag: 'latest',
      port: 3000,
    },
  })

  const onSubmit = async (data: FormData) => {
    setIsSubmitting(true)
    try {
      const config = {
        hostUrl: data.hostUrl,
        serviceName: data.serviceName,
        imageRepository: data.imageRepository,
        imageTag: data.imageTag,
        port: data.port,
      }

      const result = await createDeployment({
        appId,
        name: data.name,
        generator: data.generator,
        config,
        target: {
          type: data.targetType,
          hostUrl: data.hostUrl,
        },
      })

      if (result.success && result.deploymentId) {
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
                        <SelectValue placeholder="Select method" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="docker-compose">Docker Compose</SelectItem>
                      <SelectItem value="terraform" disabled>Terraform (Coming Soon)</SelectItem>
                      <SelectItem value="helm" disabled>Helm (Coming Soon)</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="targetType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Target Type</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select target" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="docker-host">Docker Host</SelectItem>
                      <SelectItem value="kubernetes" disabled>Kubernetes (Coming Soon)</SelectItem>
                      <SelectItem value="aws-ecs" disabled>AWS ECS (Coming Soon)</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="hostUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Docker Host URL</FormLabel>
                  <FormControl>
                    <Input placeholder="unix:///var/run/docker.sock" {...field} />
                  </FormControl>
                  <FormDescription>
                    Local socket or remote host (ssh://user@host)
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="imageRepository"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Image Repository</FormLabel>
                    <FormControl>
                      <Input placeholder="ghcr.io/org/app" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="imageTag"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Image Tag</FormLabel>
                    <FormControl>
                      <Input placeholder="latest" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
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
