// FROZEN capability: functional but accepts no new feature work.
// See README.md "Frozen Capabilities" and docs/plans/2026-06-09-product-focus-strategy.md.

import type { CollectionConfig } from 'payload'
import { adminOnly, workspaceScopedRead, denyAll } from '@/lib/authz/payload'

export const HealthChecks: CollectionConfig = {
  slug: 'health-checks',
  admin: {
    group: 'Monitoring',
    defaultColumns: ['app', 'status', 'responseTime', 'checkedAt'],
  },
  access: {
    // Read: workspace is indirect (health-check -> app -> workspace), so
    // this uses the `via` join hop rather than a direct field.
    read: workspaceScopedRead({ via: [{ collection: 'apps', on: 'app' }] }),
    create: denyAll, // Only system can create
    update: denyAll, // Immutable records
    delete: adminOnly, // Platform admin only
  },
  fields: [
    {
      name: 'app',
      type: 'relationship',
      relationTo: 'apps',
      required: true,
      index: true,
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      options: [
        { label: 'Healthy', value: 'healthy' },
        { label: 'Degraded', value: 'degraded' },
        { label: 'Down', value: 'down' },
      ],
    },
    {
      name: 'statusCode',
      type: 'number',
      admin: {
        description: 'HTTP response status code',
      },
    },
    {
      name: 'responseTime',
      type: 'number',
      admin: {
        description: 'Response time in milliseconds',
      },
    },
    {
      name: 'error',
      type: 'text',
      admin: {
        description: 'Error message if check failed',
      },
    },
    {
      name: 'checkedAt',
      type: 'date',
      required: true,
      index: true,
    },
  ],
  timestamps: true,
}
