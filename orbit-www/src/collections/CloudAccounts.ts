import type { CollectionConfig, Where } from 'payload'
import { isAdmin } from '../access/isAdmin'

export const CloudAccounts: CollectionConfig = {
  slug: 'cloud-accounts',
  admin: {
    useAsTitle: 'name',
    group: 'Infrastructure',
    defaultColumns: ['name', 'provider', 'status', 'updatedAt'],
  },
  access: {
    // Read: Platform admins see all. Workspace members see accounts linked to their workspaces.
    read: async ({ req: { user, payload } }) => {
      if (!user) return false

      // Platform admins can see all cloud accounts
      const role = (user as any).role
      if (role === 'super_admin' || role === 'admin') return true

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

      // Return query constraint: cloud accounts linked to user's workspaces
      return {
        workspaces: { in: workspaceIds },
      } as Where
    },
    // Create: Admins only
    create: isAdmin,
    // Update: Admins only
    update: isAdmin,
    // Delete: Admins only
    delete: isAdmin,
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
        { label: 'AWS', value: 'aws' },
        { label: 'GCP', value: 'gcp' },
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
          const role = (user as any)?.role
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
