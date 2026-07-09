'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { revalidatePath } from 'next/cache'
import { getPayloadUserFromSession } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/access/workspace-access'
import { startCatalogScanWorkflow, describeCatalogScanWorkflow } from '@/lib/temporal/client'
import {
  listConnectionsAdminCore,
  createConnectionCore,
  updateConnectionCore,
  deleteConnectionCore,
  validateConnectionCore,
  type AdminConnectionView,
  type CreateConnectionInput,
  type UpdateConnectionInput,
  type ValidateConnectionResult,
} from '@/lib/connections/connections-core'

/**
 * Server actions for the Platform Admin "Connections" page (WP11).
 *
 * Thin session/Temporal glue over `lib/connections/connections-core.ts`:
 * enforce platform-admin, then delegate to the tested core. The PAT is NEVER
 * returned to the client — `listConnectionsAdmin` projects a PAT-less view, and
 * only the internal token route exposes the decrypted secret to the Go worker.
 */

async function requirePlatformAdmin() {
  const actor = await getPayloadUserFromSession()
  if (!actor || !isPlatformAdmin(actor)) return null
  return actor
}

export async function listConnectionsAdmin(): Promise<{
  success: boolean
  error?: string
  connections: AdminConnectionView[]
}> {
  const actor = await requirePlatformAdmin()
  if (!actor) return { success: false, error: 'Platform admin required', connections: [] }

  const payload = await getPayload({ config })
  const connections = await listConnectionsAdminCore(payload)
  return { success: true, connections }
}

export async function createConnection(
  input: CreateConnectionInput,
): Promise<{ success: boolean; error?: string; id?: string }> {
  const actor = await requirePlatformAdmin()
  if (!actor) return { success: false, error: 'Platform admin required' }

  const payload = await getPayload({ config })
  const res = await createConnectionCore(payload, input)
  if (res.ok) revalidatePath('/settings/connections')
  return { success: res.ok, error: res.error, id: res.id }
}

export async function updateConnection(
  input: UpdateConnectionInput,
): Promise<{ success: boolean; error?: string }> {
  const actor = await requirePlatformAdmin()
  if (!actor) return { success: false, error: 'Platform admin required' }

  const payload = await getPayload({ config })
  const res = await updateConnectionCore(payload, input)
  if (res.ok) revalidatePath('/settings/connections')
  return { success: res.ok, error: res.error }
}

export async function deleteConnection(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  const actor = await requirePlatformAdmin()
  if (!actor) return { success: false, error: 'Platform admin required' }

  const payload = await getPayload({ config })
  const res = await deleteConnectionCore(payload, id)
  if (res.ok) revalidatePath('/settings/connections')
  return { success: res.ok, error: res.error }
}

/**
 * Validate a connection's PAT against the provider (Azure DevOps
 * `_apis/projects`). Persists status/lastValidatedAt/lastError and returns the
 * outcome for inline display.
 */
export async function validateConnection(
  id: string,
): Promise<{ success: boolean; error?: string; result: ValidateConnectionResult | null }> {
  const actor = await requirePlatformAdmin()
  if (!actor) return { success: false, error: 'Platform admin required', result: null }

  const payload = await getPayload({ config })
  const result = await validateConnectionCore(payload, id, {
    fetchFn: (url, init) => fetch(url, init),
  })
  revalidatePath('/settings/connections')
  return { success: result.ok, error: result.ok ? undefined : result.error, result }
}

/**
 * Start an Azure DevOps catalog scan for a connection (WP11). Platform admin
 * only. The connection doc id is both the ConnectionID and the InstallationID
 * (feeds the ingest dedupeKey), and the workflow id is
 * `catalog-scan-ado-<connectionId>`.
 */
export async function startConnectionScan(
  connectionId: string,
): Promise<{ success: boolean; error?: string; workflowId?: string }> {
  const actor = await requirePlatformAdmin()
  if (!actor) return { success: false, error: 'Platform admin required' }
  if (!connectionId) return { success: false, error: 'Connection id is required' }

  const workflowId = await startCatalogScanWorkflow({
    installationId: connectionId,
    workspaceId: '',
    provider: 'azure-devops',
    connectionId,
  })
  if (!workflowId) return { success: false, error: 'Failed to start scan' }

  revalidatePath('/discovery')
  return { success: true, workflowId }
}

/** Best-effort ADO scan status for the discovery picker banner — admin only. */
export async function getConnectionScanStatus(connectionId: string): Promise<{
  success: boolean
  error?: string
  status: 'running' | 'completed' | 'failed' | 'none'
  lastRunAt?: string
}> {
  const actor = await requirePlatformAdmin()
  if (!actor) return { success: false, error: 'Platform admin required', status: 'none' }

  const res = await describeCatalogScanWorkflow(connectionId, { provider: 'azure-devops' })
  return { success: true, status: res.status, lastRunAt: res.lastRunAt }
}
