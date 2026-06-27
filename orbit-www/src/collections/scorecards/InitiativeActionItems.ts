import type { CollectionConfig } from 'payload'
import { workspaceScopedRead, workspaceScopedCreate, workspaceScopedMutate } from './access'

/**
 * InitiativeActionItems — per-entity remediation tasks within an initiative
 * (IDP refocus P2). Typically one per (entity, failing rule); tracks who owns
 * the fix and its status.
 */
export const InitiativeActionItems: CollectionConfig = {
  slug: 'initiative-action-items',
  admin: {
    useAsTitle: 'id',
    group: 'Scorecards',
    defaultColumns: ['initiative', 'entity', 'status', 'assignee', 'updatedAt'],
    description: 'Remediation tasks tracked under an initiative.',
  },
  access: {
    read: workspaceScopedRead,
    create: workspaceScopedCreate,
    update: workspaceScopedMutate('initiative-action-items', ['owner', 'admin', 'member']),
    delete: workspaceScopedMutate('initiative-action-items', ['owner', 'admin']),
  },
  fields: [
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      required: true,
      index: true,
    },
    {
      name: 'initiative',
      type: 'relationship',
      relationTo: 'initiatives',
      required: true,
      index: true,
    },
    {
      name: 'entity',
      type: 'relationship',
      relationTo: 'catalog-entities',
      required: true,
      index: true,
    },
    { name: 'rule', type: 'relationship', relationTo: 'scorecard-rules' },
    { name: 'assignee', type: 'relationship', relationTo: 'users' },
    {
      name: 'status',
      type: 'select',
      defaultValue: 'open',
      options: [
        { label: 'Open', value: 'open' },
        { label: 'In progress', value: 'in-progress' },
        { label: 'Done', value: 'done' },
        { label: 'Waived', value: 'waived' },
      ],
    },
    { name: 'notes', type: 'textarea' },
  ],
  // entity is already indexed via `index: true`; keep the compound for list views.
  indexes: [{ fields: ['workspace', 'initiative'] }],
  timestamps: true,
}
