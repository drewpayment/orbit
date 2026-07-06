/**
 * The dispatch workflow — thin by design.
 *
 * Runs in Temporal's deterministic V8 sandbox: NO Node APIs, NO `Date.now()` /
 * `Math.random()`, NO Payload/Mongo imports. Its sole job is to invoke the
 * `dispatchScheduledAutomation` activity, which does the actual HTTP POST. The
 * activity import is TYPE-only so the sandbox never loads the activity's Node
 * code; `proxyActivities` resolves it on the worker side at run time.
 *
 * The exported function name MUST equal AUTOMATION_DISPATCH_WORKFLOW
 * ('AutomationDispatchWorkflow') — the Temporal Schedule action starts the
 * workflow by that name.
 */

import { proxyActivities } from '@temporalio/workflow'

import type * as activities from '../activities/dispatch'
import type { AutomationDispatchInput } from '../shared'

const { dispatchScheduledAutomation } = proxyActivities<typeof activities>({
  startToCloseTimeout: '1m',
  retry: { maximumAttempts: 5 },
})

export async function AutomationDispatchWorkflow(input: AutomationDispatchInput): Promise<void> {
  await dispatchScheduledAutomation(input)
}
