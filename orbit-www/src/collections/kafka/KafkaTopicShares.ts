import type { CollectionConfig } from 'payload'
import { docWorkspaceMutate, manageCreate, workspaceScopedRead } from '@/lib/access/collection-access'

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
    read: workspaceScopedRead({ fields: ['ownerWorkspace', 'targetWorkspace'] }),
    // Create: Only owner-workspace admins can create shares (from owner workspace)
    create: manageCreate(['owner', 'admin'], { field: 'ownerWorkspace' }),
    // Update: Only owner-workspace admins can update shares
    update: docWorkspaceMutate('kafka-topic-shares', ['owner', 'admin'], { field: 'ownerWorkspace' }),
    delete: docWorkspaceMutate('kafka-topic-shares', ['owner', 'admin'], { field: 'ownerWorkspace' }),
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
