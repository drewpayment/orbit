import type { CollectionConfig } from 'payload'

/**
 * PatternVersions Collection
 *
 * Append-only version history for Patterns rows. Every propose_pattern
 * resolution writes one or two rows here:
 *
 *   - The agent's original proposal (source: 'agent_proposed') — captured
 *     at resolve time so we have an audit baseline even if no admin edits
 *     happen.
 *   - The admin-edited version (source: 'reviewer_edited') — captured
 *     when the admin approves with edits. Carries the editor's user id.
 *
 * The `pattern` row's templateJson / inputSchemaJson / etc. always reflect
 * the most recent approved version (= what new PatternInstances will run).
 * This collection is the audit trail; deletions of a Patterns row leave
 * the version history intact for compliance.
 *
 * Direct mirror of AgentToolVersions; see Patterns.ts for the design
 * rationale.
 */
export const PatternVersions: CollectionConfig = {
  slug: 'pattern-versions',
  admin: {
    useAsTitle: 'displayName',
    defaultColumns: ['pattern', 'versionNumber', 'source', 'editedBy', 'createdAt'],
    description: 'Audit-trail version history for platform-wide deployment patterns',
    group: 'Agent',
  },
  access: {
    // Global catalog — every authenticated user can read pattern history
    // (mirrors the catalog's read-open policy).
    read: ({ req: { user } }) => Boolean(user),
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  fields: [
    {
      name: 'pattern',
      type: 'relationship',
      relationTo: 'patterns',
      required: true,
      index: true,
    },
    {
      name: 'versionNumber',
      type: 'number',
      required: true,
      admin: { description: "Monotonically increasing per-pattern. v1 is the agent's first proposal." },
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
        description: 'Auto-computed from pattern name + version. Used as title.',
      },
      hooks: {
        beforeChange: [
          ({ data, originalDoc }) => {
            if (!data) return ''
            const pattern = data.pattern ?? originalDoc?.pattern
            const patternName =
              typeof pattern === 'object' && pattern !== null
                ? (pattern as { name?: string }).name
                : pattern
            return `${patternName ?? 'pattern'} v${data.versionNumber ?? '?'} (${data.source ?? '?'})`
          },
        ],
      },
    },
    // Snapshot of the row's content at this version. Always populated;
    // makes the version row self-describing without joining to Patterns.
    {
      name: 'name',
      type: 'text',
      required: true,
    },
    {
      name: 'patternDisplayName',
      type: 'text',
      required: true,
    },
    {
      name: 'description',
      type: 'textarea',
    },
    {
      name: 'category',
      type: 'select',
      required: true,
      options: [
        { label: 'Compute', value: 'compute' },
        { label: 'Data', value: 'data' },
        { label: 'Cache', value: 'cache' },
        { label: 'Queue', value: 'queue' },
        { label: 'Observability', value: 'observability' },
        { label: 'Edge', value: 'edge' },
        { label: 'Static site', value: 'static-site' },
        { label: 'Other', value: 'other' },
      ],
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
      name: 'inputSchemaJson',
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
          'Comma-delimited list of fields the reviewer changed (name, display_name, description, category, template_json, input_schema_json, template_kind). Only set on reviewer_edited rows.',
      },
    },
  ],
  indexes: [
    { fields: ['pattern', 'versionNumber'], unique: true },
    { fields: ['pattern', 'createdAt'] },
  ],
  timestamps: true,
}
