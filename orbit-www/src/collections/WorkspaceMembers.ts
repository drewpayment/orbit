import type { CollectionConfig } from 'payload'
import { isSuperAdmin, isWorkspaceAdminOrOwner, getMemberWorkspaceIds } from '@/lib/access/workspace-access'

export const WorkspaceMembers: CollectionConfig = {
  slug: 'workspace-members',
  admin: {
    useAsTitle: 'id',
    defaultColumns: ['workspace', 'user', 'role', 'status'],
  },
  access: {
    // Members can read memberships for their workspaces
    read: async ({ req }) => {
      if (!req.user) return false
      if (isSuperAdmin(req.user)) return true
      const betterAuthId = (req.user as any).betterAuthId
      if (!betterAuthId) return false
      const ids = await getMemberWorkspaceIds(req.payload, betterAuthId)
      if (ids.length === 0) return false
      return { workspace: { in: ids } }
    },
    // Only workspace owners/admins can invite members
    create: async ({ req, data }) => {
      if (!req.user) return false
      if (isSuperAdmin(req.user)) return true
      const workspaceId = data?.workspace
      if (!workspaceId) return false
      const betterAuthId = (req.user as any).betterAuthId
      if (!betterAuthId) return false
      return isWorkspaceAdminOrOwner(req.payload, betterAuthId, workspaceId as string)
    },
    // Only workspace owners/admins can change roles
    update: async ({ req, id }) => {
      if (!req.user) return false
      if (isSuperAdmin(req.user)) return true
      const betterAuthId = (req.user as any).betterAuthId
      if (!betterAuthId) return false
      if (!id) return false
      const member = await req.payload.findByID({
        collection: 'workspace-members',
        id,
        overrideAccess: true,
        depth: 0,
      })
      const wsId = typeof member.workspace === 'string' ? member.workspace : member.workspace?.id
      if (!wsId) return false
      return isWorkspaceAdminOrOwner(req.payload, betterAuthId, wsId)
    },
    // Only workspace owners/admins can remove members
    delete: async ({ req, id }) => {
      if (!req.user) return false
      if (isSuperAdmin(req.user)) return true
      const betterAuthId = (req.user as any).betterAuthId
      if (!betterAuthId) return false
      if (!id) return false
      const member = await req.payload.findByID({
        collection: 'workspace-members',
        id,
        overrideAccess: true,
        depth: 0,
      })
      const wsId = typeof member.workspace === 'string' ? member.workspace : member.workspace?.id
      if (!wsId) return false
      return isWorkspaceAdminOrOwner(req.payload, betterAuthId, wsId)
    },
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
