'use client'

import { useState, useEffect } from 'react'
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
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { KnowledgePage } from '@/payload-types'

interface CreatePageModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  knowledgeSpaceId: string
  pages: KnowledgePage[]
  onCreatePage: (data: {
    title: string
    slug: string
    parentPageId?: string
  }) => Promise<void>
}

export function CreatePageModal({
  open,
  onOpenChange,
  knowledgeSpaceId,
  pages,
  onCreatePage,
}: CreatePageModalProps) {
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [parentPageId, setParentPageId] = useState<string | undefined>()
  const [isSlugManuallyEdited, setIsSlugManuallyEdited] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Auto-generate slug from title
  useEffect(() => {
    if (!isSlugManuallyEdited && title) {
      const generatedSlug = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
      setSlug(generatedSlug)
    }
  }, [title, isSlugManuallyEdited])

  const handleSlugChange = (value: string) => {
    setSlug(value)
    setIsSlugManuallyEdited(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!title.trim() || !slug.trim()) {
      return
    }

    setIsSubmitting(true)
    try {
      await onCreatePage({
        title: title.trim(),
        slug: slug.trim(),
        parentPageId,
      })

      // Reset form and close modal
      setTitle('')
      setSlug('')
      setParentPageId(undefined)
      setIsSlugManuallyEdited(false)
      onOpenChange(false)
    } catch (error) {
      console.error('Failed to create page:', error)
      alert('Failed to create page. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create New Page</DialogTitle>
            <DialogDescription>
              Add a new page to this knowledge space.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="title">
                Page Title <span className="text-red-500">*</span>
              </Label>
              <Input
                id="title"
                placeholder="Enter page title..."
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                autoFocus
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="slug">
                URL Slug <span className="text-red-500">*</span>
              </Label>
              <Input
                id="slug"
                placeholder="page-url-slug"
                value={slug}
                onChange={(e) => handleSlugChange(e.target.value)}
                required
                pattern="^[a-z0-9-]+$"
                title="Only lowercase letters, numbers, and hyphens"
              />
              <p className="text-xs text-gray-500">
                Auto-generated from title. Only lowercase letters, numbers, and hyphens.
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="parentPage">Parent Page (Optional)</Label>
              <Select
                value={parentPageId}
                onValueChange={(value) => setParentPageId(value === 'none' ? undefined : value)}
              >
                <SelectTrigger id="parentPage">
                  <SelectValue placeholder="No parent (root page)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No parent (root page)</SelectItem>
                  {pages.map((page) => (
                    <SelectItem key={page.id} value={page.id}>
                      {page.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-500">
                Choose a parent page to nest this page under it.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || !title.trim() || !slug.trim()}>
              {isSubmitting ? 'Creating...' : 'Create Page'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
