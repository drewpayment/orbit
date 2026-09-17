import type { CollectionConfig } from 'payload'
import { manageCreate, workspaceScopedRead, docWorkspaceMutate } from '@/lib/authz/payload'

export const DeploymentGenerators: CollectionConfig = {
  slug: 'deployment-generators',
  admin: {
    useAsTitle: 'name',
    group: 'Catalog',
    defaultColumns: ['name', 'type', 'isBuiltIn', 'updatedAt'],
  },
  access: {
    // Read: Users can read generators in their workspaces OR built-in generators
    read: workspaceScopedRead({ includeGlobal: true }),
    // Create: Only for custom generators, workspace admins
    create: manageCreate(['owner', 'admin'], {
      guard: (data) => !(data as { isBuiltIn?: boolean } | undefined)?.isBuiltIn,
    }),
    // Update: Built-in = admin only, custom = workspace admins
    update: docWorkspaceMutate('deployment-generators', ['owner', 'admin'], {
      guard: (doc) => !doc.isBuiltIn,
    }),
    // Delete: Only custom generators, workspace owners only
    delete: docWorkspaceMutate('deployment-generators', ['owner'], {
      guard: (doc) => !doc.isBuiltIn,
    }),
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
