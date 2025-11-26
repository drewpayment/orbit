'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Loader2, AlertCircle, CheckCircle2, Trash2, Webhook, Link2 } from 'lucide-react'
import { updateTemplate, deleteTemplate, registerTemplateWebhook, unregisterTemplateWebhook } from '@/app/actions/templates'

interface TemplateManagementFormProps {
  template: {
    id: string
    name: string
    slug: string
    description: string | null
    visibility: 'workspace' | 'shared' | 'public'
    sharedWith?: { id: string; name: string }[]
    workspace: { id: string; name: string }
  }
  availableWorkspaces: { id: string; name: string }[]
  canDelete: boolean
  hasWebhook: boolean
  webhookUrl: string
}

export function TemplateManagementForm({
  template,
  availableWorkspaces,
  canDelete,
  hasWebhook,
  webhookUrl,
}: TemplateManagementFormProps) {
  const router = useRouter()
  const [name, setName] = useState(template.name)
  const [description, setDescription] = useState(template.description || '')
  const [visibility, setVisibility] = useState<'workspace' | 'shared' | 'public'>(template.visibility)
  const [selectedWorkspaces, setSelectedWorkspaces] = useState<string[]>(
    template.sharedWith?.map((w) => w.id) || []
  )
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isWebhookActionInProgress, setIsWebhookActionInProgress] = useState(false)
  const [webhookEnabled, setWebhookEnabled] = useState(hasWebhook)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const handleWorkspaceToggle = (workspaceId: string) => {
    setSelectedWorkspaces((prev) =>
      prev.includes(workspaceId)
        ? prev.filter((id) => id !== workspaceId)
        : [...prev, workspaceId]
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    setIsSubmitting(true)

    try {
      const result = await updateTemplate({
        templateId: template.id,
        name,
        description,
        visibility,
        sharedWith: visibility === 'shared' ? selectedWorkspaces : [],
      })

      if (result.success) {
        setSuccess(true)
        setTimeout(() => {
          router.push('/templates')
          router.refresh()
        }, 1500)
      } else {
        setError(result.error || 'Failed to update template')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async () => {
    setError(null)
    setIsDeleting(true)

    try {
      const result = await deleteTemplate(template.id)

      if (result.success) {
        router.push('/templates')
        router.refresh()
      } else {
        setError(result.error || 'Failed to delete template')
        setIsDeleting(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
      setIsDeleting(false)
    }
  }

  const handleWebhookToggle = async () => {
    setError(null)
    setIsWebhookActionInProgress(true)

    try {
      if (webhookEnabled) {
        // Unregister webhook
        const result = await unregisterTemplateWebhook(template.id)
        if (result.success) {
          setWebhookEnabled(false)
          router.refresh()
        } else {
          setError(result.error || 'Failed to unregister webhook')
        }
      } else {
        // Register webhook
        const result = await registerTemplateWebhook(template.id)
        if (result.success) {
          setWebhookEnabled(true)
          router.refresh()
        } else {
          setError(result.error || 'Failed to register webhook')
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsWebhookActionInProgress(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8 max-w-2xl mx-auto">
      {/* Error Alert */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Success Alert */}
      {success && (
        <Alert className="border-green-500 bg-green-50 dark:bg-green-950">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <AlertTitle className="text-green-600">Template Updated</AlertTitle>
          <AlertDescription className="text-green-600">
            Your changes have been saved. Redirecting...
          </AlertDescription>
        </Alert>
      )}

      {/* Basic Information */}
      <Card>
        <CardHeader>
          <CardTitle>Basic Information</CardTitle>
          <CardDescription>
            Update the template name and description.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Template Name */}
          <div className="space-y-2">
            <Label htmlFor="name">
              Template Name <span className="text-red-500">*</span>
            </Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              disabled={isSubmitting || success}
              minLength={3}
              maxLength={100}
            />
            <p className="text-xs text-muted-foreground">
              Must be 3-100 characters.
            </p>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isSubmitting || success}
              rows={4}
              maxLength={2000}
            />
            <p className="text-xs text-muted-foreground">
              Supports markdown. Maximum 2000 characters.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Visibility & Sharing */}
      <Card>
        <CardHeader>
          <CardTitle>Visibility & Sharing</CardTitle>
          <CardDescription>
            Control who can see and use this template.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Visibility */}
          <div className="space-y-2">
            <Label htmlFor="visibility">
              Visibility <span className="text-red-500">*</span>
            </Label>
            <Select
              value={visibility}
              onValueChange={(value) => setVisibility(value as 'workspace' | 'shared' | 'public')}
              disabled={isSubmitting || success}
            >
              <SelectTrigger id="visibility">
                <SelectValue placeholder="Select visibility" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="workspace">Workspace Only</SelectItem>
                <SelectItem value="shared">Shared</SelectItem>
                <SelectItem value="public">Public</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {visibility === 'workspace' && 'Only members of your workspace can see this template.'}
              {visibility === 'shared' && 'Members of selected workspaces can see this template.'}
              {visibility === 'public' && 'Anyone in your organization can see this template.'}
            </p>
          </div>

          {/* Shared With (only shown when visibility is 'shared') */}
          {visibility === 'shared' && (
            <div className="space-y-2">
              <Label>
                Share With Workspaces <span className="text-red-500">*</span>
              </Label>
              <div className="border rounded-lg p-4 space-y-2 max-h-60 overflow-y-auto">
                {availableWorkspaces.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No other workspaces available.</p>
                ) : (
                  availableWorkspaces
                    .filter((w) => w.id !== template.workspace.id)
                    .map((workspace) => (
                      <div key={workspace.id} className="flex items-center space-x-2">
                        <Checkbox
                          id={`workspace-${workspace.id}`}
                          checked={selectedWorkspaces.includes(workspace.id)}
                          onCheckedChange={() => handleWorkspaceToggle(workspace.id)}
                          disabled={isSubmitting || success}
                        />
                        <Label
                          htmlFor={`workspace-${workspace.id}`}
                          className="text-sm font-normal cursor-pointer"
                        >
                          {workspace.name}
                        </Label>
                      </div>
                    ))
                )}
              </div>
              {visibility === 'shared' && selectedWorkspaces.length === 0 && (
                <p className="text-xs text-amber-600">
                  Please select at least one workspace to share with.
                </p>
              )}
            </div>
          )}

          {/* Current Workspace Info */}
          <div className="bg-muted/50 rounded-lg p-4">
            <p className="text-sm">
              <span className="font-medium">Owner Workspace:</span> {template.workspace.name}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Webhook Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>Automatic Sync</CardTitle>
          <CardDescription>
            Enable automatic manifest syncing when the repository is updated.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between">
            <div className="space-y-1 flex-1">
              <div className="flex items-center gap-2">
                <Webhook className="h-4 w-4" />
                <span className="font-medium">GitHub Webhook</span>
              </div>
              <p className="text-sm text-muted-foreground">
                {webhookEnabled
                  ? 'Webhook is active. The template will sync automatically when the repository is pushed to the default branch.'
                  : 'Enable webhook to automatically sync the manifest when the repository is updated.'}
              </p>
            </div>
            <Button
              type="button"
              variant={webhookEnabled ? 'destructive' : 'default'}
              onClick={handleWebhookToggle}
              disabled={isWebhookActionInProgress || isSubmitting || isDeleting}
            >
              {isWebhookActionInProgress ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {webhookEnabled ? 'Disabling...' : 'Enabling...'}
                </>
              ) : webhookEnabled ? (
                'Disable Webhook'
              ) : (
                'Enable Webhook'
              )}
            </Button>
          </div>

          {/* Webhook URL (for manual setup if needed) */}
          {webhookUrl && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Webhook URL</Label>
              <div className="flex items-center gap-2">
                <Input
                  value={webhookUrl}
                  readOnly
                  className="font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard.writeText(webhookUrl)
                  }}
                >
                  <Link2 className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Use this URL if you need to manually configure the webhook in GitHub.
              </p>
            </div>
          )}

          {/* Webhook Status */}
          {webhookEnabled && (
            <Alert>
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertTitle>Webhook Active</AlertTitle>
              <AlertDescription>
                The template will automatically sync when changes are pushed to the repository.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Submit Buttons */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex gap-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
            disabled={isSubmitting || isDeleting}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={
              isSubmitting ||
              isDeleting ||
              success ||
              !name ||
              (visibility === 'shared' && selectedWorkspaces.length === 0)
            }
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              'Save Changes'
            )}
          </Button>
        </div>

        {/* Delete Button */}
        {canDelete && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                variant="destructive"
                disabled={isSubmitting || isDeleting || success}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Template
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Template</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to delete this template? This action cannot be undone.
                  Any repositories created from this template will not be affected.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDelete}
                  disabled={isDeleting}
                  className="bg-red-600 hover:bg-red-700"
                >
                  {isDeleting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Deleting...
                    </>
                  ) : (
                    'Delete'
                  )}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </form>
  )
}
