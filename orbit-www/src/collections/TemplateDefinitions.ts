// orbit-www/src/collections/TemplateDefinitions.ts
import type { CollectionConfig, Where } from 'payload'
import {
  getMemberWorkspaceIds,
  getAdminOrOwnerWorkspaceIds,
  isPlatformAdmin,
} from '@/lib/access/workspace-access'
import { manageCreate, docWorkspaceMutate } from '@/lib/access/collection-access'

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
    // Read: `published` rows follow Templates.ts's visibility policy
    // (public / own workspace / explicitly shared). Non-published rows
    // (`draft`, `deprecated`) are NEVER exposed by visibility alone — design
    // §3.2: "Drafts are only visible to authors [and workspace admins]" — so
    // they're additionally gated to the row's author or a workspace
    // owner/admin of the row's OWN workspace, regardless of `visibility`.
    // A `visibility: public` draft must stay invisible to outsiders.
    read: async ({ req: { user, payload } }) => {
      if (!user) return false

      const betterAuthId = user.betterAuthId
      const workspaceIds = betterAuthId ? await getMemberWorkspaceIds(payload, betterAuthId) : []
      const adminOrOwnerWorkspaceIds = betterAuthId
        ? await getAdminOrOwnerWorkspaceIds(payload, betterAuthId)
        : []

      return {
        or: [
          {
            and: [
              { status: { equals: 'published' } },
              {
                or: [
                  { visibility: { equals: 'public' } },
                  { workspace: { in: workspaceIds } },
                  { sharedWith: { in: workspaceIds } },
                ],
              },
            ],
          },
          {
            and: [
              { status: { not_equals: 'published' } },
              {
                or: [
                  { createdBy: { equals: user.id } },
                  { workspace: { in: adminOrOwnerWorkspaceIds } },
                ],
              },
            ],
          },
        ],
      } as Where
    },
    // Create/author: workspace owner/admin only (design §3.7 — authoring is
    // gated higher than plain membership; running a published template is
    // the self-service surface, not authoring one).
    create: manageCreate(['owner', 'admin']),
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
      name: 'lastDryRunStatus',
      type: 'select',
      defaultValue: 'unknown',
      admin: {
        readOnly: true,
        description:
          'Drift status from the last scheduled re-dry-run sweep (P4.G). Never set by a manual "Preview" dry run.',
      },
      options: [
        { label: 'Unknown', value: 'unknown' },
        { label: 'OK', value: 'ok' },
        { label: 'Drifted', value: 'drifted' },
        { label: 'Failed', value: 'failed' },
      ],
    },
    {
      name: 'lastDryRunPlanHash',
      type: 'text',
      admin: {
        readOnly: true,
        description: 'Content hash of the last scheduled sweep dry run plan, used to detect drift.',
      },
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
    // Defense-in-depth (design §3.7: "Publish / deprecate: workspace admin;
    // PLATFORM ADMIN required for visibility: shared|public"). Runs
    // regardless of the caller — application code going through
    // lib/scaffolder/versions.ts's publishVersion() enforces this too, but a
    // direct payload.update({ overrideAccess: true }) call must not be able
    // to slip a shared/public template into `published` for a non-admin.
    //
    // A write with no `req.user` at all (an internal script/worker using
    // overrideAccess) is allowed ONLY when it explicitly opts in via
    // `req.context.allowSharedPublicPublish === true` — silence is treated
    // as unauthorized, not as an implicit bypass.
    beforeChange: [
      ({ data, originalDoc, req }) => {
        if (!data) return data

        const nextVisibility = (data.visibility ?? originalDoc?.visibility) as string | undefined
        const nextStatus = (data.status ?? originalDoc?.status) as string | undefined
        const isRestrictedVisibility = nextVisibility === 'shared' || nextVisibility === 'public'

        if (nextStatus === 'published' && isRestrictedVisibility) {
          if (req.user) {
            if (!isPlatformAdmin(req.user)) {
              throw new Error(
                'Only a platform admin may publish a template-definition with visibility "shared" or "public".',
              )
            }
          } else if (req.context?.allowSharedPublicPublish !== true) {
            throw new Error(
              'Only a platform admin may publish a template-definition with visibility "shared" or "public" ' +
                '(no req.user on this write, and req.context.allowSharedPublicPublish was not set).',
            )
          }
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
