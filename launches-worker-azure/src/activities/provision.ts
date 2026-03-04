import { Context } from "@temporalio/activity";
import { LocalWorkspace } from "@pulumi/pulumi/automation";
import * as path from "path";
import type { ProvisionInfraInput, ProvisionInfraResult } from "../types";

const RESERVED_PARAM_KEYS = ["subscriptionId", "location"];

export async function provisionInfra(
  input: ProvisionInfraInput
): Promise<ProvisionInfraResult> {
  const ctx = Context.current();
  const logger = ctx.log;

  logger.info("Starting Azure infrastructure provisioning", {
    launchId: input.launchId, stackName: input.stackName,
    templatePath: input.templatePath, region: input.region,
  });

  const heartbeatInterval = setInterval(() => {
    ctx.heartbeat("provisioning in progress");
  }, 5000);

  try {
    const workDir = path.resolve(__dirname, "..", "templates", input.templatePath);

    const stack = await LocalWorkspace.createOrSelectStack({
      stackName: input.stackName, workDir,
    });

    const subscriptionId =
      (input.parameters.subscriptionId as string) ||
      process.env.AZURE_SUBSCRIPTION_ID || "";
    if (!subscriptionId) {
      throw new Error(
        "Azure subscription ID is required: set parameters.subscriptionId or AZURE_SUBSCRIPTION_ID env var"
      );
    }
    await stack.setConfig("azure-native:subscriptionId", { value: subscriptionId });
    await stack.setConfig("azure-native:location", { value: input.region });

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

    return { outputs, summary: outputLines.slice(-20) };
  } finally {
    clearInterval(heartbeatInterval);
  }
}
