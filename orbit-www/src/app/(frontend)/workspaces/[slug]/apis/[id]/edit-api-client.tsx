'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import dynamic from 'next/dynamic'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Loader2, Save, X, AlertCircle, Eye } from 'lucide-react'
import { validateOpenAPI, type ValidationResult } from '@/lib/schema-validators'
import { updateAPISchema } from '../actions'
import { toast } from 'sonner'
import type { APISchema } from '@/types/api-catalog'

const Editor = dynamic(() => import('@monaco-editor/react'), {
  ssr: false,
  loading: () => (
    <div className="h-[400px] bg-muted animate-pulse rounded-md flex items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin" />
    </div>
  ),
})

interface EditAPIClientProps {
  api: APISchema
  workspaceSlug: string
  userId: string
}

interface FormData {
  name: string
  description: string
  visibility: 'private' | 'workspace' | 'public'
  status: 'draft' | 'published' | 'deprecated'
  rawContent: string
  tags: string[]
  contactName: string
  contactEmail: string
}

export function EditAPIClient({ api, workspaceSlug: _workspaceSlug, userId }: EditAPIClientProps) {
  const router = useRouter()
  const [isSaving, setIsSaving] = React.useState(false)
  const [validation, setValidation] = React.useState<ValidationResult>({ valid: true, errors: [] })
  const [tagInput, setTagInput] = React.useState('')
  const [releaseNotesDialog, setReleaseNotesDialog] = React.useState(false)
  const [releaseNotes, setReleaseNotes] = React.useState('')
  const [pendingFormData, setPendingFormData] = React.useState<FormData | null>(null)

  const form = useForm<FormData>({
    defaultValues: {
      name: api.name,
      description: api.description || '',
      visibility: api.visibility,
      status: api.status,
      rawContent: api.rawContent ?? '',
      tags: api.tags?.map((t: { tag: string }) => t.tag) || [],
      contactName: api.contactName || '',
      contactEmail: api.contactEmail || '',
    },
  })

  const rawContent = form.watch('rawContent')
  const hasContentChanged = rawContent !== api.rawContent

  // Validate content when it changes
  React.useEffect(() => {
    if (rawContent) {
      const result = validateOpenAPI(rawContent)
      setValidation(result)
    }
  }, [rawContent])

  const handleAddTag = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && tagInput.trim()) {
      e.preventDefault()
      const currentTags = form.getValues('tags') || []
      const newTag = tagInput.trim().toLowerCase()
      if (!currentTags.includes(newTag)) {
        form.setValue('tags', [...currentTags, newTag])
      }
      setTagInput('')
    }
  }

  const handleRemoveTag = (tagToRemove: string) => {
    const currentTags = form.getValues('tags') || []
    form.setValue(
      'tags',
      currentTags.filter((tag) => tag !== tagToRemove)
    )
  }

  const handleSubmit = async (data: FormData) => {
    if (!validation.valid) {
      toast.error('Please fix validation errors before saving')
      return
    }

    // If content changed, ask for release notes
    if (hasContentChanged) {
      setPendingFormData(data)
      setReleaseNotesDialog(true)
      return
    }

    await saveChanges(data)
  }

  const saveChanges = async (data: FormData, notes?: string) => {
    setIsSaving(true)
    try {
      const result = await updateAPISchema({
        id: api.id,
        name: data.name,
        description: data.description,
        visibility: data.visibility,
        status: data.status,
        rawContent: data.rawContent,
        tags: data.tags,
        contactName: data.contactName,
        contactEmail: data.contactEmail,
        releaseNotes: notes,
        userId,
      })

      if (result.newVersion) {
        toast.success('API updated and new version created')
      } else {
        toast.success('API updated successfully')
      }

      router.push(`/catalog/apis/${api.id}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update API')
    } finally {
      setIsSaving(false)
    }
  }

  const handleReleaseNotesConfirm = async () => {
    if (pendingFormData) {
      setReleaseNotesDialog(false)
      await saveChanges(pendingFormData, releaseNotes)
      setPendingFormData(null)
      setReleaseNotes('')
    }
  }

  return (
    <>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Basic Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                rules={{ required: 'Name is required' }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>API Name</FormLabel>
                    <FormControl>
                      <Input {...field} />
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
                      <Textarea {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="visibility"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Visibility</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="private">Private</SelectItem>
                          <SelectItem value="workspace">Workspace</SelectItem>
                          <SelectItem value="public">Public</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="draft">Draft</SelectItem>
                          <SelectItem value="published">Published</SelectItem>
                          <SelectItem value="deprecated">Deprecated</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="tags"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tags</FormLabel>
                    <FormControl>
                      <div className="space-y-2">
                        <Input
                          placeholder="Type a tag and press Enter"
                          value={tagInput}
                          onChange={(e) => setTagInput(e.target.value)}
                          onKeyDown={handleAddTag}
                        />
                        {field.value && field.value.length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {field.value.map((tag) => (
                              <Badge key={tag} variant="secondary" className="gap-1">
                                {tag}
                                <button
                                  type="button"
                                  onClick={() => handleRemoveTag(tag)}
                                  className="ml-1 hover:text-destructive"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="contactName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact Name</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="contactEmail"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact Email</FormLabel>
                      <FormControl>
                        <Input type="email" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>OpenAPI Specification</CardTitle>
              <CardDescription>
                {hasContentChanged && (
                  <span className="text-yellow-600">
                    Content has changed. Saving will create a new version.
                  </span>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="rawContent"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <div className="border rounded-md overflow-hidden">
                        <Editor
                          height="400px"
                          language="yaml"
                          value={field.value}
                          onChange={(value) => field.onChange(value || '')}
                          theme="vs-dark"
                          options={{
                            minimap: { enabled: false },
                            fontSize: 14,
                            lineNumbers: 'on',
                            scrollBeyondLastLine: false,
                            automaticLayout: true,
                            tabSize: 2,
                            wordWrap: 'on',
                          }}
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {!validation.valid && validation.errors.length > 0 && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    <ul className="list-disc list-inside">
                      {validation.errors.map((error, index) => (
                        <li key={index} className="text-sm">
                          {error.line && `Line ${error.line}: `}
                          {error.message}
                        </li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          <div className="flex items-center justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push(`/catalog/apis/${api.id}`)}
            >
              <Eye className="h-4 w-4 mr-2" />
              View API
            </Button>
            <Button type="submit" disabled={isSaving || !validation.valid}>
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Save Changes
                </>
              )}
            </Button>
          </div>
        </form>
      </Form>

      <Dialog open={releaseNotesDialog} onOpenChange={setReleaseNotesDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Release Notes</DialogTitle>
            <DialogDescription>
              The specification content has changed. Describe what changed in this version.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="What changed in this version? (optional)"
            value={releaseNotes}
            onChange={(e) => setReleaseNotes(e.target.value)}
            rows={4}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setReleaseNotesDialog(false)
                setPendingFormData(null)
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleReleaseNotesConfirm} disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save & Create Version'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
