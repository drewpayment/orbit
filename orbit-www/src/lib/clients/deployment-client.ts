/**
 * Deployment Service gRPC Client
 *
 * Uses @connectrpc/connect-web (NOT connect-node) to avoid Next.js webpack bundling issues.
 * The Go service supports both gRPC and Connect protocols on the same port.
 */

import { create } from '@bufbuild/protobuf'
import { createClient } from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-web'
import {
  DeploymentService,
  StartDeploymentWorkflowRequestSchema,
  GetDeploymentProgressRequestSchema,
  DeploymentTargetSchema,
  type StartDeploymentWorkflowResponse,
  type GetDeploymentProgressResponse,
} from '@/lib/proto/idp/deployment/v1/deployment_pb'
import type { JsonObject } from '@bufbuild/protobuf'

const transport = createConnectTransport({
  baseUrl: process.env.REPOSITORY_SERVICE_URL || 'http://localhost:50051',
})

export const deploymentClient = createClient(DeploymentService, transport)

export interface StartDeploymentParams {
  deploymentId: string
  appId: string
  workspaceId: string
  userId: string
  generatorType: string
  generatorSlug: string
  config: JsonObject
  target: {
    type: string
    region?: string
    cluster?: string
    hostUrl?: string
  }
  mode: string
}

/**
 * Start a new deployment workflow
 */
export async function startDeploymentWorkflow(
  params: StartDeploymentParams
): Promise<StartDeploymentWorkflowResponse> {
  try {
    const request = create(StartDeploymentWorkflowRequestSchema, {
      deploymentId: params.deploymentId,
      appId: params.appId,
      workspaceId: params.workspaceId,
      userId: params.userId,
      generatorType: params.generatorType,
      generatorSlug: params.generatorSlug,
      config: params.config,
      target: create(DeploymentTargetSchema, {
        type: params.target.type,
        region: params.target.region || '',
        cluster: params.target.cluster || '',
        hostUrl: params.target.hostUrl || '',
      }),
      mode: params.mode,
    })

    return await deploymentClient.startDeploymentWorkflow(request)
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
    const request = create(GetDeploymentProgressRequestSchema, {
      workflowId,
    })

    return await deploymentClient.getDeploymentProgress(request)
  } catch (error) {
    console.error('Failed to get deployment progress:', error)
    throw error
  }
}
