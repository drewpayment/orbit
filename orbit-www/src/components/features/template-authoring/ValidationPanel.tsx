/**
 * Validation panel — Template Authoring Phase 2, Task 14.
 *
 * Runs the static validator against the CURRENT builder state on demand and
 * lists the problems it finds, each with a best-effort jump link back into
 * the tab that owns it (`validation-jump.ts`). Paths it cannot place render
 * as plain text, so nothing is ever hidden from the author.
 *
 * The result here is advisory only: it validates the in-memory draft, which
 * may differ from what is persisted. The publish gate is satisfied by
 * `markVersionValidated`, which re-validates the SAVED version server-side.
 * Editing the definition therefore clears a previous pass — a stale green
 * check next to changed content would be worse than no check at all.
 */
'use client'

import * as React from 'react'
import { AlertCircle, CheckCircle2, Loader2, ShieldQuestion } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import type { TemplateDefinition } from '@/lib/scaffolder/schema'
import type { ValidationResult } from '@/lib/scaffolder/validate'
import { parseJumpTarget, type JumpTarget } from './validation-jump'

export interface ValidationPanelProps {
  definition: TemplateDefinition
  /**
   * The `validateTemplateDefinition` server action, injected by the editor
   * shell rather than imported here: a leaf panel that imports a `'use
   * server'` module drags the whole Payload config into any test that renders
   * it, and the shell is the single place that needs the real binding.
   */
  validate: (definitionJson: unknown) => Promise<ValidationResult>
  /** Focus the tab/field an error points at. */
  onJumpTo?: (target: JumpTarget) => void
  /** Bumped by the editor's bottom bar to trigger a run from outside. */
  runToken?: number
  /** Reports each completed run to the parent. */
  onResult?: (result: ValidationResult) => void
  /**
   * Render the panel's own Validate button. The editor shell sets this false
   * because its bottom bar already owns the trigger (via `runToken`), and two
   * identically-labelled buttons doing the same thing is worse than one.
   */
  showTrigger?: boolean
}

export function ValidationPanel({
  definition,
  validate,
  onJumpTo,
  runToken,
  onResult,
  showTrigger = true,
}: ValidationPanelProps) {
  const [result, setResult] = React.useState<ValidationResult | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)

  const validateRef = React.useRef(validate)
  validateRef.current = validate
  const onResultRef = React.useRef(onResult)
  onResultRef.current = onResult
  const definitionRef = React.useRef(definition)
  definitionRef.current = definition

  const run = React.useCallback(async () => {
    setPending(true)
    setError(null)
    try {
      const next = await validateRef.current(definitionRef.current)
      setResult(next)
      onResultRef.current?.(next)
    } catch (err) {
      setResult(null)
      setError(err instanceof Error ? err.message : 'Validation could not be run.')
    } finally {
      setPending(false)
    }
  }, [])

  // A result belongs to the definition it was computed from. Any edit
  // invalidates it rather than leaving a stale verdict on screen.
  const firstRender = React.useRef(true)
  React.useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    setResult(null)
    setError(null)
  }, [definition])

  // Trigger from the bottom bar. Skipped on mount so the panel never
  // validates before the author asks.
  const seenToken = React.useRef(runToken)
  React.useEffect(() => {
    if (runToken === undefined || runToken === seenToken.current) return
    seenToken.current = runToken
    void run()
  }, [runToken, run])

  const errors = result?.errors ?? []

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Validation</h3>
        {showTrigger ? (
          <Button size="sm" variant="outline" onClick={() => void run()} disabled={pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Validate
          </Button>
        ) : pending ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : null}
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {!error && result === null && !pending ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <ShieldQuestion className="h-4 w-4" />
          Not validated yet.
        </p>
      ) : null}

      {result?.ok ? (
        <p className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="h-4 w-4" />
          Validation passed.
        </p>
      ) : null}

      {result && !result.ok ? (
        <div className="space-y-2">
          <p className="text-sm font-medium text-destructive">
            {errors.length} {errors.length === 1 ? 'problem' : 'problems'} found
          </p>
          <ul className="space-y-2">
            {errors.map((issue, i) => {
              const target = parseJumpTarget(issue.path)
              return (
                <li
                  key={`${issue.path}:${i}`}
                  className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm"
                >
                  <p>{issue.message}</p>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {target && onJumpTo ? (
                      <button
                        type="button"
                        className="font-mono underline underline-offset-2 hover:text-foreground"
                        onClick={() => onJumpTo(target)}
                      >
                        {target.label}
                      </button>
                    ) : (
                      <span className="font-mono">{issue.path || 'document'}</span>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
