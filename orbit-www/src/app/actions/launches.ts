'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import {
  startLaunchWorkflow,
  getLaunchProgress,
  approveLaunch,
  deorbitLaunch,
  abortLaunch,
} from '@/lib/clients/launch-client'
import type { JsonObject } from '@bufbuild/protobuf'

interface CreateLaunchInput {
  name: string
  workspaceId: string
  templateId: string
  templateSlug: string
  cloudAccountId: string
  provider: string
  region: string
  parameters: Record<string, unknown>
  appId?: string
}

export async function createLaunch(data: CreateLaunchInput) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { success: false, error: 'Unauthorized' }
  }

  const payload = await getPayload({ config })

  // Check workspace membership
  const members = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: data.workspaceId } },
        { user: { equals: session.user.id } },
        { status: { equals: 'active' } },
      ],
    },
  })

  if (members.docs.length === 0) {
    return { success: false, error: 'Not a member of this workspace' }
  }

  try {
    // Look up cloud account for approval settings
    const cloudAccount = await payload.findByID({
      collection: 'cloud-accounts',
      id: data.cloudAccountId,
      depth: 0,
    })

    if (!cloudAccount) {
      return { success: false, error: 'Cloud account not found' }
    }

    // Look up template for pulumiProjectPath
    const template = await payload.findByID({
      collection: 'launch-templates',
      id: data.templateId,
      depth: 0,
    })

    if (!template) {
      return { success: false, error: 'Launch template not found' }
    }

    // Create the launch record
    const launch = await payload.create({
      collection: 'launches',
      data: {
        name: data.name,
        workspace: data.workspaceId,
        template: data.templateId,
        cloudAccount: data.cloudAccountId,
        provider: data.provider,
        region: data.region,
        parameters: data.parameters,
        status: 'pending',
        launchedBy: session.user.id,
        ...(data.appId ? { app: data.appId } : {}),
        approvalConfig: {
          required: cloudAccount.approvalRequired || false,
          approvers: cloudAccount.approvers || [],
          timeoutHours: 24,
        },
      },
    })

    return { success: true, launchId: launch.id }
  } catch (error) {
    console.error('Failed to create launch:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to create launch'
    return { success: false, error: errorMessage }
  }
}

export async function startLaunch(launchId: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { success: false, error: 'Unauthorized' }
  }

  const payload = await getPayload({ config })

  // Get launch with relationships resolved
  const launch = await payload.findByID({
    collection: 'launches',
    id: launchId,
    depth: 2,
  })

  if (!launch) {
    return { success: false, error: 'Launch not found' }
  }

  // Resolve template relationship
  const template = typeof launch.template === 'string'
    ? await payload.findByID({ collection: 'launch-templates', id: launch.template, depth: 0 })
    : launch.template

  if (!template) {
    return { success: false, error: 'Launch template not found' }
  }

  // Resolve cloud account relationship
  const cloudAccount = typeof launch.cloudAccount === 'string'
    ? await payload.findByID({ collection: 'cloud-accounts', id: launch.cloudAccount, depth: 0 })
    : launch.cloudAccount

  if (!cloudAccount) {
    return { success: false, error: 'Cloud account not found' }
  }

  try {
    const approvalRequired = launch.approvalConfig?.required || false

    // Determine if auto-approval applies (launcher is in the approvers list)
    // Note: session.user.id is a Better Auth ID, but approvers are Payload user IDs.
    // We need to look up the Payload user by email to compare.
    let autoApproved = false
    if (approvalRequired) {
      const payloadUser = await payload.find({
        collection: 'users',
        where: { email: { equals: session.user.email } },
        limit: 1,
        depth: 0,
      })
      const payloadUserId = payloadUser.docs[0]?.id
      if (payloadUserId) {
        const approverIds = (launch.approvalConfig?.approvers || []).map(
          (a: string | { id: string }) => typeof a === 'string' ? a : a.id,
        )
        autoApproved = approverIds.includes(payloadUserId)
      }
    }

    // Call gRPC to start the workflow
    const workspaceId = typeof launch.workspace === 'string' ? launch.workspace : launch.workspace?.id || ''
    const response = await startLaunchWorkflow(
      launchId,
      template.slug,
      typeof launch.cloudAccount === 'string' ? launch.cloudAccount : launch.cloudAccount.id,
      launch.provider,
      launch.region,
      (launch.parameters as JsonObject) || {},
      approvalRequired,
      template.pulumiProjectPath,
      workspaceId,
      autoApproved,
      session.user.id,
    )

    if (!response.success) {
      return { success: false, error: response.error || 'Failed to start launch workflow' }
    }

    // Update launch record with workflow ID and status
    const updateData: Record<string, unknown> = {
      workflowId: response.workflowId,
      status: 'launching',
      lastLaunchedAt: new Date().toISOString(),
    }
    if (autoApproved) {
      updateData.approvedBy = session.user.id
    }
    await payload.update({
      collection: 'launches',
      id: launchId,
      data: updateData,
    })

    return { success: true, workflowId: response.workflowId }
  } catch (error) {
    console.error('Failed to start launch:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to start launch'

    // Update launch status to failed
    try {
      await payload.update({
        collection: 'launches',
        id: launchId,
        data: {
          status: 'failed',
          launchError: errorMessage,
        },
      })
    } catch (updateError) {
      console.error('Failed to update launch status:', updateError)
    }

    return { success: false, error: errorMessage }
  }
}

export async function retryLaunch(launchId: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { success: false, error: 'Unauthorized' }
  }

  const payload = await getPayload({ config })

  const launch = await payload.findByID({
    collection: 'launches',
    id: launchId,
    depth: 0,
  })

  if (!launch) {
    return { success: false, error: 'Launch not found' }
  }

  if (!['failed', 'aborted', 'launching'].includes(launch.status)) {
    return { success: false, error: `Cannot retry a launch with status "${launch.status}"` }
  }

  // Reset status to pending and clear error before retrying
  await payload.update({
    collection: 'launches',
    id: launchId,
    data: {
      status: 'pending',
      launchError: null,
      workflowId: null,
    },
  })

  // Start the workflow again
  return startLaunch(launchId)
}

export async function deleteLaunch(launchId: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { success: false, error: 'Unauthorized' }
  }

  const payload = await getPayload({ config })

  const launch = await payload.findByID({
    collection: 'launches',
    id: launchId,
    depth: 0,
  })

  if (!launch) {
    return { success: false, error: 'Launch not found' }
  }

  if (['active', 'deorbiting', 'awaiting_approval'].includes(launch.status)) {
    return { success: false, error: `Cannot delete a launch with status "${launch.status}". Abort or deorbit first.` }
  }

  await payload.delete({
    collection: 'launches',
    id: launchId,
  })

  return { success: true }
}

export async function getLaunchStatus(launchId: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return null
  }

  const payload = await getPayload({ config })

  try {
    const launch = await payload.findByID({
      collection: 'launches',
      id: launchId,
      depth: 2,
    })

    if (!launch) {
      return null
    }

    return launch
  } catch (error) {
    console.error('Failed to get launch status:', error)
    return null
  }
}

export async function getLaunchWorkflowProgress(workflowId: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { success: false, error: 'Unauthorized' }
  }

  try {
    const progress = await getLaunchProgress(workflowId)

    return {
      success: true,
      status: progress.status,
      currentStep: progress.currentStep,
      totalSteps: progress.totalSteps,
      message: progress.message,
      percentage: progress.percentage,
      logs: progress.logs,
    }
  } catch (error) {
    console.error('Failed to get launch workflow progress:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to get launch progress'
    return { success: false, error: errorMessage }
  }
}

export async function approveLaunchAction(
  workflowId: string,
  approved: boolean,
  notes?: string,
) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { success: false, error: 'Unauthorized' }
  }

  try {
    const response = await approveLaunch(
      workflowId,
      approved,
      session.user.id,
      notes || '',
    )

    if (!response.success) {
      return { success: false, error: response.error || 'Failed to approve launch' }
    }

    return { success: true }
  } catch (error) {
    console.error('Failed to approve launch:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to approve launch'
    return { success: false, error: errorMessage }
  }
}

export async function deorbitLaunchAction(workflowId: string, reason?: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { success: false, error: 'Unauthorized' }
  }

  try {
    const response = await deorbitLaunch(
      workflowId,
      session.user.id,
      reason || '',
    )

    if (!response.success) {
      return { success: false, error: response.error || 'Failed to deorbit launch' }
    }

    return { success: true }
  } catch (error) {
    console.error('Failed to deorbit launch:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to deorbit launch'
    return { success: false, error: errorMessage }
  }
}

export async function abortLaunchAction(workflowId: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { success: false, error: 'Unauthorized' }
  }

  try {
    const response = await abortLaunch(
      workflowId,
      session.user.id,
    )

    if (!response.success) {
      return { success: false, error: response.error || 'Failed to abort launch' }
    }

    return { success: true }
  } catch (error) {
    console.error('Failed to abort launch:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to abort launch'
    return { success: false, error: errorMessage }
  }
}

export async function getLaunchTemplates(provider?: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { success: false, error: 'Unauthorized', docs: [] }
  }

  const payload = await getPayload({ config })

  try {
    const where = provider
      ? { provider: { equals: provider } }
      : {}

    const templates = await payload.find({
      collection: 'launch-templates',
      where,
      limit: 100,
    })

    return { success: true, docs: templates.docs }
  } catch (error) {
    console.error('Failed to fetch launch templates:', error)
    return { success: false, error: 'Failed to fetch launch templates', docs: [] }
  }
}

export async function getCloudAccounts(workspaceId: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { success: false, error: 'Unauthorized', docs: [] }
  }

  const payload = await getPayload({ config })

  try {
    const accounts = await payload.find({
      collection: 'cloud-accounts',
      where: {
        and: [
          { workspaces: { contains: workspaceId } },
          { status: { equals: 'connected' } },
        ],
      },
      limit: 100,
    })

    return { success: true, docs: accounts.docs }
  } catch (error) {
    console.error('Failed to fetch cloud accounts:', error)
    return { success: false, error: 'Failed to fetch cloud accounts', docs: [] }
  }
}

export async function getLaunches(workspaceId: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { success: false, error: 'Unauthorized', docs: [] }
  }

  const payload = await getPayload({ config })

  try {
    const launches = await payload.find({
      collection: 'launches',
      where: {
        workspace: { equals: workspaceId },
      },
      depth: 2,
      sort: '-updatedAt',
      limit: 100,
    })

    return { success: true, docs: launches.docs }
  } catch (error) {
    console.error('Failed to fetch launches:', error)
    return { success: false, error: 'Failed to fetch launches', docs: [] }
  }
}

export async function getAllUserLaunches() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { success: false, error: 'Unauthorized', docs: [] }
  }

  const payload = await getPayload({ config })

  try {
    // Get user's workspace memberships
    const memberships = await payload.find({
      collection: 'workspace-members',
      where: {
        user: { equals: session.user.id },
        status: { equals: 'active' },
      },
      limit: 1000,
    })

    const workspaceIds = memberships.docs.map(m =>
      String(typeof m.workspace === 'string' ? m.workspace : m.workspace.id)
    )

    if (workspaceIds.length === 0) {
      return { success: true, docs: [] }
    }

    const launches = await payload.find({
      collection: 'launches',
      where: {
        workspace: { in: workspaceIds },
      },
      depth: 2,
      sort: '-updatedAt',
      limit: 100,
    })

    return { success: true, docs: launches.docs }
  } catch (error) {
    console.error('Failed to fetch launches:', error)
    return { success: false, error: 'Failed to fetch launches', docs: [] }
  }
}
