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

import { proxyActivities, workflowInfo } from '@temporalio/workflow'

import type * as activities from '../activities/scorecard-sweep'
import type { ScorecardSweepResult } from '../shared'
import { errorDetail, groupByKey, runWithConcurrency } from './concurrency'

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

const { captureWorkspaceSnapshots } = proxyActivities<typeof activities>({
  startToCloseTimeout: '5m',
  retry: { maximumAttempts: 5 },
})

export async function ScorecardEvaluationSweepWorkflow(): Promise<ScorecardSweepResult> {
  const info = workflowInfo()
  const capturePrefix = `${info.workflowId}:${info.runId}`
  const scorecards = await listEnabledScorecards()
  const workspaces = groupByKey(scorecards, (scorecard) => scorecard.workspaceId)

  // Per-item errors are captured (never thrown) so a single failing scorecard
  // cannot abort the sweep; `runWithConcurrency` only rejects on a thrown error,
  // so we always resolve to a sentinel. `errorDetail` digs the real HTTP detail
  // out of the retry-exhausted ActivityFailure's `.cause`.
  const workspaceOutcomes = await runWithConcurrency(
    workspaces,
    EVALUATION_CONCURRENCY,
    async (workspace) => {
      const outcomes: ({ ok: true } | { ok: false; scorecardId: string; error: string })[] = []
      // A workspace is one consistency boundary: evaluate its scorecards in
      // order with snapshot side effects suppressed, then capture one final
      // forced snapshot from the settled projections.
      for (const scorecard of workspace.items) {
        try {
          await evaluateScorecard({ scorecardId: scorecard.id, captureSnapshots: false })
          outcomes.push({ ok: true })
        } catch (err) {
          outcomes.push({ ok: false, scorecardId: scorecard.id, error: errorDetail(err) })
        }
      }
      if (outcomes.every((outcome) => outcome.ok)) {
        await captureWorkspaceSnapshots({
          workspaceId: workspace.key,
          captureKey: capturePrefix,
        })
      }
      return outcomes
    },
  )
  const outcomes = workspaceOutcomes.flat()

  const failed = outcomes
    .filter((o): o is { ok: false; scorecardId: string; error: string } => !o.ok)
    .map(({ scorecardId, error }) => ({ scorecardId, error }))

  return {
    total: scorecards.length,
    succeeded: scorecards.length - failed.length,
    failed,
  }
}
