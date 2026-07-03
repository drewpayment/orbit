import type { CollectionConfig, Where } from 'payload'
import { getMemberWorkspaceIds, isWorkspaceMember, isWorkspaceAdminOrOwner } from '@/lib/access/workspace-access'
import { memberCreate } from '@/lib/access/collection-access'

export const Launches: CollectionConfig = {
  slug: 'launches',
  admin: {
    useAsTitle: 'name',
    group: 'Infrastructure',
    defaultColumns: ['name', 'provider', 'status', 'region', 'updatedAt'],
  },
  access: {
    // Read: Workspace-scoped. Admins see all.
    read: async ({ req: { user, payload } }) => {
      if (!user) return false

      // Platform admins can see all launches
      const role = user?.role
      if (role === 'super_admin' || role === 'admin') return true

      // Get user's workspace memberships
      const betterAuthId = user.betterAuthId
      const workspaceIds = betterAuthId ? await getMemberWorkspaceIds(payload, betterAuthId) : []

      // Return query constraint: launches in user's workspaces
      return {
        workspace: { in: workspaceIds },
      } as Where
    },
    // Create: active member of the target `data.workspace` (was `!!user` — gap closed)
    create: memberCreate(),
    // Update: Workspace members with owner, admin, or member role
    update: async ({ req: { user, payload }, id }) => {
      if (!user || !id) return false

      const launch = await payload.findByID({
        collection: 'launches',
        id,
        overrideAccess: true,
      })

      const workspaceId = typeof launch.workspace === 'string'
        ? launch.workspace
        : launch.workspace.id

      const betterAuthId = user.betterAuthId
      if (!betterAuthId) return false

      // owner/admin/member is every active role, i.e. any active member
      return isWorkspaceMember(payload, betterAuthId, workspaceId)
    },
    // Delete: Workspace owners and admins only
    delete: async ({ req: { user, payload }, id }) => {
      if (!user || !id) return false

      const launch = await payload.findByID({
        collection: 'launches',
        id,
        overrideAccess: true,
      })

      const workspaceId = typeof launch.workspace === 'string'
        ? launch.workspace
        : launch.workspace.id

      const betterAuthId = user.betterAuthId
      if (!betterAuthId) return false

      return isWorkspaceAdminOrOwner(payload, betterAuthId, workspaceId)
    },
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
    },
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      required: true,
      index: true,
    },
    {
      name: 'app',
      type: 'relationship',
      relationTo: 'apps',
      admin: {
        description: 'Link this launch to an app',
      },
    },
    {
      name: 'cloudAccount',
      type: 'relationship',
      relationTo: 'cloud-accounts',
      required: true,
    },
    {
      name: 'template',
      type: 'relationship',
      relationTo: 'launch-templates',
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
      name: 'region',
      type: 'text',
      required: true,
    },
    {
      name: 'status',
      type: 'select',
      defaultValue: 'pending',
      options: [
        { label: 'Pending', value: 'pending' },
        { label: 'Awaiting Approval', value: 'awaiting_approval' },
        { label: 'Launching', value: 'launching' },
        { label: 'Active', value: 'active' },
        { label: 'Failed', value: 'failed' },
        { label: 'Deorbiting', value: 'deorbiting' },
        { label: 'Deorbited', value: 'deorbited' },
        { label: 'Aborted', value: 'aborted' },
      ],
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'parameters',
      type: 'json',
      admin: {
        description: 'User-provided template parameters',
      },
    },
    {
      name: 'pulumiStackName',
      type: 'text',
      admin: {
        position: 'sidebar',
        readOnly: true,
      },
    },
    {
      name: 'pulumiOutputs',
      type: 'json',
      admin: {
        readOnly: true,
        description: 'Outputs from Pulumi stack',
      },
    },
    {
      name: 'workflowId',
      type: 'text',
      admin: {
        position: 'sidebar',
        readOnly: true,
      },
    },
    {
      name: 'approvalConfig',
      type: 'group',
      fields: [
        {
          name: 'required',
          type: 'checkbox',
          defaultValue: false,
        },
        {
          name: 'approvers',
          type: 'relationship',
          relationTo: 'users',
          hasMany: true,
        },
        {
          name: 'timeoutHours',
          type: 'number',
          defaultValue: 24,
        },
      ],
    },
    {
      name: 'approvedBy',
      type: 'relationship',
      relationTo: 'users',
      admin: {
        position: 'sidebar',
        readOnly: true,
      },
    },
    {
      name: 'launchError',
      type: 'textarea',
      admin: {
        readOnly: true,
        condition: (data) => data?.status === 'failed',
      },
    },
    {
      name: 'lastLaunchedAt',
      type: 'date',
      admin: {
        position: 'sidebar',
        readOnly: true,
      },
    },
    {
      name: 'lastDeorbitedAt',
      type: 'date',
      admin: {
        position: 'sidebar',
        readOnly: true,
      },
    },
    {
      name: 'launchedBy',
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
