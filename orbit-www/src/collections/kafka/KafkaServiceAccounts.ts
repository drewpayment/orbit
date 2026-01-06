import type { CollectionConfig, Where } from 'payload'
import crypto from 'crypto'

export const KafkaServiceAccounts: CollectionConfig = {
  slug: 'kafka-service-accounts',
  admin: {
    useAsTitle: 'name',
    group: 'Kafka',
    defaultColumns: ['name', 'application', 'permissionTemplate', 'status', 'createdAt'],
    description: 'Service accounts for Kafka authentication',
  },
  access: {
    read: async ({ req: { user, payload } }) => {
      if (!user) return false
      if (user.collection !== 'users') return false

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

      // Find applications in user's workspaces
      const apps = await payload.find({
        collection: 'kafka-applications',
        where: {
          workspace: { in: workspaceIds },
        },
        limit: 1000,
        overrideAccess: true,
      })

      const appIds = apps.docs.map((a) => a.id)

      return {
        application: { in: appIds },
      } as Where
    },
    create: ({ req: { user } }) => !!user && user.collection === 'users',
    update: async ({ req: { user, payload }, id }) => {
      if (!user || !id || user.collection !== 'users') return false

      const serviceAccount = await payload.findByID({
        collection: 'kafka-service-accounts',
        id: id as string,
        overrideAccess: true,
      })

      if (!serviceAccount) return false

      const appId = typeof serviceAccount.application === 'string'
        ? serviceAccount.application
        : serviceAccount.application.id

      const app = await payload.findByID({
        collection: 'kafka-applications',
        id: appId,
        overrideAccess: true,
      })

      if (!app) return false

      const workspaceId = typeof app.workspace === 'string' ? app.workspace : app.workspace.id

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
    },
    delete: async ({ req: { user } }) => {
      // Soft delete via revoke instead of hard delete
      if (!user || user.collection !== 'users') return false
      return false
    },
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      admin: {
        description: 'Display name for the service account',
      },
    },
    {
      name: 'application',
      type: 'relationship',
      relationTo: 'kafka-applications',
      required: true,
      index: true,
      admin: {
        description: 'Parent Kafka application',
      },
    },
    {
      name: 'virtualCluster',
      type: 'relationship',
      relationTo: 'kafka-virtual-clusters',
      required: true,
      index: true,
      admin: {
        description: 'Virtual cluster this account authenticates to',
      },
    },
    {
      name: 'username',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: {
        readOnly: true,
        description: 'Generated username (workspace-app-env-name)',
      },
    },
    {
      name: 'passwordHash',
      type: 'text',
      required: true,
      hidden: true,
      admin: {
        description: 'SHA-256 hash of the password',
      },
    },
    {
      name: 'permissionTemplate',
      type: 'select',
      required: true,
      options: [
        { label: 'Producer', value: 'producer' },
        { label: 'Consumer', value: 'consumer' },
        { label: 'Admin', value: 'admin' },
        { label: 'Custom', value: 'custom' },
      ],
      admin: {
        description: 'Permission template defining access rights',
      },
    },
    {
      name: 'customPermissions',
      type: 'array',
      admin: {
        condition: (data) => data?.permissionTemplate === 'custom',
        description: 'Custom permissions (only for custom template)',
      },
      fields: [
        {
          name: 'resourceType',
          type: 'select',
          required: true,
          options: [
            { label: 'Topic', value: 'topic' },
            { label: 'Consumer Group', value: 'group' },
            { label: 'Transactional ID', value: 'transactional_id' },
          ],
        },
        {
          name: 'resourcePattern',
          type: 'text',
          required: true,
          admin: {
            description: 'Resource name pattern (regex or literal)',
          },
        },
        {
          name: 'operations',
          type: 'select',
          hasMany: true,
          required: true,
          options: [
            { label: 'Read', value: 'read' },
            { label: 'Write', value: 'write' },
            { label: 'Create', value: 'create' },
            { label: 'Delete', value: 'delete' },
            { label: 'Alter', value: 'alter' },
            { label: 'Describe', value: 'describe' },
          ],
        },
      ],
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'active',
      options: [
        { label: 'Active', value: 'active' },
        { label: 'Revoked', value: 'revoked' },
      ],
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'lastRotatedAt',
      type: 'date',
      admin: {
        readOnly: true,
        position: 'sidebar',
      },
    },
    {
      name: 'revokedAt',
      type: 'date',
      admin: {
        readOnly: true,
        condition: (data) => data?.status === 'revoked',
      },
    },
    {
      name: 'revokedBy',
      type: 'relationship',
      relationTo: 'users',
      admin: {
        readOnly: true,
        condition: (data) => data?.status === 'revoked',
      },
    },
    {
      name: 'createdBy',
      type: 'relationship',
      relationTo: 'users',
      admin: {
        readOnly: true,
        position: 'sidebar',
      },
    },
  ],
  hooks: {
    beforeChange: [
      async ({ operation, data, req }) => {
        if (operation === 'create' && req.user) {
          data.createdBy = req.user.id
        }
        return data
      },
    ],
  },
  timestamps: true,
}

// Helper function to generate secure password
export function generateSecurePassword(length: number = 32): string {
  return crypto.randomBytes(length).toString('base64url')
}

// Helper function to hash password
export function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex')
}

// Helper function to generate username
export function generateServiceAccountUsername(
  workspaceSlug: string,
  appSlug: string,
  environment: string,
  name: string
): string {
  return `${workspaceSlug}-${appSlug}-${environment}-${name}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .substring(0, 128)
}
