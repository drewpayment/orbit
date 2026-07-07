import type { CollectionConfig } from 'payload'
import {
  workspaceScopedRead,
  docWorkspaceMutate,
  adminOnly,
} from '@/lib/access/collection-access'

/**
 * DiscoveredEntities — the catalog-discovery review queue (Catalog Discovery
 * Phase 1, docs/plans/2026-07-06-catalog-discovery.md).
 *
 * One row per detected catalog entity proposal. The Go catalog-scan Temporal
 * worker walks an installation's repos and POSTs evidence bundles to the
 * internal ingest route (`/api/internal/discovery/ingest`); that route runs the
 * pure detectors and upserts these rows (keyed on `dedupeKey`). Tier 1
 * `.orbit.yaml` detections are auto-imported (row kept as `imported` for
 * traceability); everything else lands as `proposed` for member review.
 * Approval creates `apps` / `api-schemas` rows and the existing catalog
 * projection layer emits the entities/relations.
 *
 * Workspace-scoped via the lib/access/collection-access factories: read/update
 * = active workspace members, delete = workspace owner/admin. There is NO
 * user-facing create path — the ingest route writes with `overrideAccess`, so
 * direct create is locked to platform admins.
 */
export const DiscoveredEntities: CollectionConfig = {
  slug: 'discovered-entities',
  admin: {
    useAsTitle: 'dedupeKey',
    group: 'Catalog',
    defaultColumns: ['dedupeKey', 'detectedKind', 'confidence', 'status', 'workspace', 'updatedAt'],
    description: 'Repository-scan proposals awaiting review — projected into the catalog on approval.',
  },
  access: {
    // Read: platform admin sees all; others see their active workspaces.
    read: workspaceScopedRead(),
    // Create: platform admin only. The internal ingest route uses the local API
    // with overrideAccess; there is no member-facing create.
    create: adminOnly,
    // Update: workspace owner, admin, or member (approve/ignore actions).
    update: docWorkspaceMutate('discovered-entities', ['owner', 'admin', 'member']),
    // Delete: workspace owner or admin only.
    delete: docWorkspaceMutate('discovered-entities', ['owner', 'admin']),
  },
  fields: [
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      required: true,
      index: true,
      admin: { description: 'Security enclave the proposal belongs to.' },
    },
    {
      name: 'installation',
      type: 'relationship',
      relationTo: 'github-installations',
      admin: { description: 'GitHub App installation the scan ran under.' },
    },
    {
      name: 'repo',
      type: 'group',
      admin: { description: 'Repository the proposal was detected in.' },
      fields: [
        { name: 'owner', type: 'text', required: true },
        { name: 'name', type: 'text', required: true },
        { name: 'url', type: 'text' },
        { name: 'defaultBranch', type: 'text' },
      ],
    },
    {
      name: 'path',
      type: 'text',
      defaultValue: '',
      admin: {
        description: "'' = repo root; monorepo subdirectory otherwise.",
      },
    },
    {
      name: 'detectedKind',
      type: 'select',
      required: true,
      index: true,
      options: [
        { label: 'Service', value: 'service' },
        { label: 'API', value: 'api' },
      ],
    },
    {
      name: 'confidence',
      type: 'select',
      required: true,
      options: [
        { label: 'High', value: 'high' },
        { label: 'Medium', value: 'medium' },
        { label: 'Low', value: 'low' },
      ],
    },
    {
      name: 'evidence',
      type: 'json',
      admin: {
        description: 'Which detectors fired, at which files: [{ detector, file, excerpt? }].',
      },
    },
    {
      name: 'proposal',
      type: 'json',
      admin: {
        description: 'Prefilled entity (service buildConfig, or api schemaType/specPath) used on approval.',
      },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'proposed',
      index: true,
      options: [
        { label: 'Proposed', value: 'proposed' },
        { label: 'Approved', value: 'approved' },
        { label: 'Ignored', value: 'ignored' },
        { label: 'Imported', value: 'imported' },
        { label: 'Stale', value: 'stale' },
      ],
    },
    {
      name: 'importedRef',
      type: 'group',
      admin: {
        description: 'The row this proposal was imported into (traceability).',
      },
      fields: [
        { name: 'collection', type: 'text' },
        { name: 'id', type: 'text' },
      ],
    },
    {
      name: 'dedupeKey',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: {
        description: 'sha1(installationId:owner/name:path:detectedKind) — re-scan idempotency key.',
      },
    },
    {
      name: 'scanRunId',
      type: 'text',
      admin: {
        description: 'Temporal workflow run id that last touched this proposal.',
      },
    },
    {
      name: 'lastSeenAt',
      type: 'date',
      admin: {
        description: 'When the most recent scan last observed this proposal.',
      },
    },
  ],
  indexes: [
    { fields: ['workspace', 'status'] },
  ],
  timestamps: true,
}
