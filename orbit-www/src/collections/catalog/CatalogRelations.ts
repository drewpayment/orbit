import type { CollectionConfig, Where } from 'payload'

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

export const RELATION_TYPES = [
  'owns',
  'depends-on',
  'exposes-api',
  'consumes-api',
  'produces-topic',
  'consumes-topic',
  'runs-in',
  'built-from',
  'part-of',
] as const

export const CatalogRelations: CollectionConfig = {
  slug: 'catalog-relations',
  admin: {
    useAsTitle: 'type',
    group: 'Catalog',
    defaultColumns: ['type', 'from', 'to', 'workspace', 'updatedAt'],
    description: 'Typed edges between catalog entities (dependencies, ownership, lineage).',
  },
  access: {
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
    create: ({ req: { user } }) => !!user,
    update: async ({ req: { user, payload }, id }) => {
      if (!user || !id) return false
      if (user.collection === 'users') return true
      const rel = await payload.findByID({
        collection: 'catalog-relations',
        id,
        overrideAccess: true,
      })
      const workspaceId =
        typeof rel.workspace === 'string' ? rel.workspace : rel.workspace.id
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
      const rel = await payload.findByID({
        collection: 'catalog-relations',
        id,
        overrideAccess: true,
      })
      const workspaceId =
        typeof rel.workspace === 'string' ? rel.workspace : rel.workspace.id
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
  fields: [
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      required: true,
      index: true,
      admin: { description: 'Security enclave the relation belongs to.' },
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
