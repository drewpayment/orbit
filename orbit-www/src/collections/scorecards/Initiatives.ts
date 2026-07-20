import type { CollectionConfig } from 'payload'
import {
  platformAdminFieldUpdate,
  workspaceScopedRead,
  workspaceScopedManageCreate,
  workspaceScopedMutate,
} from './access'
import { validateInitiativeRelationships } from './invariants'

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
    create: workspaceScopedManageCreate,
    update: workspaceScopedMutate('initiatives', ['owner', 'admin']),
    delete: workspaceScopedMutate('initiatives', ['owner', 'admin']),
  },
  hooks: { beforeValidate: [validateInitiativeRelationships] },
  fields: [
    { name: 'name', type: 'text', required: true, index: true },
    { name: 'description', type: 'textarea' },
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      required: true,
      index: true,
      access: { update: platformAdminFieldUpdate },
    },
    {
      name: 'scorecard',
      type: 'relationship',
      relationTo: 'scorecards',
      required: true,
      index: true,
      access: { update: platformAdminFieldUpdate },
    },
    {
      name: 'targetLevel',
      type: 'text',
      admin: { description: 'Ladder level to reach (scorecard level name).' },
    },
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
