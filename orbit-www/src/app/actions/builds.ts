'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { decrypt } from '@/lib/encryption'
import { getTemporalClient } from '@/lib/temporal/client'

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
    // Get repository info
    const repoUrl = app.repository?.url
    const ref = app.repository?.branch || 'main'
    if (!repoUrl) {
      return { success: false, error: 'App has no repository URL configured' }
    }

    // Get workspace ID (already declared above, but reuse for clarity)
    const wsId = typeof app.workspace === 'string'
      ? app.workspace
      : app.workspace.id

    // Get GitHub installation token for cloning and GHCR auth
    const installation = await payload.find({
      collection: 'github-installations',
      where: {
        allowedWorkspaces: { contains: wsId },
        status: { equals: 'active' },
      },
      limit: 1,
    })

    if (installation.docs.length === 0) {
      return { success: false, error: 'No GitHub App installation found for this workspace. Please install the GitHub App.' }
    }

    const githubToken = decrypt(installation.docs[0].installationToken as string)
    if (!githubToken) {
      return { success: false, error: 'GitHub installation token not available. Please refresh the GitHub App installation.' }
    }

    // Determine registry URL and repository path
    let registryUrl: string
    let repositoryPath: string
    let registryToken = ''
    let registryUsername: string | undefined

    if (registryConfig.type === 'ghcr') {
      registryUrl = 'ghcr.io'
      repositoryPath = `${registryConfig.ghcrOwner}/${app.name.toLowerCase().replace(/\s+/g, '-')}`
      // Use GitHub installation token for GHCR authentication
      registryToken = githubToken
    } else {
      // ACR
      registryUrl = registryConfig.acrLoginServer || ''
      repositoryPath = app.name.toLowerCase().replace(/\s+/g, '-')
      registryUsername = registryConfig.acrUsername || undefined
      registryToken = registryConfig.acrToken || ''
    }

    // Import the build client dynamically to avoid build-time issues
    const { startBuildWorkflow } = await import('@/lib/clients/build-client')

    // Start the Temporal build workflow via gRPC
    const result = await startBuildWorkflow({
      appId: input.appId,
      workspaceId,
      userId: session.user.id,
      repoUrl,
      ref,
      registry: {
        type: registryConfig.type,
        url: registryUrl,
        repository: repositoryPath,
        token: registryToken,
        username: registryUsername,
      },
      languageVersion: input.languageVersion,
      buildCommand: input.buildCommand,
      startCommand: input.startCommand,
      buildEnv: input.buildEnv,
      imageTag: input.imageTag || 'latest',
    })

    if (!result.success) {
      return { success: false, error: result.error || 'Failed to start build workflow' }
    }

    // Update app build status with workflow ID
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
          buildWorkflowId: result.workflowId,
          error: null,
        },
      },
    })

    return { success: true, workflowId: result.workflowId }
  } catch (error) {
    console.error('Failed to start build:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Failed to start build' }
  }
}

export async function cancelBuild(appId: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { success: false, error: 'Unauthorized' }
  }

  const payload = await getPayload({ config })

  // Get app to verify ownership
  const app = await payload.findByID({
    collection: 'apps',
    id: appId,
    depth: 1,
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

  try {
    // Reset the build state
    await payload.update({
      collection: 'apps',
      id: appId,
      data: {
        latestBuild: {
          status: 'none',
          builtAt: null,
          builtBy: null,
          imageUrl: null,
          imageDigest: null,
          imageTag: null,
          buildWorkflowId: null,
          error: null,
        },
      },
    })

    // TODO: If there's an active Temporal workflow, cancel it
    // This would require calling the Temporal API to cancel the workflow

    return { success: true }
  } catch (error) {
    console.error('Failed to cancel build:', error)
    return { success: false, error: 'Failed to cancel build' }
  }
}

export interface BuildStatus {
  status: 'none' | 'analyzing' | 'awaiting_input' | 'building' | 'success' | 'failed'
  error?: string | null
  imageUrl?: string | null
  imageDigest?: string | null
  imageTag?: string | null
  builtAt?: string | null
  workflowId?: string | null
  buildConfig?: {
    language?: string | null
    languageVersion?: string | null
    framework?: string | null
    buildCommand?: string | null
    startCommand?: string | null
  } | null
  needsPackageManager?: boolean
  availableChoices?: string[]
}

export async function getBuildStatus(appId: string): Promise<BuildStatus | null> {
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
    needsPackageManager: app.latestBuild?.status === 'awaiting_input',
    availableChoices: app.latestBuild?.availableChoices as string[] | undefined,
  }
}

export async function checkRegistryAvailable(appId: string): Promise<{
  available: boolean
  registryName?: string
  registryType?: 'ghcr' | 'acr'
  isWorkspaceDefault?: boolean
}> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { available: false }
  }

  const payload = await getPayload({ config })

  const app = await payload.findByID({
    collection: 'apps',
    id: appId,
    depth: 2,
  })

  if (!app) {
    return { available: false }
  }

  // Check for direct registry config on app
  if (app.registryConfig) {
    const registry = typeof app.registryConfig === 'string'
      ? await payload.findByID({ collection: 'registry-configs', id: app.registryConfig })
      : app.registryConfig

    if (registry) {
      return {
        available: true,
        registryName: registry.name,
        registryType: registry.type,
        isWorkspaceDefault: false,
      }
    }
  }

  // Check for workspace default
  const workspaceId = typeof app.workspace === 'string' ? app.workspace : app.workspace?.id
  if (workspaceId) {
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
      const registry = defaults.docs[0]
      return {
        available: true,
        registryName: registry.name,
        registryType: registry.type,
        isWorkspaceDefault: true,
      }
    }
  }

  return { available: false }
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

export async function selectPackageManager(
  workflowId: string,
  packageManager: 'npm' | 'yarn' | 'pnpm' | 'bun'
): Promise<{ success: boolean; error?: string }> {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) {
      return { success: false, error: 'Unauthorized' }
    }

    // Validate package manager
    const validPMs = ['npm', 'yarn', 'pnpm', 'bun']
    if (!validPMs.includes(packageManager)) {
      return { success: false, error: 'Invalid package manager' }
    }

    // Send signal to Temporal workflow
    const client = await getTemporalClient()
    const handle = client.workflow.getHandle(workflowId)

    await handle.signal('package_manager_selected', packageManager)

    return { success: true }
  } catch (error) {
    console.error('Failed to send package manager signal:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}
