import {
  proxyActivities,
  defineQuery,
  setHandler,
} from "@temporalio/workflow";
import type {
  DeployToLaunchInput,
  DeployToLaunchResult,
  UpdateDeploymentStatusInput,
} from "../types";

const activities = proxyActivities<{
  deployStaticSite: (input: DeployToLaunchInput) => Promise<DeployToLaunchResult>;
  updateDeploymentStatus: (input: UpdateDeploymentStatusInput) => Promise<void>;
}>({
  startToCloseTimeout: "30 minutes",
  heartbeatTimeout: "30 seconds",
  retry: { maximumAttempts: 2 },
});

const statusActivities = proxyActivities<{
  updateDeploymentStatus: (input: UpdateDeploymentStatusInput) => Promise<void>;
}>({
  startToCloseTimeout: "15 seconds",
  retry: { maximumAttempts: 5 },
});

interface DeployProgress {
  status: string;
  message: string;
  percentage: number;
}

export const getDeployProgress = defineQuery<DeployProgress>("GetDeployProgress");

export async function DeployToLaunchWorkflow(
  input: DeployToLaunchInput
): Promise<void> {
  let progress: DeployProgress = {
    status: "initializing",
    message: "Starting deployment",
    percentage: 0,
  };

  setHandler(getDeployProgress, () => progress);

  // Step 1: Update status to deploying
  progress = { status: "deploying", message: "Preparing deployment", percentage: 10 };
  await statusActivities.updateDeploymentStatus({
    deploymentId: input.deploymentId,
    status: "deploying",
  });

  // Step 2: Run strategy-specific deployment
  progress = { status: "deploying", message: "Building and deploying", percentage: 30 };

  try {
    let result: DeployToLaunchResult;

    if (input.strategy === "gcs-static-site") {
      result = await activities.deployStaticSite(input);
    } else {
      throw new Error(`Unsupported deploy strategy: ${input.strategy}`);
    }

    // Step 3: Mark as deployed
    progress = {
      status: "deployed",
      message: `Deployed: ${result.deployedUrl}`,
      percentage: 100,
    };
    await statusActivities.updateDeploymentStatus({
      deploymentId: input.deploymentId,
      status: "deployed",
      url: result.deployedUrl,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    progress = { status: "failed", message: errorMessage, percentage: 0 };
    await statusActivities.updateDeploymentStatus({
      deploymentId: input.deploymentId,
      status: "failed",
      error: errorMessage,
    });
    throw error;
  }
}
