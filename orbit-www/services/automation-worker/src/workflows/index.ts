/**
 * Workflows barrel — the single module `worker.ts` points `workflowsPath` at.
 *
 * Temporal resolves a Schedule action's workflow by its EXPORTED NAME from the
 * bundled workflows module, so every workflow that a Schedule can start MUST be
 * re-exported here. Keeping both workflows in one barrel is what lets the
 * automation schedules and the scorecard sweep schedule share one worker/task
 * queue without either one's action failing to resolve.
 */

export { AutomationDispatchWorkflow } from './automation-dispatch'
export { ScorecardEvaluationSweepWorkflow } from './scorecard-sweep'
