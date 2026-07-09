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
 *
 * Workspace-less (global) proposals (Phase 1.5, WP8): `workspace` is OPTIONAL. A
 * row with no workspace is a GLOBAL proposal, produced by a platform admin's
 * installation-level scan and managed by platform admins only. The access
 * factories already deliver those semantics without a special case: the read
 * `Where` (`{ workspace: { in: memberIds } }`) never matches a null-workspace
 * row, and the mutate gates resolve a null workspace to "deny" — so for every
 * global row the sole non-deny branch is `isPlatformAdmin`. Workspace rows are
 * unchanged. Approval imports a global row as a global catalog-entities row
 * (`source.type: 'scan'`) or, when a workspace is assigned, through the normal
 * apps/api-schemas path — see lib/discovery/import.ts.
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
      // Optional: a global proposal (no workspace) comes from an installation-
      // level scan and is platform-admin managed (WP8), mirroring the optional
      // `workspace` on catalog-entities. Access is enforced by the factories above.
      required: false,
      index: true,
      admin: { description: 'Security enclave the proposal belongs to (absent = global).' },
    },
    {
      name: 'installation',
      type: 'relationship',
      relationTo: 'github-installations',
      admin: { description: 'GitHub App installation the scan ran under.' },
    },
    {
      name: 'connection',
      type: 'relationship',
      relationTo: 'git-connections',
      admin: {
        description:
          'Non-GitHub git connection the scan ran under (Azure DevOps; mutually exclusive with `installation`).',
      },
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
        // Named collectionSlug (not `collection`) — `collection` is a reserved
        // Mongoose schema pathname and triggers warnings / undefined behavior.
        { name: 'collectionSlug', type: 'text' },
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
