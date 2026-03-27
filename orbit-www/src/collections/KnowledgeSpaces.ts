import type { CollectionConfig } from 'payload'

export const KnowledgeSpaces: CollectionConfig = {
  slug: 'knowledge-spaces',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'workspace', 'createdAt'],
    group: 'Knowledge',
  },
  access: {
    // Read: Platform admins see all, workspace members see their workspaces' spaces
    read: async ({ req: { user, payload } }) => {
      if (!user) return false
      const role = user?.role
      if (role === 'super_admin' || role === 'admin') return true

      const betterAuthId = user?.betterAuthId
      if (!betterAuthId) return false

      const memberships = await payload.find({
        collection: 'workspace-members',
        where: {
          user: { equals: betterAuthId },
          status: { equals: 'active' },
        },
        limit: 1000,
        overrideAccess: true,
      })

      const workspaceIds = memberships.docs.map(m =>
        typeof m.workspace === 'string' ? m.workspace : m.workspace.id
      )

      if (workspaceIds.length === 0) return false

      return {
        workspace: { in: workspaceIds }
      }
    },
    // Create: Any authenticated user
    create: ({ req: { user } }) => !!user,
    // Update: Platform admins or workspace admins/owners
    update: async ({ req: { user, payload }, id }) => {
      if (!user || !id) return false
      const role = user?.role
      if (role === 'super_admin' || role === 'admin') return true

      const betterAuthId = user?.betterAuthId
      if (!betterAuthId) return false

      const space = await payload.findByID({
        collection: 'knowledge-spaces',
        id,
        overrideAccess: true,
      })

      const workspaceId = typeof space.workspace === 'string'
        ? space.workspace
        : space.workspace.id

      const members = await payload.find({
        collection: 'workspace-members',
        where: {
          and: [
            { workspace: { equals: workspaceId } },
            { user: { equals: betterAuthId } },
            { role: { in: ['owner', 'admin'] } },
            { status: { equals: 'active' } },
          ],
        },
        overrideAccess: true,
      })

      return members.docs.length > 0
    },
    // Delete: Platform admins or workspace owners only
    delete: async ({ req: { user, payload }, id }) => {
      if (!user || !id) return false
      const role = user?.role
      if (role === 'super_admin' || role === 'admin') return true

      const betterAuthId = user?.betterAuthId
      if (!betterAuthId) return false

      const space = await payload.findByID({
        collection: 'knowledge-spaces',
        id,
        overrideAccess: true,
      })

      const workspaceId = typeof space.workspace === 'string'
        ? space.workspace
        : space.workspace.id

      const members = await payload.find({
        collection: 'workspace-members',
        where: {
          and: [
            { workspace: { equals: workspaceId } },
            { user: { equals: betterAuthId } },
            { role: { equals: 'owner' } },
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
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      required: true,
      hasMany: false,
      admin: {
        description: 'The workspace this knowledge space belongs to',
      },
    },
    {
      name: 'name',
      type: 'text',
      required: true,
      minLength: 3,
      maxLength: 100,
      label: 'Space Name',
    },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      label: 'URL Slug',
      admin: {
        description: 'URL-friendly identifier (e.g., "engineering-docs")',
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
      label: 'Description',
      maxLength: 500,
    },
    {
      name: 'icon',
      type: 'text',
      label: 'Icon',
      admin: {
        description: 'Icon identifier (e.g., "book", "docs", "wiki")',
      },
    },
    {
      name: 'color',
      type: 'text',
      label: 'Theme Color',
      admin: {
        description: 'Hex color code for visual identification',
      },
    },
    {
      name: 'visibility',
      type: 'select',
      required: true,
      defaultValue: 'internal',
      options: [
        { label: 'Private', value: 'private' },
        { label: 'Internal (Workspace)', value: 'internal' },
        { label: 'Public', value: 'public' },
      ],
      admin: {
        description: 'Who can view this knowledge space',
      },
    },
    {
      name: 'pages',
      type: 'ui',
      label: 'Pages',
      admin: {
        components: {
          Field: {
            path: '/components/admin/fields/KnowledgeSpacePagesField',
            exportName: 'KnowledgeSpacePagesField',
          },
        },
      },
    },
  ],
  hooks: {
    beforeValidate: [
      ({ data, operation }) => {
        // Auto-generate slug from name if not provided
        if (data && operation === 'create' && !data.slug && data.name) {
          data.slug = data.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')
        }
        return data
      },
    ],
  },
}
