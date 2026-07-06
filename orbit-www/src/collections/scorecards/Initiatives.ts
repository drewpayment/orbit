import type { CollectionConfig } from 'payload'
import { workspaceScopedRead, workspaceScopedCreate, workspaceScopedMutate } from './access'

/**
 * Initiatives — time-boxed campaigns to drive entities up a scorecard ladder
 * (IDP refocus P2, the Cortex Initiatives model).
 *
 * An initiative targets a level on a scorecard by a deadline; its action items
 * (initiative-action-items) track the per-entity remediation work.
 */
export const Initiatives: CollectionConfig = {
  slug: 'initiatives',
  admin: {
    useAsTitle: 'name',
    group: 'Scorecards',
    defaultColumns: ['name', 'scorecard', 'targetLevel', 'status', 'deadline'],
    description: 'Campaigns to raise scorecard compliance by a deadline.',
  },
  access: {
    read: workspaceScopedRead,
    create: workspaceScopedCreate,
    update: workspaceScopedMutate('initiatives', ['owner', 'admin', 'member']),
    delete: workspaceScopedMutate('initiatives', ['owner', 'admin']),
  },
  fields: [
    { name: 'name', type: 'text', required: true, index: true },
    { name: 'description', type: 'textarea' },
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      required: true,
      index: true,
    },
    {
      name: 'scorecard',
      type: 'relationship',
      relationTo: 'scorecards',
      required: true,
      index: true,
    },
    { name: 'targetLevel', type: 'text', admin: { description: 'Ladder level to reach (scorecard level name).' } },
    { name: 'owner', type: 'relationship', relationTo: 'users' },
    { name: 'deadline', type: 'date' },
    {
      name: 'status',
      type: 'select',
      defaultValue: 'active',
      options: [
        { label: 'Active', value: 'active' },
        { label: 'Completed', value: 'completed' },
        { label: 'Cancelled', value: 'cancelled' },
      ],
      admin: { position: 'sidebar' },
    },
  ],
  indexes: [{ fields: ['workspace', 'status'] }],
  timestamps: true,
}
