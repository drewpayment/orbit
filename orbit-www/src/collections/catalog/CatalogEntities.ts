import type { CollectionConfig } from 'payload'
import { ENTITY_KINDS } from './constants'
import { canCreateEntity, canManageEntity, canDeleteEntity } from '@/lib/catalog/entity-authz'
import { isPlatformAdmin } from '@/lib/access/workspace-access'

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

// ENTITY_KINDS lives in ./constants (framework-light) so client-reachable code
// can import the vocabulary without pulling this collection config — and its
// server-only automation hook — into the browser bundle. Re-exported for
// back-compat with existing `@/collections/catalog` imports.
export { ENTITY_KINDS } from './constants'

export const CatalogEntities: CollectionConfig = {
  slug: 'catalog-entities',
  admin: {
    useAsTitle: 'name',
    group: 'Catalog',
    defaultColumns: ['name', 'kind', 'lifecycle', 'workspace', 'updatedAt'],
    description: 'Unified catalog graph — projected from apps, APIs, topics and more.',
  },
  access: {
    // Org-wide read for any authenticated user — the catalog is the discovery
    // surface (Catalog Entity CRUD, docs/plans/2026-07-02-catalog-entity-crud.md).
    // Server actions and projections run with overrideAccess and bypass these
    // rules; they are defense-in-depth for direct Payload REST/GraphQL access.
    read: ({ req: { user } }) => !!user,
    // Create/update: platform admin, or an active member of the entity's
    // workspace. IMPORTANT: workspace-members.user holds a Better-Auth id, so we
    // pass req.user.betterAuthId — NOT req.user.id (a Payload doc id), which was
    // the latent access bug. A null workspace (global entity) ⇒ platform admin only.
    create: async ({ req: { user, payload }, data }) => {
      if (!user) return false
      const ws = (data as { workspace?: string | { id: string } } | undefined)?.workspace
      const workspaceId = ws ? (typeof ws === 'string' ? ws : ws.id) : null
      return canCreateEntity(payload, user.betterAuthId, isPlatformAdmin(user), workspaceId)
    },
    update: async ({ req: { user, payload }, id }) => {
      if (!user || !id) return false
      const entity = await payload.findByID({
        collection: 'catalog-entities',
        id,
        depth: 0,
        overrideAccess: true,
      })
      const ws = entity.workspace
      const workspaceId = ws ? (typeof ws === 'string' ? ws : ws.id) : null
      return canManageEntity(payload, user.betterAuthId, isPlatformAdmin(user), { workspaceId })
    },
    // Delete: manual entities only (projected rows are deleted by removing their
    // source), by a platform admin or workspace owner/admin.
    delete: async ({ req: { user, payload }, id }) => {
      if (!user || !id) return false
      const entity = await payload.findByID({
        collection: 'catalog-entities',
        id,
        depth: 0,
        overrideAccess: true,
      })
      const ws = entity.workspace
      const workspaceId = ws ? (typeof ws === 'string' ? ws : ws.id) : null
      const sourceType = entity.source?.type ?? 'manual'
      return canDeleteEntity(payload, user.betterAuthId, isPlatformAdmin(user), {
        workspaceId,
        sourceType,
      })
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
      // Optional: global entities (no workspace) are platform-admin-managed
      // (Catalog Entity CRUD). Relations derive workspace from their `from` entity.
      required: false,
      index: true,
      admin: { description: 'Security enclave the entity belongs to (absent = global).' },
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
            // Catalog Discovery global import (WP8): a repository scan created
            // this entity directly (no api-schemas/apps source), sourceId = the
            // discovered-entities dedupeKey. See lib/discovery/import.ts.
            { label: 'Scan', value: 'scan' },
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
