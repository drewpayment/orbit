/**
 * Long-running entry point for the automation Temporal worker (P4.2) and the
 * scheduled scorecard evaluation sweep (scorecards roadmap item 1).
 *
 * Runs as a SEPARATE Node process alongside the Next.js app — a Temporal Worker
 * is always its own process. It polls the dedicated `orbit-automations` task
 * queue, runs both the automation dispatch workflow and the scorecard sweep
 * workflow in the V8 sandbox, and executes their activities in plain Node. All
 * env is read here at startup.
 *
 * Startup order: connect → ensure the global sweep Schedule (FATAL on failure —
 * fail-closed, so a worker that can't guarantee its schedule exits nonzero and
 * the deployment restarts it) → create the worker → run.
 *
 * ESM note: orbit-www is `type: module`, so the workflows path is resolved via
 * `import.meta.url` (NOT `require.resolve`).
 */

import { fileURLToPath } from 'node:url'

import { NativeConnection, Worker } from '@temporalio/worker'

import * as dispatchActivities from './activities/dispatch'
import * as scorecardSweepActivities from './activities/scorecard-sweep'
import { connectAndEnsureSchedule, isSweepDisabled } from './schedule'
import { AUTOMATION_TASK_QUEUE, DEFAULT_SCORECARD_EVAL_CRON, SCORECARD_SWEEP_SCHEDULE_ID } from './shared'

async function run(): Promise<void> {
  const address = process.env.TEMPORAL_ADDRESS || 'localhost:7233'
  const namespace = process.env.TEMPORAL_NAMESPACE || 'default'

  // Temporal's workflow bundler needs the on-disk path to the workflows module,
  // resolved relative to this file rather than the CWD. The barrel re-exports
  // BOTH workflows so each Schedule action resolves its workflow by name.
  const workflowsPath = fileURLToPath(new URL('./workflows/index.ts', import.meta.url))

  // FATAL if this rejects: we refuse to poll a task queue whose sweep Schedule we
  // could not guarantee. The Connection is closed after the ensure — the worker
  // uses its own NativeConnection to poll.
  const scheduleConnection = await connectAndEnsureSchedule(address, namespace)
  await scheduleConnection.close()
  console.log(
    `[automation-worker] sweep schedule ensured — id "${SCORECARD_SWEEP_SCHEDULE_ID}", cron "${
      process.env.SCORECARD_EVAL_CRON || DEFAULT_SCORECARD_EVAL_CRON
    }", paused ${isSweepDisabled()}`,
  )

  const connection = await NativeConnection.connect({ address })

  const worker = await Worker.create({
    connection,
    namespace,
    taskQueue: AUTOMATION_TASK_QUEUE,
    workflowsPath,
    activities: { ...dispatchActivities, ...scorecardSweepActivities },
  })

  console.log(
    `[automation-worker] started — task queue "${AUTOMATION_TASK_QUEUE}", namespace "${namespace}", temporal "${address}"`,
  )

  // Drain in-flight work cleanly on termination so a redeploy doesn't drop a
  // due dispatch or a running sweep mid-flight.
  const shutdown = (signal: string): void => {
    console.log(`[automation-worker] received ${signal}, shutting down…`)
    worker.shutdown()
  }
  process.once('SIGINT', () => shutdown('SIGINT'))
  process.once('SIGTERM', () => shutdown('SIGTERM'))

  try {
    await worker.run()
  } finally {
    await connection.close()
  }
}

void run().catch((err) => {
  console.error('[automation-worker] fatal error:', err)
  process.exit(1)
})
