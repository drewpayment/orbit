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

    // Determine mode based on generator type
    // docker-compose uses generate mode to let user review files before commit
    const mode = deployment.generator === 'docker-compose' ? 'generate' : 'execute'

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
      mode,
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
      generatedFiles: progress.generatedFiles?.map(f => ({
        path: f.path,
        content: f.content,
      })) || [],
    }
  } catch (error) {
    console.error('Failed to get deployment workflow progress:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to get deployment progress'
    return { success: false, error: errorMessage }
  }
}

export async function getDeploymentGenerators() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { success: false, error: 'Unauthorized', generators: [] }
  }

  const payload = await getPayload({ config })

  try {
    const generators = await payload.find({
      collection: 'deployment-generators',
      where: {
        or: [
          { isBuiltIn: { equals: true } },
        ],
      },
      limit: 100,
    })

    return {
      success: true,
      generators: generators.docs.map(g => ({
        id: g.id,
        name: g.name,
        slug: g.slug,
        type: g.type,
        description: g.description,
        configSchema: g.configSchema,
      })),
    }
  } catch (error) {
    console.error('Failed to fetch generators:', error)
    return { success: false, error: 'Failed to fetch generators', generators: [] }
  }
}

export async function getGeneratedFiles(deploymentId: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { success: false, error: 'Unauthorized', files: [] }
  }

  const payload = await getPayload({ config })

  try {
    const deployment = await payload.findByID({
      collection: 'deployments',
      id: deploymentId,
      depth: 0,
    })

    if (!deployment) {
      return { success: false, error: 'Deployment not found', files: [] }
    }

    const files = (deployment.generatedFiles as Array<{ path: string; content: string }>) || []
    return { success: true, files }
  } catch (error) {
    console.error('Failed to get generated files:', error)
    return { success: false, error: 'Failed to get generated files', files: [] }
  }
}

export async function getRepoBranches(appId: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { success: false, error: 'Unauthorized', branches: [] as string[] }
  }

  const payload = await getPayload({ config })

  try {
    const app = await payload.findByID({
      collection: 'apps',
      id: appId,
      depth: 0,
      overrideAccess: true,
    })

    if (!app?.repository?.installationId || !app.repository.owner || !app.repository.name) {
      return { success: true, branches: ['main'], defaultBranch: 'main' }
    }

    const { createInstallationToken } = await import('@/lib/github/octokit')
    const { token } = await createInstallationToken(Number(app.repository.installationId))

    const response = await fetch(
      `https://api.github.com/repos/${app.repository.owner}/${app.repository.name}/branches?per_page=100`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
        },
      }
    )

    if (!response.ok) {
      console.error('GitHub branches API error:', response.status)
      return { success: true, branches: ['main'], defaultBranch: 'main' }
    }

    const data = await response.json() as Array<{ name: string }>
    const branches = data.map(b => b.name)

    const repoResponse = await fetch(
      `https://api.github.com/repos/${app.repository.owner}/${app.repository.name}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
        },
      }
    )

    let defaultBranch = 'main'
    if (repoResponse.ok) {
      const repoData = await repoResponse.json() as { default_branch: string }
      defaultBranch = repoData.default_branch
    }

    return { success: true, branches, defaultBranch }
  } catch (error) {
    console.error('Failed to fetch branches:', error)
    return { success: true, branches: ['main'], defaultBranch: 'main' }
  }
}

export async function commitGeneratedFiles(input: {
  deploymentId: string
  branch: string
  newBranch?: string
  message: string
}) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { success: false, error: 'Unauthorized' }
  }

  const payload = await getPayload({ config })

  try {
    const deployment = await payload.findByID({
      collection: 'deployments',
      id: input.deploymentId,
      depth: 1,
    })

    if (!deployment) {
      return { success: false, error: 'Deployment not found' }
    }

    const files = (deployment.generatedFiles as Array<{ path: string; content: string }>) || []
    if (files.length === 0) {
      return { success: false, error: 'No generated files to commit' }
    }

    const appId = typeof deployment.app === 'string' ? deployment.app : (deployment.app as { id: string }).id
    const app = await payload.findByID({
      collection: 'apps',
      id: appId,
      depth: 0,
      overrideAccess: true,
    })

    // Authorization: verify the caller is an active member of the app's workspace
    const workspaceId = typeof app.workspace === 'string'
      ? app.workspace
      : (app.workspace as { id: string } | null)?.id
    if (!workspaceId) {
      return { success: false, error: 'App has no associated workspace' }
    }
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

    if (!app?.repository?.installationId || !app.repository.owner || !app.repository.name) {
      return { success: false, error: 'App has no linked repository' }
    }

    const { createInstallationToken } = await import('@/lib/github/octokit')
    const { token } = await createInstallationToken(Number(app.repository.installationId))

    const owner = app.repository.owner as string
    const repo = app.repository.name as string
    const targetBranch = input.newBranch || input.branch
    const apiBase = `https://api.github.com/repos/${owner}/${repo}`
    const githubHeaders = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    }

    // 1. Get the ref for the source branch
    const refResponse = await fetch(`${apiBase}/git/ref/heads/${input.branch}`, {
      headers: githubHeaders,
    })
    if (!refResponse.ok) {
      return { success: false, error: `Branch "${input.branch}" not found` }
    }
    const refData = await refResponse.json() as { object: { sha: string } }
    const baseSha = refData.object.sha

    // 2. If creating a new branch, create the ref
    if (input.newBranch) {
      const createRefResponse = await fetch(`${apiBase}/git/refs`, {
        method: 'POST',
        headers: githubHeaders,
        body: JSON.stringify({
          ref: `refs/heads/${input.newBranch}`,
          sha: baseSha,
        }),
      })
      if (!createRefResponse.ok) {
        const err = await createRefResponse.json() as { message?: string }
        return { success: false, error: `Failed to create branch: ${err.message || 'unknown'}` }
      }
    }

    // 3. Get the base tree SHA
    const commitResponse = await fetch(`${apiBase}/git/commits/${baseSha}`, {
      headers: githubHeaders,
    })
    if (!commitResponse.ok) {
      return { success: false, error: `Failed to get base commit: ${commitResponse.statusText}` }
    }
    const commitRawData = await commitResponse.json() as { tree: { sha: string } }
    const baseTreeSha = commitRawData.tree.sha

    // 4. Create blobs for each file
    const tree: Array<{ path: string; mode: string; type: string; sha: string }> = []
    for (const file of files) {
      const blobResponse = await fetch(`${apiBase}/git/blobs`, {
        method: 'POST',
        headers: githubHeaders,
        body: JSON.stringify({
          content: file.content,
          encoding: 'utf-8',
        }),
      })
      const blobData = await blobResponse.json() as { sha: string; message?: string }
      if (!blobResponse.ok) {
        return { success: false, error: `Failed to create blob for "${file.path}": ${blobData.message || blobResponse.statusText}` }
      }
      tree.push({
        path: file.path,
        mode: '100644',
        type: 'blob',
        sha: blobData.sha,
      })
    }

    // 5. Create tree
    const treeResponse = await fetch(`${apiBase}/git/trees`, {
      method: 'POST',
      headers: githubHeaders,
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree,
      }),
    })
    const treeData = await treeResponse.json() as { sha: string; message?: string }
    if (!treeResponse.ok) {
      return { success: false, error: `Failed to create tree: ${treeData.message || treeResponse.statusText}` }
    }

    // 6. Create commit
    const newCommitResponse = await fetch(`${apiBase}/git/commits`, {
      method: 'POST',
      headers: githubHeaders,
      body: JSON.stringify({
        message: input.message,
        tree: treeData.sha,
        parents: [baseSha],
      }),
    })
    const newCommitData = await newCommitResponse.json() as { sha: string; message?: string }
    if (!newCommitResponse.ok) {
      return { success: false, error: `Failed to create commit: ${newCommitData.message || newCommitResponse.statusText}` }
    }

    // 7. Update the branch ref
    const updateRefResponse = await fetch(`${apiBase}/git/refs/heads/${targetBranch}`, {
      method: 'PATCH',
      headers: githubHeaders,
      body: JSON.stringify({ sha: newCommitData.sha }),
    })
    if (!updateRefResponse.ok) {
      const errData = await updateRefResponse.json() as { message?: string }
      return { success: false, error: `Failed to update branch ref: ${errData.message || updateRefResponse.statusText}` }
    }

    // 8. Update deployment status in Payload
    await payload.update({
      collection: 'deployments',
      id: input.deploymentId,
      data: {
        status: 'deployed',
        lastDeployedAt: new Date().toISOString(),
      },
    })

    return { success: true, sha: newCommitData.sha }
  } catch (error) {
    console.error('Failed to commit generated files:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

/**
 * Mark deployment as complete without committing to repository.
 * Used when user copies the generated files manually.
 */
export async function skipCommitAndComplete(deploymentId: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { success: false, error: 'Unauthorized' }
  }

  const payload = await getPayload({ config })

  try {
    await payload.update({
      collection: 'deployments',
      id: deploymentId,
      data: {
        status: 'deployed',
        lastDeployedAt: new Date().toISOString(),
      },
    })

    return { success: true }
  } catch (error) {
    console.error('Failed to complete deployment:', error)
    return { success: false, error: 'Failed to complete deployment' }
  }
}

/**
 * Sync deployment status from workflow progress.
 * Called by frontend when workflow completes but Payload status hasn't been updated
 * (workaround for missing PayloadDeploymentClient in Temporal worker)
 */
export async function syncDeploymentStatusFromWorkflow(
  deploymentId: string,
  workflowStatus: string,
  errorMessage?: string,
  generatedFiles?: Array<{ path: string; content: string }>
) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { success: false, error: 'Unauthorized' }
  }

  const payload = await getPayload({ config })

  try {
    // Map workflow status to deployment status
    let newStatus: 'pending' | 'deploying' | 'generated' | 'deployed' | 'failed'
    switch (workflowStatus) {
      case 'completed':
        // Check if this was a generate-mode workflow by looking at current status
        const deployment = await payload.findByID({
          collection: 'deployments',
          id: deploymentId,
        })
        // If generator is docker-compose, it's generate mode -> status should be 'generated'
        if (deployment?.generator === 'docker-compose') {
          newStatus = 'generated'
        } else {
          newStatus = 'deployed'
        }
        break
      case 'failed':
        newStatus = 'failed'
        break
      default:
        // Don't update for running or other statuses
        return { success: true }
    }

    await payload.update({
      collection: 'deployments',
      id: deploymentId,
      data: {
        status: newStatus,
        ...(newStatus === 'failed' && errorMessage ? { deploymentError: errorMessage } : {}),
        ...(newStatus === 'deployed' ? { lastDeployedAt: new Date().toISOString() } : {}),
        ...(newStatus === 'generated' && generatedFiles?.length ? { generatedFiles } : {}),
      },
    })

    return { success: true, newStatus }
  } catch (error) {
    console.error('Failed to sync deployment status:', error)
    return { success: false, error: 'Failed to sync status' }
  }
}

export async function deleteDeployment(deploymentId: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { success: false, error: 'Unauthorized' }
  }

  const payload = await getPayload({ config })

  try {
    const deployment = await payload.findByID({
      collection: 'deployments',
      id: deploymentId,
      depth: 2,
    })

    if (!deployment) {
      return { success: false, error: 'Deployment not found' }
    }

    // Verify access through workspace membership
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

    await payload.delete({
      collection: 'deployments',
      id: deploymentId,
    })

    return { success: true }
  } catch (error) {
    console.error('Failed to delete deployment:', error)
    return { success: false, error: 'Failed to delete deployment' }
  }
}
