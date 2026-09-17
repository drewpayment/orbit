// FROZEN capability: functional but accepts no new feature work.
// See README.md "Frozen Capabilities" and docs/plans/2026-06-09-product-focus-strategy.md.

import type { CollectionConfig } from 'payload'
import { docWorkspaceMutate, manageCreate, workspaceScopedRead } from '@/lib/authz/payload'
import { encrypt } from '@/lib/encryption'

export const RegistryConfigs: CollectionConfig = {
  slug: 'registry-configs',
  admin: {
    useAsTitle: 'name',
    group: 'Settings',
    defaultColumns: ['name', 'type', 'workspace', 'isDefault', 'updatedAt'],
  },
  access: {
    // The original per-id branch re-checked membership against the loaded
    // doc's workspace, which is equivalent to the list filter Payload applies
    // when evaluating a single-document read against a `Where`.
    read: workspaceScopedRead(),
    create: manageCreate(['owner', 'admin']),
    update: docWorkspaceMutate('registry-configs', ['owner', 'admin']),
    delete: docWorkspaceMutate('registry-configs', ['owner']),
  },
  hooks: {
    beforeChange: [
      async ({ data }) => {
        // Encrypt GHCR PAT if present and not already encrypted
        if (data?.ghcrPat) {
          const isEncrypted =
            data.ghcrPat.includes(':') && data.ghcrPat.split(':').length === 3
          if (!isEncrypted) {
            data.ghcrPat = encrypt(data.ghcrPat)
          }
        }
        // Encrypt ACR token if present and not already encrypted
        if (data?.acrToken) {
          const isEncrypted =
            data.acrToken.includes(':') && data.acrToken.split(':').length === 3
          if (!isEncrypted) {
            data.acrToken = encrypt(data.acrToken)
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
      admin: {
        description: 'Display name (e.g., "Production GHCR", "Dev ACR")',
      },
    },
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      required: true,
      index: true,
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'type',
      type: 'select',
      required: true,
      defaultValue: 'orbit',
      options: [
        { label: 'Orbit Registry', value: 'orbit' },
        { label: 'GitHub Container Registry', value: 'ghcr' },
        { label: 'Azure Container Registry', value: 'acr' },
      ],
      admin: {
        description: 'Registry type (Orbit Registry requires no configuration)',
      },
    },
    {
      name: 'isDefault',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        description: 'Use as default registry for this workspace',
        position: 'sidebar',
      },
    },
    // GHCR-specific fields
    {
      name: 'ghcrOwner',
      type: 'text',
      admin: {
        description: 'GitHub owner/org for GHCR (e.g., "drewpayment")',
        condition: (data) => data?.type === 'ghcr',
      },
    },
    {
      name: 'ghcrPat',
      type: 'text',
      admin: {
        description:
          'GitHub Personal Access Token (classic) with write:packages scope',
        condition: (data) => data?.type === 'ghcr',
      },
      access: {
        read: () => false, // Never expose in API responses
      },
    },
    {
      name: 'ghcrValidatedAt',
      type: 'date',
      admin: {
        readOnly: true,
        condition: (data) => data?.type === 'ghcr',
        description: 'Last successful connection test',
      },
    },
    {
      name: 'ghcrValidationStatus',
      type: 'select',
      options: [
        { label: 'Not tested', value: 'pending' },
        { label: 'Valid', value: 'valid' },
        { label: 'Invalid', value: 'invalid' },
      ],
      defaultValue: 'pending',
      admin: {
        readOnly: true,
        condition: (data) => data?.type === 'ghcr',
      },
    },
    // ACR-specific fields
    {
      name: 'acrLoginServer',
      type: 'text',
      admin: {
        description: 'ACR login server (e.g., "myregistry.azurecr.io")',
        condition: (data) => data?.type === 'acr',
      },
    },
    {
      name: 'acrUsername',
      type: 'text',
      admin: {
        description: 'ACR token name or username',
        condition: (data) => data?.type === 'acr',
      },
    },
    {
      name: 'acrToken',
      type: 'text',
      admin: {
        description: 'ACR repository-scoped token',
        condition: (data) => data?.type === 'acr',
      },
      access: {
        read: () => false, // Never return token in API responses
      },
    },
    {
      name: 'acrValidatedAt',
      type: 'date',
      admin: {
        readOnly: true,
        condition: (data) => data?.type === 'acr',
        description: 'Last successful connection test',
      },
    },
    {
      name: 'acrValidationStatus',
      type: 'select',
      options: [
        { label: 'Not tested', value: 'pending' },
        { label: 'Valid', value: 'valid' },
        { label: 'Invalid', value: 'invalid' },
      ],
      defaultValue: 'pending',
      admin: {
        readOnly: true,
        condition: (data) => data?.type === 'acr',
      },
    },
  ],
  timestamps: true,
}
