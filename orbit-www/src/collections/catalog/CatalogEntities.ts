import type { CollectionConfig, Where } from 'payload'

/**
 * CatalogEntities — the unified software-catalog read model (IDP refocus P1).
 *
 * One row per catalog entity (service, API, resource, topic, domain, team, …).
 * This collection is a PROJECTION: rows are kept in sync from the backing
 * source collections (apps, api-schemas, kafka-topics, …) by afterChange/
 * afterDelete hooks on those sources, plus a one-time backfill. The source
 * collections remain the system of record; this graph is what the catalog UI
 * and (P2) scorecards read. `source.type`/`source.sourceId` record provenance
 * so a projection can find and update the row it owns.
 *
 * Workspace-scoped: access mirrors the apps collection (security enclave keyed
 * to workspace-members). Worker/projection writebacks that run without a user
 * go through /api/internal/catalog/* with X-API-Key and overrideAccess.
 *
 * See docs/plans/2026-06-27-idp-refocus-implementation.md (P1).
 */

export const ENTITY_KINDS = [
  'service',
  'api',
  'resource',
  'datastore',
  'kafka-topic',
  'domain',
  'system',
  'team',
  'environment',
] as const

export const CatalogEntities: CollectionConfig = {
  slug: 'catalog-entities',
  admin: {
    useAsTitle: 'name',
    group: 'Catalog',
    defaultColumns: ['name', 'kind', 'lifecycle', 'workspace', 'updatedAt'],
    description: 'Unified catalog graph — projected from apps, APIs, topics and more.',
  },
  access: {
    // Read: Payload admins see all; others see workspace-scoped (mirrors apps).
    read: async ({ req: { user, payload } }) => {
      if (!user) return false
      if (user.collection === 'users') return true
      const memberships = await payload.find({
        collection: 'workspace-members',
        where: {
          user: { equals: user.id },
          status: { equals: 'active' },
        },
        limit: 1000,
        overrideAccess: true,
      })
      const workspaceIds = memberships.docs.map((m) =>
        String(typeof m.workspace === 'string' ? m.workspace : m.workspace.id),
      )
      return { workspace: { in: workspaceIds } } as Where
    },
    // Create/update/delete are primarily performed by projection hooks via
    // overrideAccess. Direct user edits require workspace owner/admin.
    create: ({ req: { user } }) => !!user,
    update: async ({ req: { user, payload }, id }) => {
      if (!user || !id) return false
      if (user.collection === 'users') return true
      const entity = await payload.findByID({
        collection: 'catalog-entities',
        id,
        overrideAccess: true,
      })
      const workspaceId =
        typeof entity.workspace === 'string' ? entity.workspace : entity.workspace.id
      const members = await payload.find({
        collection: 'workspace-members',
        where: {
          and: [
            { workspace: { equals: workspaceId } },
            { user: { equals: user.id } },
            { role: { in: ['owner', 'admin'] } },
            { status: { equals: 'active' } },
          ],
        },
        overrideAccess: true,
      })
      return members.docs.length > 0
    },
    delete: async ({ req: { user, payload }, id }) => {
      if (!user || !id) return false
      if (user.collection === 'users') return true
      const entity = await payload.findByID({
        collection: 'catalog-entities',
        id,
        overrideAccess: true,
      })
      const workspaceId =
        typeof entity.workspace === 'string' ? entity.workspace : entity.workspace.id
      const members = await payload.find({
        collection: 'workspace-members',
        where: {
          and: [
            { workspace: { equals: workspaceId } },
            { user: { equals: user.id } },
            { role: { in: ['owner', 'admin'] } },
            { status: { equals: 'active' } },
          ],
        },
        overrideAccess: true,
      })
      return members.docs.length > 0
    },
  },
  hooks: {
    // Automation event source (IDP refocus P4): emit `entity-changed`.
    // Fire-and-forget; loop guard — writes tagged `context.skipAutomationEmit`
    // (e.g. an automation-run's builtin creating an entity) do NOT re-emit, so
    // an entity-changed automation cannot recurse through its own action.
    afterChange: [
      ({ doc, operation, req }) => {
        if (req.context?.skipAutomationEmit) return doc
        ;(async () => {
          try {
            const { emitEntityChanged } = await import('@/lib/automations/emit')
            await emitEntityChanged(req.payload, { doc, operation })
          } catch (err) {
            console.error('[CatalogEntities Hook] automation emit failed:', err)
          }
        })()
        return doc
      },
    ],
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      index: true,
    },
    {
      name: 'slug',
      type: 'text',
      index: true,
      admin: {
        description: 'URL-safe identifier, unique within a workspace.',
      },
    },
    {
      name: 'description',
      type: 'textarea',
    },
    {
      name: 'kind',
      type: 'select',
      required: true,
      index: true,
      options: ENTITY_KINDS.map((k) => ({ label: k, value: k })),
    },
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      required: true,
      index: true,
      admin: { description: 'Security enclave the entity belongs to.' },
    },
    {
      name: 'owner',
      type: 'relationship',
      relationTo: 'catalog-entities',
      // Ownership is keyed to a Team entity (survives personnel change), not a
      // user — the Cortex/Backstage pattern.
      filterOptions: () => ({ kind: { equals: 'team' } }),
      admin: {
        description: 'Owning team (a catalog-entities row of kind "team").',
      },
    },
    {
      name: 'lifecycle',
      type: 'select',
      defaultValue: 'production',
      options: [
        { label: 'Experimental', value: 'experimental' },
        { label: 'Production', value: 'production' },
        { label: 'Deprecated', value: 'deprecated' },
      ],
    },
    {
      name: 'tier',
      type: 'select',
      options: [
        { label: 'Tier 1', value: 'tier-1' },
        { label: 'Tier 2', value: 'tier-2' },
        { label: 'Tier 3', value: 'tier-3' },
      ],
      admin: {
        description: 'Criticality — drives scorecard expectations in P2.',
      },
    },
    {
      name: 'links',
      type: 'array',
      admin: { description: 'Docs, dashboards, runbooks.' },
      fields: [
        { name: 'label', type: 'text', required: true },
        { name: 'url', type: 'text', required: true },
        {
          name: 'type',
          type: 'select',
          defaultValue: 'other',
          options: [
            { label: 'Docs', value: 'docs' },
            { label: 'Dashboard', value: 'dashboard' },
            { label: 'Runbook', value: 'runbook' },
            { label: 'Repository', value: 'repository' },
            { label: 'Other', value: 'other' },
          ],
        },
      ],
    },
    {
      name: 'source',
      type: 'group',
      admin: {
        description: 'Provenance back to the backing collection this row projects from.',
      },
      fields: [
        {
          name: 'type',
          type: 'select',
          required: true,
          defaultValue: 'manual',
          options: [
            { label: 'Manual', value: 'manual' },
            { label: 'Apps', value: 'apps' },
            { label: 'API Schemas', value: 'api-schemas' },
            { label: 'Kafka', value: 'kafka' },
            { label: 'Sync', value: 'sync' },
          ],
        },
        {
          name: 'sourceId',
          type: 'text',
          index: true,
          admin: {
            description: 'ID of the backing row in the source collection.',
          },
        },
      ],
    },
    {
      name: 'metadata',
      type: 'json',
      admin: {
        description: 'Freeform, queryable by scorecard rules (P2).',
      },
    },
    {
      name: 'health',
      type: 'select',
      defaultValue: 'unknown',
      options: [
        { label: 'Healthy', value: 'healthy' },
        { label: 'Degraded', value: 'degraded' },
        { label: 'Down', value: 'down' },
        { label: 'Unknown', value: 'unknown' },
      ],
      admin: {
        readOnly: true,
        position: 'sidebar',
        description: 'Folded-in health badge (projected from the source app).',
      },
    },
  ],
  indexes: [
    { fields: ['workspace', 'kind'] },
    // Non-unique: slug may be absent on freshly-projected rows, and a compound
    // unique index collides on multiple nulls in MongoDB. Slug uniqueness within
    // a workspace and projection idempotency (one row per source) are enforced
    // in the projection layer (lib/catalog/projection) keyed on
    // source.type + source.sourceId, not by a DB constraint.
    { fields: ['workspace', 'slug'] },
    { fields: ['source.type', 'source.sourceId'] },
  ],
  timestamps: true,
}
