/**
 * Deployment Service gRPC Client
 *
 * Uses @connectrpc/connect-web (NOT connect-node) to avoid Next.js webpack bundling issues.
 * The Go service supports both gRPC and Connect protocols on the same port.
 */

import { createClient } from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-web'
import { DeploymentService } from '@/lib/proto/idp/deployment/v1/deployment_connect'
import type {
  StartDeploymentWorkflowRequest,
  StartDeploymentWorkflowResponse,
  GetDeploymentProgressRequest,
  GetDeploymentProgressResponse,
} from '@/lib/proto/idp/deployment/v1/deployment_pb'

const transport = createConnectTransport({
  baseUrl: process.env.REPOSITORY_SERVICE_URL || 'http://localhost:8082',
})

export const deploymentClient = createClient(DeploymentService, transport)

/**
 * Start a new deployment workflow
 */
export async function startDeploymentWorkflow(
  params: StartDeploymentWorkflowRequest
): Promise<StartDeploymentWorkflowResponse> {
  try {
    return await deploymentClient.startDeploymentWorkflow(params)
  } catch (error) {
    console.error('Failed to start deployment workflow:', error)
    throw error
  }
}

/**
 * Get current progress of a deployment
 */
export async function getDeploymentProgress(
  workflowId: string
): Promise<GetDeploymentProgressResponse> {
  try {
    return await deploymentClient.getDeploymentProgress({ workflowId })
  } catch (error) {
    console.error('Failed to get deployment progress:', error)
    throw error
  }
}
