'use client'

import { useState } from 'react'
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
import { Loader2 } from 'lucide-react'
import { importRepository } from '@/app/actions/apps'

const formSchema = z.object({
  workspaceId: z.string().min(1, 'Please select a workspace'),
  repositoryUrl: z.string().url('Please enter a valid GitHub URL'),
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

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      workspaceId: workspaces[0]?.id || '',
      repositoryUrl: '',
      name: '',
      description: '',
    },
  })

  const onSubmit = async (data: FormData) => {
    setIsSubmitting(true)
    try {
      const result = await importRepository(data)
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

  // Auto-fill name from URL
  const handleUrlChange = (url: string) => {
    form.setValue('repositoryUrl', url)
    const match = url.match(/github\.com\/[^/]+\/([^/]+)/)
    if (match && !form.getValues('name')) {
      // Remove .git suffix from auto-filled name
      form.setValue('name', match[1].replace(/\.git$/, ''))
    }
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="workspaceId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Workspace</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
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
              <Button type="submit" disabled={isSubmitting}>
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
