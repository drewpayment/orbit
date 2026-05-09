import type { CollectionConfig } from 'payload'

/**
 * AgentRuns Collection
 *
 * Persistent record of one Infrastructure Agent execution. Mirrors a Temporal
 * InfrastructureAgentWorkflow lifecycle: created at start, updated as the run
 * progresses (status, summary, ended_at), and surfaced in the run history UI.
 *
 * The full conversation lives in the workflow itself (queryable via the gRPC
 * AgentService). This collection keeps the audit-friendly summary plus
 * approval breadcrumbs.
 */
export const AgentRuns: CollectionConfig = {
  slug: 'agent-runs',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['workspace', 'status', 'startedBy', 'startedAt', 'endedAt'],
    description: 'Infrastructure Agent run history',
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
    // Runs are created/updated by the gRPC AgentService (server-side). End
    // users may not directly mutate runs.
    create: ({ req: { user } }) => Boolean(user),
    update: ({ req: { user } }) => Boolean(user),
    delete: () => false,
  },
  fields: [
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      required: true,
    },
    {
      name: 'repository',
      type: 'relationship',
      relationTo: 'apps',
      required: false,
      admin: {
        description: 'Optional: the app/repo the agent is acting on',
      },
    },
    {
      name: 'workflowId',
      type: 'text',
      required: true,
      label: 'Temporal Workflow ID',
      admin: { readOnly: true },
    },
    {
      name: 'runId',
      type: 'text',
      label: 'Temporal Run ID',
      admin: { readOnly: true },
    },
    {
      name: 'title',
      type: 'text',
      required: true,
      admin: {
        description: 'Short label derived from the initial prompt',
      },
    },
    {
      name: 'initialPrompt',
      type: 'textarea',
      required: true,
      admin: { readOnly: true },
    },
    {
      name: 'llmProvider',
      type: 'relationship',
      relationTo: 'llm-providers',
      required: true,
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'starting',
      options: [
        { label: 'Starting', value: 'starting' },
        { label: 'Running', value: 'running' },
        { label: 'Awaiting User', value: 'awaiting_user' },
        { label: 'Awaiting Approval', value: 'awaiting_approval' },
        { label: 'Completed', value: 'completed' },
        { label: 'Aborted', value: 'aborted' },
        { label: 'Failed', value: 'failed' },
        { label: 'Timed Out', value: 'timeout' },
      ],
    },
    {
      name: 'summary',
      type: 'textarea',
      admin: {
        description: 'Final summary written by the agent on completion',
      },
    },
    {
      name: 'startedBy',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      admin: { readOnly: true },
    },
    {
      name: 'startedAt',
      type: 'date',
      required: true,
      admin: { readOnly: true },
    },
    {
      name: 'endedAt',
      type: 'date',
      admin: { readOnly: true },
    },
    {
      name: 'approvals',
      type: 'array',
      label: 'Approval audit trail',
      admin: {
        description: 'One entry per HITL gate the agent encountered',
        readOnly: true,
      },
      fields: [
        { name: 'approvalId', type: 'text', required: true },
        {
          name: 'kind',
          type: 'select',
          options: ['proposal', 'tool_registration', 'destructive_command', 'custom'],
        },
        { name: 'title', type: 'text' },
        {
          name: 'resolution',
          type: 'select',
          options: ['approved', 'rejected'],
        },
        { name: 'resolvedBy', type: 'relationship', relationTo: 'users' },
        { name: 'resolvedAt', type: 'date' },
        { name: 'notes', type: 'textarea' },
        {
          name: 'edited',
          type: 'checkbox',
          defaultValue: false,
          admin: { description: 'Reviewer modified the registration before approving. Tool-registration approvals only.' },
        },
        { name: 'editedBy', type: 'relationship', relationTo: 'users' },
        {
          name: 'editedFields',
          type: 'text',
          admin: { description: 'Comma-delimited list of fields the reviewer changed.' },
        },
        {
          name: 'agentToolVersionId',
          type: 'text',
          admin: { description: 'AgentToolVersions row id capturing the reviewer-edited snapshot, when edited.' },
        },
      ],
    },
  ],
  indexes: [
    { fields: ['workspace', 'startedAt'] },
    { fields: ['workflowId'], unique: true },
  ],
  timestamps: true,
}
