import type { CollectionConfig } from 'payload'
import { platformAdminFieldUpdate, workspaceScopedRead } from './access'
import { validateRuleRelationships } from './invariants'

/**
 * ScorecardRules — individual checks belonging to a scorecard (IDP refocus P2).
 *
 * Four rule `type`s, each driven by a JSON `expression` (kept as JSON so rules
 * are data, not code — Port's model). The evaluator (lib/scorecards/evaluate)
 * interprets `expression` per type:
 *   - field-presence: { path: string, op: 'exists' | 'not-empty' }
 *   - relation-check: { relationType: string, direction?: 'from'|'to'|'either',
 *                       targetKind?: string, min?: number }
 *   - threshold:      { path: string, op: 'eq'|'neq'|'gt'|'gte'|'lt'|'lte'|'in',
 *                       value: unknown }
 *   - entity-score:   { target: 'self' | 'related', scoreScope?: 'overall' |
 *                       'scorecard' (default 'overall'), scorecardId?: string
 *                       (when scoreScope='scorecard'), relationType?: string,
 *                       direction?: 'from'|'to'|'either', targetKind?: string
 *                       (target='related' selectors), aggregate?: 'min'|'avg'|
 *                       'max' (default 'min' — weakest-link), op: 'gte'|'gt'|
 *                       'lte'|'lt'|'eq', value: number } — compiles the
 *                       entity's own or related entities' stored entity-scores
 *                       (see docs/plans/2026-07-01-entity-scores-and-golden-paths.md).
 *                       Reads the LATEST stored scores, not a live recompute:
 *                       evaluation order is non-score rules first (which feed
 *                       score recomputation), then entity-score rules in the
 *                       same pass, so cross-scorecard chains converge on the
 *                       next evaluation run.
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
  // Rule writes are service-owned because expression validation and parent
  // scorecard reevaluation live in authenticated server actions. Denying direct
  // REST/GraphQL/Admin mutations prevents malformed or stale rules.
  access: {
    read: workspaceScopedRead,
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  hooks: { beforeValidate: [validateRuleRelationships] },
  fields: [
    {
      name: 'scorecard',
      type: 'relationship',
      relationTo: 'scorecards',
      required: true,
      index: true,
      access: { update: platformAdminFieldUpdate },
    },
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      required: true,
      index: true,
      access: { update: platformAdminFieldUpdate },
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
        { label: 'Entity score', value: 'entity-score' },
      ],
    },
    {
      name: 'expression',
      type: 'json',
      required: true,
      admin: {
        description: 'Rule definition interpreted by the evaluator per type (see collection doc).',
      },
    },
    { name: 'weight', type: 'number', defaultValue: 1 },
  ],
  // scorecard + workspace are already indexed via `index: true` on their fields.
  timestamps: true,
}
