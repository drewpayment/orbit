import type { CollectionConfig, Where } from 'payload'
import { encrypt } from '@/lib/encryption'
import { manageCreate, workspaceScopedRead, docWorkspaceMutate } from '@/lib/authz/payload'

export const EnvironmentVariables: CollectionConfig = {
  slug: 'environment-variables',
  admin: {
    useAsTitle: 'name',
    group: 'Configuration',
    defaultColumns: ['name', 'workspace', 'app', 'useInBuilds', 'useInDeployments', 'updatedAt'],
  },
  hooks: {
    beforeChange: [
      async ({ data, req, operation }) => {
        // Encrypt the value if it's being set and not already encrypted
        if (data?.value) {
          // Check if already encrypted (encrypted values have the format: iv:authTag:encryptedData)
          const isEncrypted = data.value.includes(':') && data.value.split(':').length === 3

          if (!isEncrypted) {
            data.value = encrypt(data.value)
          }
        }

        // Set createdBy on create
        if (operation === 'create' && req.user) {
          data.createdBy = req.user.id
        }

        return data
      },
    ],
    beforeValidate: [
      async ({ data, req, operation, originalDoc }) => {
        // Validate unique constraint: (workspace, app, name) must be unique
        if (data?.workspace && data?.name) {
          const where: Where = {
            and: [
              { workspace: { equals: data.workspace } },
              { name: { equals: data.name } },
            ],
          }

          // Include app in constraint (null values must also match)
          if (data.app) {
            where.and!.push({ app: { equals: data.app } })
          } else {
            where.and!.push({ app: { exists: false } })
          }

          // Exclude current document when updating
          if (operation === 'update' && originalDoc?.id) {
            where.and!.push({ id: { not_equals: originalDoc.id } })
          }

          const existing = await req.payload.find({
            collection: 'environment-variables',
            where,
            limit: 1,
            overrideAccess: true,
          })

          if (existing.docs.length > 0) {
            const scope = data.app ? 'app-level' : 'workspace-level'
            throw new Error(
              `An environment variable named "${data.name}" already exists at the ${scope} scope`
            )
          }
        }

        return data
      },
    ],
  },
  access: {
    // Read: Only workspace members can view variables
    read: workspaceScopedRead(),
    // Create: Only workspace owners/admins can create variables
    create: manageCreate(['owner', 'admin']),
    // Update: Only workspace owners/admins can update variables
    update: docWorkspaceMutate('environment-variables', ['owner', 'admin']),
    // Delete: Only workspace owners/admins can delete variables
    delete: docWorkspaceMutate('environment-variables', ['owner', 'admin']),
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      index: true,
      admin: {
        description: 'Variable name (e.g., TURSO_DATABASE_URL, API_KEY)',
      },
    },
    {
      name: 'value',
      type: 'text',
      required: true,
      admin: {
        description: 'Variable value (automatically encrypted on save)',
      },
    },
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      required: true,
      index: true,
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'app',
      type: 'relationship',
      relationTo: 'apps',
      admin: {
        description: 'Optional: Set this for app-level variable overrides',
        position: 'sidebar',
      },
    },
    {
      name: 'useInBuilds',
      type: 'checkbox',
      defaultValue: true,
      admin: {
        description: 'Include this variable in build processes',
      },
    },
    {
      name: 'useInDeployments',
      type: 'checkbox',
      defaultValue: true,
      admin: {
        description: 'Include this variable in deployment environments',
      },
    },
    {
      name: 'description',
      type: 'textarea',
      admin: {
        description: 'Optional: Describe what this variable is used for',
      },
    },
    {
      name: 'createdBy',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      admin: {
        position: 'sidebar',
        readOnly: true,
      },
    },
  ],
  indexes: [
    {
      fields: ['workspace', 'app', 'name'],
      unique: true,
    },
    {
      fields: ['workspace', 'name'],
    },
    {
      fields: ['app'],
    },
  ],
  timestamps: true,
}
