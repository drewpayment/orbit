'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { startDeploymentWorkflow, getDeploymentProgress } from '@/lib/clients/deployment-client'
import type { JsonObject } from '@bufbuild/protobuf'

interface CreateDeploymentInput {
  appId: string
  name: string
  generator: 'docker-compose' | 'terraform' | 'helm' | 'custom'
  config: Record<string, unknown>
  target: {
    type: string
    region?: string
    cluster?: string
    hostUrl?: string
  }
}

export async function createDeployment(input: CreateDeploymentInput) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { success: false, error: 'Unauthorized' }
  }

  const payload = await getPayload({ config })

  // Verify user has access to the app
  const app = await payload.findByID({
    collection: 'apps',
    id: input.appId,
    depth: 1,
  })

  if (!app) {
    return { success: false, error: 'App not found' }
  }

  const workspaceId = typeof app.workspace === 'string'
    ? app.workspace
    : app.workspace.id

  // Check workspace membership
  const members = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: workspaceId } },
        { user: { equals: session.user.id } },
        { status: { equals: 'active' } },
      ],
    },
  })

  if (members.docs.length === 0) {
    return { success: false, error: 'Not a member of this workspace' }
  }

  try {
    // Create deployment record
    const deployment = await payload.create({
      collection: 'deployments',
      data: {
        name: input.name,
        app: input.appId,
        generator: input.generator,
        config: input.config,
        target: {
          type: input.target.type,
          region: input.target.region || '',
          cluster: input.target.cluster || '',
          url: '', // Will be set after deployment
        },
        status: 'pending',
        healthStatus: 'unknown',
      },
    })

    // TODO: Start Temporal workflow
    // For now, just return the deployment ID
    // In future: call repository-service gRPC to start DeploymentWorkflow

    return { success: true, deploymentId: deployment.id }
  } catch (error) {
    console.error('Failed to create deployment:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to create deployment'
    return { success: false, error: errorMessage }
  }
}

export async function startDeployment(deploymentId: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { success: false, error: 'Unauthorized' }
  }

  const payload = await getPayload({ config })

  // Get deployment with app for access check
  const deployment = await payload.findByID({
    collection: 'deployments',
    id: deploymentId,
    depth: 2,
  })

  if (!deployment) {
    return { success: false, error: 'Deployment not found' }
  }

  // Extract app ID and verify access
  const appId = typeof deployment.app === 'string'
    ? deployment.app
    : deployment.app.id

  const app = await payload.findByID({
    collection: 'apps',
    id: appId,
    depth: 1,
  })

  if (!app) {
    return { success: false, error: 'App not found' }
  }

  const workspaceId = typeof app.workspace === 'string'
    ? app.workspace
    : app.workspace.id

  // Check workspace membership
  const members = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: workspaceId } },
        { user: { equals: session.user.id } },
        { status: { equals: 'active' } },
      ],
    },
  })

  if (members.docs.length === 0) {
    return { success: false, error: 'Not a member of this workspace' }
  }

  try {
    // Extract deployment config and target
    const deploymentConfig = deployment.config as JsonObject || {}
    const deploymentTarget = {
      type: deployment.target?.type || '',
      region: deployment.target?.region || undefined,
      cluster: deployment.target?.cluster || undefined,
      hostUrl: deployment.target?.url || undefined,
    }

    // Start the Temporal workflow via gRPC
    const response = await startDeploymentWorkflow({
      deploymentId,
      appId,
      workspaceId,
      userId: session.user.id,
      generatorType: deployment.generator,
      generatorSlug: deployment.generator, // Using generator type as slug for now
      config: deploymentConfig,
      target: deploymentTarget,
      mode: 'execute', // Default to execute mode
    })

    if (!response.success) {
      return { success: false, error: response.error || 'Failed to start workflow' }
    }

    // Update deployment record with workflow ID and status
    await payload.update({
      collection: 'deployments',
      id: deploymentId,
      data: {
        status: 'deploying',
        workflowId: response.workflowId,
      },
    })

    return { success: true, workflowId: response.workflowId }
  } catch (error) {
    console.error('Failed to start deployment:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to start deployment'

    // Update deployment status to failed
    try {
      await payload.update({
        collection: 'deployments',
        id: deploymentId,
        data: {
          status: 'failed',
          deploymentError: errorMessage,
        },
      })
    } catch (updateError) {
      console.error('Failed to update deployment status:', updateError)
    }

    return { success: false, error: errorMessage }
  }
}

export async function getDeploymentStatus(deploymentId: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return null
  }

  const payload = await getPayload({ config })

  try {
    const deployment = await payload.findByID({
      collection: 'deployments',
      id: deploymentId,
      depth: 1,
    })

    if (!deployment) {
      return null
    }

    // Verify user has access to the deployment through app workspace
    const appId = typeof deployment.app === 'string'
      ? deployment.app
      : deployment.app.id

    const app = await payload.findByID({
      collection: 'apps',
      id: appId,
      depth: 1,
    })

    if (!app) {
      return null
    }

    const workspaceId = typeof app.workspace === 'string'
      ? app.workspace
      : app.workspace.id

    // Check workspace membership
    const members = await payload.find({
      collection: 'workspace-members',
      where: {
        and: [
          { workspace: { equals: workspaceId } },
          { user: { equals: session.user.id } },
          { status: { equals: 'active' } },
        ],
      },
    })

    if (members.docs.length === 0) {
      return null
    }

    return {
      id: deployment.id,
      name: deployment.name,
      status: deployment.status,
      healthStatus: deployment.healthStatus,
      lastDeployedAt: deployment.lastDeployedAt,
      target: deployment.target,
      workflowId: deployment.workflowId,
      deploymentError: deployment.deploymentError,
    }
  } catch (error) {
    console.error('Failed to get deployment status:', error)
    return null
  }
}

export async function getDeploymentWorkflowProgress(workflowId: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { success: false, error: 'Unauthorized' }
  }

  try {
    const progress = await getDeploymentProgress(workflowId)

    return {
      success: true,
      currentStep: progress.currentStep,
      stepsTotal: progress.stepsTotal,
      stepsCurrent: progress.stepsCurrent,
      message: progress.message,
      status: progress.status,
    }
  } catch (error) {
    console.error('Failed to get deployment workflow progress:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to get deployment progress'
    return { success: false, error: errorMessage }
  }
}
