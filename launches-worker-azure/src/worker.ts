import { NativeConnection, Worker } from "@temporalio/worker";
import * as activities from "./activities";

async function run() {
  const temporalAddress = process.env.TEMPORAL_ADDRESS || "localhost:7233";
  const namespace = process.env.TEMPORAL_NAMESPACE || "default";
  const taskQueue = process.env.TASK_QUEUE || "launches_azure";

  console.log(`Connecting to Temporal at ${temporalAddress}`);

  const connection = await NativeConnection.connect({
    address: temporalAddress,
  });

  const worker = await Worker.create({
    connection,
    namespace,
    activities,
    taskQueue,
  });

  console.log(`Azure worker started, listening on task queue: ${taskQueue}`);
  await worker.run();
}

run().catch((err) => {
  console.error("Azure worker failed:", err);
  process.exit(1);
});
