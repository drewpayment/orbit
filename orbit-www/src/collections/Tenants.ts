import type { CollectionConfig } from 'payload'
import { isAdmin } from '../access/isAdmin'

/**
 * Tenants Collection
 *
 * Supports multi-tenant SaaS architecture.
 * - Self-hosted deployments: Single default tenant (id: 'default')
 * - SaaS deployments: Multiple tenants with full data isolation
 *
 * All tenant-scoped collections (github-installations, etc.) reference this.
 */
export const Tenants: CollectionConfig = {
  slug: 'tenants',

  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'slug', 'plan', 'status', 'createdAt'],
    group: 'System',
    description: 'Multi-tenant organization management',
  },

  access: {
    // Only admins can manage tenants
    read: isAdmin,
    create: isAdmin,
    update: isAdmin,
    delete: isAdmin,
  },

  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      label: 'Tenant Name',
      admin: {
        description: 'Organization or company name',
      },
    },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      label: 'Tenant Slug',
      admin: {
        description: 'URL-friendly identifier (e.g., "acme-corp")',
      },
    },
    {
      name: 'plan',
      type: 'select',
      required: true,
      defaultValue: 'self-hosted',
      options: [
        { label: 'Self-Hosted (Default)', value: 'self-hosted' },
        { label: 'Free Tier', value: 'free' },
        { label: 'Professional', value: 'professional' },
        { label: 'Enterprise', value: 'enterprise' },
      ],
      admin: {
        description: 'Subscription plan level',
      },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'active',
      options: [
        { label: 'Active', value: 'active' },
        { label: 'Suspended', value: 'suspended' },
        { label: 'Cancelled', value: 'cancelled' },
      ],
      admin: {
        description: 'Current tenant status',
      },
    },
    {
      name: 'settings',
      type: 'group',
      fields: [
        {
          name: 'maxWorkspaces',
          type: 'number',
          admin: {
            description: 'Maximum number of workspaces allowed (null = unlimited)',
          },
        },
        {
          name: 'maxUsers',
          type: 'number',
          admin: {
            description: 'Maximum number of users allowed (null = unlimited)',
          },
        },
        {
          name: 'customDomain',
          type: 'text',
          admin: {
            description: 'Custom domain for this tenant (e.g., "acme.orbit.dev")',
          },
        },
      ],
    },
    {
      name: 'metadata',
      type: 'group',
      fields: [
        {
          name: 'contactEmail',
          type: 'email',
          admin: {
            description: 'Primary contact email for this tenant',
          },
        },
        {
          name: 'billingEmail',
          type: 'email',
          admin: {
            description: 'Billing contact email',
          },
        },
        {
          name: 'notes',
          type: 'textarea',
          admin: {
            description: 'Internal notes about this tenant',
          },
        },
      ],
    },
  ],

  hooks: {
    beforeChange: [
      async ({ operation, data }) => {
        // Auto-generate slug from name if not provided
        if (operation === 'create' && !data.slug && data.name) {
          data.slug = data.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')
        }
        return data
      },
    ],
  },
}
