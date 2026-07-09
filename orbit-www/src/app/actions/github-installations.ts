'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { revalidatePath } from 'next/cache'
import { getPayloadUserFromSession } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/access/workspace-access'
import {
  signalGitHubTokenRefresh,
  cancelGitHubTokenRefreshWorkflow,
  gitHubTokenRefreshWorkflowId,
} from '@/lib/temporal/client'
import {
  listInstallationsAdminCore,
  getInstallationRefreshStateCore,
  countAppsForInstallation,
  deleteInstallationCore,
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

/**
 * How many Apps reference this installation — prefetched when the Remove-
 * connection confirm dialog opens so the admin sees the blast radius before
 * confirming.
 */
export async function getInstallationAppCount(docId: string): Promise<{
  success: boolean
  error?: string
  count: number
}> {
  const actor = await requirePlatformAdmin()
  if (!actor) return { success: false, error: 'Platform admin required', count: 0 }

  const payload = await getPayload({ config })
  try {
    const doc = await payload.findByID({
      collection: 'github-installations',
      id: docId,
      depth: 0,
      overrideAccess: true,
    })
    const count = await countAppsForInstallation(payload, String(doc.installationId ?? ''))
    return { success: true, count }
  } catch {
    return { success: false, error: 'Installation not found', count: 0 }
  }
}

/**
 * Remove a GitHub installation (platform admin): cancel its token refresh
 * workflow and delete the doc. Apps referencing it keep their data but lose
 * GitHub access at the next token use; the app must still be uninstalled on
 * GitHub (the UI links there). Never throws.
 */
export async function deleteInstallationAdmin(docId: string): Promise<{
  success: boolean
  error?: string
  appCount: number
}> {
  const actor = await requirePlatformAdmin()
  if (!actor) return { success: false, error: 'Platform admin required', appCount: 0 }

  const payload = await getPayload({ config })
  const res = await deleteInstallationCore(payload, docId, () =>
    cancelGitHubTokenRefreshWorkflow(gitHubTokenRefreshWorkflowId(docId)),
  )
  if (res.ok) revalidatePath('/settings/github')
  return { success: res.ok, error: res.error, appCount: res.appCount }
}
