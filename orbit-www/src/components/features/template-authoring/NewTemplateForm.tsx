/**
 * Metadata-only create form (Template Authoring Phase 2, Task 8).
 *
 * Collects just enough to mint a draft definition + its version-1 snapshot,
 * then hands the author straight to the editor. Everything substantive
 * (parameters, steps, output) is authored there, not here — this form exists
 * so the editor always has a real definition id to save against.
 *
 * `createTemplateDefinition` re-checks the workspace RBAC gate server-side;
 * the workspace list this renders is only an affordance.
 */
'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { createTemplateDefinition } from '@/app/(frontend)/self-service/templates/authoring-actions'

export interface NewTemplateFormProps {
  workspaces: { id: string; name: string }[]
}

/** Preview of the kebab-case `metadata.name` the server will derive. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export function NewTemplateForm({ workspaces }: NewTemplateFormProps) {
  const router = useRouter()
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const [workspaceId, setWorkspaceId] = React.useState(workspaces[0]?.id ?? '')
  const [name, setName] = React.useState('')
  const [title, setTitle] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [owner, setOwner] = React.useState('')
  const [targetKind, setTargetKind] = React.useState('')
  const [visibility, setVisibility] = React.useState<'workspace' | 'shared' | 'public'>('workspace')
  const [sourceMode, setSourceMode] = React.useState<'orbit' | 'git'>('orbit')

  const slug = slugify(name)

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    if (!workspaceId) {
      setError('Choose a workspace.')
      return
    }
    if (!slug) {
      setError('Enter a name using at least one letter or number.')
      return
    }
    setPending(true)
    try {
      const { id } = await createTemplateDefinition({
        workspaceId,
        name: name.trim(),
        title: title.trim() || undefined,
        description: description.trim() || undefined,
        owner: owner.trim() || undefined,
        targetKind: targetKind.trim() || undefined,
        visibility,
        sourceMode,
      })
      router.push(`/self-service/templates/${id}/edit`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the template.')
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="template-workspace">Workspace</Label>
        <Select value={workspaceId} onValueChange={setWorkspaceId}>
          <SelectTrigger id="template-workspace">
            <SelectValue placeholder="Choose a workspace" />
          </SelectTrigger>
          <SelectContent>
            {workspaces.map((w) => (
              <SelectItem key={w.id} value={w.id}>
                {w.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="template-name">Name</Label>
        <Input
          id="template-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Backend service"
          required
        />
        <p className="text-xs text-muted-foreground">
          {slug ? `Identifier: ${slug}` : 'Used to derive the template identifier.'}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="template-title">Title</Label>
        <Input
          id="template-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Defaults to the name"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="template-description">Description</Label>
        <Textarea
          id="template-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="What this paved path creates, and when to reach for it."
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="template-owner">Owner</Label>
          <Input
            id="template-owner"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            placeholder="platform-team"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="template-target-kind">Target kind</Label>
          <Input
            id="template-target-kind"
            value={targetKind}
            onChange={(e) => setTargetKind(e.target.value)}
            placeholder="service"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="template-visibility">Visibility</Label>
          <Select
            value={visibility}
            onValueChange={(v) => setVisibility(v as typeof visibility)}
          >
            <SelectTrigger id="template-visibility">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="workspace">Workspace</SelectItem>
              <SelectItem value="shared">Shared</SelectItem>
              <SelectItem value="public">Public</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Publishing a shared or public template additionally requires a platform admin.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="template-source-mode">Source</Label>
          <Select value={sourceMode} onValueChange={(v) => setSourceMode(v as typeof sourceMode)}>
            <SelectTrigger id="template-source-mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="orbit">Authored in Orbit</SelectItem>
              <SelectItem value="git">Backed by git</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Create draft
      </Button>
    </form>
  )
}
