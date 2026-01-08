import type { CollectionConfig, Where } from 'payload'
import { afterChangeHook } from './hooks/applicationRequestHooks'

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
    read: async ({ req: { user, payload } }) => {
      if (!user) return false

      // Platform admins can see all
      if (user.collection === 'users') return true

      // Get user's workspace memberships
      const memberships = await payload.find({
        collection: 'workspace-members',
        where: {
          user: { equals: user.id },
          status: { equals: 'active' },
        },
        limit: 1000,
        overrideAccess: true,
      })

      const workspaceIds = memberships.docs.map((m) =>
        String(typeof m.workspace === 'string' ? m.workspace : m.workspace.id)
      )

      const adminWorkspaceIds = memberships.docs
        .filter((m) => m.role === 'owner' || m.role === 'admin')
        .map((m) => String(typeof m.workspace === 'string' ? m.workspace : m.workspace.id))

      // User can see:
      // 1. Their own requests (any status)
      // 2. Requests in workspaces they admin (pending_workspace status)
      return {
        or: [
          { requestedBy: { equals: user.id } },
          {
            and: [
              { workspace: { in: adminWorkspaceIds } },
              { status: { equals: 'pending_workspace' } },
            ],
          },
          // Also allow workspace admins to see approved/rejected for audit
          {
            and: [{ workspace: { in: workspaceIds } }],
          },
        ],
      } as Where
    },
    // Any authenticated user can create a request
    create: ({ req: { user } }) => !!user,
    // Updates controlled by server actions - only allow through hooks
    update: async ({ req: { user, payload }, id }) => {
      if (!user || !id) return false

      // Platform admins can update any
      if (user.collection === 'users') return true

      const request = await payload.findByID({
        collection: 'kafka-application-requests',
        id: id as string,
        overrideAccess: true,
      })

      if (!request) return false

      const workspaceId =
        typeof request.workspace === 'string'
          ? request.workspace
          : (request.workspace as { id: string }).id

      // Workspace admins can update requests in pending_workspace
      if (request.status === 'pending_workspace') {
        const members = await payload.find({
          collection: 'workspace-members',
          where: {
            and: [
              { workspace: { equals: workspaceId } },
              { user: { equals: user.id } },
              { role: { in: ['owner', 'admin'] } },
              { status: { equals: 'active' } },
            ],
          },
          limit: 1,
          overrideAccess: true,
        })

        return members.docs.length > 0
      }

      return false
    },
    // Only requester can delete (cancel) their own pending request
    delete: async ({ req: { user, payload }, id }) => {
      if (!user || !id) return false

      // Platform admins can delete any
      if (user.collection === 'users') return true

      const request = await payload.findByID({
        collection: 'kafka-application-requests',
        id: id as string,
        overrideAccess: true,
      })

      if (!request) return false

      // Only requester can cancel, and only if still pending
      const requesterId =
        typeof request.requestedBy === 'string'
          ? request.requestedBy
          : (request.requestedBy as { id: string }).id

      return (
        requesterId === user.id &&
        (request.status === 'pending_workspace' || request.status === 'pending_platform')
      )
    },
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
