'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'

interface StartBuildInput {
  appId: string
  // Optional overrides
  languageVersion?: string
  buildCommand?: string
  startCommand?: string
  buildEnv?: Record<string, string>
  imageTag?: string
}

export async function startBuild(input: StartBuildInput) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { success: false, error: 'Unauthorized' }
  }

  const payload = await getPayload({ config })

  // Get app with workspace info
  const app = await payload.findByID({
    collection: 'apps',
    id: input.appId,
    depth: 2,
  })

  if (!app) {
    return { success: false, error: 'App not found' }
  }

  // Check workspace membership
  const workspaceId = typeof app.workspace === 'string'
    ? app.workspace
    : app.workspace.id

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

  // Check if app has repository configured
  if (!app.repository?.url) {
    return { success: false, error: 'App has no repository configured' }
  }

  // Get registry config (app-specific or workspace default)
  let registryConfig = null
  if (app.registryConfig) {
    registryConfig = typeof app.registryConfig === 'string'
      ? await payload.findByID({ collection: 'registry-configs', id: app.registryConfig })
      : app.registryConfig
  } else {
    // Find workspace default
    const defaults = await payload.find({
      collection: 'registry-configs',
      where: {
        and: [
          { workspace: { equals: workspaceId } },
          { isDefault: { equals: true } },
        ],
      },
      limit: 1,
    })
    if (defaults.docs.length > 0) {
      registryConfig = defaults.docs[0]
    }
  }

  if (!registryConfig) {
    return {
      success: false,
      error: 'No container registry configured. Please configure a registry in workspace settings.'
    }
  }

  try {
    // Update app build status to analyzing
    await payload.update({
      collection: 'apps',
      id: input.appId,
      data: {
        latestBuild: {
          status: 'analyzing',
          builtAt: null,
          builtBy: session.user.id,
          imageUrl: null,
          imageDigest: null,
          imageTag: null,
          buildWorkflowId: null,
          error: null,
        },
      },
    })

    // TODO: Start Temporal workflow via gRPC
    // For now, return success with placeholder workflow ID
    const workflowId = `build-${input.appId}-${Date.now()}`

    // Update with workflow ID
    await payload.update({
      collection: 'apps',
      id: input.appId,
      data: {
        latestBuild: {
          buildWorkflowId: workflowId,
        },
      },
    })

    return { success: true, workflowId }
  } catch (error) {
    console.error('Failed to start build:', error)
    return { success: false, error: 'Failed to start build' }
  }
}

export async function getBuildStatus(appId: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return null
  }

  const payload = await getPayload({ config })

  const app = await payload.findByID({
    collection: 'apps',
    id: appId,
    depth: 1,
  })

  if (!app) {
    return null
  }

  return {
    status: app.latestBuild?.status || 'none',
    imageUrl: app.latestBuild?.imageUrl,
    imageDigest: app.latestBuild?.imageDigest,
    imageTag: app.latestBuild?.imageTag,
    builtAt: app.latestBuild?.builtAt,
    workflowId: app.latestBuild?.buildWorkflowId,
    error: app.latestBuild?.error,
    buildConfig: app.buildConfig,
  }
}

export async function analyzeRepository(appId: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { success: false, error: 'Unauthorized' }
  }

  const payload = await getPayload({ config })

  const app = await payload.findByID({
    collection: 'apps',
    id: appId,
    depth: 1,
  })

  if (!app || !app.repository?.url) {
    return { success: false, error: 'App or repository not found' }
  }

  // TODO: Call build service AnalyzeRepository RPC
  // For now, return mock data
  return {
    success: true,
    detected: true,
    config: {
      language: 'nodejs',
      languageVersion: '22',
      framework: 'nextjs',
      buildCommand: 'npm run build',
      startCommand: 'npm start',
    },
  }
}
