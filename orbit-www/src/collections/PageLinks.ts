import type { CollectionConfig } from 'payload'

export const PageLinks: CollectionConfig = {
  slug: 'page-links',
  admin: {
    useAsTitle: 'id',
    defaultColumns: ['fromPage', 'toPage', 'linkType', 'createdAt'],
    hidden: false,
  },
  access: {
    read: ({ req: { user } }) => {
      if (!user) return false
      return {
        'fromPage.knowledgeSpace.workspace.members.user': {
          equals: user.id,
        },
      }
    },
    create: ({ req: { user } }) => !!user,
    update: () => false, // Links are immutable after creation
    delete: ({ req: { user } }) => !!user,
  },
  fields: [
    {
      name: 'fromPage',
      type: 'relationship',
      relationTo: 'knowledge-pages',
      required: true,
      index: true,
    },
    {
      name: 'toPage',
      type: 'relationship',
      relationTo: 'knowledge-pages',
      required: true,
      index: true,
    },
    {
      name: 'linkType',
      type: 'select',
      required: true,
      defaultValue: 'mention',
      options: [
        { label: 'Mention', value: 'mention' },
        { label: 'Embed', value: 'embed' },
        { label: 'Reference', value: 'reference' },
      ],
    },
  ],
  timestamps: true,
}
