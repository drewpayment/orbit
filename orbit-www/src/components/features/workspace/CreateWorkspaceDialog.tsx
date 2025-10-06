'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'

const workspaceSchema = z.object({
  name: z
    .string()
    .min(3, 'Workspace name must be at least 3 characters')
    .max(50, 'Workspace name must be less than 50 characters')
    .regex(/^[a-zA-Z0-9\s-_]+$/, 'Only alphanumeric characters, spaces, hyphens, and underscores allowed'),
  slug: z
    .string()
    .min(3, 'Slug must be at least 3 characters')
    .max(30, 'Slug must be less than 30 characters')
    .regex(/^[a-z0-9-]+$/, 'Only lowercase letters, numbers, and hyphens allowed'),
  description: z.string().max(200, 'Description must be less than 200 characters').optional(),
  default_visibility: z.enum(['private', 'internal', 'public']),
  require_approval_for_repos: z.boolean().default(true),
  enable_code_generation: z.boolean().default(true),
})

type WorkspaceFormData = z.infer<typeof workspaceSchema>

interface CreateWorkspaceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CreateWorkspaceDialog({ open, onOpenChange }: CreateWorkspaceDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)

  const form = useForm<WorkspaceFormData>({
    resolver: zodResolver(workspaceSchema),
    defaultValues: {
      name: '',
      slug: '',
      description: '',
      default_visibility: 'internal',
      require_approval_for_repos: true,
      enable_code_generation: true,
    },
  })

  // Auto-generate slug from name
  const handleNameChange = (name: string) => {
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .substring(0, 30)

    form.setValue('slug', slug)
  }

  const onSubmit = async (data: WorkspaceFormData) => {
    try {
      setIsSubmitting(true)

      // TODO: Replace with actual gRPC client call
      await new Promise(resolve => setTimeout(resolve, 1500))

      console.log('Creating workspace:', data)

      toast.success('Workspace created successfully', {
        description: `${data.name} is now ready to use`,
      })

      form.reset()
      onOpenChange(false)
    } catch (error) {
      toast.error('Failed to create workspace', {
        description: error instanceof Error ? error.message : 'An unexpected error occurred',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle>Create New Workspace</DialogTitle>
          <DialogDescription>
            Workspaces help you organize repositories, APIs, and knowledge into separate environments.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Workspace Name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Engineering Team"
                      {...field}
                      onChange={(e) => {
                        field.onChange(e)
                        handleNameChange(e.target.value)
                      }}
                    />
                  </FormControl>
                  <FormDescription>
                    A friendly name for your workspace
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="slug"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Slug</FormLabel>
                  <FormControl>
                    <Input placeholder="engineering-team" {...field} />
                  </FormControl>
                  <FormDescription>
                    URL-friendly identifier (auto-generated from name)
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description (Optional)</FormLabel>
                  <FormControl>
                    <Input placeholder="Main engineering workspace for product development" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="default_visibility"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Default Visibility</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select visibility" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="private">Private - Only invited members</SelectItem>
                      <SelectItem value="internal">Internal - All organization members</SelectItem>
                      <SelectItem value="public">Public - Anyone can view</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Default visibility for new resources in this workspace
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create Workspace
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
