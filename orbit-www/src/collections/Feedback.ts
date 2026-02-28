import type { CollectionConfig } from 'payload'
import { isAdmin } from '../access/isAdmin'

export const Feedback: CollectionConfig = {
  slug: 'feedback',

  admin: {
    useAsTitle: 'subject',
    defaultColumns: ['subject', 'category', 'rating', 'read', 'createdAt'],
    group: 'System',
    description: 'User feedback submissions',
  },

  access: {
    // Anyone authenticated can create feedback
    create: ({ req: { user } }) => !!user,
    // Only admins can read/update/delete
    read: isAdmin,
    update: isAdmin,
    delete: isAdmin,
  },

  fields: [
    {
      name: 'category',
      type: 'select',
      required: true,
      options: [
        { label: 'General', value: 'general' },
        { label: 'Bug Report', value: 'bug' },
        { label: 'Feature Request', value: 'feature' },
        { label: 'Question', value: 'question' },
      ],
    },
    {
      name: 'rating',
      type: 'number',
      min: 0,
      max: 5,
    },
    {
      name: 'name',
      type: 'text',
      required: true,
    },
    {
      name: 'email',
      type: 'email',
      required: true,
    },
    {
      name: 'subject',
      type: 'text',
      required: true,
    },
    {
      name: 'message',
      type: 'textarea',
      required: true,
    },
    {
      name: 'steps',
      type: 'textarea',
      admin: {
        description: 'Steps to reproduce (for bug reports)',
        condition: (data) => data?.category === 'bug',
      },
    },
    {
      name: 'read',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        description: 'Mark as reviewed',
        position: 'sidebar',
      },
    },
    {
      name: 'submittedBy',
      type: 'relationship',
      relationTo: 'users',
      admin: {
        position: 'sidebar',
        readOnly: true,
      },
    },
  ],
}
