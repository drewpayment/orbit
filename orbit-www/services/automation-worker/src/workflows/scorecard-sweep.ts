/**
 * The scorecard evaluation sweep workflow — thin, but with fan-out.
 *
 * Runs in Temporal's deterministic V8 sandbox: NO Node APIs, NO `Date.now()` /
 * `Math.random()`, NO Payload/Mongo imports. Activity imports are TYPE-only so
 * the sandbox never loads the activities' Node code; `proxyActivities` resolves
 * them on the worker side at run time. The `runWithConcurrency` / `errorDetail`
 * helpers are pure JS (import nothing) so they are safe to import here.
 *
 * The exported function name MUST equal SCORECARD_SWEEP_WORKFLOW
 * ('ScorecardEvaluationSweepWorkflow') — the Temporal Schedule action starts the
 * workflow by that name.
 *
 * Flow: list every enabled scorecard, then evaluate each with bounded
 * concurrency (3) to avoid hammering the app. Per-item failures are CAUGHT and
 * collected — one bad scorecard must never abort the sweep — and reported in the
 * result so the Temporal UI shows exactly what happened.
 *
 * See docs/plans/2026-07-02-scheduled-scorecard-evaluation.md.
 */

import { proxyActivities } from '@temporalio/workflow'

import type * as activities from '../activities/scorecard-sweep'
import type { ScorecardSweepResult } from '../shared'
import { errorDetail, runWithConcurrency } from './concurrency'

/** How many scorecard evaluations run at once. Keeps app load bounded. */
const EVALUATION_CONCURRENCY = 3

const { listEnabledScorecards } = proxyActivities<typeof activities>({
  startToCloseTimeout: '1m',
  retry: { maximumAttempts: 5 },
})

const { evaluateScorecard } = proxyActivities<typeof activities>({
  // A big-workspace evaluation is slow — give it a generous window.
  startToCloseTimeout: '5m',
  retry: { maximumAttempts: 5 },
})

export async function ScorecardEvaluationSweepWorkflow(): Promise<ScorecardSweepResult> {
  const scorecards = await listEnabledScorecards()

  // Per-item errors are captured (never thrown) so a single failing scorecard
  // cannot abort the sweep; `runWithConcurrency` only rejects on a thrown error,
  // so we always resolve to a sentinel. `errorDetail` digs the real HTTP detail
  // out of the retry-exhausted ActivityFailure's `.cause`.
  const outcomes = await runWithConcurrency(scorecards, EVALUATION_CONCURRENCY, async (scorecard) => {
    try {
      await evaluateScorecard({ scorecardId: scorecard.id })
      return { ok: true as const }
    } catch (err) {
      return { ok: false as const, scorecardId: scorecard.id, error: errorDetail(err) }
    }
  })

  const failed = outcomes
    .filter((o): o is { ok: false; scorecardId: string; error: string } => !o.ok)
    .map(({ scorecardId, error }) => ({ scorecardId, error }))

  return {
    total: scorecards.length,
    succeeded: scorecards.length - failed.length,
    failed,
  }
}
