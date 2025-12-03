'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Form,
  FormControl,
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
import { GitBranch, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

const formSchema = z.object({
  branch: z.string().min(1, 'Branch is required'),
  newBranch: z.string().optional(),
  createNewBranch: z.boolean().default(false),
  message: z.string().min(1, 'Commit message is required'),
})

type FormData = z.infer<typeof formSchema>

interface CommitToRepoFormProps {
  deploymentId: string
  branches: string[]
  defaultBranch: string
  onCommit: (data: { branch: string; newBranch?: string; message: string }) => Promise<void>
  onSkip?: () => Promise<void>
}

export function CommitToRepoForm({
  deploymentId,
  branches,
  defaultBranch,
  onCommit,
  onSkip,
}: CommitToRepoFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSkipping, setIsSkipping] = useState(false)

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      branch: defaultBranch,
      newBranch: '',
      createNewBranch: false,
      message: 'chore: add deployment configuration',
    },
  })

  const createNewBranch = form.watch('createNewBranch')

  const onSubmit = async (data: FormData) => {
    setIsSubmitting(true)
    try {
      await onCommit({
        branch: data.createNewBranch ? '' : data.branch,
        newBranch: data.createNewBranch ? data.newBranch : undefined,
        message: data.message,
      })
      toast.success('Files committed successfully')
    } catch (error) {
      toast.error('Failed to commit files')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="rounded-md border p-4 mt-4">
      <h4 className="text-sm font-medium flex items-center gap-2 mb-4">
        <GitBranch className="h-4 w-4" />
        Commit to Repository
      </h4>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="createNewBranch"
            render={({ field }) => (
              <FormItem className="flex items-center gap-2">
                <FormControl>
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
                <FormLabel className="!mt-0">Create new branch</FormLabel>
              </FormItem>
            )}
          />

          {createNewBranch ? (
            <FormField
              control={form.control}
              name="newBranch"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New Branch Name</FormLabel>
                  <FormControl>
                    <Input placeholder="feature/deployment-config" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          ) : (
            <FormField
              control={form.control}
              name="branch"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Branch</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select branch" />
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
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          <FormField
            control={form.control}
            name="message"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Commit Message</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="flex gap-2">
            <Button type="submit" disabled={isSubmitting || isSkipping}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Committing...
                </>
              ) : (
                'Commit to Repository'
              )}
            </Button>
            {onSkip && (
              <Button
                type="button"
                variant="outline"
                disabled={isSubmitting || isSkipping}
                onClick={async () => {
                  setIsSkipping(true)
                  try {
                    await onSkip()
                    toast.success('Deployment marked as complete')
                  } catch (error) {
                    toast.error('Failed to complete deployment')
                  } finally {
                    setIsSkipping(false)
                  }
                }}
              >
                {isSkipping ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Completing...
                  </>
                ) : (
                  "I'll copy it manually"
                )}
              </Button>
            )}
          </div>
        </form>
      </Form>
    </div>
  )
}
