// FROZEN capability: functional but accepts no new feature work.
// See README.md "Frozen Capabilities" and docs/plans/2026-06-09-product-focus-strategy.md.

import type { CollectionConfig, Where } from 'payload'
import { adminOnly } from '@/lib/access/collection-access'
import { isPlatformAdmin, getMemberWorkspaceIds } from '@/lib/access/workspace-access'

export const HealthChecks: CollectionConfig = {
  slug: 'health-checks',
  admin: {
    group: 'Monitoring',
    defaultColumns: ['app', 'status', 'responseTime', 'checkedAt'],
  },
  access: {
    // Read: workspace is indirect (health-check -> app -> workspace), so this
    // is a hand-rolled resolver rather than `workspaceScopedRead` (which only
    // supports fields on the doc itself). Platform admin sees all; otherwise
    // resolve the caller's member workspaces, then the apps within them.
    read: async ({ req: { user, payload } }) => {
      if (!user) return false
      if (isPlatformAdmin(user)) return true

      const betterAuthId = user.betterAuthId
      const workspaceIds = betterAuthId ? await getMemberWorkspaceIds(payload, betterAuthId) : []

      const apps = await payload.find({
        collection: 'apps',
        where: { workspace: { in: workspaceIds } },
        limit: 10000,
        overrideAccess: true,
      })

      const appIds = apps.docs.map(a => a.id)

      return {
        app: { in: appIds },
      } as Where
    },
    create: () => false, // Only system can create
    update: () => false, // Immutable records
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
