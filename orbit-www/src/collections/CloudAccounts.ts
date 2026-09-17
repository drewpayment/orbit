import type { CollectionConfig } from 'payload'
import { adminOnly, workspaceScopedRead } from '@/lib/authz/payload'

export const CloudAccounts: CollectionConfig = {
  slug: 'cloud-accounts',
  admin: {
    useAsTitle: 'name',
    group: 'Infrastructure',
    defaultColumns: ['name', 'provider', 'status', 'updatedAt'],
  },
  access: {
    // Read: Platform admins see all. Workspace members see accounts linked to their workspaces.
    read: workspaceScopedRead({ field: 'workspaces' }),
    // Create: Admins only
    create: adminOnly,
    // Update: Admins only
    update: adminOnly,
    // Delete: Admins only
    delete: adminOnly,
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
    },
    {
      name: 'provider',
      type: 'select',
      required: true,
      options: [
        { label: 'Azure', value: 'azure' },
        { label: 'DigitalOcean', value: 'digitalocean' },
      ],
    },
    {
      name: 'credentials',
      type: 'json',
      required: true,
      admin: {
        description: 'Provider-specific credentials (admin only)',
        condition: (data, siblingData, { user }) => {
          const role = user?.role
          return role === 'super_admin' || role === 'admin'
        },
      },
    },
    {
      name: 'region',
      type: 'text',
      admin: {
        description: 'Default region for this cloud account',
      },
    },
    {
      name: 'workspaces',
      type: 'relationship',
      relationTo: 'workspaces',
      hasMany: true,
      required: true,
      index: true,
    },
    {
      name: 'status',
      type: 'select',
      defaultValue: 'disconnected',
      options: [
        { label: 'Connected', value: 'connected' },
        { label: 'Disconnected', value: 'disconnected' },
        { label: 'Error', value: 'error' },
      ],
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'lastValidatedAt',
      type: 'date',
      admin: {
        position: 'sidebar',
        readOnly: true,
      },
    },
    {
      name: 'approvalRequired',
      type: 'checkbox',
      defaultValue: false,
    },
    {
      name: 'approvers',
      type: 'relationship',
      relationTo: 'users',
      hasMany: true,
      admin: {
        condition: (data) => data?.approvalRequired === true,
      },
    },
    {
      name: 'createdBy',
      type: 'relationship',
      relationTo: 'users',
      admin: {
        position: 'sidebar',
        readOnly: true,
      },
    },
  ],
  timestamps: true,
}
