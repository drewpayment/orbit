'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Play } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { runEvaluation } from '@/app/(frontend)/scorecards/actions'

/**
 * "Evaluate now" — re-runs scorecard evaluation server-side, then refreshes the
 * route so the freshly written results render. Disabled while running.
 *
 * Busy state is driven solely by `running` (reset in `finally`). We call
 * router.refresh() directly rather than wrapping it in a useTransition: the
 * refresh's pending flag does not reliably clear after router.refresh(), which
 * previously left the button stuck on "Evaluating…". The success toast confirms
 * completion immediately; the results matrix re-renders a beat later.
 */
export function EvaluateButton({ scorecardId }: { scorecardId: string }) {
  const router = useRouter()
  const [running, setRunning] = useState(false)

  async function handleClick() {
    setRunning(true)
    try {
      const summary = await runEvaluation(scorecardId)
      toast.success(
        `Evaluated ${summary.entitiesEvaluated} ${
          summary.entitiesEvaluated === 1 ? 'entity' : 'entities'
        } against ${summary.rulesEvaluated} ${
          summary.rulesEvaluated === 1 ? 'rule' : 'rules'
        }.`,
      )
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Evaluation failed')
    } finally {
      setRunning(false)
    }
  }

  return (
    <Button onClick={handleClick} disabled={running} size="sm">
      {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
      {running ? 'Evaluating…' : 'Evaluate now'}
    </Button>
  )
}
