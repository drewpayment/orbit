'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { canCreateApplication, getWorkspaceQuotaInfo, type QuotaInfo } from '@/lib/kafka/quotas'
import { getTemporalClient } from '@/lib/temporal/client'

export interface CreateApplicationInput {
  name: string
  slug: string
  description?: string
  workspaceId: string
}

export interface CreateApplicationResult {
  success: boolean
  applicationId?: string
  error?: string
  /** Set when quota is exceeded - use this to show quota exceeded modal */
  quotaExceeded?: boolean
  /** Quota info when quotaExceeded is true */
  quotaInfo?: QuotaInfo
}

export async function createApplication(
  input: CreateApplicationInput
): Promise<CreateApplicationResult> {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    })

    if (!session?.user) {
      return { success: false, error: 'Not authenticated' }
    }

    const payload = await getPayload({ config })

    // Verify user is member of workspace
    const membership = await payload.find({
      collection: 'workspace-members',
      where: {
        and: [
          { workspace: { equals: input.workspaceId } },
          { user: { equals: session.user.id } },
          { status: { equals: 'active' } },
        ],
      },
      limit: 1,
      overrideAccess: true,
    })

    if (membership.docs.length === 0) {
      return { success: false, error: 'Not a member of this workspace' }
    }

    // Check quota before creating
    const canCreate = await canCreateApplication(payload, input.workspaceId)
    if (!canCreate) {
      const quotaInfo = await getWorkspaceQuotaInfo(payload, input.workspaceId)
      return {
        success: false,
        error: 'Workspace has reached its application quota',
        quotaExceeded: true,
        quotaInfo,
      }
    }

    // Check if slug already exists in workspace
    const existing = await payload.find({
      collection: 'kafka-applications',
      where: {
        and: [
          { workspace: { equals: input.workspaceId } },
          { slug: { equals: input.slug } },
          { status: { not_equals: 'deleted' } },
        ],
      },
      limit: 1,
      overrideAccess: true,
    })

    if (existing.docs.length > 0) {
      return { success: false, error: 'An application with this slug already exists' }
    }

    // Get workspace to access slug
    const workspace = await payload.findByID({
      collection: 'workspaces',
      id: input.workspaceId,
      overrideAccess: true,
    })

    if (!workspace) {
      return { success: false, error: 'Workspace not found' }
    }

    // Create the application with pending provisioning status
    const application = await payload.create({
      collection: 'kafka-applications',
      data: {
        name: input.name,
        slug: input.slug,
        description: input.description || '',
        workspace: input.workspaceId,
        status: 'active',
        provisioningStatus: 'pending',
        createdBy: session.user.id,
      },
      overrideAccess: true,
    })

    // Trigger Temporal workflow to provision virtual clusters
    const workflowId = await triggerVirtualClusterProvisionWorkflow({
      applicationId: application.id,
      applicationSlug: input.slug,
      workspaceId: input.workspaceId,
      workspaceSlug: workspace.slug,
    })

    // Store workflow ID if started successfully
    if (workflowId) {
      await payload.update({
        collection: 'kafka-applications',
        id: application.id,
        data: {
          provisioningWorkflowId: workflowId,
        },
        overrideAccess: true,
      })
    }

    return { success: true, applicationId: application.id }
  } catch (error) {
    console.error('Error creating application:', error)
    return { success: false, error: 'Failed to create application' }
  }
}

export interface ListApplicationsInput {
  workspaceId: string
}

export interface EnvironmentProvisioningResult {
  status: 'success' | 'failed' | 'skipped'
  error?: string
  message?: string
}

export interface ProvisioningDetails {
  dev?: EnvironmentProvisioningResult
  stage?: EnvironmentProvisioningResult
  prod?: EnvironmentProvisioningResult
}

export interface ApplicationData {
  id: string
  name: string
  slug: string
  description?: string
  status: 'active' | 'decommissioning' | 'deleted'
  provisioningStatus: 'pending' | 'in_progress' | 'completed' | 'partial' | 'failed'
  provisioningError?: string
  provisioningDetails?: ProvisioningDetails
  createdAt: string
  virtualClusters?: {
    id: string
    environment: 'dev' | 'stage' | 'prod'
    status: string
    advertisedHost: string
  }[]
}

export interface ListApplicationsResult {
  success: boolean
  applications?: ApplicationData[]
  error?: string
}

export async function listApplications(
  input: ListApplicationsInput
): Promise<ListApplicationsResult> {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    })

    if (!session?.user) {
      return { success: false, error: 'Not authenticated' }
    }

    const payload = await getPayload({ config })

    // Verify user is member of workspace
    const membership = await payload.find({
      collection: 'workspace-members',
      where: {
        and: [
          { workspace: { equals: input.workspaceId } },
          { user: { equals: session.user.id } },
          { status: { equals: 'active' } },
        ],
      },
      limit: 1,
      overrideAccess: true,
    })

    if (membership.docs.length === 0) {
      return { success: false, error: 'Not a member of this workspace' }
    }

    // Fetch applications
    const apps = await payload.find({
      collection: 'kafka-applications',
      where: {
        and: [
          { workspace: { equals: input.workspaceId } },
          { status: { not_equals: 'deleted' } },
        ],
      },
      sort: '-createdAt',
      limit: 100,
      overrideAccess: true,
    })

    // Fetch virtual clusters for each application
    const appIds = apps.docs.map((a) => a.id)
    const virtualClusters = await payload.find({
      collection: 'kafka-virtual-clusters',
      where: {
        application: { in: appIds },
      },
      limit: 1000,
      overrideAccess: true,
    })

    // Group virtual clusters by application
    const vcByApp = new Map<string, typeof virtualClusters.docs>()
    for (const vc of virtualClusters.docs) {
      const appId = typeof vc.application === 'string' ? vc.application : vc.application?.id
      if (!appId) continue
      if (!vcByApp.has(appId)) {
        vcByApp.set(appId, [])
      }
      vcByApp.get(appId)!.push(vc)
    }

    const applications: ApplicationData[] = apps.docs.map((app) => ({
      id: app.id,
      name: app.name,
      slug: app.slug,
      description: app.description || undefined,
      status: app.status as ApplicationData['status'],
      provisioningStatus: (app.provisioningStatus || 'pending') as ApplicationData['provisioningStatus'],
      provisioningError: app.provisioningError || undefined,
      provisioningDetails: app.provisioningDetails as ProvisioningDetails | undefined,
      createdAt: app.createdAt,
      virtualClusters: vcByApp.get(app.id)?.map((vc) => ({
        id: vc.id,
        environment: vc.environment as 'dev' | 'stage' | 'prod',
        status: vc.status,
        advertisedHost: vc.advertisedHost,
      })),
    }))

    return { success: true, applications }
  } catch (error) {
    console.error('Error listing applications:', error)
    return { success: false, error: 'Failed to list applications' }
  }
}

export interface GetApplicationInput {
  applicationId: string
}

export interface GetApplicationResult {
  success: boolean
  application?: ApplicationData
  error?: string
}

export async function getApplication(
  input: GetApplicationInput
): Promise<GetApplicationResult> {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    })

    if (!session?.user) {
      return { success: false, error: 'Not authenticated' }
    }

    const payload = await getPayload({ config })

    const app = await payload.findByID({
      collection: 'kafka-applications',
      id: input.applicationId,
      depth: 1,
    })

    if (!app) {
      return { success: false, error: 'Application not found' }
    }

    // Fetch virtual clusters
    const virtualClusters = await payload.find({
      collection: 'kafka-virtual-clusters',
      where: {
        application: { equals: app.id },
      },
      limit: 10,
      overrideAccess: true,
    })

    const application: ApplicationData = {
      id: app.id,
      name: app.name,
      slug: app.slug,
      description: app.description || undefined,
      status: app.status as ApplicationData['status'],
      provisioningStatus: (app.provisioningStatus || 'pending') as ApplicationData['provisioningStatus'],
      provisioningError: app.provisioningError || undefined,
      provisioningDetails: app.provisioningDetails as ProvisioningDetails | undefined,
      createdAt: app.createdAt,
      virtualClusters: virtualClusters.docs.map((vc) => ({
        id: vc.id,
        environment: vc.environment as 'dev' | 'stage' | 'prod',
        status: vc.status,
        advertisedHost: vc.advertisedHost,
      })),
    }

    return { success: true, application }
  } catch (error) {
    console.error('Error getting application:', error)
    return { success: false, error: 'Failed to get application' }
  }
}

/**
 * Retries virtual cluster provisioning for an existing application.
 * Use this when virtual clusters failed to provision or were never started.
 */
export async function retryVirtualClusterProvisioning(
  applicationId: string
): Promise<{ success: boolean; workflowId?: string; error?: string }> {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    })

    if (!session?.user) {
      return { success: false, error: 'Not authenticated' }
    }

    const payload = await getPayload({ config })

    // Fetch application with workspace
    const application = await payload.findByID({
      collection: 'kafka-applications',
      id: applicationId,
      depth: 1,
    })

    if (!application) {
      return { success: false, error: 'Application not found' }
    }

    const workspace =
      typeof application.workspace === 'string'
        ? await payload.findByID({
            collection: 'workspaces',
            id: application.workspace,
            overrideAccess: true,
          })
        : application.workspace

    if (!workspace) {
      return { success: false, error: 'Workspace not found' }
    }

    const workspaceId = typeof application.workspace === 'string' ? application.workspace : workspace.id

    // Trigger the provisioning workflow
    const workflowId = await triggerVirtualClusterProvisionWorkflow({
      applicationId: application.id,
      applicationSlug: application.slug,
      workspaceId,
      workspaceSlug: workspace.slug,
    })

    if (!workflowId) {
      return { success: false, error: 'Failed to start provisioning workflow' }
    }

    // Update the application with the workflow ID and reset status
    await payload.update({
      collection: 'kafka-applications',
      id: applicationId,
      data: {
        provisioningWorkflowId: workflowId,
        provisioningStatus: 'pending',
        provisioningError: null, // Clear previous error
      },
      overrideAccess: true,
    })

    return { success: true, workflowId }
  } catch (error) {
    console.error('Error retrying virtual cluster provisioning:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Input type for VirtualClusterProvisionWorkflow (must match Go struct)
 */
type VirtualClusterProvisionWorkflowInput = {
  ApplicationID: string
  ApplicationSlug: string
  WorkspaceID: string
  WorkspaceSlug: string
}

/**
 * Triggers the VirtualClusterProvisionWorkflow to create dev, stage, and prod virtual clusters
 * for a newly created Kafka application.
 */
async function triggerVirtualClusterProvisionWorkflow(input: {
  applicationId: string
  applicationSlug: string
  workspaceId: string
  workspaceSlug: string
}): Promise<string | null> {
  const workflowId = `virtual-cluster-provision-${input.applicationId}`

  // Transform input to match Go struct field names (PascalCase)
  const workflowInput: VirtualClusterProvisionWorkflowInput = {
    ApplicationID: input.applicationId,
    ApplicationSlug: input.applicationSlug,
    WorkspaceID: input.workspaceId,
    WorkspaceSlug: input.workspaceSlug,
  }

  try {
    const client = await getTemporalClient()

    const handle = await client.workflow.start('VirtualClusterProvisionWorkflow', {
      taskQueue: 'orbit-workflows',
      workflowId,
      args: [workflowInput],
    })

    console.log(
      `[Kafka] Started VirtualClusterProvisionWorkflow: ${handle.workflowId} for app ${input.applicationSlug}`
    )

    return handle.workflowId
  } catch (error) {
    console.error('[Kafka] Failed to start VirtualClusterProvisionWorkflow:', error)
    // Don't throw - the application record is already created
    // The workflow can be retried manually if needed
    return null
  }
}
