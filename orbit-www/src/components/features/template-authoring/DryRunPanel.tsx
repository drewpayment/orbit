/**
 * Dry-run panel — Template Authoring Phase 2, Task 14.
 *
 * Fill the parameter form (or pick a saved fixture), start a `dryRun: true`
 * run against the SAVED version, then watch it via `useRunPolling`: per-step
 * status plus the plan's file tree.
 *
 * Two things worth knowing:
 *
 * 1. **It runs the saved version, not the editor's buffer.** A dry run needs
 *    a persisted `template-definition-versions` row to point at, so unsaved
 *    edits are not part of it. The panel says so rather than quietly running
 *    something other than what is on screen.
 * 2. **Success is recorded server-side.** When polling reaches `succeeded`,
 *    the panel calls `recordSuccessfulDryRun`, which re-verifies the run
 *    (dry, succeeded, belongs to this version) before stamping the version.
 *    That stamp is half the publish gate; `publishVersion` re-checks all of
 *    it again, so nothing here is trusted.
 */
'use client'

import * as React from 'react'
import { AlertCircle, Loader2, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SchemaForm } from '@/components/forms/schema-form/SchemaForm'
import type { ParameterPage } from '@/lib/scaffolder/schema'
import type { ActionRun } from '@/payload-types'
import { parameterPageToSchemaFormPage } from './schema-ui-split'
import { useRunPolling } from './use-run-polling'
import { parsePlanEntries } from './plan-entries'
import { FileTreeDiff } from './FileTreeDiff'
import type { FixtureRow } from './FixturesPanel'

const NO_FIXTURE = '__none__'

export interface DryRunPanelProps {
  versionId: string | null
  pages: ParameterPage[]
  fixtures: FixtureRow[]
  /** True when the editor holds unsaved changes — the run would use the saved version. */
  dirty: boolean
  /** Parameter values, owned by the shell so FixturesPanel can save them. */
  values: Record<string, unknown>
  onValuesChange: (values: Record<string, unknown>) => void
  startDryRun: (input: {
    templateVersionId: string
    parameters: Record<string, unknown>
    fixtureId?: string
  }) => Promise<{ runId: string }>
  getRun: (runId: string) => Promise<ActionRun | null>
  recordSuccessfulDryRun: (versionId: string, runId: string) => Promise<{ recorded: boolean }>
  /** Fired once the succeeded run has been recorded against the version. */
  onGateSatisfied?: () => void
  /** The template definition's own workspace — see `parameterPageToSchemaFormPage`'s doc comment. */
  workspaceId?: string
}

type StepStatus = NonNullable<ActionRun['steps']>[number]['status']

const STEP_VARIANT: Record<StepStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'outline',
  running: 'secondary',
  succeeded: 'default',
  failed: 'destructive',
  skipped: 'outline',
}

export function DryRunPanel({
  versionId,
  pages,
  fixtures,
  dirty,
  values,
  onValuesChange,
  startDryRun,
  getRun,
  recordSuccessfulDryRun,
  onGateSatisfied,
  workspaceId,
}: DryRunPanelProps) {
  const [runId, setRunId] = React.useState<string | null>(null)
  const [starting, setStarting] = React.useState(false)
  const [startError, setStartError] = React.useState<string | null>(null)
  const [fixtureId, setFixtureId] = React.useState<string>(NO_FIXTURE)

  // PR #105's hook is the single copy of this (my duplicate was dropped in
  // reconciliation): no type parameter, `error` is an Error, and the interval
  // lives in an options object.
  const { run, error: pollError, isPolling } = useRunPolling(runId, getRun)

  const schemaPages = React.useMemo(
    () => pages.map((p) => parameterPageToSchemaFormPage(p, workspaceId)),
    [pages, workspaceId],
  )
  // Files and every other planned kind — including the planner's `skipped`
  // and `unsupported` markers, which FileTreeDiff surfaces so a partial
  // preview never reads as a complete one.
  const plan = React.useMemo(() => parsePlanEntries(run?.plan), [run?.plan])

  // Record the succeeded run against its version exactly once. Keyed on the
  // run id so a re-render, a later poll, or a second dry run cannot re-fire it.
  const recordedRef = React.useRef<string | null>(null)
  const recordRef = React.useRef(recordSuccessfulDryRun)
  recordRef.current = recordSuccessfulDryRun
  const gateRef = React.useRef(onGateSatisfied)
  gateRef.current = onGateSatisfied

  React.useEffect(() => {
    if (!versionId || !run || run.status !== 'succeeded') return
    if (recordedRef.current === run.id) return
    recordedRef.current = run.id
    let cancelled = false
    void (async () => {
      try {
        const { recorded } = await recordRef.current(versionId, run.id)
        if (!cancelled && recorded) gateRef.current?.()
      } catch {
        // The publish gate re-derives this from the database; a failure here
        // only means the author must re-run, never a silently-passed gate.
        if (!cancelled) recordedRef.current = null
      }
    })()
    return () => {
      cancelled = true
    }
  }, [run, versionId])

  async function onStart() {
    if (!versionId) return
    setStartError(null)
    setStarting(true)
    try {
      const { runId: created } = await startDryRun({
        templateVersionId: versionId,
        parameters: values,
        fixtureId: fixtureId === NO_FIXTURE ? undefined : fixtureId,
      })
      setRunId(created)
    } catch (err) {
      // Includes the server-side parameter validation rejection, which is the
      // most common failure and needs to reach the author verbatim.
      setStartError(err instanceof Error ? err.message : 'Could not start the dry run.')
    } finally {
      setStarting(false)
    }
  }

  const usableFixtures = fixtures.filter((f): f is FixtureRow & { id: string } => !!f.id)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Dry run</h3>
        <Button size="sm" onClick={() => void onStart()} disabled={starting || !versionId || isPolling}>
          {starting || isPolling ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          Dry run
        </Button>
      </div>

      {!versionId ? (
        <Alert>
          <AlertDescription>Save a draft before running a preview.</AlertDescription>
        </Alert>
      ) : null}

      {dirty ? (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            You have unsaved changes. A dry run executes the last saved version, not what is on
            screen. Save a draft first to preview your edits.
          </AlertDescription>
        </Alert>
      ) : null}

      {startError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{startError}</AlertDescription>
        </Alert>
      ) : null}

      {pollError ? (
        <Alert variant="destructive">
          <AlertDescription>{pollError.message}</AlertDescription>
        </Alert>
      ) : null}

      {usableFixtures.length > 0 ? (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="dry-run-fixture">
            Fixture
          </label>
          <Select value={fixtureId} onValueChange={setFixtureId}>
            <SelectTrigger id="dry-run-fixture">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_FIXTURE}>Use the form below</SelectItem>
              {usableFixtures.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {fixtureId === NO_FIXTURE && schemaPages.length > 0 ? (
        <div className="rounded-md border p-3">
          <SchemaForm
            as="div"
            pages={schemaPages}
            values={values}
            onChange={onValuesChange}
            hideSubmit
            mode="single"
          />
        </div>
      ) : null}

      {run ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium">Status</span>
            <Badge variant={run.status === 'failed' ? 'destructive' : 'secondary'}>
              {run.status}
            </Badge>
            {isPolling ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : null}
          </div>

          {run.error ? (
            <Alert variant="destructive">
              <AlertDescription>{run.error}</AlertDescription>
            </Alert>
          ) : null}

          {run.steps && run.steps.length > 0 ? (
            <ul className="space-y-1">
              {run.steps.map((step) => (
                <li
                  key={step.id}
                  className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-sm"
                >
                  <span className="truncate">{step.name || step.id}</span>
                  <Badge variant={STEP_VARIANT[step.status]}>{step.status}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No step progress reported yet.</p>
          )}

          <div className="space-y-1.5">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Planned changes
            </h4>
            <FileTreeDiff entries={plan.files} others={plan.others} />
          </div>
        </div>
      ) : null}
    </div>
  )
}
