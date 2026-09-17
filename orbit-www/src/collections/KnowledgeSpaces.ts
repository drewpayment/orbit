import type { CollectionConfig } from 'payload'
import { memberCreate, workspaceScopedRead, docWorkspaceMutate } from '@/lib/authz/payload'

export const KnowledgeSpaces: CollectionConfig = {
  slug: 'knowledge-spaces',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'workspace', 'createdAt'],
    group: 'Knowledge',
  },
  access: {
    // Read: Platform admins see all, workspace members see their workspaces' spaces
    read: workspaceScopedRead(),
    // Create: active member of the target `data.workspace` (was `!!user` — gap closed)
    create: memberCreate(),
    // Update: Platform admins or workspace admins/owners
    update: docWorkspaceMutate('knowledge-spaces', ['owner', 'admin']),
    // Delete: Platform admins or workspace owners only
    delete: docWorkspaceMutate('knowledge-spaces', ['owner']),
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
