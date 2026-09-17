import type { CollectionConfig } from 'payload'
import { RELATION_TYPES } from './constants'
import { authenticatedOnly, memberCreate, docWorkspaceMutate } from '@/lib/authz/payload'
import { ALL_ROLES, MANAGE_ROLES } from '@/lib/authz/policy'

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
    read: authenticatedOnly,
    // Create: platform admin, or an active member of the relation's workspace
    // (denormalized onto `data.workspace` at write time; null ⇒ admin only).
    // Update: any active member of the relation's current workspace
    // (ALL_ROLES, matching the prior `canManageEntity`).
    create: memberCreate(),
    update: docWorkspaceMutate('catalog-relations', ALL_ROLES),
    // Delete: manual relations only (projected edges belong to their
    // projector), by an owner/admin (or platform admin). SEMANTIC CHANGE
    // (Phase C, #135): the prior rule reused `canManageEntity` (ALL_ROLES, any
    // active member) for delete; this tightens it to MANAGE_ROLES so deleting
    // a relation requires the same owner/admin rights as deleting an entity.
    delete: docWorkspaceMutate('catalog-relations', MANAGE_ROLES, {
      guard: (doc) => (doc as { source?: { type?: string } }).source?.type === 'manual',
    }),
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
