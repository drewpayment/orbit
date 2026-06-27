'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { Action } from '@/payload-types'
import {
  createAction,
  updateAction,
  type ActionFormValues,
} from '@/app/(frontend)/self-service/authoring-actions'
import {
  assembleInputSchema,
  validateBuilderFields,
  type BuilderField,
} from './input-schema-builder'
import { InputSchemaBuilder } from './InputSchemaBuilder'
import { BackendConfigFields, type BackendConfig } from './BackendConfigFields'

type ApprovalPolicy = NonNullable<Action['approvalPolicy']>

const APPROVAL_OPTIONS: ReadonlyArray<{ value: ApprovalPolicy; label: string }> = [
  { value: 'none', label: 'No approval' },
  { value: 'workspace-admin', label: 'Workspace admin approval' },
  { value: 'platform-admin', label: 'Platform admin approval' },
]

export interface ActionWorkspaceOption {
  id: string
  name: string
}

export interface ActionFormInitial {
  name: string
  description?: string | null
  icon?: string | null
  approvalPolicy: ApprovalPolicy
  backend: BackendConfig
  fields: BuilderField[]
  enabled: boolean
}

type ActionFormProps =
  | {
      mode: 'create'
      workspaces: ActionWorkspaceOption[]
    }
  | {
      mode: 'edit'
      actionId: string
      initial: ActionFormInitial
    }

/**
 * Create/edit form for a self-service Action (IDP refocus P3). On `create` it
 * renders a workspace picker (the manageable workspaces the page resolved) and
 * redirects to the self-service hub; on `edit` it patches in place. Authoring is
 * enforced server-side by the create/update actions — this form is only rendered
 * for users the page already authorized.
 */
export function ActionForm(props: ActionFormProps) {
  const router = useRouter()
  const isEdit = props.mode === 'edit'
  const initial = isEdit ? props.initial : undefined

  const [workspace, setWorkspace] = useState(
    props.mode === 'create' ? (props.workspaces[0]?.id ?? '') : '',
  )
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [icon, setIcon] = useState(initial?.icon ?? '')
  const [approvalPolicy, setApprovalPolicy] = useState<ApprovalPolicy>(
    initial?.approvalPolicy ?? 'none',
  )
  const [backend, setBackend] = useState<BackendConfig>(
    initial?.backend ?? { type: 'builtin', ref: '' },
  )
  const [fields, setFields] = useState<BuilderField[]>(initial?.fields ?? [])
  const [enabled, setEnabled] = useState(initial?.enabled ?? true)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      toast.error('An action name is required.')
      return
    }
    if (props.mode === 'create' && !workspace) {
      toast.error('Select a workspace.')
      return
    }
    const fieldError = validateBuilderFields(fields)
    if (fieldError) {
      toast.error(fieldError)
      return
    }

    const values: ActionFormValues = {
      name,
      description,
      icon,
      approvalPolicy,
      backend: { type: backend.type, ref: backend.ref },
      inputSchema: assembleInputSchema(fields),
      enabled,
    }

    setSubmitting(true)
    try {
      if (props.mode === 'create') {
        await createAction({ ...values, workspace })
        toast.success('Action created')
        router.push('/self-service')
      } else {
        await updateAction(props.actionId, values)
        toast.success('Action updated')
        router.refresh()
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save action')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {props.mode === 'create' && (
        <div className="space-y-1.5">
          <Label htmlFor="action-workspace">Workspace</Label>
          <Select value={workspace} onValueChange={setWorkspace}>
            <SelectTrigger id="action-workspace">
              <SelectValue placeholder="Select a workspace" />
            </SelectTrigger>
            <SelectContent>
              {props.workspaces.map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="action-name">Name</Label>
        <Input
          id="action-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Register a service"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="action-description">Description</Label>
        <Textarea
          id="action-description"
          value={description ?? ''}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What this action does and when to use it."
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="action-icon">Icon (optional)</Label>
        <Input
          id="action-icon"
          value={icon ?? ''}
          onChange={(e) => setIcon(e.target.value)}
          placeholder="lucide icon name, e.g. rocket"
        />
        <p className="text-xs text-muted-foreground">
          A{' '}
          <a
            href="https://lucide.dev/icons"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            lucide icon
          </a>{' '}
          name shown on the catalog card.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="action-approval">Approval policy</Label>
        <Select
          value={approvalPolicy}
          onValueChange={(v) => setApprovalPolicy(v as ApprovalPolicy)}
        >
          <SelectTrigger id="action-approval">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {APPROVAL_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <BackendConfigFields value={backend} onChange={setBackend} />

      <InputSchemaBuilder value={fields} onChange={setFields} />

      <div className="flex items-center gap-2">
        <Switch id="action-enabled" checked={enabled} onCheckedChange={setEnabled} />
        <Label htmlFor="action-enabled">Enabled</Label>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="submit" disabled={submitting}>
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {isEdit ? 'Save changes' : 'Create action'}
        </Button>
      </div>
    </form>
  )
}
