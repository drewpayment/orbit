'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
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
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { produceTopicMessage } from '@/app/actions/kafka-messages'

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), {
  ssr: false,
  loading: () => (
    <div className="h-[150px] bg-muted animate-pulse rounded-md flex items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin" />
    </div>
  ),
})

const produceSchema = z.object({
  partition: z.string().optional(),
  key: z.string().optional(),
  value: z.string().min(1, 'Message value is required'),
  headers: z.array(
    z.object({
      key: z.string().min(1, 'Header key is required'),
      value: z.string(),
    }),
  ),
})

type ProduceFormData = z.infer<typeof produceSchema>

interface ProduceMessageSheetProps {
  topicId: string
  workspaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function ProduceMessageSheet({
  topicId,
  workspaceId,
  open,
  onOpenChange,
  onSuccess,
}: ProduceMessageSheetProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)

  const form = useForm<ProduceFormData>({
    resolver: zodResolver(produceSchema),
    defaultValues: {
      partition: 'auto',
      key: '',
      value: '',
      headers: [],
    },
  })

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'headers',
  })

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen && form.formState.isDirty) {
      if (!confirm('You have unsaved changes. Discard?')) {
        return
      }
    }
    if (!newOpen) {
      form.reset()
    }
    onOpenChange(newOpen)
  }

  const onSubmit = async (data: ProduceFormData) => {
    try {
      setIsSubmitting(true)

      const headers: Record<string, string> = {}
      for (const h of data.headers) {
        headers[h.key] = h.value
      }

      const result = await produceTopicMessage({
        topicId,
        workspaceId,
        partition:
          data.partition && data.partition !== 'auto'
            ? Number(data.partition)
            : null,
        key: data.key || undefined,
        value: data.value,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
      })

      if (result.success) {
        toast.success('Message produced', {
          description: `Partition ${result.partition}, Offset ${result.offset}`,
        })
        form.reset()
        onSuccess()
      } else {
        toast.error('Failed to produce message', {
          description: result.error,
        })
      }
    } catch (error) {
      toast.error('Failed to produce message', {
        description:
          error instanceof Error ? error.message : 'An unexpected error occurred',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent className="sm:max-w-xl flex flex-col">
        <SheetHeader>
          <SheetTitle>Produce Message</SheetTitle>
          <SheetDescription>
            Send a new message to this topic.
          </SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col flex-1 overflow-hidden"
          >
            <div className="flex-1 overflow-y-auto space-y-5 px-4 py-4">
              <FormField
                control={form.control}
                name="partition"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Partition</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Auto-assign" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="auto">Auto-assign</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Leave as auto-assign for round-robin partition selection.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Separator />

              <FormField
                control={form.control}
                name="key"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Key (optional)</FormLabel>
                    <FormControl>
                      <MonacoEditor
                        height="100px"
                        language="plaintext"
                        value={field.value}
                        onChange={(val) => field.onChange(val ?? '')}
                        theme="vs-dark"
                        options={{
                          minimap: { enabled: false },
                          scrollBeyondLastLine: false,
                          lineNumbers: 'off',
                          fontSize: 13,
                          wordWrap: 'on',
                          renderLineHighlight: 'none',
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="value"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Value</FormLabel>
                    <FormControl>
                      <MonacoEditor
                        height="200px"
                        language="json"
                        value={field.value}
                        onChange={(val) => field.onChange(val ?? '')}
                        theme="vs-dark"
                        options={{
                          minimap: { enabled: false },
                          scrollBeyondLastLine: false,
                          lineNumbers: 'on',
                          fontSize: 13,
                          wordWrap: 'on',
                          formatOnPaste: true,
                          formatOnType: true,
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Separator />

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">Headers</label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => append({ key: '', value: '' })}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Add Header
                  </Button>
                </div>

                {fields.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No headers. Click &quot;Add Header&quot; to add key-value
                    pairs.
                  </p>
                )}

                {fields.map((field, index) => (
                  <div key={field.id} className="flex items-start gap-2">
                    <FormField
                      control={form.control}
                      name={`headers.${index}.key`}
                      render={({ field }) => (
                        <FormItem className="flex-1">
                          <FormControl>
                            <Input placeholder="Header key" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`headers.${index}.value`}
                      render={({ field }) => (
                        <FormItem className="flex-1">
                          <FormControl>
                            <Input placeholder="Header value" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 shrink-0"
                      onClick={() => remove(index)}
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            <SheetFooter className="border-t px-4 py-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Produce
              </Button>
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  )
}
