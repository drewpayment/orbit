// orbit-www/src/collections/TemplateDefinitions.ts
import type { CollectionConfig, Where } from 'payload'
import { getMemberWorkspaceIds } from '@/lib/access/workspace-access'
import { memberCreate, docWorkspaceMutate } from '@/lib/access/collection-access'

/**
 * TemplateDefinitions — the v2 Scaffolder document (In-App Template
 * Authoring, docs/plans/2026-09-09-in-app-template-authoring-design.md
 * §3.1/§5). Replaces `Templates` as the row template authors create; the
 * actual document body (parameters/steps/output) lives in an immutable
 * `template-definition-versions` snapshot pointed at by `currentVersion` —
 * this row is metadata + the version pointer (mirrors `Patterns` /
 * `PatternVersions`).
 *
 * Workspace-scoped (like `Templates`) rather than platform-global (like
 * `Patterns`): a template belongs to the workspace that authored it, with
 * the same `visibility: workspace|shared|public` tiers `Templates` uses.
 * The `read` access below is a bespoke copy of `Templates.ts`'s (not the
 * `workspaceScopedRead` factory, which has no visibility/sharedWith
 * concept) so this collection stays behaviour-identical to the one it
 * replaces. If a third collection needs this exact shape, promote it into
 * `collection-access.ts` as a visibility-aware read factory.
 *
 * `migratedFrom` is the idempotency key the v1→v2 migration reconciler
 * (`scripts/migrate-templates-to-v2.ts`) keys on — see `lib/scaffolder/v1-migration.ts`.
 */
export const TemplateDefinitions: CollectionConfig = {
  slug: 'template-definitions',
  admin: {
    useAsTitle: 'name',
    group: 'Self-Service',
    defaultColumns: ['name', 'status', 'visibility', 'workspace', 'usageCount'],
    description: 'Self-service template definitions (v2 Scaffolder engine).',
  },
  access: {
    // Read: identical visibility policy to Templates.ts — public, own
    // workspace, or explicitly shared with a workspace the caller belongs to.
    read: async ({ req: { user, payload } }) => {
      if (!user) return false

      const betterAuthId = user.betterAuthId
      const workspaceIds = betterAuthId ? await getMemberWorkspaceIds(payload, betterAuthId) : []

      return {
        or: [
          { visibility: { equals: 'public' } },
          { workspace: { in: workspaceIds } },
          { sharedWith: { in: workspaceIds } },
        ],
      } as Where
    },
    create: memberCreate(),
    update: docWorkspaceMutate('template-definitions', ['owner', 'admin']),
    delete: docWorkspaceMutate('template-definitions', ['owner', 'admin']),
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      minLength: 3,
      maxLength: 100,
    },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      validate: (val: unknown) => {
        if (typeof val !== 'string' || !/^[a-z0-9-]+$/.test(val)) {
          return 'Slug must contain only lowercase letters, numbers, and hyphens'
        }
        return true
      },
    },
    { name: 'title', type: 'text' },
    { name: 'description', type: 'textarea', maxLength: 2000 },
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      required: true,
      index: true,
    },
    {
      name: 'owner',
      type: 'text',
      admin: {
        description:
          'Team/owner label for the template (no dedicated teams collection exists yet — free text).',
      },
    },
    {
      name: 'targetKind',
      type: 'text',
      admin: { description: 'Catalog entity kind this template produces, e.g. "service".' },
    },
    {
      name: 'visibility',
      type: 'select',
      required: true,
      defaultValue: 'workspace',
      options: [
        { label: 'Workspace Only', value: 'workspace' },
        { label: 'Shared', value: 'shared' },
        { label: 'Public', value: 'public' },
      ],
    },
    {
      name: 'sharedWith',
      type: 'relationship',
      relationTo: 'workspaces',
      hasMany: true,
      admin: {
        condition: (data) => data?.visibility === 'shared',
        description: 'Workspaces that can use this template',
      },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'draft',
      index: true,
      options: [
        { label: 'Draft', value: 'draft' },
        { label: 'Published', value: 'published' },
        { label: 'Deprecated', value: 'deprecated' },
      ],
    },
    {
      name: 'currentVersion',
      type: 'relationship',
      relationTo: 'template-definition-versions',
      admin: {
        readOnly: true,
        description: 'Pointer to the active version row (not an ordinal).',
      },
    },
    {
      name: 'sourceMode',
      type: 'select',
      required: true,
      defaultValue: 'orbit',
      options: [
        { label: 'Orbit-authored', value: 'orbit' },
        { label: 'Git-backed', value: 'git' },
      ],
    },
    {
      name: 'gitSource',
      type: 'group',
      admin: { condition: (data) => data?.sourceMode === 'git' },
      fields: [
        { name: 'repoUrl', type: 'text' },
        { name: 'manifestPath', type: 'text', defaultValue: 'orbit-template.yaml' },
        { name: 'lastSyncedAt', type: 'date', admin: { readOnly: true } },
        {
          name: 'syncStatus',
          type: 'select',
          defaultValue: 'pending',
          options: [
            { label: 'Synced', value: 'synced' },
            { label: 'Error', value: 'error' },
            { label: 'Pending', value: 'pending' },
          ],
          admin: { readOnly: true },
        },
      ],
    },
    {
      name: 'migratedFrom',
      type: 'relationship',
      relationTo: 'templates',
      admin: {
        readOnly: true,
        description: 'Set by the v1→v2 migration reconciler; presence is its idempotency key.',
      },
    },
    {
      name: 'fixtures',
      type: 'array',
      admin: { description: 'Named sample inputs for one-click dry run.' },
      fields: [
        { name: 'name', type: 'text', required: true },
        { name: 'values', type: 'json' },
      ],
    },
    {
      name: 'usageCount',
      type: 'number',
      defaultValue: 0,
      admin: { readOnly: true },
    },
    {
      name: 'lastDryRunAt',
      type: 'date',
      admin: { readOnly: true },
    },
    {
      name: 'createdBy',
      type: 'relationship',
      relationTo: 'users',
      admin: { readOnly: true, position: 'sidebar' },
    },
  ],
  hooks: {
    beforeValidate: [
      ({ data, operation, req }) => {
        if (!data) return data

        if (operation === 'create' && !data.slug && data.name) {
          data.slug = data.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')
        }

        if (operation === 'create' && req.user && !data.createdBy) {
          data.createdBy = req.user.id
        }

        return data
      },
    ],
  },
  indexes: [
    { fields: ['slug'], unique: true },
    { fields: ['workspace', 'status'] },
    { fields: ['workspace', 'visibility'] },
  ],
  timestamps: true,
}
