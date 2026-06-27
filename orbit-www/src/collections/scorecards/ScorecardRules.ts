import type { CollectionConfig } from 'payload'
import { workspaceScopedRead, workspaceScopedCreate, workspaceScopedMutate } from './access'

/**
 * ScorecardRules — individual checks belonging to a scorecard (IDP refocus P2).
 *
 * Three rule `type`s, each driven by a JSON `expression` (kept as JSON so rules
 * are data, not code — Port's model). The evaluator (lib/scorecards/evaluate)
 * interprets `expression` per type:
 *   - field-presence: { path: string, op: 'exists' | 'not-empty' }
 *   - relation-check: { relationType: string, direction?: 'from'|'to'|'either',
 *                       targetKind?: string, min?: number }
 *   - threshold:      { path: string, op: 'eq'|'neq'|'gt'|'gte'|'lt'|'lte'|'in',
 *                       value: unknown }
 *
 * `level` names the ladder rung (matches a Scorecards.levels[].name) this rule
 * contributes to. `workspace` is denormalised from the parent scorecard for
 * scoping/indexing.
 */
export const ScorecardRules: CollectionConfig = {
  slug: 'scorecard-rules',
  admin: {
    useAsTitle: 'title',
    group: 'Scorecards',
    defaultColumns: ['title', 'scorecard', 'type', 'level', 'updatedAt'],
    description: 'Individual pass/fail checks within a scorecard.',
  },
  access: {
    read: workspaceScopedRead,
    create: workspaceScopedCreate,
    update: workspaceScopedMutate('scorecard-rules', ['owner', 'admin', 'member']),
    delete: workspaceScopedMutate('scorecard-rules', ['owner', 'admin']),
  },
  fields: [
    {
      name: 'scorecard',
      type: 'relationship',
      relationTo: 'scorecards',
      required: true,
      index: true,
    },
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      required: true,
      index: true,
      admin: { description: 'Denormalised from the parent scorecard.' },
    },
    { name: 'title', type: 'text', required: true },
    { name: 'description', type: 'textarea' },
    {
      name: 'level',
      type: 'text',
      admin: { description: 'Ladder rung this rule belongs to (matches a scorecard level name).' },
    },
    {
      name: 'type',
      type: 'select',
      required: true,
      options: [
        { label: 'Field presence', value: 'field-presence' },
        { label: 'Relation check', value: 'relation-check' },
        { label: 'Threshold', value: 'threshold' },
      ],
    },
    {
      name: 'expression',
      type: 'json',
      required: true,
      admin: { description: 'Rule definition interpreted by the evaluator per type (see collection doc).' },
    },
    { name: 'weight', type: 'number', defaultValue: 1 },
  ],
  // scorecard + workspace are already indexed via `index: true` on their fields.
  timestamps: true,
}
