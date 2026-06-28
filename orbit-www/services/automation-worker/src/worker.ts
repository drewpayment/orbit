/**
 * Long-running entry point for the automation Temporal worker (P4.2).
 *
 * Runs as a SEPARATE Node process alongside the Next.js app — a Temporal Worker
 * is always its own process. It polls the dedicated `orbit-automations` task
 * queue, runs the dispatch workflow in the V8 sandbox, and executes the dispatch
 * activity in plain Node. All env is read here at startup.
 *
 * ESM note: orbit-www is `type: module`, so the workflows path is resolved via
 * `import.meta.url` (NOT `require.resolve`).
 */

import { fileURLToPath } from 'node:url'

import { NativeConnection, Worker } from '@temporalio/worker'

import * as activities from './activities/dispatch'
import { AUTOMATION_TASK_QUEUE } from './shared'

async function run(): Promise<void> {
  const address = process.env.TEMPORAL_ADDRESS || 'localhost:7233'
  const namespace = process.env.TEMPORAL_NAMESPACE || 'default'

  // Temporal's workflow bundler needs the on-disk path to the workflows module,
  // resolved relative to this file rather than the CWD.
  const workflowsPath = fileURLToPath(new URL('./workflows/automation-dispatch.ts', import.meta.url))

  const connection = await NativeConnection.connect({ address })

  const worker = await Worker.create({
    connection,
    namespace,
    taskQueue: AUTOMATION_TASK_QUEUE,
    workflowsPath,
    activities,
  })

  console.log(
    `[automation-worker] started — task queue "${AUTOMATION_TASK_QUEUE}", namespace "${namespace}", temporal "${address}"`,
  )

  // Drain in-flight work cleanly on termination so a redeploy doesn't drop a
  // due dispatch mid-flight.
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
