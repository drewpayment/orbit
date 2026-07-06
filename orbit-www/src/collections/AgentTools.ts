import type { CollectionConfig } from 'payload'
import { getMemberWorkspaceIds } from '@/lib/access/workspace-access'

/**
 * AgentTools Collection
 *
 * Self-extending tool library for the Infrastructure Agent. Each row is a
 * named, parameterized template the agent can invoke once approved by a
 * human. Templates compile to vetted primitives (shell_exec, http_request,
 * composite) — the agent never executes a row directly. The workflow's
 * register_tool dispatch creates pending rows; approval flips them to
 * approved status and they appear in subsequent LLM tool catalogs.
 *
 * See docs/plans/robust-twirling-crab.md §6 for the design rationale.
 */
export const AgentTools: CollectionConfig = {
  slug: 'agent-tools',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['workspace', 'name', 'templateKind', 'status', 'updatedAt'],
    description: 'Self-extending tool library for the Infrastructure Agent',
    group: 'Agent',
  },
  access: {
    read: async ({ req: { user, payload } }) => {
      if (!user) return false
      const betterAuthId = user.betterAuthId
      const workspaceIds = betterAuthId ? await getMemberWorkspaceIds(payload, betterAuthId) : []
      return { workspace: { in: workspaceIds } }
    },
    // Rows are written via the temporal worker's internal API; humans
    // resolve them through the chat-UI Approve/Reject path which calls the
    // /resolve endpoint server-side. Direct CRUD via Payload's REST is
    // disabled to keep the registry's audit trail unambiguous.
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
    },
    {
      name: 'name',
      type: 'text',
      required: true,
      admin: {
        description:
          'Slug-style tool name the agent invokes (e.g. deploy_azure_appservice). Must be unique per workspace and must not collide with built-in tools.',
      },
    },
    {
      name: 'description',
      type: 'textarea',
      required: true,
      admin: {
        description:
          'Plain-language explanation shown to the LLM as part of its tool catalog. Concise: one paragraph at most.',
      },
    },
    {
      name: 'inputSchemaJson',
      type: 'code',
      admin: {
        language: 'json',
        description: 'JSON Schema describing the tool args.',
      },
    },
    {
      name: 'templateKind',
      type: 'select',
      required: true,
      options: [
        { label: 'Shell command', value: 'shell' },
        { label: 'HTTP request', value: 'http' },
        { label: 'Composite (sequential primitives)', value: 'composite' },
      ],
    },
    {
      name: 'templateJson',
      type: 'code',
      required: true,
      admin: {
        language: 'json',
        description:
          'Template body. {{var}} placeholders are substituted with the agent-supplied args (shell-escaped for the shell kind, JSON-escaped for http). See docs/plans/robust-twirling-crab.md §6.',
      },
    },
    {
      name: 'reasoning',
      type: 'textarea',
      admin: {
        description: "The agent's rationale for why this tool is worth registering, captured at proposal time.",
      },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'pending',
      options: [
        { label: 'Pending approval', value: 'pending' },
        { label: 'Approved', value: 'approved' },
        { label: 'Rejected', value: 'rejected' },
      ],
    },
    {
      name: 'createdByRunId',
      type: 'text',
      admin: { readOnly: true },
    },
    {
      name: 'approvedBy',
      type: 'relationship',
      relationTo: 'users',
      admin: { readOnly: true },
    },
    {
      name: 'approvedAt',
      type: 'date',
      admin: { readOnly: true },
    },
    {
      name: 'rejectionReason',
      type: 'textarea',
      admin: { readOnly: true },
    },
    {
      name: 'invocationCount',
      type: 'number',
      defaultValue: 0,
      admin: { readOnly: true, description: 'How many times the tool has been invoked since approval.' },
    },
    {
      name: 'lastInvokedAt',
      type: 'date',
      admin: { readOnly: true },
    },
    {
      name: 'currentVersion',
      type: 'number',
      defaultValue: 1,
      admin: {
        readOnly: true,
        description:
          "Version number reflected in this row's templateJson / etc. The full version history lives in agent-tool-versions; this field is the pointer to which version is active.",
      },
    },
  ],
  indexes: [
    { fields: ['workspace', 'name'], unique: true },
    { fields: ['workspace', 'status'] },
  ],
  timestamps: true,
}
