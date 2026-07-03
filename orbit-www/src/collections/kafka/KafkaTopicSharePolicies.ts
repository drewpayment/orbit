import type { CollectionConfig } from 'payload'
import { adminOnly } from '@/lib/access/collection-access'

export const KafkaTopicSharePolicies: CollectionConfig = {
  slug: 'kafka-topic-share-policies',
  admin: {
    useAsTitle: 'name',
    group: 'Kafka',
    defaultColumns: ['name', 'workspace', 'visibility', 'autoApprove', 'enabled'],
    description: 'Policies controlling topic sharing behavior',
  },
  access: {
    // Platform admins manage policies. The `workspace` field is not yet used
    // to scope access — workspace-scoping these policies is a follow-up.
    read: adminOnly,
    create: adminOnly,
    update: adminOnly,
    delete: adminOnly,
  },
  fields: [
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      index: true,
      admin: {
        description: 'Workspace this policy applies to (null = platform-wide)',
      },
    },
    {
      name: 'name',
      type: 'text',
      required: true,
      admin: {
        description: 'Policy name for identification',
      },
    },
    {
      name: 'description',
      type: 'textarea',
      admin: {
        description: 'Policy description',
      },
    },
    {
      name: 'visibility',
      type: 'select',
      required: true,
      defaultValue: 'private',
      options: [
        { label: 'Private', value: 'private' },
        { label: 'Discoverable', value: 'discoverable' },
        { label: 'Public', value: 'public' },
      ],
      admin: {
        description: 'Who can see topics for sharing requests',
      },
    },
    {
      name: 'autoApprove',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        description: 'Automatically approve share requests',
      },
    },
    {
      name: 'autoApproveWorkspaces',
      type: 'relationship',
      relationTo: 'workspaces',
      hasMany: true,
      admin: {
        description: 'Workspaces whose requests are auto-approved',
        condition: (_, siblingData) => siblingData?.autoApprove !== true,
      },
    },
    {
      name: 'allowedAccessLevels',
      type: 'select',
      hasMany: true,
      options: [
        { label: 'Read (Consume)', value: 'read' },
        { label: 'Write (Produce)', value: 'write' },
        { label: 'Read + Write', value: 'read-write' },
      ],
      defaultValue: ['read'],
      admin: {
        description: 'Access levels that can be requested',
      },
    },
    {
      name: 'maxShareDuration',
      type: 'number',
      admin: {
        description: 'Maximum share duration in days (0 = unlimited)',
      },
    },
    {
      name: 'requireReason',
      type: 'checkbox',
      defaultValue: true,
      admin: {
        description: 'Require reason for share requests',
      },
    },
    {
      name: 'topicPatterns',
      type: 'array',
      admin: {
        description: 'Topic name patterns this policy applies to (regex)',
      },
      fields: [
        {
          name: 'pattern',
          type: 'text',
          required: true,
          admin: {
            description: 'Regex pattern to match topic names',
          },
        },
      ],
    },
    {
      name: 'enabled',
      type: 'checkbox',
      defaultValue: true,
      admin: {
        position: 'sidebar',
        description: 'Policy is active',
      },
    },
    {
      name: 'priority',
      type: 'number',
      defaultValue: 0,
      admin: {
        position: 'sidebar',
        description: 'Higher priority policies are evaluated first',
      },
    },
  ],
  timestamps: true,
}
