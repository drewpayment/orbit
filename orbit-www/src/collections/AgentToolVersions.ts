import type { CollectionConfig } from 'payload'
import { workspaceScopedRead, denyAll } from '@/lib/authz/payload'

/**
 * AgentToolVersions Collection
 *
 * Append-only version history for AgentTools rows. Every register_tool
 * resolution writes one or two rows here:
 *
 *   - The agent's original proposal (source: 'agent_proposed') — captured
 *     at resolve time so we have an audit baseline even if no reviewer
 *     edits happen.
 *   - The reviewer-edited version (source: 'reviewer_edited') — captured
 *     when the reviewer approves with edits. Carries the editor's user id.
 *
 * The `tool` row's templateJson / etc. fields always reflect the most
 * recent approved version (= what the agent invokes). This collection is
 * the audit trail; deletions of an AgentTools row leave the version
 * history intact for compliance.
 */
export const AgentToolVersions: CollectionConfig = {
  slug: 'agent-tool-versions',
  admin: {
    useAsTitle: 'displayName',
    defaultColumns: ['tool', 'versionNumber', 'source', 'editedBy', 'createdAt'],
    description: 'Audit-trail version history for self-extending agent tools',
    group: 'Agent',
  },
  access: {
    // Mirror AgentTools: workspace members can read versions of their
    // workspace's tools. Writes only via the temporal worker's internal
    // API; direct CRUD via Payload's REST is disabled to keep the audit
    // trail unambiguous.
    read: workspaceScopedRead({ via: [{ collection: 'agent-tools', on: 'tool' }] }),
    create: denyAll,
    update: denyAll,
    delete: denyAll,
  },
  fields: [
    {
      name: 'tool',
      type: 'relationship',
      relationTo: 'agent-tools',
      required: true,
      index: true,
    },
    {
      name: 'versionNumber',
      type: 'number',
      required: true,
      admin: { description: 'Monotonically increasing per-tool. v1 is the agent\'s first proposal.' },
    },
    {
      name: 'source',
      type: 'select',
      required: true,
      options: [
        { label: 'Agent proposed', value: 'agent_proposed' },
        { label: 'Reviewer edited', value: 'reviewer_edited' },
      ],
    },
    {
      name: 'displayName',
      type: 'text',
      admin: {
        readOnly: true,
        description: 'Auto-computed from tool name + version. Used as title.',
      },
      hooks: {
        beforeChange: [
          ({ data, originalDoc }) => {
            if (!data) return ''
            const tool = data.tool ?? originalDoc?.tool
            const toolName = typeof tool === 'object' && tool !== null ? (tool as { name?: string }).name : tool
            return `${toolName ?? 'tool'} v${data.versionNumber ?? '?'} (${data.source ?? '?'})`
          },
        ],
      },
    },
    {
      name: 'name',
      type: 'text',
      required: true,
    },
    {
      name: 'description',
      type: 'textarea',
    },
    {
      name: 'inputSchemaJson',
      type: 'code',
      admin: { language: 'json' },
    },
    {
      name: 'templateKind',
      type: 'select',
      required: true,
      options: [
        { label: 'Shell command', value: 'shell' },
        { label: 'HTTP request', value: 'http' },
        { label: 'Composite', value: 'composite' },
      ],
    },
    {
      name: 'templateJson',
      type: 'code',
      required: true,
      admin: { language: 'json' },
    },
    {
      name: 'editedBy',
      type: 'relationship',
      relationTo: 'users',
      admin: {
        readOnly: true,
        description: 'Set on reviewer_edited rows; null on agent_proposed rows.',
      },
    },
    {
      name: 'editedFields',
      type: 'text',
      admin: {
        readOnly: true,
        description:
          'Comma-delimited list of fields the reviewer changed (name, description, template_json, input_schema_json, template_kind). Only set on reviewer_edited rows.',
      },
    },
  ],
  indexes: [
    { fields: ['tool', 'versionNumber'], unique: true },
    { fields: ['tool', 'createdAt'] },
  ],
  timestamps: true,
}
