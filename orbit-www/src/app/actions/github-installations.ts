'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { getPayloadUserFromSession } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/access/workspace-access'
import { signalGitHubTokenRefresh } from '@/lib/temporal/client'
import {
  listInstallationsAdminCore,
  getInstallationRefreshStateCore,
  type AdminInstallationView,
  type InstallationRefreshState,
} from '@/lib/github/installations-core'

/**
 * Server actions for the Platform Admin "GitHub Installations" page (WP9).
 *
 * Thin session/Temporal glue over `lib/github/installations-core.ts`: enforce
 * platform-admin, then delegate to the tested core. Closes the operational gap
 * behind a real incident — an installation token silently expired for weeks
 * with no UI signal and no way to force a refresh.
 */

async function requirePlatformAdmin() {
  const actor = await getPayloadUserFromSession()
  if (!actor || !isPlatformAdmin(actor)) return null
  return actor
}

export async function listInstallationsAdmin(): Promise<{
  success: boolean
  error?: string
  installations: AdminInstallationView[]
}> {
  const actor = await requirePlatformAdmin()
  if (!actor) return { success: false, error: 'Platform admin required', installations: [] }

  const payload = await getPayload({ config })
  const installations = await listInstallationsAdminCore(payload)
  return { success: true, installations }
}

/**
 * Trigger an immediate token refresh for one installation. Fire-and-forget:
 * signalGitHubTokenRefresh uses signal-with-start, so a dead refresher is
 * restarted and a bare signal to a live one nudges it. Never throws; the client
 * polls getInstallationRefreshState for the expiry flip.
 */
export async function refreshInstallationToken(
  docId: string,
): Promise<{ success: boolean; error?: string }> {
  const actor = await requirePlatformAdmin()
  if (!actor) return { success: false, error: 'Platform admin required' }

  await signalGitHubTokenRefresh(docId)
  return { success: true }
}

export async function getInstallationRefreshState(docId: string): Promise<{
  success: boolean
  error?: string
  state: InstallationRefreshState | null
}> {
  const actor = await requirePlatformAdmin()
  if (!actor) return { success: false, error: 'Platform admin required', state: null }

  const payload = await getPayload({ config })
  try {
    const state = await getInstallationRefreshStateCore(payload, docId)
    return { success: true, state }
  } catch {
    return { success: false, error: 'Installation not found', state: null }
  }
}
