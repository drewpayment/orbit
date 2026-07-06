import type { CollectionConfig } from 'payload'
import { adminOnly, workspaceScopedRead } from '@/lib/access/collection-access'

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
    // Platform admins can read all quotas; workspace owner/admin can read
    // their own workspace's quota.
    read: workspaceScopedRead({ scope: 'manage' }),
    // Only platform admins can create/update/delete quotas
    create: adminOnly,
    update: adminOnly,
    delete: adminOnly,
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
