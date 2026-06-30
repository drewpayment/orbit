/**
 * Activity that hands a due schedule automation off to orbit-www.
 *
 * This runs in plain Node (NOT the workflow sandbox), so it is free to read the
 * environment and use global `fetch`. It stays deliberately thin: all real work
 * (loading the automation, resolving inputs, creating + executing the run) lives
 * behind the internal dispatch route in orbit-www. The activity's only job is to
 * POST and to fail loudly so Temporal retries.
 *
 * See docs/plans/2026-06-27-automation-temporal-ts-worker.md.
 */

import { ApplicationFailure } from '@temporalio/activity'

import type { AutomationDispatchInput } from '../shared'

/**
 * POST the due automation to orbit-www's internal dispatch route.
 *
 * Env is read at call time (not module scope) so the worker process picks up
 * config without a restart-order dependency and so missing config produces a
 * clear, actionable error rather than a silent `undefined` in the URL.
 *
 * @throws if `ORBIT_API_URL` or `ORBIT_INTERNAL_API_KEY` is missing, or if the
 *   dispatch route responds non-2xx. A 4xx (terminal — e.g. invalid inputs that
 *   can never succeed on retry) is thrown as a non-retryable
 *   {@link ApplicationFailure} so Temporal STOPS retrying; a 5xx/network failure
 *   is thrown as a plain Error so Temporal retries per the workflow's policy.
 */
export async function dispatchScheduledAutomation(input: AutomationDispatchInput): Promise<void> {
  const apiUrl = process.env.ORBIT_API_URL
  if (!apiUrl) {
    throw new Error('dispatchScheduledAutomation: missing required env var ORBIT_API_URL')
  }

  const apiKey = process.env.ORBIT_INTERNAL_API_KEY
  if (!apiKey) {
    throw new Error('dispatchScheduledAutomation: missing required env var ORBIT_INTERNAL_API_KEY')
  }

  const url = `${apiUrl}/api/internal/automations/dispatch`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify({
      type: 'schedule',
      workspace: input.workspaceId,
      automationId: input.automationId,
    }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '<unreadable response body>')
    const message = `dispatchScheduledAutomation: dispatch route returned ${response.status} ${response.statusText} for automation ${input.automationId}: ${body}`

    // A 4xx is terminal: the request itself is wrong (e.g. invalid/missing
    // required inputs) and will never succeed on retry. Throw it non-retryable
    // so Temporal stops the retry storm. Any other non-2xx (5xx/network) is
    // transient → plain Error, which Temporal retries per the workflow policy.
    if (response.status >= 400 && response.status < 500) {
      throw ApplicationFailure.nonRetryable(message, 'DispatchTerminal')
    }
    throw new Error(message)
  }
}
