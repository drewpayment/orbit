'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'

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
    // Update status to deploying
    await payload.update({
      collection: 'deployments',
      id: deploymentId,
      data: {
        status: 'deploying',
      },
    })

    // TODO: Start Temporal workflow via gRPC
    // For now, simulate with a placeholder workflow ID

    return { success: true, workflowId: `deploy-${deploymentId}` }
  } catch (error) {
    console.error('Failed to start deployment:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to start deployment'
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
