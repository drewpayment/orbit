import type { CollectionConfig } from 'payload'

/**
 * AgentEvents Collection
 *
 * Durable replica of the Infrastructure Agent conversation transcript. The
 * Temporal workflow remains the execution engine and live-streaming source,
 * but its history is purged once the namespace retention (24h) expires and
 * compacted on continue-as-new. This collection is the system of record for
 * the transcript so reopening a run renders the full history regardless of
 * Temporal state.
 *
 * One row per durable workflow event, keyed by (workflowId, sequence). The
 * `payload` field holds the exact AgentEvent.Payload map the workflow emits —
 * the same shape the SSE DTO mapper consumes — so persisted events render
 * identically to streamed ones.
 *
 * Rows are written exclusively by the temporal worker via the internal
 * POST /api/internal/agent-events route (overrideAccess). End users may read
 * (scoped to their active workspaces) but never mutate.
 */
export const AgentEvents: CollectionConfig = {
  slug: 'agent-events',
  admin: {
    useAsTitle: 'kind',
    defaultColumns: ['workflowId', 'sequence', 'kind', 'emittedAt'],
    description: 'Persisted Infrastructure Agent transcript events',
    group: 'Agent',
  },
  access: {
    read: async ({ req: { user, payload } }) => {
      if (!user) return false
      const members = await payload.find({
        collection: 'workspace-members',
        where: {
          and: [{ user: { equals: user.id } }, { status: { equals: 'active' } }],
        },
        limit: 100,
      })
      const workspaceIds = members.docs.map((m) =>
        typeof m.workspace === 'string' ? m.workspace : m.workspace.id,
      )
      return { workspace: { in: workspaceIds } }
    },
    // Events are written by the temporal worker via the internal API only.
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
      admin: { readOnly: true },
    },
    {
      name: 'run',
      type: 'relationship',
      relationTo: 'agent-runs',
      required: true,
      admin: { readOnly: true },
    },
    {
      name: 'workflowId',
      type: 'text',
      required: true,
      label: 'Temporal Workflow ID',
      admin: { readOnly: true },
    },
    {
      name: 'sequence',
      type: 'number',
      required: true,
      label: 'Workflow event sequence',
      admin: { readOnly: true },
    },
    {
      name: 'kind',
      type: 'text',
      required: true,
      admin: {
        readOnly: true,
        description:
          'conversation_turn | proposal_update | approval_request | approval_resolution | status_update | tool_call_output',
      },
    },
    {
      name: 'payload',
      type: 'json',
      required: true,
      admin: {
        readOnly: true,
        description: 'Exact AgentEvent.Payload map as emitted by the workflow',
      },
    },
    {
      name: 'emittedAt',
      type: 'date',
      required: true,
      admin: { readOnly: true },
    },
  ],
  indexes: [
    { fields: ['workflowId', 'sequence'], unique: true },
    { fields: ['run'] },
  ],
  timestamps: true,
}
