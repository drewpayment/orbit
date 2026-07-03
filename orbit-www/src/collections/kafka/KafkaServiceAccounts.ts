import type { Access, CollectionConfig, Where } from 'payload'
import crypto from 'crypto'
import { docWorkspaceMutate, manageCreate } from '@/lib/access/collection-access'
import { getMemberWorkspaceIds, isPlatformAdmin } from '@/lib/access/workspace-access'

/** Normalize a relationship value (`string` id or populated `{ id }`) to its id. */
function relationId(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value === 'object' && 'id' in (value as Record<string, unknown>)) {
    const id = (value as { id?: unknown }).id
    return typeof id === 'string' ? id : null
  }
  return null
}

// Read: no direct workspace relation — resolved indirectly via the parent
// `application`. Users see service accounts belonging to applications in
// their member workspaces.
const readServiceAccountsForMemberWorkspaces: Access = async ({ req: { user, payload } }) => {
  if (!user) return false
  if (isPlatformAdmin(user)) return true

  const betterAuthId = typeof user.betterAuthId === 'string' ? user.betterAuthId : null
  const workspaceIds = betterAuthId ? await getMemberWorkspaceIds(payload, betterAuthId) : []

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
}

// Resolves the workspace owning the `application` (or `virtualCluster`)
// referenced on the incoming data/doc, for create/update gating.
async function resolveServiceAccountWorkspace(
  payload: import('payload').Payload,
  appOrClusterRef: unknown,
): Promise<string | null> {
  const appId = relationId(appOrClusterRef)
  if (!appId) return null
  const app = await payload.findByID({
    collection: 'kafka-applications',
    id: appId,
    depth: 0,
    overrideAccess: true,
  })
  if (!app) return null
  return relationId(app.workspace)
}

export const KafkaServiceAccounts: CollectionConfig = {
  slug: 'kafka-service-accounts',
  admin: {
    useAsTitle: 'name',
    group: 'Kafka',
    defaultColumns: ['name', 'application', 'permissionTemplate', 'status', 'createdAt'],
    description: 'Service accounts for Kafka authentication',
  },
  access: {
    read: readServiceAccountsForMemberWorkspaces,
    // Owner/admin of the workspace that owns the referenced application
    create: manageCreate(['owner', 'admin'], {
      field: 'application',
      resolveWorkspace: ({ data, payload }) =>
        resolveServiceAccountWorkspace(payload, (data as Record<string, unknown> | undefined)?.application),
    }),
    // Owner/admin of the workspace that owns the service account's application
    update: docWorkspaceMutate('kafka-service-accounts', ['owner', 'admin'], {
      field: 'application',
      resolveWorkspace: ({ doc, payload }) =>
        resolveServiceAccountWorkspace(payload, (doc as Record<string, unknown> | undefined)?.application),
    }),
    // Soft delete via revoke instead of hard delete
    delete: () => false,
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
