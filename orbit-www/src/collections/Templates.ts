// orbit-www/src/collections/Templates.ts
import type { CollectionConfig } from 'payload'

export const Templates: CollectionConfig = {
  slug: 'templates',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'language', 'visibility', 'workspace', 'usageCount'],
    group: 'Repositories',
  },
  access: {
    // Read: Based on visibility and workspace membership
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
        typeof m.workspace === 'string' ? m.workspace : m.workspace.id
      )

      // Return query constraint: public OR in user's workspaces OR shared with user's workspaces
      return {
        or: [
          { visibility: { equals: 'public' } },
          { workspace: { in: workspaceIds } },
          { sharedWith: { in: workspaceIds } },
        ],
      }
    },
    // Create: Users with template:create permission
    create: ({ req: { user } }) => !!user,
    // Update: Workspace admins/owners
    update: async ({ req: { user, payload }, id }) => {
      if (!user || !id) return false

      const template = await payload.findByID({
        collection: 'templates',
        id,
        overrideAccess: true,
      })

      const workspaceId = typeof template.workspace === 'string'
        ? template.workspace
        : template.workspace.id

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
    // Delete: Workspace owners only
    delete: async ({ req: { user, payload }, id }) => {
      if (!user || !id) return false

      const template = await payload.findByID({
        collection: 'templates',
        id,
        overrideAccess: true,
      })

      const workspaceId = typeof template.workspace === 'string'
        ? template.workspace
        : template.workspace.id

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
    // Identity
    {
      name: 'name',
      type: 'text',
      required: true,
      minLength: 3,
      maxLength: 100,
      label: 'Template Name',
    },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      label: 'URL Slug',
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
      maxLength: 2000,
      admin: {
        description: 'Supports markdown',
      },
    },

    // Ownership & Visibility
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      required: true,
      hasMany: false,
      index: true,
    },
    {
      name: 'visibility',
      type: 'select',
      required: true,
      defaultValue: 'workspace',
      options: [
        { label: 'Workspace Only', value: 'workspace' },
        { label: 'Shared', value: 'shared' },
        { label: 'Public', value: 'public' },
      ],
    },
    {
      name: 'sharedWith',
      type: 'relationship',
      relationTo: 'workspaces',
      hasMany: true,
      label: 'Shared With Workspaces',
      admin: {
        condition: (data) => data?.visibility === 'shared',
        description: 'Workspaces that can use this template',
      },
    },

    // GitHub Source
    {
      name: 'gitProvider',
      type: 'select',
      required: true,
      defaultValue: 'github',
      options: [
        { label: 'GitHub', value: 'github' },
        { label: 'Azure DevOps', value: 'azure_devops' },
        { label: 'GitLab', value: 'gitlab' },
        { label: 'Bitbucket', value: 'bitbucket' },
      ],
    },
    {
      name: 'repoUrl',
      type: 'text',
      required: true,
      label: 'Repository URL',
      admin: {
        description: 'Full URL to the GitHub repository',
      },
    },
    {
      name: 'defaultBranch',
      type: 'text',
      defaultValue: 'main',
      label: 'Default Branch',
    },
    {
      name: 'isGitHubTemplate',
      type: 'checkbox',
      defaultValue: false,
      label: 'GitHub Template Repository',
      admin: {
        description: 'Is this repo marked as a Template in GitHub?',
      },
    },

    // Metadata
    {
      name: 'language',
      type: 'text',
      label: 'Programming Language',
      admin: {
        description: 'Primary language (e.g., typescript, go, python)',
      },
    },
    {
      name: 'framework',
      type: 'text',
      label: 'Framework',
      admin: {
        description: 'Framework used (e.g., nextjs, express, fastapi)',
      },
    },
    {
      name: 'categories',
      type: 'select',
      hasMany: true,
      options: [
        { label: 'API Service', value: 'api-service' },
        { label: 'Frontend App', value: 'frontend-app' },
        { label: 'Backend Service', value: 'backend-service' },
        { label: 'CLI Tool', value: 'cli-tool' },
        { label: 'Library', value: 'library' },
        { label: 'Mobile App', value: 'mobile-app' },
        { label: 'Infrastructure', value: 'infrastructure' },
        { label: 'Documentation', value: 'documentation' },
        { label: 'Monorepo', value: 'monorepo' },
      ],
    },
    {
      name: 'tags',
      type: 'array',
      label: 'Tags',
      fields: [
        {
          name: 'tag',
          type: 'text',
          required: true,
        },
      ],
    },
    {
      name: 'complexity',
      type: 'select',
      options: [
        { label: 'Starter', value: 'starter' },
        { label: 'Intermediate', value: 'intermediate' },
        { label: 'Production Ready', value: 'production-ready' },
      ],
    },

    // Manifest Sync
    {
      name: 'manifestPath',
      type: 'text',
      defaultValue: 'orbit-template.yaml',
      label: 'Manifest File Path',
    },
    {
      name: 'lastSyncedAt',
      type: 'date',
      label: 'Last Synced',
      admin: {
        readOnly: true,
        date: {
          pickerAppearance: 'dayAndTime',
        },
      },
    },
    {
      name: 'syncStatus',
      type: 'select',
      defaultValue: 'pending',
      options: [
        { label: 'Synced', value: 'synced' },
        { label: 'Error', value: 'error' },
        { label: 'Pending', value: 'pending' },
      ],
      admin: {
        readOnly: true,
      },
    },
    {
      name: 'syncError',
      type: 'text',
      label: 'Sync Error',
      admin: {
        readOnly: true,
        condition: (data) => data?.syncStatus === 'error',
      },
    },

    // Variables (from manifest)
    {
      name: 'variables',
      type: 'json',
      label: 'Template Variables',
      admin: {
        description: 'Parsed from orbit-template.yaml',
        readOnly: true,
      },
    },

    // Webhook (optional)
    {
      name: 'webhookId',
      type: 'text',
      label: 'Webhook ID',
      admin: {
        readOnly: true,
        position: 'sidebar',
      },
    },
    {
      name: 'webhookSecret',
      type: 'text',
      label: 'Webhook Secret',
      admin: {
        hidden: true,
      },
    },

    // Stats
    {
      name: 'usageCount',
      type: 'number',
      defaultValue: 0,
      label: 'Usage Count',
      admin: {
        readOnly: true,
        position: 'sidebar',
      },
    },

    // Audit
    {
      name: 'createdBy',
      type: 'relationship',
      relationTo: 'users',
      hasMany: false,
      admin: {
        readOnly: true,
        position: 'sidebar',
      },
    },
  ],
  hooks: {
    beforeValidate: [
      ({ data, operation, req }) => {
        if (!data) return data

        // Auto-generate slug from name
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

        return data
      },
    ],
  },
}
