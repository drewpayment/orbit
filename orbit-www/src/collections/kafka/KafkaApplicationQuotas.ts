import type { CollectionConfig } from 'payload'

/**
 * KafkaApplicationQuotas - Workspace-level quota overrides
 *
 * Stores per-workspace quota overrides for Kafka applications.
 * When a workspace has an entry here, it overrides the system default quota (5).
 * Only one quota record can exist per workspace.
 */
export const KafkaApplicationQuotas: CollectionConfig = {
  slug: 'kafka-application-quotas',
  admin: {
    useAsTitle: 'workspace',
    group: 'Kafka',
    defaultColumns: ['workspace', 'applicationQuota', 'setBy', 'updatedAt'],
    description: 'Workspace-level quota overrides for Kafka applications',
  },
  access: {
    // Platform admins can read all quotas
    // Workspace admins can read their own workspace quota
    read: async ({ req: { user, payload } }) => {
      if (!user) return false

      // Platform admins can see all
      if (user.collection === 'users') return true

      // Workspace admins can see their workspace quota
      const memberships = await payload.find({
        collection: 'workspace-members',
        where: {
          user: { equals: user.id },
          status: { equals: 'active' },
          role: { in: ['owner', 'admin'] },
        },
        limit: 1000,
        overrideAccess: true,
      })

      const workspaceIds = memberships.docs.map((m) =>
        String(typeof m.workspace === 'string' ? m.workspace : m.workspace.id)
      )

      return {
        workspace: { in: workspaceIds },
      }
    },
    // Only platform admins can create/update/delete quotas
    create: ({ req: { user } }) => {
      if (!user) return false
      return user.collection === 'users'
    },
    update: ({ req: { user } }) => {
      if (!user) return false
      return user.collection === 'users'
    },
    delete: ({ req: { user } }) => {
      if (!user) return false
      return user.collection === 'users'
    },
  },
  fields: [
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      required: true,
      unique: true, // One quota override per workspace
      index: true,
      admin: {
        description: 'Workspace this quota override applies to',
      },
    },
    {
      name: 'applicationQuota',
      type: 'number',
      required: true,
      min: 1,
      max: 1000,
      admin: {
        description: 'Maximum number of Kafka applications allowed for this workspace',
      },
    },
    {
      name: 'setBy',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      admin: {
        description: 'Platform admin who granted this quota override',
        readOnly: true,
      },
    },
    {
      name: 'reason',
      type: 'textarea',
      required: true,
      admin: {
        description: 'Reason for granting this quota override',
      },
    },
  ],
  hooks: {
    beforeChange: [
      async ({ operation, data, req }) => {
        // Set the setBy field to the current user on create
        if (operation === 'create' && req.user) {
          data.setBy = req.user.id
        }
        return data
      },
    ],
  },
  timestamps: true,
}
