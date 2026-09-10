// orbit-www/src/collections/TemplateDefinitionVersions.ts
import type { CollectionConfig } from 'payload'
import { workspaceScopedRead } from '@/lib/access/collection-access'

/**
 * TemplateDefinitionVersions — immutable snapshots of a TemplateDefinition's
 * v2 document (design §3.2). Direct mirror of `PatternVersions.ts`: the
 * parent row (`TemplateDefinitions`) holds a `currentVersion` pointer, each
 * version row is a full snapshot with a monotonic `versionNumber`.
 *
 * `workspace` is denormalized from the parent at write time (see
 * `lib/scaffolder/versions.ts`) purely so `workspaceScopedRead()` works
 * without a custom resolver hop through `definition`.
 *
 * Write-closed to humans: authoring goes through `lib/scaffolder/versions.ts`
 * helpers, which role-check in application code and write with
 * `overrideAccess: true`. Phase 2 wires the authoring UI on top of those
 * helpers.
 */
export const TemplateDefinitionVersions: CollectionConfig = {
  slug: 'template-definition-versions',
  admin: {
    useAsTitle: 'id',
    group: 'Self-Service',
    defaultColumns: ['definition', 'versionNumber', 'editedBy', 'createdAt'],
    description: 'Immutable version history for template definitions.',
  },
  access: {
    read: workspaceScopedRead(),
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  fields: [
    {
      name: 'definition',
      type: 'relationship',
      relationTo: 'template-definitions',
      required: true,
      index: true,
    },
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      required: true,
      index: true,
      admin: { description: "Denormalized from the parent definition's workspace at write time." },
    },
    {
      name: 'versionNumber',
      type: 'number',
      required: true,
      admin: { description: 'Monotonically increasing per-definition.' },
    },
    {
      name: 'definitionJson',
      type: 'json',
      required: true,
      admin: { description: 'The full v2 document (apiVersion/kind/metadata/spec) — see design §3.1.' },
    },
    {
      name: 'editedBy',
      type: 'relationship',
      relationTo: 'users',
      admin: { readOnly: true },
    },
    { name: 'changeNote', type: 'textarea' },
    {
      name: 'validatedAt',
      type: 'date',
      admin: { readOnly: true, description: 'Set when static validation last passed for this version.' },
    },
    {
      name: 'dryRunRunId',
      type: 'relationship',
      relationTo: 'action-runs',
      admin: {
        readOnly: true,
        description: 'The successful dry run that satisfied the publish gate.',
      },
    },
  ],
  indexes: [
    { fields: ['definition', 'versionNumber'], unique: true },
    { fields: ['definition', 'createdAt'] },
  ],
  timestamps: true,
}
