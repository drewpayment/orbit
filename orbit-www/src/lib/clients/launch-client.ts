/**
 * Launch Service gRPC Client
 *
 * Uses @connectrpc/connect-web (NOT connect-node) to avoid Next.js webpack bundling issues.
 * The Go service supports both gRPC and Connect protocols on the same port.
 */

import { create } from '@bufbuild/protobuf'
import { createClient } from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-web'
import {
  LaunchService,
  StartLaunchRequestSchema,
  GetLaunchProgressRequestSchema,
  ApproveLaunchRequestSchema,
  DeorbitLaunchRequestSchema,
  AbortLaunchRequestSchema,
  DeployToLaunchRequestSchema,
  type StartLaunchResponse,
  type GetLaunchProgressResponse,
  type ApproveLaunchResponse,
  type DeorbitLaunchResponse,
  type AbortLaunchResponse,
  type DeployToLaunchResponse,
} from '@/lib/proto/idp/launch/v1/launch_pb'
import type { JsonObject } from '@bufbuild/protobuf'

const transport = createConnectTransport({
  baseUrl: process.env.REPOSITORY_SERVICE_URL || 'http://localhost:50051',
})

export const launchClient = createClient(LaunchService, transport)

/**
 * Start a new launch workflow
 */
export async function startLaunchWorkflow(
  launchId: string,
  templateSlug: string,
  cloudAccountId: string,
  provider: string,
  region: string,
  parameters: JsonObject,
  approvalRequired: boolean,
  pulumiProjectPath: string,
  workspaceId: string,
  autoApproved: boolean,
  launchedBy: string,
): Promise<StartLaunchResponse> {
  try {
    const request = create(StartLaunchRequestSchema, {
      launchId,
      templateSlug,
      cloudAccountId,
      provider,
      region,
      parameters,
      approvalRequired,
      pulumiProjectPath,
      workspaceId,
      autoApproved,
      launchedBy,
    })

    return await launchClient.startLaunch(request)
  } catch (error) {
    console.error('Failed to start launch workflow:', error)
    throw error
  }
}

/**
 * Get current progress of a launch workflow
 */
export async function getLaunchProgress(
  workflowId: string,
): Promise<GetLaunchProgressResponse> {
  try {
    const request = create(GetLaunchProgressRequestSchema, {
      workflowId,
    })

    return await launchClient.getLaunchProgress(request)
  } catch (error) {
    console.error('Failed to get launch progress:', error)
    throw error
  }
}

/**
 * Approve or reject a launch awaiting approval
 */
export async function approveLaunch(
  workflowId: string,
  approved: boolean,
  approvedBy: string,
  notes: string,
): Promise<ApproveLaunchResponse> {
  try {
    const request = create(ApproveLaunchRequestSchema, {
      workflowId,
      approved,
      approvedBy,
      notes,
    })

    return await launchClient.approveLaunch(request)
  } catch (error) {
    console.error('Failed to approve launch:', error)
    throw error
  }
}

/**
 * Deorbit (tear down) a launched infrastructure stack
 */
export async function deorbitLaunch(
  workflowId: string,
  requestedBy: string,
  reason: string,
): Promise<DeorbitLaunchResponse> {
  try {
    const request = create(DeorbitLaunchRequestSchema, {
      workflowId,
      requestedBy,
      reason,
    })

    return await launchClient.deorbitLaunch(request)
  } catch (error) {
    console.error('Failed to deorbit launch:', error)
    throw error
  }
}

/**
 * Abort a launch in progress
 */
export async function abortLaunch(
  workflowId: string,
  requestedBy: string,
): Promise<AbortLaunchResponse> {
  try {
    const request = create(AbortLaunchRequestSchema, {
      workflowId,
      requestedBy,
    })

    return await launchClient.abortLaunch(request)
  } catch (error) {
    console.error('Failed to abort launch:', error)
    throw error
  }
}

/**
 * Deploy an application to Launch infrastructure
 */
export async function deployToLaunch(
  deploymentId: string,
  launchId: string,
  strategy: string,
  cloudAccountId: string,
  provider: string,
  repoUrl: string,
  branch: string,
  buildCommand: string,
  outputDirectory: string,
  launchOutputs: JsonObject,
  buildEnv: Record<string, string>,
): Promise<DeployToLaunchResponse> {
  try {
    const request = create(DeployToLaunchRequestSchema, {
      deploymentId,
      launchId,
      strategy,
      cloudAccountId,
      provider,
      repoUrl,
      branch,
      buildCommand,
      outputDirectory,
      launchOutputs,
      buildEnv,
    })

    return await launchClient.deployToLaunch(request)
  } catch (error) {
    console.error('Failed to start deploy-to-launch workflow:', error)
    throw error
  }
}
