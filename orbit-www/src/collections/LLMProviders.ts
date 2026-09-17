import type { CollectionConfig } from 'payload'
import { workspaceScopedRead, manageCreate, docWorkspaceMutate } from '@/lib/authz/payload'

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
    read: workspaceScopedRead(),
    // A null workspace means global/platform-level provider config —
    // restricted to platform admins (the adapter's admin bypass runs before
    // workspace resolution, so a missing workspace only denies non-admins).
    create: manageCreate(['owner', 'admin']),
    update: docWorkspaceMutate('llm-providers', ['owner', 'admin']),
    delete: docWorkspaceMutate('llm-providers', ['owner']),
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
