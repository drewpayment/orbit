import { Context } from "@temporalio/activity";
import { LocalWorkspace } from "@pulumi/pulumi/automation";
import * as path from "path";
import type { DestroyInfraInput } from "../types";

export async function destroyInfra(input: DestroyInfraInput): Promise<void> {
  const ctx = Context.current();
  const logger = ctx.log;

  logger.info("Starting infrastructure destruction (deorbit)", {
    launchId: input.launchId,
    stackName: input.stackName,
  });

  const heartbeatInterval = setInterval(() => {
    ctx.heartbeat("deorbiting in progress");
  }, 5000);

  try {
    const workDir = path.resolve(
      __dirname,
      "..",
      "templates",
      input.templatePath
    );

    const stack = await LocalWorkspace.selectStack({
      stackName: input.stackName,
      workDir,
    });

    await stack.destroy({
      onOutput: (line: string) => {
        logger.info(line);
      },
    });

    await stack.workspace.removeStack(input.stackName);

    logger.info("Infrastructure deorbited successfully", {
      launchId: input.launchId,
    });
  } finally {
    clearInterval(heartbeatInterval);
  }
}
