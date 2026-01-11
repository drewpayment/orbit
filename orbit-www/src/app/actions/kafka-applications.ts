'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { canCreateApplication, getWorkspaceQuotaInfo, type QuotaInfo } from '@/lib/kafka/quotas'

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

    // Create the application
    const application = await payload.create({
      collection: 'kafka-applications',
      data: {
        name: input.name,
        slug: input.slug,
        description: input.description || '',
        workspace: input.workspaceId,
        status: 'active',
        createdBy: session.user.id,
      },
      overrideAccess: true,
    })

    // TODO: Trigger Temporal workflow to provision virtual clusters

    return { success: true, applicationId: application.id }
  } catch (error) {
    console.error('Error creating application:', error)
    return { success: false, error: 'Failed to create application' }
  }
}

export interface ListApplicationsInput {
  workspaceId: string
}

export interface ApplicationData {
  id: string
  name: string
  slug: string
  description?: string
  status: 'active' | 'decommissioning' | 'deleted'
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
      const appId = typeof vc.application === 'string' ? vc.application : vc.application.id
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
