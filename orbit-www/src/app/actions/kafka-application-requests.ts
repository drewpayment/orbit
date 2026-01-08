'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import type { KafkaApplicationRequest, User, Workspace } from '@/payload-types'

// Types for application requests
export interface SubmitApplicationRequestInput {
  workspaceId: string
  applicationName: string
  applicationSlug: string
  description?: string
}

export interface SubmitApplicationRequestResult {
  success: boolean
  requestId?: string
  error?: string
}

export interface ApplicationRequestData {
  id: string
  applicationName: string
  applicationSlug: string
  description?: string
  status: 'pending_workspace' | 'pending_platform' | 'approved' | 'rejected'
  workspaceId: string
  workspaceName?: string
  requestedBy: {
    id: string
    name?: string
    email?: string
  }
  workspaceApprovedBy?: {
    id: string
    name?: string
    email?: string
  }
  workspaceApprovedAt?: string
  platformApprovedBy?: {
    id: string
    name?: string
    email?: string
  }
  platformApprovedAt?: string
  platformAction?: 'approved_single' | 'increased_quota'
  rejectedBy?: {
    id: string
    name?: string
    email?: string
  }
  rejectedAt?: string
  rejectionReason?: string
  createdAt: string
}

/**
 * Submit an application request when quota is exceeded
 */
export async function submitApplicationRequest(
  input: SubmitApplicationRequestInput
): Promise<SubmitApplicationRequestResult> {
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

    // Check if there's already a pending request for this slug
    const existingRequest = await payload.find({
      collection: 'kafka-application-requests',
      where: {
        and: [
          { workspace: { equals: input.workspaceId } },
          { applicationSlug: { equals: input.applicationSlug } },
          { status: { in: ['pending_workspace', 'pending_platform'] } },
        ],
      },
      limit: 1,
      overrideAccess: true,
    })

    if (existingRequest.docs.length > 0) {
      return { success: false, error: 'A pending request for this application already exists' }
    }

    // Check if an application with this slug already exists
    const existingApp = await payload.find({
      collection: 'kafka-applications',
      where: {
        and: [
          { workspace: { equals: input.workspaceId } },
          { slug: { equals: input.applicationSlug } },
          { status: { not_equals: 'deleted' } },
        ],
      },
      limit: 1,
      overrideAccess: true,
    })

    if (existingApp.docs.length > 0) {
      return { success: false, error: 'An application with this slug already exists' }
    }

    // Create the request
    const request = await payload.create({
      collection: 'kafka-application-requests',
      data: {
        workspace: input.workspaceId,
        applicationName: input.applicationName,
        applicationSlug: input.applicationSlug,
        description: input.description || '',
        requestedBy: session.user.id,
        status: 'pending_workspace',
      },
      overrideAccess: true,
    })

    return { success: true, requestId: request.id }
  } catch (error) {
    console.error('Error submitting application request:', error)
    return { success: false, error: 'Failed to submit request' }
  }
}

/**
 * Get user's own requests for a workspace
 */
export async function getMyRequests(workspaceId: string): Promise<{
  success: boolean
  requests?: ApplicationRequestData[]
  error?: string
}> {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    })

    if (!session?.user) {
      return { success: false, error: 'Not authenticated' }
    }

    const payload = await getPayload({ config })

    const requests = await payload.find({
      collection: 'kafka-application-requests',
      where: {
        and: [
          { workspace: { equals: workspaceId } },
          { requestedBy: { equals: session.user.id } },
        ],
      },
      sort: '-createdAt',
      limit: 100,
      depth: 1,
      overrideAccess: true,
    })

    return {
      success: true,
      requests: requests.docs.map(mapRequestToData),
    }
  } catch (error) {
    console.error('Error getting my requests:', error)
    return { success: false, error: 'Failed to get requests' }
  }
}

/**
 * Get pending workspace approvals (for workspace admins)
 */
export async function getPendingWorkspaceApprovals(workspaceId: string): Promise<{
  success: boolean
  requests?: ApplicationRequestData[]
  error?: string
}> {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    })

    if (!session?.user) {
      return { success: false, error: 'Not authenticated' }
    }

    const payload = await getPayload({ config })

    // Verify user is workspace admin
    const membership = await payload.find({
      collection: 'workspace-members',
      where: {
        and: [
          { workspace: { equals: workspaceId } },
          { user: { equals: session.user.id } },
          { role: { in: ['owner', 'admin'] } },
          { status: { equals: 'active' } },
        ],
      },
      limit: 1,
      overrideAccess: true,
    })

    if (membership.docs.length === 0) {
      return { success: false, error: 'Not a workspace admin' }
    }

    const requests = await payload.find({
      collection: 'kafka-application-requests',
      where: {
        and: [
          { workspace: { equals: workspaceId } },
          { status: { equals: 'pending_workspace' } },
        ],
      },
      sort: '-createdAt',
      limit: 100,
      depth: 1,
      overrideAccess: true,
    })

    return {
      success: true,
      requests: requests.docs.map(mapRequestToData),
    }
  } catch (error) {
    console.error('Error getting pending workspace approvals:', error)
    return { success: false, error: 'Failed to get approvals' }
  }
}

/**
 * Get pending platform approvals (for platform admins)
 */
export async function getPendingPlatformApprovals(): Promise<{
  success: boolean
  requests?: ApplicationRequestData[]
  error?: string
}> {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    })

    if (!session?.user) {
      return { success: false, error: 'Not authenticated' }
    }

    const payload = await getPayload({ config })

    // Check if user is platform admin (exists in users collection)
    const user = await payload.findByID({
      collection: 'users',
      id: session.user.id,
      overrideAccess: true,
    })

    if (!user) {
      return { success: false, error: 'Not a platform admin' }
    }

    const requests = await payload.find({
      collection: 'kafka-application-requests',
      where: {
        status: { equals: 'pending_platform' },
      },
      sort: '-createdAt',
      limit: 100,
      depth: 2, // Need workspace name
      overrideAccess: true,
    })

    return {
      success: true,
      requests: requests.docs.map(mapRequestToData),
    }
  } catch (error) {
    console.error('Error getting pending platform approvals:', error)
    return { success: false, error: 'Failed to get approvals' }
  }
}

/**
 * Approve request as workspace admin
 */
export async function approveRequestAsWorkspaceAdmin(requestId: string): Promise<{
  success: boolean
  error?: string
}> {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    })

    if (!session?.user) {
      return { success: false, error: 'Not authenticated' }
    }

    const payload = await getPayload({ config })

    const request = await payload.findByID({
      collection: 'kafka-application-requests',
      id: requestId,
      overrideAccess: true,
    })

    if (!request) {
      return { success: false, error: 'Request not found' }
    }

    if (request.status !== 'pending_workspace') {
      return { success: false, error: 'Request is not pending workspace approval' }
    }

    const workspaceId =
      typeof request.workspace === 'string'
        ? request.workspace
        : (request.workspace as { id: string }).id

    // Verify user is workspace admin
    const membership = await payload.find({
      collection: 'workspace-members',
      where: {
        and: [
          { workspace: { equals: workspaceId } },
          { user: { equals: session.user.id } },
          { role: { in: ['owner', 'admin'] } },
          { status: { equals: 'active' } },
        ],
      },
      limit: 1,
      overrideAccess: true,
    })

    if (membership.docs.length === 0) {
      return { success: false, error: 'Not a workspace admin' }
    }

    // Update request to pending_platform
    await payload.update({
      collection: 'kafka-application-requests',
      id: requestId,
      data: {
        status: 'pending_platform',
        workspaceApprovedBy: session.user.id,
        workspaceApprovedAt: new Date().toISOString(),
      },
      overrideAccess: true,
    })

    return { success: true }
  } catch (error) {
    console.error('Error approving request as workspace admin:', error)
    return { success: false, error: 'Failed to approve request' }
  }
}

/**
 * Reject request as workspace admin
 */
export async function rejectRequestAsWorkspaceAdmin(
  requestId: string,
  reason?: string
): Promise<{
  success: boolean
  error?: string
}> {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    })

    if (!session?.user) {
      return { success: false, error: 'Not authenticated' }
    }

    const payload = await getPayload({ config })

    const request = await payload.findByID({
      collection: 'kafka-application-requests',
      id: requestId,
      overrideAccess: true,
    })

    if (!request) {
      return { success: false, error: 'Request not found' }
    }

    if (request.status !== 'pending_workspace') {
      return { success: false, error: 'Request is not pending workspace approval' }
    }

    const workspaceId =
      typeof request.workspace === 'string'
        ? request.workspace
        : (request.workspace as { id: string }).id

    // Verify user is workspace admin
    const membership = await payload.find({
      collection: 'workspace-members',
      where: {
        and: [
          { workspace: { equals: workspaceId } },
          { user: { equals: session.user.id } },
          { role: { in: ['owner', 'admin'] } },
          { status: { equals: 'active' } },
        ],
      },
      limit: 1,
      overrideAccess: true,
    })

    if (membership.docs.length === 0) {
      return { success: false, error: 'Not a workspace admin' }
    }

    // Update request to rejected
    await payload.update({
      collection: 'kafka-application-requests',
      id: requestId,
      data: {
        status: 'rejected',
        rejectedBy: session.user.id,
        rejectedAt: new Date().toISOString(),
        rejectionReason: reason || null,
      },
      overrideAccess: true,
    })

    return { success: true }
  } catch (error) {
    console.error('Error rejecting request as workspace admin:', error)
    return { success: false, error: 'Failed to reject request' }
  }
}

/**
 * Approve request as platform admin
 */
export async function approveRequestAsPlatformAdmin(
  requestId: string,
  action: 'single' | 'increase_quota'
): Promise<{
  success: boolean
  error?: string
}> {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    })

    if (!session?.user) {
      return { success: false, error: 'Not authenticated' }
    }

    const payload = await getPayload({ config })

    // Check if user is platform admin
    const user = await payload.findByID({
      collection: 'users',
      id: session.user.id,
      overrideAccess: true,
    })

    if (!user) {
      return { success: false, error: 'Not a platform admin' }
    }

    const request = await payload.findByID({
      collection: 'kafka-application-requests',
      id: requestId,
      overrideAccess: true,
    })

    if (!request) {
      return { success: false, error: 'Request not found' }
    }

    if (request.status !== 'pending_platform') {
      return { success: false, error: 'Request is not pending platform approval' }
    }

    const platformAction = action === 'increase_quota' ? 'increased_quota' : 'approved_single'

    // Update request to approved
    await payload.update({
      collection: 'kafka-application-requests',
      id: requestId,
      data: {
        status: 'approved',
        platformApprovedBy: session.user.id,
        platformApprovedAt: new Date().toISOString(),
        platformAction,
      },
      overrideAccess: true,
    })

    // Note: The actual application creation and quota increase
    // are handled by the afterChange hook on the collection

    return { success: true }
  } catch (error) {
    console.error('Error approving request as platform admin:', error)
    return { success: false, error: 'Failed to approve request' }
  }
}

/**
 * Reject request as platform admin
 */
export async function rejectRequestAsPlatformAdmin(
  requestId: string,
  reason?: string
): Promise<{
  success: boolean
  error?: string
}> {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    })

    if (!session?.user) {
      return { success: false, error: 'Not authenticated' }
    }

    const payload = await getPayload({ config })

    // Check if user is platform admin
    const user = await payload.findByID({
      collection: 'users',
      id: session.user.id,
      overrideAccess: true,
    })

    if (!user) {
      return { success: false, error: 'Not a platform admin' }
    }

    const request = await payload.findByID({
      collection: 'kafka-application-requests',
      id: requestId,
      overrideAccess: true,
    })

    if (!request) {
      return { success: false, error: 'Request not found' }
    }

    if (request.status !== 'pending_platform') {
      return { success: false, error: 'Request is not pending platform approval' }
    }

    // Update request to rejected
    await payload.update({
      collection: 'kafka-application-requests',
      id: requestId,
      data: {
        status: 'rejected',
        rejectedBy: session.user.id,
        rejectedAt: new Date().toISOString(),
        rejectionReason: reason || null,
      },
      overrideAccess: true,
    })

    return { success: true }
  } catch (error) {
    console.error('Error rejecting request as platform admin:', error)
    return { success: false, error: 'Failed to reject request' }
  }
}

/**
 * Check if current user is a workspace admin and get pending approval count
 */
export async function getWorkspaceAdminStatus(workspaceId: string): Promise<{
  isAdmin: boolean
  pendingCount: number
}> {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    })

    if (!session?.user) {
      return { isAdmin: false, pendingCount: 0 }
    }

    const payload = await getPayload({ config })

    // Check workspace admin membership
    const membership = await payload.find({
      collection: 'workspace-members',
      where: {
        and: [
          { workspace: { equals: workspaceId } },
          { user: { equals: session.user.id } },
          { role: { in: ['owner', 'admin'] } },
          { status: { equals: 'active' } },
        ],
      },
      limit: 1,
      overrideAccess: true,
    })

    const isAdmin = membership.docs.length > 0

    if (!isAdmin) {
      return { isAdmin: false, pendingCount: 0 }
    }

    // Get pending approval count
    const pendingRequests = await payload.find({
      collection: 'kafka-application-requests',
      where: {
        and: [
          { workspace: { equals: workspaceId } },
          { status: { equals: 'pending_workspace' } },
        ],
      },
      limit: 0, // We only need the count
      overrideAccess: true,
    })

    return { isAdmin: true, pendingCount: pendingRequests.totalDocs }
  } catch {
    return { isAdmin: false, pendingCount: 0 }
  }
}

// Helper function to map request document to data type
function mapRequestToData(doc: KafkaApplicationRequest): ApplicationRequestData {
  const requestedBy = doc.requestedBy as User | string
  const workspaceApprovedBy = doc.workspaceApprovedBy as User | string | null | undefined
  const platformApprovedBy = doc.platformApprovedBy as User | string | null | undefined
  const rejectedBy = doc.rejectedBy as User | string | null | undefined
  const workspace = doc.workspace as Workspace | string

  return {
    id: doc.id,
    applicationName: doc.applicationName,
    applicationSlug: doc.applicationSlug,
    description: doc.description || undefined,
    status: doc.status,
    workspaceId: typeof workspace === 'string' ? workspace : workspace.id,
    workspaceName: typeof workspace === 'object' ? workspace.name : undefined,
    requestedBy: {
      id: typeof requestedBy === 'string' ? requestedBy : requestedBy.id,
      name: typeof requestedBy === 'object' ? requestedBy.name || undefined : undefined,
      email: typeof requestedBy === 'object' ? requestedBy.email : undefined,
    },
    workspaceApprovedBy: workspaceApprovedBy
      ? {
          id:
            typeof workspaceApprovedBy === 'string'
              ? workspaceApprovedBy
              : workspaceApprovedBy.id,
          name:
            typeof workspaceApprovedBy === 'object'
              ? workspaceApprovedBy.name || undefined
              : undefined,
          email:
            typeof workspaceApprovedBy === 'object'
              ? workspaceApprovedBy.email
              : undefined,
        }
      : undefined,
    workspaceApprovedAt: doc.workspaceApprovedAt || undefined,
    platformApprovedBy: platformApprovedBy
      ? {
          id:
            typeof platformApprovedBy === 'string'
              ? platformApprovedBy
              : platformApprovedBy.id,
          name:
            typeof platformApprovedBy === 'object'
              ? platformApprovedBy.name || undefined
              : undefined,
          email:
            typeof platformApprovedBy === 'object'
              ? platformApprovedBy.email
              : undefined,
        }
      : undefined,
    platformApprovedAt: doc.platformApprovedAt || undefined,
    platformAction: doc.platformAction || undefined,
    rejectedBy: rejectedBy
      ? {
          id: typeof rejectedBy === 'string' ? rejectedBy : rejectedBy.id,
          name:
            typeof rejectedBy === 'object'
              ? rejectedBy.name || undefined
              : undefined,
          email:
            typeof rejectedBy === 'object'
              ? rejectedBy.email
              : undefined,
        }
      : undefined,
    rejectedAt: doc.rejectedAt || undefined,
    rejectionReason: doc.rejectionReason || undefined,
    createdAt: doc.createdAt,
  }
}
