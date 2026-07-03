import type { CollectionConfig, Where } from 'payload'
import { getMemberWorkspaceIds } from '@/lib/access/workspace-access'

/**
 * PendingApprovals Collection (Spike 7 commit γ)
 *
 * Aggregated, queryable view of every approval gate the InfrastructureAgent
 * workflow has ever opened. The chat thread already shows pending gates
 * inline; this collection exists so a reviewer who isn't watching that
 * specific run can still find work to do — landing page is
 * /platform/approvals.
 *
 * Lifecycle:
 *   1. Workflow opens a gate (request_approval / register_tool / destructive
 *      command) → ExecuteActivity(OpenPendingApproval) → POST creates a
 *      pending row.
 *   2. Reviewer resolves via chat or queue page → workflow's gate-side
 *      Selector wakes → ExecuteActivity(ResolvePendingApproval) → PATCH
 *      flips status to resolved/aborted.
 *
 * The (workflowId, approvalId) tuple is unique — the worker treats
 * "row already exists" as success so a continue-as-new replay can re-emit
 * the open call without duplicating rows.
 *
 * Direct CRUD via Payload's REST is disabled. The workflow + chat-side
 * resolver are the only writers.
 */
export const PendingApprovals: CollectionConfig = {
  slug: 'pending-approvals',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['workspace', 'kind', 'title', 'status', 'createdAt'],
    description: 'Aggregated view of agent approval gates across all runs',
    group: 'Agent',
  },
  access: {
    read: async ({ req: { user, payload } }) => {
      if (!user) return false
      // Platform admins see everything (they own the queue page).
      if (user.role === 'super_admin' || user.role === 'admin') return true
      const betterAuthId = user.betterAuthId
      const workspaceIds = betterAuthId ? await getMemberWorkspaceIds(payload, betterAuthId) : []
      if (workspaceIds.length === 0) {
        const denyAll: Where = { id: { equals: '__none__' } }
        return denyAll
      }
      const where: Where = { workspace: { in: workspaceIds } }
      return where
    },
    create: () => false,
    update: () => false,
    delete: () => false,
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
      name: 'workflowId',
      type: 'text',
      required: true,
      index: true,
      admin: { description: 'Temporal workflow id (not run id) — stable across continue-as-new.' },
    },
    {
      name: 'runId',
      type: 'text',
      admin: { description: 'Most recent Temporal run id; useful for jumping into the chat thread.' },
    },
    {
      name: 'agentRun',
      type: 'relationship',
      relationTo: 'agent-runs',
      admin: {
        description: 'Optional link to the AgentRuns row (when the workflow has one).',
      },
    },
    {
      name: 'approvalId',
      type: 'text',
      required: true,
      index: true,
    },
    {
      name: 'kind',
      type: 'select',
      required: true,
      options: [
        { label: 'Tool registration', value: 'tool_registration' },
        { label: 'Pattern registration', value: 'pattern_registration' },
        { label: 'Destructive command', value: 'destructive_command' },
        { label: 'Proposal', value: 'proposal' },
        { label: 'Custom', value: 'custom' },
      ],
    },
    {
      name: 'title',
      type: 'text',
      required: true,
    },
    {
      name: 'bodyMarkdown',
      type: 'textarea',
      admin: { description: 'Reviewer-facing body. Same content the chat card shows.' },
    },
    {
      name: 'payload',
      type: 'json',
      admin: {
        description:
          'Structured gate payload. For tool_registration: {name, description, templateKind, templateJson, inputSchemaJson}. For pattern_registration: {name, displayName, description, category, templateKind, templateJson, inputSchemaJson, reasoning, pattern_id}. For destructive_command: {command, matchedPattern}.',
      },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'pending',
      options: [
        { label: 'Pending', value: 'pending' },
        { label: 'Resolved', value: 'resolved' },
        { label: 'Aborted', value: 'aborted' },
      ],
      index: true,
    },
    {
      name: 'resolution',
      type: 'select',
      options: [
        { label: 'Approved', value: 'approved' },
        { label: 'Rejected', value: 'rejected' },
      ],
      admin: { readOnly: true, description: 'Set when status flips to resolved.' },
    },
    {
      name: 'resolvedBy',
      type: 'relationship',
      relationTo: 'users',
      admin: { readOnly: true },
    },
    {
      name: 'resolvedAt',
      type: 'date',
      admin: { readOnly: true },
    },
    {
      name: 'notes',
      type: 'textarea',
      admin: { readOnly: true, description: 'Reviewer notes / rejection reason.' },
    },
    {
      name: 'reviewerRounds',
      type: 'number',
      defaultValue: 0,
      admin: {
        readOnly: true,
        description:
          'Snapshot of state.reviewerRounds at resolution time — how many back-and-forths the reviewer had with the agent before deciding.',
      },
    },
  ],
  indexes: [
    { fields: ['workflowId', 'approvalId'], unique: true },
    { fields: ['workspace', 'status'] },
  ],
  timestamps: true,
}
