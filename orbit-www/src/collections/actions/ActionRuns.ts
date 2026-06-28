import type { CollectionConfig } from 'payload'
import { workspaceScopedRead, workspaceScopedMemberCreate } from './access'

/**
 * ActionRuns — the durable record of one execution of an Action (IDP refocus
 * P3, Port's "Action Run"). Created when a member runs an Action; walks
 * pending → awaiting-approval → running → succeeded|failed. For Temporal-backed
 * backends, `workflowId` holds the dispatch workflow id (same convention as
 * pattern-instances). Status/logs/outputs are written back by the execution
 * runner (TS) or the worker (Temporal) via /api/internal/action-runs/[id]/status
 * with X-API-Key, bypassing the access rules below.
 *
 * Creating a run is allowed for any active workspace member (self-service);
 * direct updates are not user-facing (the runner uses overrideAccess).
 */
export const ActionRuns: CollectionConfig = {
  slug: 'action-runs',
  admin: {
    useAsTitle: 'id',
    group: 'Self-Service',
    defaultColumns: ['action', 'status', 'triggeredBy', 'updatedAt'],
    description: 'Execution records for self-service actions.',
  },
  access: {
    read: workspaceScopedRead,
    create: workspaceScopedMemberCreate,
    // Status/logs are advanced by the runner with overrideAccess, not by users.
    update: () => false,
    delete: () => false,
  },
  fields: [
    {
      name: 'action',
      type: 'relationship',
      relationTo: 'actions',
      required: true,
      index: true,
    },
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      required: true,
      index: true,
    },
    {
      name: 'entity',
      type: 'relationship',
      relationTo: 'catalog-entities',
      admin: { description: 'What this run produced or targeted, if anything.' },
    },
    { name: 'inputs', type: 'json', admin: { description: 'Validated against the Action inputSchema.' } },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'pending',
      index: true,
      options: [
        { label: 'Pending', value: 'pending' },
        { label: 'Awaiting approval', value: 'awaiting-approval' },
        { label: 'Running', value: 'running' },
        { label: 'Succeeded', value: 'succeeded' },
        { label: 'Failed', value: 'failed' },
      ],
    },
    {
      name: 'workflowId',
      type: 'text',
      admin: { readOnly: true, description: 'Temporal dispatch workflow id (Temporal backends).' },
    },
    {
      name: 'logs',
      type: 'json',
      admin: { readOnly: true, description: 'Append-only array of { ts, level, message } entries.' },
    },
    { name: 'outputs', type: 'json', admin: { readOnly: true, description: 'Produced urls/ids/etc.' } },
    { name: 'error', type: 'textarea', admin: { readOnly: true } },
    { name: 'triggeredBy', type: 'relationship', relationTo: 'users', admin: { readOnly: true } },
    {
      name: 'trigger',
      type: 'select',
      defaultValue: 'manual',
      options: [
        { label: 'Manual', value: 'manual' },
        { label: 'Automation', value: 'automation' },
      ],
      admin: { description: 'P4 automations create runs with trigger=automation.' },
    },
    {
      name: 'sourceAutomation',
      type: 'relationship',
      relationTo: 'automations',
      index: true,
      admin: {
        readOnly: true,
        description: 'The automation that created this run (P4.1; set when trigger=automation).',
      },
    },
  ],
  indexes: [
    { fields: ['workspace', 'status'] },
    { fields: ['action', 'status'] },
    // Recent runs for an automation's detail view (newest first).
    { fields: ['sourceAutomation', 'createdAt'] },
  ],
  timestamps: true,
}
