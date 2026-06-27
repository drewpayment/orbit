import type { CollectionConfig } from 'payload'
import {
  workspaceScopedRead,
  workspaceScopedManageCreate,
  workspaceScopedManageMutate,
} from './access'

/**
 * Automations — "when X changes, do Y" rules that close the loop between
 * scorecards (P2) and self-service actions (P3) (IDP refocus P4, Port's
 * Automation model).
 *
 * An Automation watches an event (`trigger.event`), narrows it with an optional
 * `trigger.filter` (a small JSON predicate evaluated in-process — see
 * lib/automations/match.ts), and when a matching event fires, creates an
 * `action-runs` row for its `action` with `trigger: 'automation'`, reusing the
 * P3 runner verbatim. `inputMapping` maps fields off the event into the
 * action's inputs (template strings — see lib/automations/input-mapping.ts).
 *
 * Drift detection is just an Automation on `rule-result-changed` whose filter
 * matches the pass→fail transition (`{ transition: 'drift' }`).
 *
 * Triggers:
 *   - rule-result-changed / entity-changed → fired in-process by afterChange
 *     hooks on scorecard-rule-results / catalog-entities (fire-and-forget).
 *   - schedule → swept by the (deferred) Temporal schedule worker via
 *     /api/internal/automations/dispatch; `schedule` holds the cron expression.
 *
 * Authoring is gated on workspace owner/admin (same Option A as P2/P3), enforced
 * here and in lib/automations/authz.ts → canManageAutomations.
 *
 * See docs/plans/2026-06-27-idp-refocus-implementation.md (P4).
 */

export const AUTOMATION_EVENTS = [
  'rule-result-changed',
  'entity-changed',
  'schedule',
] as const

export const Automations: CollectionConfig = {
  slug: 'automations',
  admin: {
    useAsTitle: 'name',
    group: 'Automations',
    defaultColumns: ['name', 'workspace', 'action', 'enabled', 'updatedAt'],
    description: 'Event-driven rules that run self-service actions when catalog or scorecard state changes.',
  },
  access: {
    read: workspaceScopedRead,
    create: workspaceScopedManageCreate,
    update: workspaceScopedManageMutate,
    delete: workspaceScopedManageMutate,
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
      name: 'trigger',
      type: 'group',
      admin: { description: 'What event this automation reacts to.' },
      fields: [
        {
          name: 'event',
          type: 'select',
          required: true,
          defaultValue: 'rule-result-changed',
          options: AUTOMATION_EVENTS.map((e) => ({ label: e, value: e })),
        },
        {
          name: 'filter',
          type: 'json',
          admin: {
            description:
              'Optional JSON predicate narrowing the event (e.g. { "transition": "drift" } or { "kind": "service" }). Evaluated in-process; AND of all keys.',
          },
        },
        {
          name: 'schedule',
          type: 'text',
          admin: {
            description:
              'Cron expression — only used when event is "schedule" (swept by the deferred Temporal worker).',
            condition: (_, siblingData) => siblingData?.event === 'schedule',
          },
        },
      ],
    },
    {
      name: 'action',
      type: 'relationship',
      relationTo: 'actions',
      required: true,
      index: true,
      admin: { description: 'The self-service Action to run when this automation fires.' },
    },
    {
      name: 'inputMapping',
      type: 'json',
      admin: {
        description:
          'Maps event fields → action inputs. Values may be templates referencing the event, e.g. { "service": "{{entity.slug}}", "reason": "Rule {{rule.title}} failing" }.',
      },
    },
    {
      name: 'enabled',
      type: 'checkbox',
      defaultValue: true,
      admin: { position: 'sidebar' },
    },
    {
      name: 'lastTriggeredAt',
      type: 'date',
      admin: {
        readOnly: true,
        position: 'sidebar',
        description: 'When this automation last created a run.',
      },
    },
  ],
  indexes: [
    { fields: ['workspace', 'enabled'] },
    { fields: ['workspace', 'trigger.event', 'enabled'] },
  ],
  timestamps: true,
}
