import type { CollectionConfig } from 'payload'

/**
 * LLMProviders Collection
 *
 * Per-workspace bring-your-own LLM credentials used by the Infrastructure
 * Agent (see InfrastructureAgentWorkflow). The agent's LLMNextStep activity
 * loads a provider record by id, decrypts the apiKey, and constructs a
 * runtime Provider via the plugin registry (anthropic | openai_compat).
 *
 * Mirrors the encrypted-secret pattern from PluginConfig: the `apiKey` field
 * uses the EncryptedField admin component so the value is encrypted at rest
 * and never exposed in raw form to non-privileged callers.
 */
export const LLMProviders: CollectionConfig = {
  slug: 'llm-providers',
  admin: {
    useAsTitle: 'displayName',
    defaultColumns: ['workspace', 'provider', 'model', 'isDefault', 'updatedAt'],
    description: 'Workspace-scoped LLM credentials for the Infrastructure Agent',
    group: 'Agent',
  },
  access: {
    read: async ({ req: { user, payload } }) => {
      if (!user) return false
      const members = await payload.find({
        collection: 'workspace-members',
        where: {
          and: [{ user: { equals: user.id } }, { status: { equals: 'active' } }],
        },
        limit: 100,
      })
      const workspaceIds = members.docs.map((m) =>
        typeof m.workspace === 'string' ? m.workspace : m.workspace.id,
      )
      return { workspace: { in: workspaceIds } }
    },
    create: async ({ req: { user, payload }, data }) => {
      if (!user) return false
      if (!data?.workspace) return true
      const members = await payload.find({
        collection: 'workspace-members',
        where: {
          and: [
            { workspace: { equals: data.workspace } },
            { user: { equals: user.id } },
            { role: { in: ['owner', 'admin'] } },
            { status: { equals: 'active' } },
          ],
        },
      })
      return members.docs.length > 0
    },
    update: async ({ req: { user, payload }, id }) => {
      if (!user || !id) return false
      try {
        const doc = await payload.findByID({
          collection: 'llm-providers',
          id: id as string,
        })
        const members = await payload.find({
          collection: 'workspace-members',
          where: {
            and: [
              { workspace: { equals: doc.workspace } },
              { user: { equals: user.id } },
              { role: { in: ['owner', 'admin'] } },
              { status: { equals: 'active' } },
            ],
          },
        })
        return members.docs.length > 0
      } catch {
        return false
      }
    },
    delete: async ({ req: { user, payload }, id }) => {
      if (!user || !id) return false
      try {
        const doc = await payload.findByID({
          collection: 'llm-providers',
          id: id as string,
        })
        const members = await payload.find({
          collection: 'workspace-members',
          where: {
            and: [
              { workspace: { equals: doc.workspace } },
              { user: { equals: user.id } },
              { role: { equals: 'owner' } },
              { status: { equals: 'active' } },
            ],
          },
        })
        return members.docs.length > 0
      } catch {
        return false
      }
    },
  },
  fields: [
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      required: true,
      label: 'Workspace',
    },
    {
      name: 'displayName',
      type: 'text',
      required: true,
      label: 'Display Name',
      admin: {
        description: 'Friendly name shown in the agent run UI (e.g. "Anthropic prod key")',
      },
    },
    {
      name: 'provider',
      type: 'select',
      required: true,
      label: 'Provider',
      options: [
        { label: 'Anthropic', value: 'anthropic' },
        { label: 'OpenAI-compatible (OpenAI, LM Studio, Ollama, vLLM, …)', value: 'openai_compat' },
      ],
      admin: {
        description: 'Which Provider plugin handles requests for this credential',
      },
    },
    {
      name: 'baseUrl',
      type: 'text',
      label: 'Base URL',
      admin: {
        description:
          'Optional. Defaults: anthropic=https://api.anthropic.com, openai_compat=https://api.openai.com. Override for self-hosted backends (LM Studio: http://host.docker.internal:1234, Ollama: http://host.docker.internal:11434).',
      },
    },
    {
      name: 'model',
      type: 'text',
      required: true,
      label: 'Model',
      admin: {
        description: 'Model identifier (e.g. claude-opus-4-7, gpt-4o, llama3-70b)',
      },
    },
    {
      name: 'apiKey',
      type: 'text',
      label: 'API Key',
      admin: {
        description: 'Encrypted at rest. Leave blank for self-hosted backends that don\'t require a key.',
        components: {
          Field: {
            path: '/components/admin/fields/EncryptedField',
            exportName: 'EncryptedField',
          },
        },
      },
    },
    {
      name: 'isDefault',
      type: 'checkbox',
      label: 'Default for workspace',
      defaultValue: false,
      admin: {
        description: 'When true, agent runs in this workspace use this provider unless explicitly overridden',
      },
    },
    {
      name: 'createdBy',
      type: 'relationship',
      relationTo: 'users',
      label: 'Created By',
      admin: { readOnly: true },
    },
    {
      name: 'lastModifiedBy',
      type: 'relationship',
      relationTo: 'users',
      label: 'Last Modified By',
      admin: { readOnly: true },
    },
  ],
  indexes: [
    { fields: ['workspace', 'displayName'], unique: true },
  ],
  hooks: {
    beforeChange: [
      async ({ data, req, operation }) => {
        if (operation === 'create') {
          data.createdBy = req.user?.id
        }
        data.lastModifiedBy = req.user?.id
        return data
      },
    ],
    afterChange: [
      async ({ doc, req, operation }) => {
        // When marking as default, clear isDefault on siblings.
        if (doc.isDefault && (operation === 'create' || operation === 'update')) {
          await req.payload.update({
            collection: 'llm-providers',
            where: {
              and: [
                { workspace: { equals: doc.workspace } },
                { id: { not_equals: doc.id } },
                { isDefault: { equals: true } },
              ],
            },
            data: { isDefault: false },
          })
        }
      },
    ],
  },
  timestamps: true,
}
