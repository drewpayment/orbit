import type { Access, CollectionConfig, Where } from 'payload'
import { afterChangeHook } from './hooks/applicationRequestHooks'
import { memberCreate } from '@/lib/access/collection-access'
import {
  getAdminOrOwnerWorkspaceIds,
  getMemberWorkspaceIds,
  isPlatformAdmin,
  isWorkspaceAdminOrOwner,
} from '@/lib/access/workspace-access'

// Read: users see (1) their own requests regardless of status, (2) requests
// awaiting workspace-tier approval in workspaces they admin, and (3) all
// requests (any status) in workspaces they're a member of, for audit.
// `requestedBy` is a relationship to `users` (set from `req.user.id` in the
// beforeChange hook below), so comparing against the Payload id is correct —
// only the workspace-membership lookups needed the Better-Auth id fix.
const readOwnOrWorkspaceRequests: Access = async ({ req: { user, payload } }) => {
  if (!user) return false
  if (isPlatformAdmin(user)) return true

  const betterAuthId = typeof user.betterAuthId === 'string' ? user.betterAuthId : null
  const [workspaceIds, adminWorkspaceIds] = betterAuthId
    ? await Promise.all([
        getMemberWorkspaceIds(payload, betterAuthId),
        getAdminOrOwnerWorkspaceIds(payload, betterAuthId),
      ])
    : [[], []]

  return {
    or: [
      { requestedBy: { equals: user.id } },
      {
        and: [
          { workspace: { in: adminWorkspaceIds } },
          { status: { equals: 'pending_workspace' } },
        ],
      },
      { workspace: { in: workspaceIds } },
    ],
  } as Where
}

// Update: workspace owner/admin can act on a request only while it's still
// awaiting workspace-tier approval; platform tier + terminal states are
// handled elsewhere (server actions / hooks running with overrideAccess).
const updateWhilePendingWorkspace: Access = async ({ req: { user, payload }, id }) => {
  if (!user || !id) return false
  if (isPlatformAdmin(user)) return true

  const betterAuthId = typeof user.betterAuthId === 'string' ? user.betterAuthId : null
  if (!betterAuthId) return false

  const request = await payload.findByID({
    collection: 'kafka-application-requests',
    id: id as string,
    depth: 0,
    overrideAccess: true,
  })
  if (!request || request.status !== 'pending_workspace') return false

  const workspaceId =
    typeof request.workspace === 'string' ? request.workspace : (request.workspace as { id: string })?.id
  if (!workspaceId) return false

  return isWorkspaceAdminOrOwner(payload, betterAuthId, workspaceId)
}

// Delete: only the requester can cancel their own still-pending request.
const deleteOwnPendingRequest: Access = async ({ req: { user, payload }, id }) => {
  if (!user || !id) return false
  if (isPlatformAdmin(user)) return true

  const request = await payload.findByID({
    collection: 'kafka-application-requests',
    id: id as string,
    depth: 0,
    overrideAccess: true,
  })
  if (!request) return false

  const requesterId =
    typeof request.requestedBy === 'string'
      ? request.requestedBy
      : (request.requestedBy as { id: string })?.id

  return (
    requesterId === user.id &&
    (request.status === 'pending_workspace' || request.status === 'pending_platform')
  )
}

/**
 * KafkaApplicationRequests - Pending approval requests for Kafka applications
 *
 * When a workspace exceeds its application quota, users submit requests
 * that go through a dual-tier approval workflow:
 * 1. Workspace admin approval (pending_workspace → pending_platform)
 * 2. Platform admin approval (pending_platform → approved/rejected)
 *
 * On approval, the application is created automatically via collection hooks.
 */
export const KafkaApplicationRequests: CollectionConfig = {
  slug: 'kafka-application-requests',
  admin: {
    useAsTitle: 'applicationName',
    group: 'Kafka',
    defaultColumns: ['applicationName', 'workspace', 'status', 'requestedBy', 'createdAt'],
    description: 'Approval requests for Kafka applications when quota is exceeded',
  },
  access: {
    // Users can see their own requests
    // Workspace admins can see workspace requests in pending_workspace
    // Platform admins can see all pending_platform requests
    read: readOwnOrWorkspaceRequests,
    // Any active member of the target workspace can create a request
    create: memberCreate(),
    // Updates controlled by server actions - only allow through hooks
    update: updateWhilePendingWorkspace,
    // Only requester can delete (cancel) their own pending request
    delete: deleteOwnPendingRequest,
  },
  fields: [
    // Application details (same as normal creation)
    {
      name: 'applicationName',
      type: 'text',
      required: true,
      admin: {
        description: 'Display name for the application',
      },
    },
    {
      name: 'applicationSlug',
      type: 'text',
      required: true,
      index: true,
      admin: {
        description: 'URL-safe identifier',
      },
      validate: (value: string | undefined | null) => {
        if (!value) return 'Slug is required'
        if (!/^[a-z][a-z0-9-]*$/.test(value)) {
          return 'Slug must start with a letter and contain only lowercase letters, numbers, and hyphens'
        }
        if (value.length > 63) {
          return 'Slug must be 63 characters or less'
        }
        return true
      },
    },
    {
      name: 'description',
      type: 'textarea',
      admin: {
        description: 'Optional description of what this application does',
      },
    },
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      required: true,
      index: true,
      admin: {
        description: 'Workspace requesting the application',
      },
    },
    {
      name: 'requestedBy',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      admin: {
        description: 'User who submitted the request',
        readOnly: true,
      },
    },
    // Status
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'pending_workspace',
      options: [
        { label: 'Pending Workspace Approval', value: 'pending_workspace' },
        { label: 'Pending Platform Approval', value: 'pending_platform' },
        { label: 'Approved', value: 'approved' },
        { label: 'Rejected', value: 'rejected' },
      ],
      index: true,
      admin: {
        position: 'sidebar',
      },
    },
    // Workspace tier approval
    {
      name: 'workspaceApprovedBy',
      type: 'relationship',
      relationTo: 'users',
      admin: {
        description: 'Workspace admin who approved',
        readOnly: true,
        condition: (data) =>
          data?.status === 'pending_platform' ||
          data?.status === 'approved' ||
          (data?.status === 'rejected' && data?.workspaceApprovedBy),
      },
    },
    {
      name: 'workspaceApprovedAt',
      type: 'date',
      admin: {
        readOnly: true,
        condition: (data) =>
          data?.status === 'pending_platform' ||
          data?.status === 'approved' ||
          (data?.status === 'rejected' && data?.workspaceApprovedAt),
      },
    },
    // Platform tier approval
    {
      name: 'platformApprovedBy',
      type: 'relationship',
      relationTo: 'users',
      admin: {
        description: 'Platform admin who approved',
        readOnly: true,
        condition: (data) => data?.status === 'approved',
      },
    },
    {
      name: 'platformApprovedAt',
      type: 'date',
      admin: {
        readOnly: true,
        condition: (data) => data?.status === 'approved',
      },
    },
    {
      name: 'platformAction',
      type: 'select',
      options: [
        { label: 'Approved Single Request', value: 'approved_single' },
        { label: 'Increased Workspace Quota', value: 'increased_quota' },
      ],
      admin: {
        description: 'Action taken by platform admin on approval',
        readOnly: true,
        condition: (data) => data?.status === 'approved',
      },
    },
    // Rejection (either tier can reject)
    {
      name: 'rejectedBy',
      type: 'relationship',
      relationTo: 'users',
      admin: {
        description: 'Admin who rejected the request',
        readOnly: true,
        condition: (data) => data?.status === 'rejected',
      },
    },
    {
      name: 'rejectedAt',
      type: 'date',
      admin: {
        readOnly: true,
        condition: (data) => data?.status === 'rejected',
      },
    },
    {
      name: 'rejectionReason',
      type: 'textarea',
      admin: {
        description: 'Optional reason for rejection',
        readOnly: true,
        condition: (data) => data?.status === 'rejected',
      },
    },
  ],
  hooks: {
    beforeChange: [
      async ({ operation, data, req }) => {
        if (operation === 'create' && req.user) {
          data.requestedBy = req.user.id
          data.status = 'pending_workspace'
        }
        return data
      },
    ],
    afterChange: [afterChangeHook],
  },
  timestamps: true,
}
