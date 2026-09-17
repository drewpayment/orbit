import type { CollectionConfig } from 'payload'
import { docWorkspaceMutate, memberCreate, workspaceScopedRead } from '@/lib/authz/payload'

export const Launches: CollectionConfig = {
  slug: 'launches',
  admin: {
    useAsTitle: 'name',
    group: 'Infrastructure',
    defaultColumns: ['name', 'provider', 'status', 'region', 'updatedAt'],
  },
  access: {
    // Read: Workspace-scoped. Admins see all.
    read: workspaceScopedRead(),
    // Create: active member of the target `data.workspace` (was `!!user` — gap closed)
    create: memberCreate(),
    // Update: Workspace members with owner, admin, or member role (any active member)
    update: docWorkspaceMutate('launches', ['owner', 'admin', 'member']),
    // Delete: Workspace owners and admins only
    delete: docWorkspaceMutate('launches', ['owner', 'admin']),
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
