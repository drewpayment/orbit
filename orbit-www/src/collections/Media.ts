import type { CollectionConfig } from 'payload'
import { adminOnly, authenticatedOnly } from '@/lib/authz/payload'

export const Media: CollectionConfig = {
  slug: 'media',
  access: {
    // Nothing in the app serves media to anonymous visitors (it only backs
    // users.avatar), so reads need a session. Writes are platform-admin only:
    // Payload's default let any logged-in user upload, overwrite or delete files.
    read: authenticatedOnly,
    create: adminOnly,
    update: adminOnly,
    delete: adminOnly,
  },
  fields: [
    {
      name: 'alt',
      type: 'text',
      required: true,
    },
  ],
  upload: true,
}
