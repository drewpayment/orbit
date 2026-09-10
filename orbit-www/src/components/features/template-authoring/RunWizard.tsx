/**
 * Consumer run wizard — Template Authoring Phase 2, Task 16.
 *
 * Paged `SchemaForm` (mode `'wizard'`) over the published definition's
 * parameter pages → a Review step that previews planned changes via
 * `planRun` (a dry run under the hood — see `authoring-actions.ts`'s
 * `planRun` alias) → Submit calls `startRun` and redirects to the run
 * detail route.
 *
 * `planRun`/`startRun`/`getRun` are injected props (not imported server
 * actions) so this component is unit-testable with stubs and so the Server
 * Component page owns which concrete actions/data it wires up — the same
 * convention as `useRunPolling`'s injected `getRun`.
 *
 * `planRun` can fail for reasons entirely unrelated to whether the Go
 * scaffolder worker is up (e.g. `startDryRun` is manage-gated in
 * `authoring-actions.ts`, so a plain workspace member calling it from this
 * consumer wizard will always get a permission error) — this component
 * treats ANY planRun failure the same way: show "Preview unavailable" with
 * the error message, and never let a preview failure block the real Submit.
 */
'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ArrowLeft, Loader2 } from 'lucide-react'
import { SchemaForm } from '@/components/forms/schema-form/SchemaForm'
import type { SchemaFormPage } from '@/components/forms/schema-form/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useRunPolling } from './use-run-polling'
import type { ActionRun } from '@/payload-types'

export interface RunWizardPlanInput {
  templateVersionId: string
  parameters: Record<string, unknown>
}

export interface RunWizardStartResult {
  runId: string
  status: string
}

export interface RunWizardProps {
  /**
   * The definition reference used to build the redirect to the run detail
   * route. This is the `[id]` route segment — a document id from the
   * catalog's links, or a slug when someone typed the URL — and the run
   * pages resolve either.
   */
  templateRef: string
  templateVersionId: string
  pages: SchemaFormPage[]
  planRun: (input: RunWizardPlanInput) => Promise<{ runId: string }>
  startRun: (input: RunWizardPlanInput) => Promise<RunWizardStartResult>
  getRun: (id: string) => Promise<ActionRun | null>
}

type Phase = 'form' | 'review'

/** A single entry of a dry run's `plan` JSON, defensively typed (see design §4: `PlannedChange[]`). */
interface PlannedChangeLike {
  kind?: string
  name?: string
  description?: string
}

function asPlannedChanges(plan: unknown): PlannedChangeLike[] | null {
  if (!Array.isArray(plan)) return null
  return plan.map((entry) =>
    entry && typeof entry === 'object' ? (entry as PlannedChangeLike) : { description: String(entry) },
  )
}

export function RunWizard({ templateRef, templateVersionId, pages, planRun, startRun, getRun }: RunWizardProps) {
  const router = useRouter()
  const [phase, setPhase] = React.useState<Phase>(pages.length === 0 ? 'review' : 'form')
  const [parameters, setParameters] = React.useState<Record<string, unknown>>({})

  const [previewRunId, setPreviewRunId] = React.useState<string | null>(null)
  const [previewError, setPreviewError] = React.useState<Error | null>(null)
  const [previewRequested, setPreviewRequested] = React.useState(false)

  const [submitting, setSubmitting] = React.useState(false)
  const [submitError, setSubmitError] = React.useState<string | null>(null)

  const { run: previewRun, error: pollError } = useRunPolling(previewRunId, getRun)

  const requestPreview = React.useCallback(
    async (values: Record<string, unknown>) => {
      setPreviewError(null)
      setPreviewRunId(null)
      setPreviewRequested(true)
      try {
        const { runId } = await planRun({ templateVersionId, parameters: values })
        setPreviewRunId(runId)
      } catch (err) {
        setPreviewError(err instanceof Error ? err : new Error(String(err)))
      }
    },
    [planRun, templateVersionId],
  )

  function handleFormSubmit(values: Record<string, unknown>) {
    setParameters(values)
    setPhase('review')
    void requestPreview(values)
  }

  React.useEffect(() => {
    if (phase === 'review' && pages.length === 0 && !previewRequested) {
      void requestPreview(parameters)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  async function handleSubmit() {
    setSubmitting(true)
    setSubmitError(null)
    try {
      const { runId } = await startRun({ templateVersionId, parameters })
      router.push(`/self-service/templates/${templateRef}/run/${runId}`)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to start the run.')
      setSubmitting(false)
    }
  }

  if (phase === 'form') {
    return (
      <SchemaForm
        pages={pages}
        values={parameters}
        onSubmit={handleFormSubmit}
        mode="wizard"
        submitLabel="Review"
      />
    )
  }

  const effectiveError = previewError ?? pollError
  const isPreviewing = previewRequested && !effectiveError && (!previewRun || previewRun.status === 'pending' || previewRun.status === 'running')
  const plannedChanges = previewRun?.status === 'succeeded' ? asPlannedChanges(previewRun.plan) : null

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Review</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {Object.keys(parameters).length > 0 && (
            <dl className="grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-3 gap-y-1 text-sm">
              {Object.entries(parameters).map(([key, value]) => (
                <React.Fragment key={key}>
                  <dt className="font-medium text-muted-foreground">{key}</dt>
                  <dd className="break-words">{formatParamValue(value)}</dd>
                </React.Fragment>
              ))}
            </dl>
          )}

          {isPreviewing && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Generating preview…
            </p>
          )}

          {effectiveError && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div>
                <p className="font-medium text-amber-700 dark:text-amber-400">Preview unavailable</p>
                <p className="text-muted-foreground">{effectiveError.message}</p>
              </div>
            </div>
          )}

          {previewRun?.status === 'failed' && !effectiveError && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div>
                <p className="font-medium text-amber-700 dark:text-amber-400">Preview unavailable</p>
                <p className="text-muted-foreground">{previewRun.error ?? 'The preview run failed.'}</p>
              </div>
            </div>
          )}

          {plannedChanges && plannedChanges.length > 0 && (
            <ul className="space-y-2 text-sm">
              {plannedChanges.map((change, i) => (
                <li key={i} className="rounded-md border p-2">
                  {change.kind && <span className="mr-2 font-mono text-xs text-muted-foreground">{change.kind}</span>}
                  {change.name && <span className="font-medium">{change.name}</span>}
                  {change.description && <p className="text-muted-foreground">{change.description}</p>}
                </li>
              ))}
            </ul>
          )}

          {plannedChanges && plannedChanges.length === 0 && (
            <p className="text-sm text-muted-foreground">No planned changes reported.</p>
          )}

          {submitError && <p className="text-sm text-destructive">{submitError}</p>}
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        {pages.length > 0 && (
          <Button type="button" variant="outline" onClick={() => setPhase('form')} disabled={submitting}>
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        )}
        <Button type="button" onClick={handleSubmit} disabled={submitting}>
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          Submit
        </Button>
      </div>
    </div>
  )
}

function formatParamValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'object') {
    if ('secret' in (value as Record<string, unknown>)) return '••••••••'
    return JSON.stringify(value)
  }
  return String(value)
}
