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
import { normalizeInputSchema } from '@/lib/actions/input-schema'
import { inputSchemaToJsonSchema } from '@/lib/actions/input-schema-to-json-schema'
import { SchemaForm } from '@/components/forms/schema-form/SchemaForm'
import { runAction } from '@/app/(frontend)/self-service/actions'
import type { ActionSummary } from '@/app/(frontend)/self-service/actions'
import { approvalPolicyLabel } from './action-ui'

const RUN_ACTION_FORM_ID = 'run-action-dialog-form'

/**
 * Run dialog for a self-service Action (IDP refocus P3). Renders a
 * {@link SchemaForm} derived from the Action's `inputSchema.fields` via
 * {@link inputSchemaToJsonSchema} (Template Authoring Phase 2, Group A Task 6
 * — migrated off the hand-rolled field switch), then dispatches
 * {@link runAction}. On success it routes to the new run's detail page; the
 * server action is the source of truth for validation, so field errors
 * surface via toast in addition to SchemaForm's own client-side validation.
 *
 * SchemaForm's own submit button is hidden (`hideSubmit`) so Cancel/Run can
 * sit together in the dialog footer; the footer's Run button submits the
 * form by id (`form={RUN_ACTION_FORM_ID}`), which works even with zero
 * fields (an empty-but-valid form still submits normally).
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
  const normalized = useMemo(() => normalizeInputSchema(action.inputSchema), [action.inputSchema])
  const { schema, uiSchema } = useMemo(() => inputSchemaToJsonSchema(normalized), [normalized])

  const [submitting, setSubmitting] = useState(false)

  const approvalNote = approvalPolicyLabel(action.approvalPolicy)

  async function handleSubmit(values: Record<string, unknown>) {
    setSubmitting(true)
    try {
      const { runId } = await runAction({ actionId: action.id, inputs: values })
      toast.success(`Started "${action.name}"`)
      onOpenChange(false)
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

        {normalized.fields.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This action takes no inputs. Run it to start a new execution.
          </p>
        ) : (
          <SchemaForm
            id={RUN_ACTION_FORM_ID}
            pages={[{ title: action.name, schema, uiSchema }]}
            mode="single"
            hideSubmit
            onSubmit={handleSubmit}
          />
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
          {normalized.fields.length === 0 ? (
            <Button type="button" disabled={submitting} onClick={() => handleSubmit({})}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {submitting ? 'Starting…' : 'Run action'}
            </Button>
          ) : (
            <Button type="submit" form={RUN_ACTION_FORM_ID} disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {submitting ? 'Starting…' : 'Run action'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
