/**
 * Activities for the scheduled scorecard evaluation sweep (scorecards roadmap
 * item 1).
 *
 * These run in plain Node (NOT the workflow sandbox), so they are free to read
 * the environment and use global `fetch`. Like the automation dispatch activity,
 * they stay deliberately thin: all real work (listing enabled scorecards,
 * running `runScorecardEvaluation`, recomputing entity scores, capturing
 * snapshots) lives behind the internal scorecard routes in orbit-www. The
 * activities' only job is to call those routes and to fail loudly so Temporal
 * retries.
 *
 * See docs/plans/2026-07-02-scheduled-scorecard-evaluation.md.
 */

import { ApplicationFailure } from '@temporalio/activity'

import type { DueScorecard } from '../shared'

/**
 * Read the two required internal-API env vars at CALL time (not module scope) so
 * the worker picks up config without a restart-order dependency and so missing
 * config produces a clear, actionable error rather than a silent `undefined` in
 * the URL.
 *
 * @throws a plain (retryable) Error naming the first missing var.
 */
function readInternalApiConfig(activity: string): { apiUrl: string; apiKey: string } {
  const apiUrl = process.env.ORBIT_API_URL
  if (!apiUrl) {
    throw new Error(`${activity}: missing required env var ORBIT_API_URL`)
  }
  const apiKey = process.env.ORBIT_INTERNAL_API_KEY
  if (!apiKey) {
    throw new Error(`${activity}: missing required env var ORBIT_INTERNAL_API_KEY`)
  }
  return { apiUrl, apiKey }
}

/**
 * Classify a non-2xx response the same way the dispatch activity does: a 4xx is
 * TERMINAL (the request itself is wrong and will never succeed on retry) → a
 * non-retryable {@link ApplicationFailure} so Temporal stops the retry storm; any
 * other non-2xx (5xx/network) is transient → a plain Error that Temporal retries
 * per the workflow policy.
 */
async function throwForResponse(activity: string, response: Response, context: string): Promise<never> {
  const body = await response.text().catch(() => '<unreadable response body>')
  const message = `${activity}: ${context} returned ${response.status} ${response.statusText}: ${body}`
  if (response.status >= 400 && response.status < 500) {
    throw ApplicationFailure.nonRetryable(message, 'ScorecardSweepTerminal')
  }
  throw new Error(message)
}

/**
 * List every enabled scorecard (across all workspaces) that is due for the
 * nightly sweep, via GET `${ORBIT_API_URL}/api/internal/scorecards/due`.
 *
 * @throws if env is missing, or if the route responds non-2xx (4xx →
 *   non-retryable, else retryable).
 */
export async function listEnabledScorecards(): Promise<DueScorecard[]> {
  const { apiUrl, apiKey } = readInternalApiConfig('listEnabledScorecards')

  const url = `${apiUrl}/api/internal/scorecards/due`
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'X-API-Key': apiKey,
    },
  })

  if (!response.ok) {
    await throwForResponse('listEnabledScorecards', response, 'due route')
  }

  const data = (await response.json()) as { scorecards?: DueScorecard[] }
  return data.scorecards ?? []
}

/**
 * Trigger evaluation of a single scorecard via POST
 * `${ORBIT_API_URL}/api/internal/scorecards/evaluate`. The route re-runs the
 * scorecard pipeline (which also recomputes entity scores and captures score
 * snapshots), so the sweep needs no extra calls for trend history.
 *
 * @throws if env is missing, or if the route responds non-2xx (4xx →
 *   non-retryable, else retryable).
 */
export async function evaluateScorecard(input: { scorecardId: string }): Promise<void> {
  const { apiUrl, apiKey } = readInternalApiConfig('evaluateScorecard')

  const url = `${apiUrl}/api/internal/scorecards/evaluate`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify({ scorecardId: input.scorecardId }),
  })

  if (!response.ok) {
    await throwForResponse(
      'evaluateScorecard',
      response,
      `evaluate route for scorecard ${input.scorecardId}`,
    )
  }
}
