import type { CollectionConfig } from 'payload'
import {
  workspaceScopedRead,
  workspaceScopedManageCreate,
  workspaceScopedMutate,
} from './access'

/**
 * Actions — the self-service catalog of things a developer can ask the platform
 * to do (IDP refocus P3, Port's "Action" model).
 *
 * An Action declares an input form (`inputSchema`), an `approvalPolicy`, and a
 * `backend` that says how it executes. `backend.type` discriminates the
 * executor — locally-runnable ones (`builtin`, `webhook`) run in the TS layer
 * today; the `temporal-*` / `kafka-provision` / `agent` types WRAP existing
 * Temporal workflows and are dispatched by the (deferred) Go ActionDispatch
 * workflow — no existing workflow is rewritten. Running an Action produces an
 * `action-runs` row.
 *
 * Authoring (defining Actions) is gated on workspace owner/admin; RUNNING an
 * Action is available to any workspace member (that's self-service) and is
 * enforced on the action-runs collection + the run server action.
 *
 * See docs/plans/2026-06-27-idp-refocus-implementation.md (P3).
 */

export const ACTION_BACKEND_TYPES = [
  'builtin',
  'webhook',
  'temporal-template',
  'temporal-pattern',
  'temporal-launch',
  'kafka-provision',
  'agent',
] as const

export const Actions: CollectionConfig = {
  slug: 'actions',
  admin: {
    useAsTitle: 'name',
    group: 'Self-Service',
    defaultColumns: ['name', 'workspace', 'backend', 'enabled', 'updatedAt'],
    description: 'Self-service actions developers can run (templates, provisioning, agent, …).',
  },
  // Authoring is owner/admin; members can read (and run via action-runs).
  access: {
    read: workspaceScopedRead,
    create: workspaceScopedManageCreate,
    update: workspaceScopedMutate('actions', ['owner', 'admin']),
    delete: workspaceScopedMutate('actions', ['owner', 'admin']),
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
      name: 'icon',
      type: 'text',
      admin: { description: 'Optional lucide icon name for the catalog card.' },
    },
    {
      name: 'inputSchema',
      type: 'json',
      admin: {
        description:
          'JSON Schema for the run form (reuses the Patterns inputSchemaJson convention). Drives the inputs collected before a run.',
      },
    },
    {
      name: 'approvalPolicy',
      type: 'select',
      defaultValue: 'none',
      options: [
        { label: 'No approval', value: 'none' },
        { label: 'Workspace admin approval', value: 'workspace-admin' },
        { label: 'Platform admin approval', value: 'platform-admin' },
      ],
    },
    {
      name: 'backend',
      type: 'group',
      admin: { description: 'How this action executes.' },
      fields: [
        {
          name: 'type',
          type: 'select',
          required: true,
          defaultValue: 'builtin',
          options: ACTION_BACKEND_TYPES.map((t) => ({ label: t, value: t })),
        },
        {
          name: 'ref',
          type: 'text',
          admin: {
            description:
              'Backend target: builtin handler id, webhook URL, template/pattern/launch id, topic config, or agent prompt ref — interpreted per type.',
          },
        },
      ],
    },
    {
      name: 'enabled',
      type: 'checkbox',
      defaultValue: true,
      admin: { position: 'sidebar' },
    },
  ],
  indexes: [{ fields: ['workspace', 'enabled'] }],
  timestamps: true,
}
