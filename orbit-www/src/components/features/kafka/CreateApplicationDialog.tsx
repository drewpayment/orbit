'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { createApplication } from '@/app/actions/kafka-applications'
import { submitApplicationRequest } from '@/app/actions/kafka-application-requests'
import { QuotaExceededModal } from './QuotaExceededModal'
import type { QuotaInfo } from '@/lib/kafka/quotas'

interface CreateApplicationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  onSuccess: () => void
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 63)
}

export function CreateApplicationDialog({
  open,
  onOpenChange,
  workspaceId,
  onSuccess,
}: CreateApplicationDialogProps) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [description, setDescription] = useState('')
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false)
  const [loading, setLoading] = useState(false)

  // Quota exceeded modal state
  const [showQuotaModal, setShowQuotaModal] = useState(false)
  const [quotaInfo, setQuotaInfo] = useState<QuotaInfo | null>(null)
  const [submittingRequest, setSubmittingRequest] = useState(false)

  const handleNameChange = (value: string) => {
    setName(value)
    if (!slugManuallyEdited) {
      setSlug(slugify(value))
    }
  }

  const handleSlugChange = (value: string) => {
    setSlug(value)
    setSlugManuallyEdited(true)
  }

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error('Name is required')
      return
    }
    if (!slug.trim()) {
      toast.error('Slug is required')
      return
    }
    if (!/^[a-z][a-z0-9-]*$/.test(slug)) {
      toast.error(
        'Slug must start with a letter and contain only lowercase letters, numbers, and hyphens'
      )
      return
    }

    setLoading(true)
    try {
      const result = await createApplication({
        name: name.trim(),
        slug: slug.trim(),
        description: description.trim() || undefined,
        workspaceId,
      })

      if (result.success) {
        resetForm()
        onSuccess()
      } else if (result.quotaExceeded && result.quotaInfo) {
        // Show quota exceeded modal
        setQuotaInfo(result.quotaInfo)
        setShowQuotaModal(true)
      } else {
        toast.error(result.error || 'Failed to create application')
      }
    } catch {
      toast.error('Failed to create application')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmitRequest = async () => {
    setSubmittingRequest(true)
    try {
      const result = await submitApplicationRequest({
        workspaceId,
        applicationName: name.trim(),
        applicationSlug: slug.trim(),
        description: description.trim() || undefined,
      })

      if (result.success) {
        toast.success('Request submitted for approval')
        setShowQuotaModal(false)
        resetForm()
        onOpenChange(false)
      } else {
        toast.error(result.error || 'Failed to submit request')
      }
    } catch {
      toast.error('Failed to submit request')
    } finally {
      setSubmittingRequest(false)
    }
  }

  const resetForm = () => {
    setName('')
    setSlug('')
    setDescription('')
    setSlugManuallyEdited(false)
    setQuotaInfo(null)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Create Kafka Application</DialogTitle>
            <DialogDescription>
              Create a new Kafka application. This will provision three virtual clusters for dev,
              stage, and prod environments.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                placeholder="e.g., Payments Service"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                disabled={loading}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="slug">Slug</Label>
              <Input
                id="slug"
                placeholder="e.g., payments-service"
                value={slug}
                onChange={(e) => handleSlugChange(e.target.value)}
                disabled={loading}
              />
              <p className="text-sm text-muted-foreground">
                Used in hostnames: <code>{slug || 'your-app'}.dev.kafka.orbit.io</code>
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Textarea
                id="description"
                placeholder="What does this application do?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={loading}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create Application
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {quotaInfo && (
        <QuotaExceededModal
          open={showQuotaModal}
          onClose={() => setShowQuotaModal(false)}
          onSubmitRequest={handleSubmitRequest}
          quotaInfo={quotaInfo}
          applicationName={name}
          isSubmitting={submittingRequest}
        />
      )}
    </>
  )
}
