import type { CollectionConfig } from 'payload'
import { encrypt } from '@/lib/encryption'
import { adminOnly } from '@/lib/access/collection-access'

/**
 * GitConnections — non-GitHub git provider connections for catalog discovery
 * (Catalog Discovery Phase 1.6, docs/plans/2026-07-06-catalog-discovery.md,
 * WP11). GitHub keeps its own `github-installations` collection (GitHub App,
 * installation tokens, Temporal-managed refresh); this collection covers the
 * PAT-authenticated providers, starting with Azure DevOps.
 *
 * The `credentials.pat` is encrypted at rest with AES-256-GCM via
 * `lib/encryption` (the same envelope as `github-installations.installationToken`
 * and `registry-configs.ghcrPat`) in the beforeChange hook below. It is
 * `hidden` from the admin UI and MUST never cross the server/client boundary:
 * the admin server actions project a PAT-less view, and only the internal
 * `POST /api/internal/git-connections/token` route (X-API-Key, Go worker only)
 * decrypts and returns it.
 *
 * Access is platform-admin only for every operation — workspace exposure via
 * `allowedWorkspaces` comes in a later phase; today the field only records which
 * workspaces a scan may attribute entities to.
 */
export const GitConnections: CollectionConfig = {
  slug: 'git-connections',

  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'provider', 'organization', 'status', 'lastValidatedAt'],
    group: 'Integrations',
    description: 'Non-GitHub git provider connections (Azure DevOps) for catalog discovery.',
  },

  access: {
    // Platform admin only for all operations. Internal writeback paths (server
    // actions, the token route, validate) run with overrideAccess: true.
    read: adminOnly,
    create: adminOnly,
    update: adminOnly,
    delete: adminOnly,
  },

  hooks: {
    beforeChange: [
      ({ data }) => {
        // Encrypt the PAT if present and not already encrypted (encrypted values
        // have the iv:authTag:ciphertext shape). An absent credentials.pat on
        // update means "keep the stored value" — the action omits it entirely.
        const pat = data?.credentials?.pat
        if (typeof pat === 'string' && pat.length > 0) {
          const isEncrypted = pat.includes(':') && pat.split(':').length === 3
          if (!isEncrypted) {
            data.credentials.pat = encrypt(pat)
          }
        }
        return data
      },
    ],
  },

  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      admin: { description: 'Display name (e.g., "Acme Azure DevOps").' },
    },
    {
      name: 'provider',
      type: 'select',
      required: true,
      defaultValue: 'azure-devops',
      // Fail-closed registry: one provider today, more added deliberately.
      options: [{ label: 'Azure DevOps', value: 'azure-devops' }],
      admin: { description: 'Git provider. Azure DevOps only for now.' },
    },
    {
      name: 'organization',
      type: 'text',
      required: true,
      admin: { description: 'Provider organization (e.g., the ADO org name).' },
    },
    {
      name: 'project',
      type: 'text',
      admin: { description: 'Optional project filter. Empty = all projects in the org.' },
    },
    {
      name: 'baseUrl',
      type: 'text',
      defaultValue: 'https://dev.azure.com',
      admin: {
        description: 'API base URL. Override for Azure DevOps Server (on-prem).',
      },
    },
    {
      name: 'credentials',
      type: 'group',
      admin: { description: 'Encrypted provider credentials.' },
      fields: [
        {
          name: 'pat',
          type: 'text',
          admin: {
            description: 'Personal access token (AES-256-GCM encrypted at rest).',
            hidden: true, // Never show in the admin UI.
            readOnly: true,
          },
        },
      ],
    },
    {
      name: 'allowedWorkspaces',
      type: 'relationship',
      relationTo: 'workspaces',
      hasMany: true,
      admin: {
        description: 'Workspaces a scan of this connection may attribute entities to.',
        position: 'sidebar',
      },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'active',
      options: [
        { label: 'Active', value: 'active' },
        { label: 'Error', value: 'error' },
      ],
      admin: {
        description: 'Connection health. "error" is set when validation fails.',
        position: 'sidebar',
      },
    },
    {
      name: 'lastValidatedAt',
      type: 'date',
      admin: {
        description: 'When the PAT was last successfully validated against the provider.',
        readOnly: true,
        position: 'sidebar',
      },
    },
    {
      name: 'lastError',
      type: 'text',
      admin: {
        description: 'Most recent validation failure reason.',
        readOnly: true,
        position: 'sidebar',
      },
    },
  ],

  timestamps: true,
}
