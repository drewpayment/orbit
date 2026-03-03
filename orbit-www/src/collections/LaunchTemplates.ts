import type { CollectionConfig } from 'payload'
import { isAdmin } from '../access/isAdmin'

export const LaunchTemplates: CollectionConfig = {
  slug: 'launch-templates',
  admin: {
    useAsTitle: 'name',
    group: 'Infrastructure',
    defaultColumns: ['name', 'type', 'provider', 'category'],
  },
  access: {
    // Read: Any authenticated user
    read: ({ req: { user } }) => !!user,
    // Create/Update/Delete: Admins only
    create: isAdmin,
    update: isAdmin,
    delete: isAdmin,
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
    },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      index: true,
    },
    {
      name: 'description',
      type: 'textarea',
      required: true,
    },
    {
      name: 'type',
      type: 'select',
      required: true,
      options: [
        { label: 'Solution Bundle', value: 'bundle' },
        { label: 'Individual Resource', value: 'resource' },
      ],
    },
    {
      name: 'provider',
      type: 'select',
      required: true,
      options: [
        { label: 'AWS', value: 'aws' },
        { label: 'GCP', value: 'gcp' },
        { label: 'Azure', value: 'azure' },
        { label: 'DigitalOcean', value: 'digitalocean' },
      ],
    },
    {
      name: 'crossProviderSlugs',
      type: 'json',
      admin: {
        description: 'Array of equivalent template slugs on other providers',
      },
    },
    {
      name: 'category',
      type: 'select',
      required: true,
      options: [
        { label: 'Compute', value: 'compute' },
        { label: 'Storage', value: 'storage' },
        { label: 'Database', value: 'database' },
        { label: 'Networking', value: 'networking' },
        { label: 'Container', value: 'container' },
        { label: 'Serverless', value: 'serverless' },
      ],
    },
    {
      name: 'parameterSchema',
      type: 'json',
      required: true,
      admin: {
        description: 'JSON Schema for user parameters',
      },
    },
    {
      name: 'pulumiProjectPath',
      type: 'text',
      required: true,
      admin: {
        description: 'Path to Pulumi program within provider worker',
      },
    },
    {
      name: 'estimatedDuration',
      type: 'text',
      admin: {
        description: 'e.g. "~5 min"',
      },
    },
    {
      name: 'builtIn',
      type: 'checkbox',
      defaultValue: true,
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'icon',
      type: 'text',
      admin: {
        position: 'sidebar',
        description: 'Icon identifier for UI',
      },
    },
  ],
  timestamps: true,
}
