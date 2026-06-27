import type { CollectionConfig } from 'payload'
import { ENTITY_KINDS } from '../catalog'
import { workspaceScopedRead, workspaceScopedManageCreate, workspaceScopedMutate } from './access'

/**
 * Scorecards — operational-excellence standards applied to catalog entities
 * (IDP refocus P2, issue #45).
 *
 * A scorecard defines a set of rules (scorecard-rules) and a maturity ladder
 * (`levels`). It `appliesTo` a slice of the catalog (a kind + optional extra
 * filter). Evaluation projects pass/fail rows into scorecard-rule-results, the
 * queryable source of truth the UI and automations (P4) read.
 *
 * See docs/plans/2026-06-27-idp-refocus-implementation.md (P2).
 */
export const Scorecards: CollectionConfig = {
  slug: 'scorecards',
  admin: {
    useAsTitle: 'name',
    group: 'Scorecards',
    defaultColumns: ['name', 'workspace', 'enabled', 'updatedAt'],
    description: 'Standards + maturity ladders scored against catalog entities.',
  },
  // Authoring (create/update/delete) is gated on workspace owner/admin (P2
  // Option A); members read-only. See lib/scorecards/authz.ts.
  access: {
    read: workspaceScopedRead,
    create: workspaceScopedManageCreate,
    update: workspaceScopedMutate('scorecards', ['owner', 'admin']),
    delete: workspaceScopedMutate('scorecards', ['owner', 'admin']),
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
      admin: { description: 'Security enclave the scorecard belongs to.' },
    },
    {
      name: 'appliesTo',
      type: 'group',
      admin: { description: 'Which catalog entities this scorecard scores.' },
      fields: [
        {
          name: 'kind',
          type: 'select',
          options: ENTITY_KINDS.map((k) => ({ label: k, value: k })),
          admin: { description: 'Restrict to one entity kind. Blank = all kinds.' },
        },
        {
          name: 'filter',
          type: 'json',
          admin: { description: 'Optional extra Payload `where` merged into the entity selection.' },
        },
      ],
    },
    {
      name: 'levels',
      type: 'array',
      admin: {
        description: 'Maturity ladder, lowest rank first (e.g. Bronze=1, Silver=2, Gold=3).',
      },
      fields: [
        { name: 'name', type: 'text', required: true },
        { name: 'rank', type: 'number', required: true, admin: { description: 'Ordering; higher = more mature.' } },
        { name: 'color', type: 'text', admin: { description: 'Optional hex/className for the chip.' } },
      ],
    },
    {
      name: 'enabled',
      type: 'checkbox',
      defaultValue: true,
      admin: { position: 'sidebar' },
    },
  ],
  // workspace is already indexed via `index: true` on the field.
  timestamps: true,
}
