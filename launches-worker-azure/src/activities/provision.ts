import { Context } from "@temporalio/activity";
import { LocalWorkspace } from "@pulumi/pulumi/automation";
import * as path from "path";
import type { ProvisionInfraInput, ProvisionInfraResult } from "../types";

const RESERVED_PARAM_KEYS = ["subscriptionId", "location"];

const TEMPLATES_BASE_DIR = path.resolve(__dirname, "..", "templates");

const REDACTED = "[REDACTED:secret]";

/**
 * Asserts that the stack name matches the expected tenant-scoped pattern
 * orbit-<workspaceId>-<launchId>, derived independently from the activity
 * input fields. Rejects any stackName that does not match to prevent
 * cross-tenant stack access (LW-H1).
 */
function assertStackName(input: ProvisionInfraInput): void {
  const expected = `orbit-${input.workspaceId}-${input.launchId}`;
  if (input.stackName !== expected) {
    throw new Error(
      `Stack name mismatch: received "${input.stackName}", expected "${expected}". ` +
        "Stack names must follow the pattern orbit-<workspaceId>-<launchId>."
    );
  }
}

/**
 * Resolves and validates a template path against the base templates directory.
 * Rejects any path that escapes the base dir (path traversal guard, LW-H2).
 */
function resolveTemplatePath(templatePath: string): string {
  const resolved = path.resolve(TEMPLATES_BASE_DIR, templatePath);
  if (!resolved.startsWith(TEMPLATES_BASE_DIR + path.sep) && resolved !== TEMPLATES_BASE_DIR) {
    throw new Error(
      `Invalid templatePath "${templatePath}": resolves outside the templates directory.`
    );
  }
  return resolved;
}

export async function provisionInfra(
  input: ProvisionInfraInput
): Promise<ProvisionInfraResult> {
  const ctx = Context.current();
  const logger = ctx.log;

  assertStackName(input);

  logger.info("Starting Azure infrastructure provisioning", {
    launchId: input.launchId, stackName: input.stackName,
    templatePath: input.templatePath, region: input.region,
  });

  const heartbeatInterval = setInterval(() => {
    ctx.heartbeat("provisioning in progress");
  }, 5000);

  try {
    const workDir = resolveTemplatePath(input.templatePath);

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

    // Filter secret-flagged outputs to prevent plaintext secrets from being
    // persisted in Temporal workflow history (LW-H3). The downstream
    // StoreLaunchOutputs activity forwards these to Payload CMS; replacing
    // secret values with a redaction marker keeps the key visible for
    // troubleshooting without leaking the value.
    // TODO: design a secure out-of-band delivery path for connection credentials.
    const outputs: Record<string, unknown> = {};
    for (const [key, output] of Object.entries(upResult.outputs)) {
      outputs[key] = output.secret ? REDACTED : output.value;
    }

    return { outputs, summary: outputLines.slice(-20) };
  } finally {
    clearInterval(heartbeatInterval);
  }
}
