import { Context } from "@temporalio/activity";
import { LocalWorkspace } from "@pulumi/pulumi/automation";
import * as path from "path";
import type { DestroyInfraInput } from "../types";

const TEMPLATES_BASE_DIR = path.resolve(__dirname, "..", "templates");

function assertStackName(input: DestroyInfraInput): void {
  const expected = `orbit-${input.workspaceId}-${input.launchId}`;
  if (input.stackName !== expected) {
    throw new Error(
      `Stack name mismatch: received "${input.stackName}", expected "${expected}". ` +
        "Stack names must follow the pattern orbit-<workspaceId>-<launchId>."
    );
  }
}

function resolveTemplatePath(templatePath: string): string {
  const resolved = path.resolve(TEMPLATES_BASE_DIR, templatePath);
  if (!resolved.startsWith(TEMPLATES_BASE_DIR + path.sep) && resolved !== TEMPLATES_BASE_DIR) {
    throw new Error(
      `Invalid templatePath "${templatePath}": resolves outside the templates directory.`
    );
  }
  return resolved;
}

export async function destroyInfra(input: DestroyInfraInput): Promise<void> {
  const ctx = Context.current();
  const logger = ctx.log;

  assertStackName(input);

  logger.info("Starting Azure infrastructure destruction (deorbit)", {
    launchId: input.launchId, stackName: input.stackName,
  });

  const heartbeatInterval = setInterval(() => {
    ctx.heartbeat("deorbiting in progress");
  }, 5000);

  try {
    const workDir = resolveTemplatePath(input.templatePath);
    const stack = await LocalWorkspace.selectStack({ stackName: input.stackName, workDir });

    await stack.destroy({ onOutput: (line: string) => { logger.info(line); } });
    await stack.workspace.removeStack(input.stackName);

    logger.info("Azure infrastructure deorbited successfully", { launchId: input.launchId });
  } finally {
    clearInterval(heartbeatInterval);
  }
}
