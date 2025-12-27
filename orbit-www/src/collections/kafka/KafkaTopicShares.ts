import type { CollectionConfig, Where } from 'payload'

export const KafkaTopicShares: CollectionConfig = {
  slug: 'kafka-topic-shares',
  admin: {
    useAsTitle: 'id',
    group: 'Kafka',
    defaultColumns: ['topic', 'ownerWorkspace', 'targetWorkspace', 'accessLevel', 'status'],
    description: 'Cross-workspace topic access grants',
  },
  access: {
    // Read: Users can see shares involving their workspaces (as owner or target)
    read: async ({ req: { user, payload } }) => {
      if (!user) return false
      if (user.collection === 'users') return true

      const memberships = await payload.find({
        collection: 'workspace-members',
        where: {
          user: { equals: user.id },
          status: { equals: 'active' },
        },
        limit: 1000,
        overrideAccess: true,
      })

      const workspaceIds = memberships.docs.map(m =>
        String(typeof m.workspace === 'string' ? m.workspace : m.workspace.id)
      )

      return {
        or: [
          { ownerWorkspace: { in: workspaceIds } },
          { targetWorkspace: { in: workspaceIds } },
        ],
      } as Where
    },
    // Create: Only workspace admins can create shares (from owner workspace)
    create: async ({ req: { user, payload }, data }) => {
      if (!user) return false
      if (user.collection === 'users') return true

      if (!data?.ownerWorkspace) return false

      const members = await payload.find({
        collection: 'workspace-members',
        where: {
          and: [
            { workspace: { equals: data.ownerWorkspace } },
            { user: { equals: user.id } },
            { role: { in: ['owner', 'admin'] } },
            { status: { equals: 'active' } },
          ],
        },
        overrideAccess: true,
      })

      return members.docs.length > 0
    },
    // Update: Only owner workspace admins can update shares
    update: async ({ req: { user, payload }, id }) => {
      if (!user || !id) return false
      if (user.collection === 'users') return true

      const share = await payload.findByID({
        collection: 'kafka-topic-shares',
        id,
        overrideAccess: true,
      })

      const workspaceId = typeof share.ownerWorkspace === 'string' ? share.ownerWorkspace : share.ownerWorkspace.id

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
        overrideAccess: true,
      })

      return members.docs.length > 0
    },
    delete: async ({ req: { user, payload }, id }) => {
      if (!user || !id) return false
      if (user.collection === 'users') return true

      const share = await payload.findByID({
        collection: 'kafka-topic-shares',
        id,
        overrideAccess: true,
      })

      const workspaceId = typeof share.ownerWorkspace === 'string' ? share.ownerWorkspace : share.ownerWorkspace.id

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
        overrideAccess: true,
      })

      return members.docs.length > 0
    },
  },
  fields: [
    {
      name: 'topic',
      type: 'relationship',
      relationTo: 'kafka-topics',
      required: true,
      index: true,
      admin: {
        description: 'Topic being shared',
      },
    },
    {
      name: 'ownerWorkspace',
      type: 'relationship',
      relationTo: 'workspaces',
      required: true,
      index: true,
      admin: {
        description: 'Workspace that owns the topic',
      },
    },
    {
      name: 'targetWorkspace',
      type: 'relationship',
      relationTo: 'workspaces',
      required: true,
      index: true,
      admin: {
        description: 'Workspace receiving access',
      },
    },
    {
      name: 'accessLevel',
      type: 'select',
      required: true,
      options: [
        { label: 'Read (Consume)', value: 'read' },
        { label: 'Write (Produce)', value: 'write' },
        { label: 'Read + Write', value: 'read-write' },
      ],
      admin: {
        description: 'Level of access granted',
      },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'pending',
      options: [
        { label: 'Pending', value: 'pending' },
        { label: 'Approved', value: 'approved' },
        { label: 'Rejected', value: 'rejected' },
        { label: 'Revoked', value: 'revoked' },
        { label: 'Expired', value: 'expired' },
      ],
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'expiresAt',
      type: 'date',
      admin: {
        description: 'Optional expiration date for the share',
        date: {
          pickerAppearance: 'dayAndTime',
        },
      },
    },
    {
      name: 'requestedBy',
      type: 'relationship',
      relationTo: 'users',
      admin: {
        readOnly: true,
        description: 'User who requested the share',
      },
    },
    {
      name: 'approvedBy',
      type: 'relationship',
      relationTo: 'users',
      admin: {
        readOnly: true,
        description: 'User who approved the share',
      },
    },
    {
      name: 'approvedAt',
      type: 'date',
      admin: {
        readOnly: true,
        description: 'Approval timestamp',
      },
    },
    {
      name: 'reason',
      type: 'textarea',
      admin: {
        description: 'Reason for requesting access',
      },
    },
    {
      name: 'rejectionReason',
      type: 'textarea',
      admin: {
        description: 'Reason for rejection (if rejected)',
      },
    },
  ],
  hooks: {
    beforeChange: [
      async ({ operation, data, req }) => {
        if (operation === 'create' && req.user) {
          data.requestedBy = req.user.id
        }
        return data
      },
    ],
    beforeValidate: [
      async ({ data, operation, req }) => {
        // Prevent self-sharing
        if (operation === 'create' && data?.ownerWorkspace && data?.targetWorkspace) {
          const ownerId = typeof data.ownerWorkspace === 'string' ? data.ownerWorkspace : data.ownerWorkspace.id
          const targetId = typeof data.targetWorkspace === 'string' ? data.targetWorkspace : data.targetWorkspace.id
          if (ownerId === targetId) {
            throw new Error('Cannot share a topic with its owning workspace')
          }
        }
        return data
      },
    ],
  },
  timestamps: true,
}
