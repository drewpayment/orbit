/**
 * Build Service gRPC Client
 *
 * Uses @connectrpc/connect-web to communicate with repository-service
 * for starting Temporal BuildWorkflow operations.
 */

import { create } from '@bufbuild/protobuf'
import { createClient } from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-web'
import {
  BuildService,
  StartBuildWorkflowRequestSchema,
  GetBuildProgressRequestSchema,
  RegistryConfigSchema,
  RegistryType,
} from '@/lib/proto/idp/build/v1/build_pb'
import type {
  StartBuildWorkflowResponse,
  GetBuildProgressResponse,
} from '@/lib/proto/idp/build/v1/build_pb'

const transport = createConnectTransport({
  baseUrl: process.env.REPOSITORY_SERVICE_URL || 'http://localhost:50051',
})

export const buildClient = createClient(BuildService, transport)

export interface StartBuildParams {
  appId: string
  workspaceId: string
  userId: string
  repoUrl: string
  ref?: string
  registry: {
    type: 'ghcr' | 'acr'
    url: string
    repository: string
    token: string
    username?: string
  }
  languageVersion?: string
  buildCommand?: string
  startCommand?: string
  buildEnv?: Record<string, string>
  imageTag?: string
}

/**
 * Start a new build workflow
 */
export async function startBuildWorkflow(
  params: StartBuildParams
): Promise<StartBuildWorkflowResponse> {
  try {
    const registryType = params.registry.type === 'ghcr'
      ? RegistryType.GHCR
      : RegistryType.ACR

    const request = create(StartBuildWorkflowRequestSchema, {
      appId: params.appId,
      workspaceId: params.workspaceId,
      userId: params.userId,
      repoUrl: params.repoUrl,
      ref: params.ref || 'main',
      registry: create(RegistryConfigSchema, {
        type: registryType,
        url: params.registry.url,
        repository: params.registry.repository,
        token: params.registry.token,
        username: params.registry.username,
      }),
      languageVersion: params.languageVersion,
      buildCommand: params.buildCommand,
      startCommand: params.startCommand,
      buildEnv: params.buildEnv || {},
      imageTag: params.imageTag || 'latest',
    })

    return await buildClient.startBuildWorkflow(request)
  } catch (error) {
    console.error('Failed to start build workflow:', error)
    throw error
  }
}

/**
 * Get current progress of a build
 */
export async function getBuildProgress(
  workflowId: string
): Promise<GetBuildProgressResponse> {
  try {
    const request = create(GetBuildProgressRequestSchema, {
      workflowId,
    })

    return await buildClient.getBuildProgress(request)
  } catch (error) {
    console.error('Failed to get build progress:', error)
    throw error
  }
}
