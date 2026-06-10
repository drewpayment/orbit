import type { CollectionConfig } from 'payload'

/**
 * Patterns Collection
 *
 * Platform-wide catalog of admin-approved deployment recipes. The
 * Infrastructure Agent proposes new patterns via the propose_pattern tool;
 * a platform admin reviews and approves them through the /platform/approvals
 * queue, after which they become first-class catalog items every workspace
 * can invoke (via instantiate_pattern, or — later — directly from a browse
 * UI).
 *
 * This collection is the generalized form of AgentTools one abstraction
 * level up: AgentTools are workspace-scoped, one-shot, agent-callable
 * actions; Patterns are platform-wide, instantiable, long-lived deployment
 * recipes. The schema, status enum, and approval-with-edits semantics
 * deliberately mirror AgentTools so the existing approval plumbing in
 * PendingApprovals + the chat-thread ApprovalCard extend over with minimal
 * change.
 *
 * Workspaces still own the *instances* (see PatternInstances) — the
 * security enclave applies to provisioned state, not to the recipe.
 *
 * See /Users/drewpayment/.claude/plans/merry-strolling-bumblebee.md
 * (Patterns Catalog spike) for the design rationale.
 */
export const Patterns: CollectionConfig = {
  slug: 'patterns',
  admin: {
    useAsTitle: 'displayName',
    defaultColumns: ['name', 'category', 'templateKind', 'status', 'updatedAt'],
    description: 'Platform-wide catalog of admin-approved deployment recipes',
    group: 'Agent',
  },
  access: {
    // Global catalog — every authenticated user can browse approved
    // patterns. Pending/rejected/deprecated rows are filtered by the
    // catalog UI, not by access control, since admins need to see them.
    read: ({ req: { user } }) => Boolean(user),
    // Mutations only via the temporal worker's internal API (X-API-Key);
    // humans resolve via the chat-UI approve/reject path which routes
    // to /api/internal/patterns/[id]/resolve.
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      admin: {
        description:
          'Slug-style pattern name the agent invokes (e.g. static_site_on_render). Globally unique. Must not collide with built-in tools.',
      },
    },
    {
      name: 'displayName',
      type: 'text',
      required: true,
      admin: {
        description: 'Human-readable name shown in the catalog UI (e.g. "Static site on Render").',
      },
    },
    {
      name: 'description',
      type: 'textarea',
      required: true,
      admin: {
        description:
          'Plain-language explanation shown to the LLM and to users browsing the catalog. Concise: one paragraph at most.',
      },
    },
    {
      name: 'category',
      type: 'select',
      required: true,
      options: [
        { label: 'Compute (containers, VMs, functions)', value: 'compute' },
        { label: 'Data (databases, warehouses)', value: 'data' },
        { label: 'Cache (Redis, Memcached)', value: 'cache' },
        { label: 'Queue (Kafka, RabbitMQ, SQS)', value: 'queue' },
        { label: 'Observability (logs, metrics, traces)', value: 'observability' },
        { label: 'Edge (CDN, DNS, WAF)', value: 'edge' },
        { label: 'Static site / SPA hosting', value: 'static-site' },
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
        { label: 'Composite (sequential primitives)', value: 'composite' },
      ],
      admin: {
        description:
          'Same three kinds the AgentTools registry supports — pattern execution reuses tooltemplate.Expand, the safety classifier, and the per-run sandbox.',
      },
    },
    {
      name: 'templateJson',
      type: 'code',
      required: true,
      admin: {
        language: 'json',
        description:
          'Template body. {{var}} placeholders are substituted with the user-supplied parameters at instantiation time. Validated against the input schema before approval.',
      },
    },
    {
      name: 'inputSchemaJson',
      type: 'code',
      required: true,
      admin: {
        language: 'json',
        description:
          'JSON Schema describing the parameters a PatternInstance must supply. Every {{var}} in templateJson must appear here as a property.',
      },
    },
    {
      name: 'reasoning',
      type: 'textarea',
      admin: {
        description:
          "The agent's rationale for why this pattern is worth productizing, captured at proposal time.",
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
        { label: 'Deprecated', value: 'deprecated' },
        { label: 'Rejected', value: 'rejected' },
      ],
    },
    {
      name: 'createdByRunId',
      type: 'text',
      admin: { readOnly: true, description: 'Agent workflow id that proposed the pattern.' },
    },
    {
      name: 'createdByUser',
      type: 'relationship',
      relationTo: 'users',
      admin: { readOnly: true, description: 'User on whose behalf the proposing agent run executed.' },
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
      name: 'currentVersion',
      type: 'number',
      defaultValue: 1,
      admin: {
        readOnly: true,
        description:
          "Version number reflected in this row's templateJson / inputSchemaJson. Full version history lives in pattern-versions; this field is the pointer to which version is active.",
      },
    },
    // Usage telemetry — informs catalog ranking once we have a browse UI.
    {
      name: 'instantiationCount',
      type: 'number',
      defaultValue: 0,
      admin: { readOnly: true, description: 'How many PatternInstances have been provisioned from this pattern.' },
    },
    {
      name: 'lastInstantiatedAt',
      type: 'date',
      admin: { readOnly: true },
    },
  ],
  indexes: [
    { fields: ['name'], unique: true },
    { fields: ['status'] },
    { fields: ['category', 'status'] },
  ],
  timestamps: true,
}
