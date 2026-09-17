import type { Access, CollectionConfig, Where } from 'payload'
import { docWorkspaceMutate, memberCreate } from '@/lib/authz/payload'
import { workspaceIdsFor } from '@/lib/authz/membership'
import { principalOf } from '@/lib/authz/policy'

// Read: visibility-based access (public=all, workspace=members, private=creator).
// This is NOT `workspaceScopedRead` with `extend`, because the adapter's
// default branch (`{ workspace: { in: ids } }`) would expose private/draft
// schemas sitting in a member's workspace — the workspace branch here must
// additionally require `visibility: 'workspace'`.
const readApiSchema: Access = async ({ req: { user, payload } }) => {
  if (!user) {
    // Unauthenticated users can only see public APIs
    return {
      visibility: { equals: 'public' },
    } as Where
  }

  const principal = principalOf(user)!
  if (principal.isPlatformAdmin) return true

  // Get user's workspace memberships (keyed on the Better-Auth id)
  const workspaceIds = principal.betterAuthId
    ? await workspaceIdsFor(payload, principal.betterAuthId, 'member')
    : []

  // Can see: public APIs, workspace APIs in their workspaces, private APIs
  // they created. `createdBy` is a relationship to `users`, so comparing
  // against the caller's Payload id here is correct (unlike workspace-members
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
          { createdBy: { equals: principal.payloadId } },
        ],
      },
    ],
  } as Where
}

export const APISchemas: CollectionConfig = {
  slug: 'api-schemas',
  admin: {
    useAsTitle: 'name',
    group: 'API Catalog',
    defaultColumns: ['name', 'workspace', 'visibility', 'status', 'currentVersion', 'updatedAt'],
    description: 'OpenAPI schemas registered in the API catalog',
  },
  access: {
    read: readApiSchema,
    // Create: any active member of the target `data.workspace`.
    create: memberCreate(),
    // Update: creator (createdBy) or any active workspace member.
    update: docWorkspaceMutate('api-schemas', ['owner', 'admin', 'member'], { ownerField: 'createdBy' }),
    // Delete: creator (createdBy) or workspace owner/admin.
    delete: docWorkspaceMutate('api-schemas', ['owner', 'admin'], { ownerField: 'createdBy' }),
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
        { label: 'Protocol Buffers', value: 'proto' },
      ],
      admin: {
        description: 'Schema format (OpenAPI, AsyncAPI, GraphQL, Protocol Buffers supported)',
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
      name: 'source',
      type: 'group',
      admin: {
        description: 'Where this schema came from — set by /api/internal/api-schemas for a scaffolder-run-registered schema, otherwise "manual".',
        position: 'sidebar',
      },
      fields: [
        {
          name: 'type',
          type: 'select',
          defaultValue: 'manual',
          options: [
            { label: 'Manual', value: 'manual' },
            { label: 'Scaffolder run', value: 'scaffolder-run' },
          ],
        },
        {
          name: 'sourceId',
          type: 'text',
          admin: {
            description: 'Identifies the specific producer, e.g. the scaffolder run id.',
          },
        },
      ],
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
