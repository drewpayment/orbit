import type { CollectionConfig, Where } from 'payload'
import { memberCreate } from '@/lib/access/collection-access'
import {
  isPlatformAdmin,
  isWorkspaceMember,
  isWorkspaceAdminOrOwner,
  getMemberWorkspaceIds,
} from '@/lib/access/workspace-access'

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

      // Platform admin can see all
      if (isPlatformAdmin(user)) return true

      // Get user's workspace memberships (keyed on the Better-Auth id)
      const betterAuthId = user.betterAuthId
      const workspaceIds = betterAuthId ? await getMemberWorkspaceIds(payload, betterAuthId) : []

      // Can see: public APIs, workspace APIs in their workspaces, private APIs
      // they created. `createdBy` is a relationship to `users`, so comparing
      // against the Payload `user.id` here is correct (unlike workspace-members
      // lookups, which store the Better-Auth id).
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
    // Create: any active member of the target `data.workspace`.
    create: memberCreate(),
    update: async ({ req: { user, payload }, id }) => {
      if (!user || !id) return false
      if (isPlatformAdmin(user)) return true

      const schema = await payload.findByID({
        collection: 'api-schemas',
        id,
        depth: 0,
        overrideAccess: true,
      })

      // Creator can always edit (createdBy is a relationship to `users`, so
      // user.id is the correct comparison here).
      const createdById = typeof schema.createdBy === 'string'
        ? schema.createdBy
        : schema.createdBy?.id
      if (createdById === user.id) return true

      const workspaceId = typeof schema.workspace === 'string'
        ? schema.workspace
        : schema.workspace?.id
      if (!workspaceId) return false

      // Workspace owners/admins/members can edit
      const betterAuthId = user.betterAuthId
      if (!betterAuthId) return false
      return isWorkspaceMember(payload, betterAuthId, workspaceId)
    },
    delete: async ({ req: { user, payload }, id }) => {
      if (!user || !id) return false
      if (isPlatformAdmin(user)) return true

      const schema = await payload.findByID({
        collection: 'api-schemas',
        id,
        depth: 0,
        overrideAccess: true,
      })

      // Creator can delete (createdBy is a relationship to `users`, so user.id
      // is the correct comparison here).
      const createdById = typeof schema.createdBy === 'string'
        ? schema.createdBy
        : schema.createdBy?.id
      if (createdById === user.id) return true

      const workspaceId = typeof schema.workspace === 'string'
        ? schema.workspace
        : schema.workspace?.id
      if (!workspaceId) return false

      // Only workspace owners/admins can delete
      const betterAuthId = user.betterAuthId
      if (!betterAuthId) return false
      return isWorkspaceAdminOrOwner(payload, betterAuthId, workspaceId)
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
        { label: 'GraphQL', value: 'graphql' },
      ],
      admin: {
        description: 'Schema format (OpenAPI, AsyncAPI, GraphQL supported)',
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
        description: 'OpenAPI, AsyncAPI, GraphQL specification content',
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
      async ({ data, operation, req, originalDoc }) => {
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

        // Parse spec to extract metadata. Sniffing lives in the discovery
        // detectors lib so there is one implementation shared with the
        // catalog scanner. GraphQL SDL is not YAML, so it gets its own
        // extractor rather than misfiring `extractSpecMetadata`.
        //
        // On update, `data` is the partial patch from the edit form and may
        // omit `schemaType` entirely (it's not a field the edit page sends) —
        // fall back to the persisted value on `originalDoc` so a graphql row's
        // content edit still hits the graphql branch instead of misfiring the
        // yaml-based extractor.
        const effectiveSchemaType = data.schemaType ?? originalDoc?.schemaType
        if (data.rawContent) {
          if (effectiveSchemaType === 'graphql') {
            const { extractGraphQLMetadata } = await import('@/lib/discovery/detectors')
            const meta = extractGraphQLMetadata(data.rawContent)
            if (meta) {
              data.endpointCount = meta.endpointCount
            }
          } else {
            const { extractSpecMetadata } = await import('@/lib/discovery/detectors')
            const meta = extractSpecMetadata(data.rawContent)
            if (meta) {
              // Auto-detect schema type from content
              if (meta.schemaType) {
                data.schemaType = meta.schemaType
              }

              if (meta.hasInfo) {
                data.specTitle = meta.title
                data.specDescription = meta.description
                data.currentVersion = meta.version

                if (meta.hasContact) {
                  data.contactName = data.contactName || meta.contactName
                  data.contactEmail = data.contactEmail || meta.contactEmail
                }
              }

              if (meta.serverUrls) {
                data.serverUrls = meta.serverUrls.map((url) => ({ url }))
              }

              if (meta.endpointCount !== null) {
                data.endpointCount = meta.endpointCount
              }
            }
          }
        }

        return data
      },
    ],
    // Catalog projection: keep the unified catalog graph in sync.
    afterChange: [
      async ({ doc, req }) => {
        // Fire and forget — projection failure must never block the save.
        ;(async () => {
          try {
            const { projectApiSchemaEntity } = await import('@/lib/catalog/projection')
            await projectApiSchemaEntity(req.payload, doc)
          } catch (err) {
            console.error('[APISchemas Hook] catalog projection failed:', err)
          }
        })()
        return doc
      },
    ],
    afterDelete: [
      async ({ doc, req }) => {
        ;(async () => {
          try {
            const { removeProjectedEntity } = await import('@/lib/catalog/projection')
            await removeProjectedEntity(req.payload, 'api-schemas', String(doc.id))
          } catch (err) {
            console.error('[APISchemas Hook] catalog projection removal failed:', err)
          }
        })()
      },
    ],
  },
  timestamps: true,
}
