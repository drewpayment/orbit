import { Context } from "@temporalio/activity";
import { LocalWorkspace } from "@pulumi/pulumi/automation";
import * as path from "path";
import type { ProvisionInfraInput, ProvisionInfraResult } from "../types";

/** Keys extracted from parameters and set as GCP provider config, not user config. */
const RESERVED_PARAM_KEYS = ["project", "region"];

export async function provisionInfra(
  input: ProvisionInfraInput
): Promise<ProvisionInfraResult> {
  const ctx = Context.current();
  const logger = ctx.log;

  logger.info("Starting GCP infrastructure provisioning", {
    launchId: input.launchId,
    stackName: input.stackName,
    templatePath: input.templatePath,
    region: input.region,
  });

  const heartbeatInterval = setInterval(() => {
    ctx.heartbeat("provisioning in progress");
  }, 5000);

  try {
    const workDir = path.resolve(
      __dirname,
      "..",
      "templates",
      input.templatePath
    );

    const stack = await LocalWorkspace.createOrSelectStack({
      stackName: input.stackName,
      workDir,
    });

    // GCP requires both project and region (unlike AWS which only needs region)
    const gcpProject =
      (input.parameters.project as string) || process.env.GCP_PROJECT || "";
    if (!gcpProject) {
      throw new Error(
        "GCP project is required: set parameters.project or GCP_PROJECT env var"
      );
    }
    await stack.setConfig("gcp:project", { value: gcpProject });
    await stack.setConfig("gcp:region", { value: input.region });

    // Set user parameters as Pulumi config (skip reserved keys)
    for (const [key, value] of Object.entries(input.parameters)) {
      if (RESERVED_PARAM_KEYS.includes(key)) continue;
      await stack.setConfig(key, {
        value: typeof value === "string" ? value : JSON.stringify(value),
      });
    }

    await stack.refresh({ onOutput: logger.info });

    const outputLines: string[] = [];
    const upResult = await stack.up({
      onOutput: (line: string) => {
        outputLines.push(line);
        logger.info(line);
      },
    });

    const outputs: Record<string, unknown> = {};
    for (const [key, output] of Object.entries(upResult.outputs)) {
      outputs[key] = output.value;
    }

    return {
      outputs,
      summary: outputLines.slice(-20),
    };
  } finally {
    clearInterval(heartbeatInterval);
  }
}
