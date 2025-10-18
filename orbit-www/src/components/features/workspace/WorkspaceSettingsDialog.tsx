'use client'

import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { Loader2, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
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
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'
import type { Workspace } from './WorkspaceManager'
import { updateWorkspaceSettings, deleteWorkspace } from '@/app/(frontend)/workspaces/actions'

const settingsSchema = z.object({
  name: z
    .string()
    .min(3, 'Workspace name must be at least 3 characters')
    .max(50, 'Workspace name must be less than 50 characters'),
  description: z.string().max(200, 'Description must be less than 200 characters').optional(),
})

type SettingsFormData = z.infer<typeof settingsSchema>

interface WorkspaceSettingsDialogProps {
  workspace: Workspace
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function WorkspaceSettingsDialog({
  workspace,
  open,
  onOpenChange,
}: WorkspaceSettingsDialogProps) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const form = useForm<SettingsFormData>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      name: workspace.name,
      description: workspace.description || '',
    },
  })

  // Reset form when workspace changes
  useEffect(() => {
    form.reset({
      name: workspace.name,
      description: workspace.description || '',
    })
  }, [workspace, form])

  const onSubmit = async (data: SettingsFormData) => {
    try {
      setIsSubmitting(true)
      const result = await updateWorkspaceSettings(workspace.id, {
        name: data.name,
        description: data.description,
      })

      if (result.success) {
        toast.success('Settings updated', {
          description: 'Workspace settings have been saved successfully',
        })
        onOpenChange(false)
      } else {
        toast.error('Failed to update settings', {
          description: result.error || 'An unexpected error occurred',
        })
      }
    } catch (error) {
      toast.error('Failed to update settings', {
        description: error instanceof Error ? error.message : 'An unexpected error occurred',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm(`Are you sure you want to delete "${workspace.name}"? This action cannot be undone.`)) {
      return
    }

    try {
      setIsDeleting(true)
      const result = await deleteWorkspace(workspace.id)

      if (result.success) {
        toast.success('Workspace deleted', {
          description: `${workspace.name} has been permanently deleted`,
        })
        onOpenChange(false)
        router.push('/admin/workspaces')
        router.refresh()
      } else {
        toast.error('Failed to delete workspace', {
          description: result.error || 'An unexpected error occurred',
        })
      }
    } catch (error) {
      toast.error('Failed to delete workspace', {
        description: error instanceof Error ? error.message : 'An unexpected error occurred',
      })
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle>Workspace Settings</DialogTitle>
          <DialogDescription>
            Update workspace configuration and preferences
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
                    <Input placeholder="Engineering Team" {...field} />
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
                    <Input placeholder="Main engineering workspace" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex items-center justify-between pt-2">
              <p className="text-sm">
                Slug: <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                  /{workspace.slug}
                </code>
              </p>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </Form>

        <Separator className="my-4" />

        <div className="space-y-4">
          <div>
            <h4 className="mb-2 text-sm font-medium text-destructive">Danger Zone</h4>
            <p className="mb-4 text-sm text-muted-foreground">
              Permanently delete this workspace and all associated data. This action cannot be undone.
            </p>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {!isDeleting && <Trash2 className="mr-2 h-4 w-4" />}
              Delete Workspace
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
