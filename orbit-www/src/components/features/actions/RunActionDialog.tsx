'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Play } from 'lucide-react'
import { toast } from 'sonner'
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
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  normalizeInputSchema,
  type ActionInputField,
} from '@/lib/actions/input-schema'
import { runAction } from '@/app/(frontend)/self-service/actions'
import type { ActionSummary } from '@/app/(frontend)/self-service/actions'
import { approvalPolicyLabel } from './action-ui'

/**
 * Run dialog for a self-service Action (IDP refocus P3). Renders a form derived
 * from the Action's `inputSchema.fields` — text→Input, textarea→Textarea,
 * number→number Input, boolean→Checkbox, select→Select — then dispatches
 * {@link runAction}. On success it routes to the new run's detail page; the
 * server action is the source of truth for validation, so field errors surface
 * via toast.
 */
export function RunActionDialog({
  action,
  open,
  onOpenChange,
}: {
  action: ActionSummary
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const schema = useMemo(() => normalizeInputSchema(action.inputSchema), [action.inputSchema])
  const fields = schema.fields

  const [values, setValues] = useState<Record<string, unknown>>({})
  const [submitting, setSubmitting] = useState(false)

  const approvalNote = approvalPolicyLabel(action.approvalPolicy)

  function setField(name: string, value: unknown) {
    setValues((prev) => ({ ...prev, [name]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      const { runId } = await runAction({ actionId: action.id, inputs: values })
      toast.success(`Started "${action.name}"`)
      onOpenChange(false)
      setValues({})
      router.push(`/self-service/runs/${runId}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start action')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Run {action.name}</DialogTitle>
          {action.description && <DialogDescription>{action.description}</DialogDescription>}
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {fields.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              This action takes no inputs. Run it to start a new execution.
            </p>
          ) : (
            fields.map((field) => (
              <ActionField
                key={field.name}
                field={field}
                value={values[field.name]}
                onChange={(v) => setField(field.name, v)}
              />
            ))
          )}

          {approvalNote && (
            <p className="rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              Requires {approvalNote.toLowerCase()} before it executes.
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {submitting ? 'Starting…' : 'Run action'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Renders one input row from an {@link ActionInputField}. */
function ActionField({
  field,
  value,
  onChange,
}: {
  field: ActionInputField
  value: unknown
  onChange: (value: unknown) => void
}) {
  const id = `action-field-${field.name}`

  if (field.type === 'boolean') {
    return (
      <div className="flex items-start gap-2">
        <Checkbox
          id={id}
          checked={value === true}
          onCheckedChange={(checked) => onChange(checked === true)}
        />
        <div className="space-y-1 leading-none">
          <Label htmlFor={id} className="cursor-pointer">
            {field.label}
            {field.required && <span className="ml-0.5 text-destructive">*</span>}
          </Label>
          {field.help && <p className="text-xs text-muted-foreground">{field.help}</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {field.label}
        {field.required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>

      {field.type === 'textarea' ? (
        <Textarea
          id={id}
          value={typeof value === 'string' ? value : ''}
          placeholder={field.placeholder}
          required={field.required}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : field.type === 'select' ? (
        <Select value={typeof value === 'string' ? value : ''} onValueChange={onChange}>
          <SelectTrigger id={id}>
            <SelectValue placeholder={field.placeholder ?? 'Select…'} />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          id={id}
          type={field.type === 'number' ? 'number' : 'text'}
          value={
            value === undefined || value === null ? '' : (value as string | number)
          }
          placeholder={field.placeholder}
          required={field.required}
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      {field.help && <p className="text-xs text-muted-foreground">{field.help}</p>}
    </div>
  )
}
