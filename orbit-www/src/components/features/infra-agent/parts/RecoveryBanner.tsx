'use client'

import { AlertTriangle, RotateCcw, CheckCircle2 } from 'lucide-react'

import { Button } from '@/components/ui/button'

interface Props {
  errorText: string
  onRetry: () => void
  onMarkDone: () => void
  busy: boolean
}

// Shown when the agent's LLM call failed *after* at least one tool has
// already run. The run is parked in awaiting_user (not failed) so the
// deployment work-product isn't thrown away; the user picks how to
// recover. See GitHub issue #42.
export function RecoveryBanner({ errorText, onRetry, onMarkDone, busy }: Props) {
  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3">
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden />
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <p className="text-sm font-medium text-amber-200">
              Agent hit an error mid-conversation
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Tools that already ran succeeded — the agent only failed on its next LLM call.
              Retry that step, mark the run done if the deploy is already finished, or type a
              follow-up to redirect.
            </p>
          </div>
          <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background/60 p-2 font-mono text-[11px] text-muted-foreground">
            {errorText}
          </pre>
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant="outline"
              onClick={onRetry}
              disabled={busy}
              className="h-7 px-2.5 text-xs"
            >
              <RotateCcw className="mr-1 h-3 w-3" /> Retry last turn
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={onMarkDone}
              disabled={busy}
              className="h-7 px-2.5 text-xs"
            >
              <CheckCircle2 className="mr-1 h-3 w-3" /> Mark as done
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
