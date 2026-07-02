import type { CollectionConfig } from 'payload'
import { RELATION_TYPES } from './constants'
import { canCreateEntity, canManageEntity } from '@/lib/catalog/entity-authz'
import { isPlatformAdmin } from '@/lib/access/workspace-access'

/**
 * CatalogRelations — typed edges in the catalog graph (IDP refocus P1).
 *
 * Directed edge `from` --(type)--> `to`, both catalog-entities in the same
 * workspace. Like CatalogEntities, relations are PROJECTED from sources:
 * app→API links, and (the differentiator) Kafka lineage edges become
 * produces-topic / consumes-topic relations. Idempotency is enforced in the
 * projection layer keyed on (workspace, from, to, type), not by a DB
 * constraint (relationship fields holding null/ObjectId make a clean unique
 * compound index awkward).
 *
 * See docs/plans/2026-06-27-idp-refocus-implementation.md (P1).
 */

// RELATION_TYPES lives in ./constants (framework-light) — see the note in
// CatalogEntities.ts. Re-exported for back-compat.
export { RELATION_TYPES } from './constants'

export const CatalogRelations: CollectionConfig = {
  slug: 'catalog-relations',
  admin: {
    useAsTitle: 'type',
    group: 'Catalog',
    defaultColumns: ['type', 'from', 'to', 'workspace', 'updatedAt'],
    description: 'Typed edges between catalog entities (dependencies, ownership, lineage).',
  },
  access: {
    // Org-wide read for any authenticated user; a relation is visible wherever
    // its endpoints are (Catalog Entity CRUD). Server actions/projections use
    // overrideAccess — these rules are defense-in-depth for direct API access.
    read: ({ req: { user } }) => !!user,
    // Create/update: platform admin, or an active member of the relation's
    // workspace (derived from its `from` entity). Better-Auth id via
    // req.user.betterAuthId — never req.user.id. Null workspace ⇒ admin only.
    create: async ({ req: { user, payload }, data }) => {
      if (!user) return false
      const ws = (data as { workspace?: string | { id: string } } | undefined)?.workspace
      const workspaceId = ws ? (typeof ws === 'string' ? ws : ws.id) : null
      return canCreateEntity(payload, user.betterAuthId, isPlatformAdmin(user), workspaceId)
    },
    update: async ({ req: { user, payload }, id }) => {
      if (!user || !id) return false
      const rel = await payload.findByID({
        collection: 'catalog-relations',
        id,
        depth: 0,
        overrideAccess: true,
      })
      const ws = rel.workspace
      const workspaceId = ws ? (typeof ws === 'string' ? ws : ws.id) : null
      return canManageEntity(payload, user.betterAuthId, isPlatformAdmin(user), { workspaceId })
    },
    // Delete: manual relations only (projected edges belong to their projector),
    // by anyone with manage rights on the relation's workspace.
    delete: async ({ req: { user, payload }, id }) => {
      if (!user || !id) return false
      const rel = await payload.findByID({
        collection: 'catalog-relations',
        id,
        depth: 0,
        overrideAccess: true,
      })
      if ((rel.source?.type ?? 'manual') !== 'manual') return false
      const ws = rel.workspace
      const workspaceId = ws ? (typeof ws === 'string' ? ws : ws.id) : null
      return canManageEntity(payload, user.betterAuthId, isPlatformAdmin(user), { workspaceId })
    },
  },
  fields: [
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      // Optional: derived from the `from` entity's workspace at write time;
      // absent for a global-from-global relation (Catalog Entity CRUD).
      required: false,
      index: true,
      admin: { description: 'Security enclave the relation belongs to (absent = global).' },
    },
    {
      name: 'from',
      type: 'relationship',
      relationTo: 'catalog-entities',
      required: true,
      index: true,
    },
    {
      name: 'to',
      type: 'relationship',
      relationTo: 'catalog-entities',
      required: true,
      index: true,
    },
    {
      name: 'type',
      type: 'select',
      required: true,
      index: true,
      options: RELATION_TYPES.map((t) => ({ label: t, value: t })),
    },
    {
      name: 'source',
      type: 'group',
      admin: {
        description: 'Provenance back to the backing collection this edge projects from.',
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
            { label: 'Kafka Lineage', value: 'kafka-lineage' },
            { label: 'Sync', value: 'sync' },
          ],
        },
        {
          name: 'sourceId',
          type: 'text',
          index: true,
        },
      ],
    },
    {
      name: 'metadata',
      type: 'json',
    },
  ],
  indexes: [
    { fields: ['workspace', 'from', 'type'] },
    { fields: ['workspace', 'to', 'type'] },
    { fields: ['source.type', 'source.sourceId'] },
  ],
  timestamps: true,
}
