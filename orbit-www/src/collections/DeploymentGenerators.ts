import type { CollectionConfig, Where } from 'payload'

export const DeploymentGenerators: CollectionConfig = {
  slug: 'deployment-generators',
  admin: {
    useAsTitle: 'name',
    group: 'Catalog',
    defaultColumns: ['name', 'type', 'isBuiltIn', 'updatedAt'],
  },
  access: {
    // Read: Users can read generators in their workspaces OR built-in generators
    read: async ({ req: { user, payload } }) => {
      if (!user) return false

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

      // Return generators in user's workspaces OR built-in generators (no workspace)
      return {
        or: [
          { workspace: { in: workspaceIds } },
          { workspace: { exists: false } },
        ],
      } as Where
    },
    // Create: Only for custom generators, workspace admins
    create: async ({ req: { user, payload }, data }) => {
      if (!user) return false
      // Built-in generators can't be created via API
      if (data?.isBuiltIn) return false
      if (!data?.workspace) return false

      const members = await payload.find({
        collection: 'workspace-members',
        where: {
          and: [
            { workspace: { equals: data.workspace } },
            { user: { equals: user.id } },
            { role: { in: ['owner', 'admin'] } },
            { status: { equals: 'active' } },
          ],
        },
        overrideAccess: true,
      })
      return members.docs.length > 0
    },
    // Update: Built-in = admin only, custom = workspace admins
    update: async ({ req: { user, payload }, id }) => {
      if (!user || !id) return false

      const generator = await payload.findByID({
        collection: 'deployment-generators',
        id,
        overrideAccess: true,
      })

      // Built-in generators cannot be modified
      if (generator.isBuiltIn) return false

      if (!generator.workspace) return false

      const workspaceId = typeof generator.workspace === 'string'
        ? generator.workspace
        : generator.workspace.id

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
    // Delete: Only custom generators, workspace owners only
    delete: async ({ req: { user, payload }, id }) => {
      if (!user || !id) return false

      const generator = await payload.findByID({
        collection: 'deployment-generators',
        id,
        overrideAccess: true,
      })

      // Built-in generators cannot be deleted
      if (generator.isBuiltIn) return false

      if (!generator.workspace) return false

      const workspaceId = typeof generator.workspace === 'string'
        ? generator.workspace
        : generator.workspace.id

      const members = await payload.find({
        collection: 'workspace-members',
        where: {
          and: [
            { workspace: { equals: workspaceId } },
            { user: { equals: user.id } },
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
      name: 'name',
      type: 'text',
      required: true,
      admin: {
        description: 'Display name for this generator',
      },
    },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: {
        description: 'Unique identifier (e.g., docker-compose-basic)',
      },
    },
    {
      name: 'description',
      type: 'textarea',
    },
    {
      name: 'type',
      type: 'select',
      required: true,
      options: [
        { label: 'Docker Compose', value: 'docker-compose' },
        { label: 'Terraform', value: 'terraform' },
        { label: 'Helm', value: 'helm' },
        { label: 'Custom', value: 'custom' },
      ],
    },
    {
      name: 'configSchema',
      type: 'json',
      admin: {
        description: 'JSON Schema for validating generator config',
      },
    },
    {
      name: 'templateFiles',
      type: 'array',
      admin: {
        description: 'IaC template files for this generator',
      },
      fields: [
        {
          name: 'path',
          type: 'text',
          required: true,
          admin: {
            description: 'File path (e.g., docker-compose.yml)',
          },
        },
        {
          name: 'content',
          type: 'code',
          required: true,
          admin: {
            language: 'yaml',
            description: 'Template content with variable placeholders',
          },
        },
      ],
    },
    {
      name: 'isBuiltIn',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        position: 'sidebar',
        readOnly: true,
        description: 'Built-in generators cannot be modified',
      },
    },
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      index: true,
      admin: {
        position: 'sidebar',
        condition: (data) => !data?.isBuiltIn,
        description: 'Workspace for custom generators (null = global)',
      },
    },
  ],
  timestamps: true,
}
