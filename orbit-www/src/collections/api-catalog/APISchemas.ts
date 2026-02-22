import type { CollectionConfig, Where } from 'payload'

export const APISchemas: CollectionConfig = {
  slug: 'api-schemas',
  admin: {
    useAsTitle: 'name',
    group: 'API Catalog',
    defaultColumns: ['name', 'workspace', 'visibility', 'status', 'currentVersion', 'updatedAt'],
    description: 'OpenAPI schemas registered in the API catalog',
  },
  access: {
    // Read: Visibility-based access (public=all, workspace=members, private=creator)
    read: async ({ req: { user, payload } }) => {
      if (!user) {
        // Unauthenticated users can only see public APIs
        return {
          visibility: { equals: 'public' },
        } as Where
      }

      // Payload admin users can see all
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

      const workspaceIds = memberships.docs.map(m =>
        String(typeof m.workspace === 'string' ? m.workspace : m.workspace.id)
      )

      // Can see: public APIs, workspace APIs in their workspaces, private APIs they created
      return {
        or: [
          { visibility: { equals: 'public' } },
          {
            and: [
              { visibility: { equals: 'workspace' } },
              { workspace: { in: workspaceIds } },
            ],
          },
          {
            and: [
              { visibility: { equals: 'private' } },
              { createdBy: { equals: user.id } },
            ],
          },
        ],
      } as Where
    },
    create: ({ req: { user } }) => !!user,
    update: async ({ req: { user, payload }, id }) => {
      if (!user || !id) return false
      if (user.collection === 'users') return true

      const schema = await payload.findByID({
        collection: 'api-schemas',
        id,
        overrideAccess: true,
      })

      // Creator can always edit
      const createdById = typeof schema.createdBy === 'string'
        ? schema.createdBy
        : schema.createdBy?.id
      if (createdById === user.id) return true

      const workspaceId = typeof schema.workspace === 'string'
        ? schema.workspace
        : schema.workspace.id

      // Workspace owners/admins/members can edit
      const members = await payload.find({
        collection: 'workspace-members',
        where: {
          and: [
            { workspace: { equals: workspaceId } },
            { user: { equals: user.id } },
            { role: { in: ['owner', 'admin', 'member'] } },
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

      const schema = await payload.findByID({
        collection: 'api-schemas',
        id,
        overrideAccess: true,
      })

      // Creator can delete
      const createdById = typeof schema.createdBy === 'string'
        ? schema.createdBy
        : schema.createdBy?.id
      if (createdById === user.id) return true

      const workspaceId = typeof schema.workspace === 'string'
        ? schema.workspace
        : schema.workspace.id

      // Only workspace owners/admins can delete
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
      name: 'name',
      type: 'text',
      required: true,
      index: true,
      admin: {
        description: 'Display name for the API',
      },
    },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: {
        description: 'URL-friendly identifier (auto-generated from name)',
      },
      validate: (val: unknown) => {
        if (typeof val !== 'string' || !/^[a-z0-9-]+$/.test(val)) {
          return 'Slug must contain only lowercase letters, numbers, and hyphens'
        }
        return true
      },
    },
    {
      name: 'description',
      type: 'textarea',
      admin: {
        description: 'Brief description of what this API does',
      },
    },
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      required: true,
      index: true,
      admin: {
        description: 'Owning workspace',
      },
    },
    {
      name: 'visibility',
      type: 'select',
      required: true,
      defaultValue: 'workspace',
      options: [
        { label: 'Private (Creator only)', value: 'private' },
        { label: 'Workspace (Members only)', value: 'workspace' },
        { label: 'Public (Everyone)', value: 'public' },
      ],
      admin: {
        description: 'Who can view this API in the catalog',
      },
    },
    {
      name: 'schemaType',
      type: 'select',
      required: true,
      defaultValue: 'openapi',
      options: [
        { label: 'OpenAPI', value: 'openapi' },
        { label: 'AsyncAPI', value: 'asyncapi' },
      ],
      admin: {
        description: 'Schema format (OpenAPI and AsyncAPI supported)',
      },
    },
    {
      name: 'currentVersion',
      type: 'text',
      admin: {
        description: 'Current version string (from OpenAPI info.version)',
      },
    },
    {
      name: 'rawContent',
      type: 'code',
      required: true,
      admin: {
        language: 'yaml',
        description: 'OpenAPI specification content',
      },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'draft',
      options: [
        { label: 'Draft', value: 'draft' },
        { label: 'Published', value: 'published' },
        { label: 'Deprecated', value: 'deprecated' },
      ],
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'deprecationMessage',
      type: 'text',
      admin: {
        description: 'Reason for deprecation (shown to consumers)',
        condition: (data) => data?.status === 'deprecated',
      },
    },
    {
      name: 'tags',
      type: 'array',
      admin: {
        description: 'Tags for discovery and filtering',
      },
      fields: [
        {
          name: 'tag',
          type: 'text',
          required: true,
        },
      ],
    },
    {
      name: 'contactName',
      type: 'text',
      admin: {
        description: 'API maintainer name',
      },
    },
    {
      name: 'contactEmail',
      type: 'text',
      admin: {
        description: 'API maintainer email',
      },
    },
    {
      name: 'serverUrls',
      type: 'array',
      admin: {
        description: 'Base URLs from the OpenAPI spec',
      },
      fields: [
        {
          name: 'url',
          type: 'text',
          required: true,
        },
      ],
    },
    {
      name: 'repository',
      type: 'relationship',
      relationTo: 'apps',
      admin: {
        description: 'Linked application/repository (optional)',
      },
    },
    {
      name: 'repositoryPath',
      type: 'text',
      admin: {
        description: 'Path to OpenAPI spec in repository (e.g., docs/openapi.yaml)',
      },
    },
    {
      name: 'createdBy',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      admin: {
        readOnly: true,
        description: 'User who created this API schema',
        position: 'sidebar',
      },
    },
    {
      name: 'lastEditedBy',
      type: 'relationship',
      relationTo: 'users',
      admin: {
        readOnly: true,
        description: 'User who last edited this API schema',
        position: 'sidebar',
      },
    },
    // Cached metadata from OpenAPI spec
    {
      name: 'specTitle',
      type: 'text',
      admin: {
        readOnly: true,
        description: 'Title from OpenAPI info.title',
      },
    },
    {
      name: 'specDescription',
      type: 'textarea',
      admin: {
        readOnly: true,
        description: 'Description from OpenAPI info.description',
      },
    },
    {
      name: 'endpointCount',
      type: 'number',
      admin: {
        readOnly: true,
        description: 'Number of endpoints in the spec',
        position: 'sidebar',
      },
    },
    {
      name: 'latestVersionNumber',
      type: 'number',
      admin: {
        readOnly: true,
        description: 'Latest version number (for ordering)',
        position: 'sidebar',
      },
    },
  ],
  hooks: {
    beforeValidate: [
      async ({ data, operation, req }) => {
        if (!data) return data

        // Auto-generate slug from name if not provided
        if (operation === 'create' && !data.slug && data.name) {
          data.slug = data.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')
        }

        // Set createdBy on create
        if (operation === 'create' && req.user && !data.createdBy) {
          data.createdBy = req.user.id
        }

        // Set lastEditedBy on update
        if (operation === 'update' && req.user) {
          data.lastEditedBy = req.user.id
        }

        // Parse spec to extract metadata
        if (data.rawContent) {
          try {
            // Dynamic import yaml to avoid SSR issues
            const yaml = await import('yaml')
            const spec = yaml.parse(data.rawContent)

            // Auto-detect schema type from content
            if (spec?.asyncapi) {
              data.schemaType = 'asyncapi'
            } else if (spec?.openapi || spec?.swagger) {
              data.schemaType = 'openapi'
            }

            if (spec?.info) {
              data.specTitle = spec.info.title || null
              data.specDescription = spec.info.description || null
              data.currentVersion = spec.info.version || null

              if (spec.info.contact) {
                data.contactName = data.contactName || spec.info.contact.name || null
                data.contactEmail = data.contactEmail || spec.info.contact.email || null
              }
            }

            if (spec?.servers && Array.isArray(spec.servers)) {
              data.serverUrls = spec.servers.map((s: { url: string }) => ({ url: s.url }))
            }

            if (data.schemaType === 'asyncapi') {
              // Count channels for AsyncAPI specs
              if (spec?.channels) {
                data.endpointCount = Object.keys(spec.channels).length
              }
            } else {
              // Count endpoints for OpenAPI specs
              if (spec?.paths) {
                let count = 0
                for (const path of Object.values(spec.paths)) {
                  if (path && typeof path === 'object') {
                    const methods = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head']
                    for (const method of methods) {
                      if (method in path) count++
                    }
                  }
                }
                data.endpointCount = count
              }
            }
          } catch {
            // Invalid YAML - will be caught by validation
          }
        }

        return data
      },
    ],
  },
  timestamps: true,
}
