import type { CollectionConfig, Where } from 'payload'
import { createHash } from 'crypto'

export const APISchemaVersions: CollectionConfig = {
  slug: 'api-schema-versions',
  admin: {
    useAsTitle: 'version',
    group: 'API Catalog',
    defaultColumns: ['schema', 'version', 'versionNumber', 'createdAt'],
    description: 'Version history for API schemas',
  },
  access: {
    // Read: Inherit from parent schema (via workspace)
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
        workspace: { in: workspaceIds },
      } as Where
    },
    // Only allow create/update/delete for authenticated users (managed via schema hooks)
    create: ({ req: { user } }) => !!user,
    update: ({ req: { user } }) => user?.collection === 'users',
    delete: ({ req: { user } }) => user?.collection === 'users',
  },
  fields: [
    {
      name: 'schema',
      type: 'relationship',
      relationTo: 'api-schemas',
      required: true,
      index: true,
      admin: {
        description: 'Parent API schema',
      },
    },
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      required: true,
      index: true,
      admin: {
        description: 'Workspace (denormalized for access control)',
      },
    },
    {
      name: 'version',
      type: 'text',
      required: true,
      admin: {
        description: 'Version string (from OpenAPI info.version or auto-generated)',
      },
    },
    {
      name: 'versionNumber',
      type: 'number',
      required: true,
      index: true,
      admin: {
        description: 'Monotonic version number for ordering',
      },
    },
    {
      name: 'rawContent',
      type: 'code',
      required: true,
      admin: {
        language: 'yaml',
        description: 'OpenAPI specification content at this version',
      },
    },
    {
      name: 'contentHash',
      type: 'text',
      index: true,
      admin: {
        readOnly: true,
        description: 'SHA-256 hash for change detection',
      },
    },
    {
      name: 'releaseNotes',
      type: 'textarea',
      admin: {
        description: 'Optional notes describing changes in this version',
      },
    },
    {
      name: 'createdBy',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      admin: {
        readOnly: true,
        description: 'User who created this version',
      },
    },
  ],
  hooks: {
    beforeValidate: [
      async ({ data, operation, req }) => {
        if (!data) return data

        // Set createdBy on create
        if (operation === 'create' && req.user && !data.createdBy) {
          data.createdBy = req.user.id
        }

        // Calculate content hash
        if (data.rawContent && !data.contentHash) {
          data.contentHash = createHash('sha256')
            .update(data.rawContent)
            .digest('hex')
        }

        // Extract version from OpenAPI spec if not provided
        if (operation === 'create' && data.rawContent && !data.version) {
          try {
            const yaml = await import('yaml')
            const spec = yaml.parse(data.rawContent)
            data.version = spec?.info?.version || `v${data.versionNumber || 1}`
          } catch {
            data.version = `v${data.versionNumber || 1}`
          }
        }

        return data
      },
    ],
    afterChange: [
      async ({ doc, operation, req: { payload } }) => {
        // Update parent schema's latestVersionNumber after creating a new version
        if (operation === 'create' && doc.schema) {
          const schemaId = typeof doc.schema === 'string' ? doc.schema : doc.schema.id

          try {
            await payload.update({
              collection: 'api-schemas',
              id: schemaId,
              data: {
                latestVersionNumber: doc.versionNumber,
                currentVersion: doc.version,
              },
              overrideAccess: true,
            })
          } catch (error) {
            console.error('Failed to update parent schema version:', error)
          }
        }
      },
    ],
  },
  timestamps: true,
}
