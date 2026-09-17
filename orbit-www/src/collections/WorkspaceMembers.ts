import type { CollectionConfig } from 'payload'
import { docWorkspaceMutate, manageCreate, workspaceScopedRead } from '@/lib/authz/payload'

export const WorkspaceMembers: CollectionConfig = {
  slug: 'workspace-members',
  admin: {
    useAsTitle: 'id',
    defaultColumns: ['workspace', 'user', 'role', 'status'],
  },
  access: {
    // Members can read memberships for their workspaces
    read: workspaceScopedRead(),
    // Only workspace owners/admins can invite members
    create: manageCreate(['owner', 'admin']),
    // Only workspace owners/admins can change roles
    update: docWorkspaceMutate('workspace-members', ['owner', 'admin']),
    // Only workspace owners/admins can remove members
    delete: docWorkspaceMutate('workspace-members', ['owner', 'admin']),
  },
  fields: [
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      required: true,
      hasMany: false,
    },
    {
      name: 'user',
      type: 'text',
      required: true,
      index: true,
      admin: {
        description: 'Better Auth user ID',
      },
    },
    {
      name: 'role',
      type: 'select',
      required: true,
      defaultValue: 'member',
      options: [
        {
          label: 'Owner',
          value: 'owner',
        },
        {
          label: 'Admin',
          value: 'admin',
        },
        {
          label: 'Member',
          value: 'member',
        },
      ],
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'pending',
      options: [
        {
          label: 'Active',
          value: 'active',
        },
        {
          label: 'Pending',
          value: 'pending',
        },
        {
          label: 'Rejected',
          value: 'rejected',
        },
      ],
    },
    {
      name: 'requestedAt',
      type: 'date',
      required: true,
      defaultValue: () => new Date().toISOString(),
      admin: {
        date: {
          pickerAppearance: 'dayAndTime',
        },
      },
    },
    {
      name: 'approvedAt',
      type: 'date',
      admin: {
        date: {
          pickerAppearance: 'dayAndTime',
        },
      },
    },
    {
      name: 'approvedBy',
      type: 'text',
      admin: {
        description: 'Better Auth user ID of the user who approved this membership request',
      },
    },
  ],
  indexes: [
    {
      fields: ['workspace', 'user'],
      unique: true,
    },
  ],
}
