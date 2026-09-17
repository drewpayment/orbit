'use server'

import { getPayload, type Where } from 'payload'
import config from '@payload-config'
import { getActor, check, memberWorkspaceIds } from '@/lib/authz'
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
  const actor = await getActor()
  if (!actor) {
    return { success: false, error: 'Unauthorized' }
  }

  const payload = await getPayload({ config })

  // Check workspace membership
  const members = await check('create', { kind: 'workspace', id: data.workspaceId }, actor)

  if (!members.allowed) {
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
        // provider is constrained to the launches collection's supported set by the
        // UI/ProviderSelector; the input type stays a broad string for callers/tests.
        provider: data.provider as 'azure' | 'digitalocean',
        region: data.region,
        parameters: data.parameters,
        status: 'pending',
        // Semantic fix: `launchedBy` is `relationTo: 'users'` — the Payload id.
        launchedBy: actor.payloadId,
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
  const actor = await getActor()
  if (!actor) {
    return { success: false, error: 'Unauthorized' }
  }

  const payload = await getPayload({ config })

  // Get launch with relationships resolved
  const launch = await payload.findByID({
    collection: 'launches',
    id: launchId,
    depth: 2,
    overrideAccess: true,
  })

  if (!launch) {
    return { success: false, error: 'Launch not found' }
  }

  // Verify workspace membership before starting a launch workflow
  const launchWsId = typeof launch.workspace === 'string' ? launch.workspace : launch.workspace?.id
  if (!launchWsId) {
    return { success: false, error: 'Launch has no workspace' }
  }
  const launchMembership = await check('create', { kind: 'workspace', id: launchWsId }, actor)
  if (!launchMembership.allowed) {
    return { success: false, error: 'Not a member of this workspace' }
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

    // Determine if auto-approval applies (launcher is in the approvers list).
    // `approvers` holds Payload user ids — compare against `actor.payloadId`
    // directly (previously this re-derived the Payload id via an email
    // lookup because only the Better-Auth session was available; the Actor
    // already carries both ids by name).
    let autoApproved = false
    if (approvalRequired) {
      const approverIds = (launch.approvalConfig?.approvers || []).map(
        (a: string | { id: string }) => typeof a === 'string' ? a : a.id,
      )
      autoApproved = approverIds.includes(actor.payloadId)
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
      actor.betterAuthId,
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
      // Semantic fix: `approvedBy` is `relationTo: 'users'` — the Payload id.
      updateData.approvedBy = actor.payloadId
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
  const actor = await getActor()
  if (!actor) {
    return { success: false, error: 'Unauthorized' }
  }

  const payload = await getPayload({ config })

  const launch = await payload.findByID({
    collection: 'launches',
    id: launchId,
    depth: 0,
    overrideAccess: true,
  })

  if (!launch) {
    return { success: false, error: 'Launch not found' }
  }

  // Explicit workspace membership check — defense-in-depth, consistent with
  // startLaunch/deleteLaunch siblings.
  const retryWsId = typeof launch.workspace === 'string' ? launch.workspace : launch.workspace.id
  if (!retryWsId) {
    return { success: false, error: 'Launch has no workspace' }
  }
  const retryMembership = await check('create', { kind: 'workspace', id: retryWsId }, actor)
  if (!retryMembership.allowed) {
    return { success: false, error: 'Not a member of this workspace' }
  }

  if (!['failed', 'aborted', 'launching'].includes(launch.status ?? '')) {
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
  const actor = await getActor()
  if (!actor) {
    return { success: false, error: 'Unauthorized' }
  }

  const payload = await getPayload({ config })

  const launch = await payload.findByID({
    collection: 'launches',
    id: launchId,
    depth: 0,
    overrideAccess: true,
  })

  if (!launch) {
    return { success: false, error: 'Launch not found' }
  }

  // Verify workspace membership before allowing delete
  const delWsId = typeof launch.workspace === 'string' ? launch.workspace : launch.workspace.id
  if (!delWsId) {
    return { success: false, error: 'Launch has no workspace' }
  }
  const delMembership = await check('create', { kind: 'workspace', id: delWsId }, actor)
  if (!delMembership.allowed) {
    return { success: false, error: 'Not a member of this workspace' }
  }

  if (['active', 'deorbiting', 'awaiting_approval'].includes(launch.status ?? '')) {
    return { success: false, error: `Cannot delete a launch with status "${launch.status}". Abort or deorbit first.` }
  }

  await payload.delete({
    collection: 'launches',
    id: launchId,
  })

  return { success: true }
}

export async function getLaunchStatus(launchId: string) {
  const actor = await getActor()
  if (!actor) {
    return null
  }

  const payload = await getPayload({ config })

  try {
    const launch = await payload.findByID({
      collection: 'launches',
      id: launchId,
      depth: 2,
      overrideAccess: true,
    })

    if (!launch) {
      return null
    }

    // Verify workspace membership before returning launch data
    const statusWsId = typeof launch.workspace === 'string' ? launch.workspace : launch.workspace.id
    if (!statusWsId) {
      return null
    }
    const statusMembership = await check('read', { kind: 'workspace', id: statusWsId }, actor)
    if (!statusMembership.allowed) {
      return null
    }

    return launch
  } catch (error) {
    console.error('Failed to get launch status:', error)
    return null
  }
}

export async function getLaunchWorkflowProgress(workflowId: string) {
  const actor = await getActor()
  if (!actor) {
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
  const actor = await getActor()
  if (!actor) {
    return { success: false, error: 'Unauthorized' }
  }

  try {
    const response = await approveLaunch(
      workflowId,
      approved,
      actor.betterAuthId,
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
  const actor = await getActor()
  if (!actor) {
    return { success: false, error: 'Unauthorized' }
  }

  try {
    const response = await deorbitLaunch(
      workflowId,
      actor.betterAuthId,
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
  const actor = await getActor()
  if (!actor) {
    return { success: false, error: 'Unauthorized' }
  }

  try {
    const response = await abortLaunch(
      workflowId,
      actor.betterAuthId,
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
  const actor = await getActor()
  if (!actor) {
    return { success: false, error: 'Unauthorized', docs: [] }
  }

  const payload = await getPayload({ config })

  try {
    const where: Where = provider
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
  const actor = await getActor()
  if (!actor) {
    return { success: false, error: 'Unauthorized', docs: [] }
  }

  const payload = await getPayload({ config })

  // Verify workspace membership before returning cloud account data
  const caCheck = await check('read', { kind: 'workspace', id: workspaceId }, actor)
  if (!caCheck.allowed) {
    return { success: false, error: 'Not a member of this workspace', docs: [] }
  }

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
  const actor = await getActor()
  if (!actor) {
    return { success: false, error: 'Unauthorized', docs: [] }
  }

  const payload = await getPayload({ config })

  // Verify workspace membership before enumerating launches
  const glCheck = await check('read', { kind: 'workspace', id: workspaceId }, actor)
  if (!glCheck.allowed) {
    return { success: false, error: 'Not a member of this workspace', docs: [] }
  }

  try {
    const launches = await payload.find({
      collection: 'launches',
      where: {
        workspace: { equals: workspaceId },
      },
      depth: 2,
      sort: '-updatedAt',
      limit: 100,
      overrideAccess: true,
    })

    return { success: true, docs: launches.docs }
  } catch (error) {
    console.error('Failed to fetch launches:', error)
    return { success: false, error: 'Failed to fetch launches', docs: [] }
  }
}

export async function getAllUserLaunches() {
  const actor = await getActor()
  if (!actor) {
    return { success: false, error: 'Unauthorized', docs: [] }
  }

  const payload = await getPayload({ config })

  try {
    // Get user's workspace memberships
    const workspaceIds = await memberWorkspaceIds('member', actor)

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
