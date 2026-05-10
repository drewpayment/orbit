'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { revalidatePath } from 'next/cache'

import { getPayloadUserFromSession } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/access/workspace-access'
import type { LlmProvider } from '@/payload-types'

// Server actions for the platform-admin LLM Providers page. All mutations
// re-check isPlatformAdmin server-side so a stale client view can't slip
// past the page-level gate, then use overrideAccess: true so the admin
// user (whose role lives outside the workspace-members collection that
// LLMProviders.access reads from) can act across workspaces.

interface CreateInput {
  workspaceId: string
  displayName: string
  provider: 'anthropic' | 'openai_compat'
  baseUrl?: string
  model: string
  apiKey?: string
  isDefault?: boolean
}

export async function createLLMProvider(input: CreateInput) {
  const user = await getPayloadUserFromSession()
  if (!user || !isPlatformAdmin(user)) {
    return { success: false as const, error: 'Forbidden' }
  }

  if (!input.workspaceId || !input.displayName || !input.provider || !input.model) {
    return { success: false as const, error: 'workspaceId, displayName, provider, and model are required' }
  }

  const payload = await getPayload({ config })

  try {
    const created = await payload.create({
      collection: 'llm-providers',
      data: {
        workspace: input.workspaceId,
        displayName: input.displayName,
        provider: input.provider,
        baseUrl: input.baseUrl ?? '',
        model: input.model,
        apiKey: input.apiKey ?? '',
        isDefault: Boolean(input.isDefault),
        createdBy: user.id,
        lastModifiedBy: user.id,
      },
      overrideAccess: true,
    })
    revalidatePath('/platform/llm-providers')
    return { success: true as const, id: created.id }
  } catch (err) {
    return { success: false as const, error: (err as Error).message }
  }
}

export async function deleteLLMProvider(id: string) {
  const user = await getPayloadUserFromSession()
  if (!user || !isPlatformAdmin(user)) {
    return { success: false as const, error: 'Forbidden' }
  }
  if (!id) {
    return { success: false as const, error: 'id required' }
  }
  const payload = await getPayload({ config })
  try {
    await payload.delete({
      collection: 'llm-providers',
      id,
      overrideAccess: true,
    })
    revalidatePath('/platform/llm-providers')
    return { success: true as const }
  } catch (err) {
    return { success: false as const, error: (err as Error).message }
  }
}

interface UpdateInput {
  id: string
  displayName?: string
  provider?: 'anthropic' | 'openai_compat'
  baseUrl?: string
  model?: string
  apiKey?: string
  isDefault?: boolean
}

export async function updateLLMProvider(input: UpdateInput) {
  const user = await getPayloadUserFromSession()
  if (!user || !isPlatformAdmin(user)) {
    return { success: false as const, error: 'Forbidden' }
  }
  if (!input.id) {
    return { success: false as const, error: 'id required' }
  }
  const payload = await getPayload({ config })

  const data: Partial<LlmProvider> = { lastModifiedBy: user.id }
  if (input.displayName !== undefined) data.displayName = input.displayName
  if (input.provider !== undefined) data.provider = input.provider
  if (input.baseUrl !== undefined) data.baseUrl = input.baseUrl
  if (input.model !== undefined) data.model = input.model
  // Only overwrite apiKey when an explicit non-empty value is provided so
  // operators can edit the row without re-entering the secret.
  if (input.apiKey !== undefined && input.apiKey !== '') data.apiKey = input.apiKey
  if (input.isDefault !== undefined) data.isDefault = input.isDefault

  try {
    await payload.update({
      collection: 'llm-providers',
      id: input.id,
      data,
      overrideAccess: true,
    })
    revalidatePath('/platform/llm-providers')
    return { success: true as const }
  } catch (err) {
    return { success: false as const, error: (err as Error).message }
  }
}
