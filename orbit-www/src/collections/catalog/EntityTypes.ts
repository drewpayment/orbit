import type { CollectionConfig } from 'payload'
import { ENTITY_KINDS, RELATION_TYPES } from './constants'
import { workspaceScopedRead, workspaceScopedManageCreate, workspaceScopedMutate } from '../scorecards/access'

/**
 * EntityTypes — the definition & home for a catalog `kind`, workspace-scoped
 * (Entity Scores & Golden Paths, docs/plans/2026-07-01-entity-scores-and-golden-paths.md).
 *
 * One row per (workspace, kind) — e.g. "what does 'service' mean here, what's
 * the paved road, what score does an unscored service start from". Uniqueness
 * of (workspace, kind) is enforced in the app layer (lib/catalog/entity-types),
 * mirroring catalog projection idempotency, not by a DB constraint.
 *
 * `baseValue` is the INHERITED value: the score an entity of this kind carries
 * when no scorecard applies to it, and the baseline term folded into the
 * overall score once scorecards do apply (see lib/scorecards/scoring.ts).
 * `scoringWeight` weights this kind's contribution when `entity-score`
 * scorecard rules aggregate across related entities.
 *
 * `goldenPath` is the paved-road definition: a narrative summary + docs link
 * for humans, plus structural expectations (`requiredRelations`,
 * `requiredMetadata`) that lib/scorecards/scoring.ts checks against an
 * entity's actual relations/metadata to compute golden-path alignment %.
 *
 * Lazy defaults: when no row exists for a (workspace, kind),
 * `lib/catalog/entity-types.ts → resolveEntityType` returns a built-in default
 * (baseValue 50, scoringWeight 1, empty golden path) so scoring never blocks
 * on setup.
 *
 * Access mirrors scorecards (reuses collections/scorecards/access.ts): workspace
 * members read, owner/admin author.
 */
export const EntityTypes: CollectionConfig = {
  slug: 'entity-types',
  admin: {
    useAsTitle: 'displayName',
    group: 'Catalog',
    defaultColumns: ['displayName', 'kind', 'workspace', 'baseValue', 'updatedAt'],
    description: 'Definition, golden path, and inherited base value for a catalog kind.',
  },
  access: {
    read: workspaceScopedRead,
    create: workspaceScopedManageCreate,
    update: workspaceScopedMutate('entity-types', ['owner', 'admin']),
    delete: workspaceScopedMutate('entity-types', ['owner', 'admin']),
  },
  fields: [
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      required: true,
      index: true,
      admin: { description: 'Security enclave the type definition belongs to.' },
    },
    {
      name: 'kind',
      type: 'select',
      required: true,
      index: true,
      options: ENTITY_KINDS.map((k) => ({ label: k, value: k })),
      admin: { description: 'One definition per kind per workspace (enforced in the app layer).' },
    },
    { name: 'displayName', type: 'text', required: true, admin: { description: 'e.g. "Backend Service".' } },
    { name: 'description', type: 'textarea', admin: { description: 'What this type means here.' } },
    {
      name: 'baseValue',
      type: 'number',
      defaultValue: 50,
      min: 0,
      max: 100,
      admin: {
        description:
          'The inherited value: the score an entity of this kind carries when no scorecard applies to it, and the baseline term in the overall score.',
      },
    },
    {
      name: 'scoringWeight',
      type: 'number',
      defaultValue: 1,
      admin: { description: "How much this kind counts in cross-entity aggregation (entity-score rules with `aggregate`)." },
    },
    {
      name: 'goldenPath',
      type: 'group',
      admin: { description: 'The paved-road definition for this kind.' },
      fields: [
        { name: 'summary', type: 'textarea', admin: { description: 'Narrative for leaders.' } },
        { name: 'docsUrl', type: 'text', admin: { description: 'Link to the paved-road docs/template.' } },
        {
          name: 'requiredRelations',
          type: 'array',
          admin: { description: 'Structural expectations checked against the entity’s actual relations.' },
          fields: [
            {
              name: 'relationType',
              type: 'select',
              required: true,
              options: RELATION_TYPES.map((t) => ({ label: t, value: t })),
            },
            {
              name: 'direction',
              type: 'select',
              defaultValue: 'either',
              options: [
                { label: 'From', value: 'from' },
                { label: 'To', value: 'to' },
                { label: 'Either', value: 'either' },
              ],
            },
            {
              name: 'targetKind',
              type: 'select',
              options: ENTITY_KINDS.map((k) => ({ label: k, value: k })),
              admin: { description: 'Restrict to relations touching this kind. Blank = any kind.' },
            },
            { name: 'min', type: 'number', defaultValue: 1 },
          ],
        },
        {
          name: 'requiredMetadata',
          type: 'array',
          admin: { description: 'Expected metadata.*/field paths on the entity.' },
          fields: [
            { name: 'path', type: 'text', required: true },
            { name: 'label', type: 'text' },
          ],
        },
      ],
    },
  ],
  // workspace + kind are already indexed via `index: true` on their fields.
  indexes: [{ fields: ['workspace', 'kind'] }],
  timestamps: true,
}
