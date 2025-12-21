import type { CollectionConfig } from 'payload'
import { encrypt } from '@/lib/encryption'

export const RegistryConfigs: CollectionConfig = {
  slug: 'registry-configs',
  admin: {
    useAsTitle: 'name',
    group: 'Settings',
    defaultColumns: ['name', 'type', 'workspace', 'isDefault', 'updatedAt'],
  },
  access: {
    read: async ({ req: { user, payload }, id }) => {
      if (!user) return false
      if (!id) {
        // List view - filter by workspace membership
        const workspaceIds = await getWorkspaceIdsForUser(payload, user.id)
        // If user has no workspaces, return empty result (but not 403)
        if (workspaceIds.length === 0) {
          return {
            id: { equals: 'nonexistent-id-to-return-empty-results' },
          }
        }
        return {
          workspace: {
            in: workspaceIds,
          },
        }
      }
      return true
    },
    create: async ({ req: { user, payload }, data }) => {
      if (!user || !data?.workspace) return false

      const workspaceId =
        typeof data.workspace === 'string' ? data.workspace : data.workspace.id

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
    update: async ({ req: { user, payload }, id }) => {
      if (!user || !id) return false

      const config = await payload.findByID({
        collection: 'registry-configs',
        id,
        overrideAccess: true,
      })

      if (!config?.workspace) return false

      const workspaceId =
        typeof config.workspace === 'string'
          ? config.workspace
          : config.workspace.id

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

      const config = await payload.findByID({
        collection: 'registry-configs',
        id,
        overrideAccess: true,
      })

      if (!config?.workspace) return false

      const workspaceId =
        typeof config.workspace === 'string'
          ? config.workspace
          : config.workspace.id

      const members = await payload.find({
        collection: 'workspace-members',
        where: {
          and: [
            { workspace: { equals: workspaceId } },
            { user: { equals: user.id } },
            { role: { equals: 'owner' } },
            { status: { equals: 'active' } },
          ],
        },
        overrideAccess: true,
      })
      return members.docs.length > 0
    },
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
  ],
  timestamps: true,
}

// Helper function to get workspace IDs for a user
async function getWorkspaceIdsForUser(
  payload: any,
  userId: string
): Promise<string[]> {
  const members = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [{ user: { equals: userId } }, { status: { equals: 'active' } }],
    },
    overrideAccess: true,
    limit: 100,
  })

  return members.docs.map((m: any) =>
    typeof m.workspace === 'string' ? m.workspace : m.workspace.id
  )
}
