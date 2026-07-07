'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { revalidatePath } from 'next/cache'
import type { DiscoveredEntity } from '@/payload-types'
import { getCurrentUser, getPayloadUserFromSession } from '@/lib/auth/session'
import { getWorkspaceMembership } from '@/lib/access/workspace-access'
import { getWorkspaceGitHubInstallations } from './github'
import { startCatalogScanWorkflow, describeCatalogScanWorkflow } from '@/lib/temporal/client'
import {
  listDiscoveriesCore,
  approveDiscoveriesCore,
  ignoreDiscoveriesCore,
  startWorkspaceScanCore,
  type DiscoveryFilter,
  type ApproveResult,
  type IgnoreResult,
  type StartedScan,
} from '@/lib/discovery/actions-core'

/**
 * Server actions for Catalog Discovery (Phase 1,
 * docs/plans/2026-07-06-catalog-discovery.md).
 *
 * Thin session/Temporal glue over `lib/discovery/actions-core.ts`: resolve the
 * Better-Auth id (RBAC key) and — for approve — the Payload `users` id (the
 * `api-schemas` import actor), then delegate. All membership/dispatch logic and
 * its tests live in the core; these wrappers only surface a `{ success }` shape
 * to the client and revalidate the affected pages.
 */

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong'
}

export async function startWorkspaceScan(workspaceId: string): Promise<{
  success: boolean
  error?: string
  started: StartedScan[]
}> {
  const user = await getCurrentUser()
  if (!user) return { success: false, error: 'Unauthorized', started: [] }

  const payload = await getPayload({ config })

  const installations = await getWorkspaceGitHubInstallations(workspaceId)
  if (!installations.success) {
    return { success: false, error: installations.error ?? 'Failed to resolve installations', started: [] }
  }
  if (installations.installations.length === 0) {
    return {
      success: false,
      error: 'No active GitHub installation is connected to this workspace.',
      started: [],
    }
  }

  try {
    const { started } = await startWorkspaceScanCore(
      payload,
      user.id,
      workspaceId,
      installations.installations,
      (input) => startCatalogScanWorkflow(input),
    )
    return { success: true, started }
  } catch (e) {
    return { success: false, error: errMessage(e), started: [] }
  }
}

export interface ScanStatusEntry {
  installationId: string
  accountLogin: string
  status: 'running' | 'completed' | 'failed' | 'none'
  lastRunAt?: string
}

export async function getScanStatus(workspaceId: string): Promise<{
  success: boolean
  error?: string
  statuses: ScanStatusEntry[]
}> {
  const user = await getCurrentUser()
  if (!user) return { success: false, error: 'Unauthorized', statuses: [] }

  const payload = await getPayload({ config })
  const membership = await getWorkspaceMembership(payload, user.id, workspaceId)
  if (!membership) return { success: false, error: 'Not a member of this workspace', statuses: [] }

  const installations = await getWorkspaceGitHubInstallations(workspaceId)
  if (!installations.success) {
    return { success: false, error: installations.error ?? 'Failed to resolve installations', statuses: [] }
  }

  const statuses = await Promise.all(
    installations.installations.map(async (inst): Promise<ScanStatusEntry> => {
      const installationId = String(inst.installationId)
      const status = await describeCatalogScanWorkflow(installationId)
      return { installationId, accountLogin: inst.accountLogin, ...status }
    }),
  )

  return { success: true, statuses }
}

export async function listDiscoveries(
  workspaceId: string,
  filter: DiscoveryFilter = {},
): Promise<DiscoveredEntity[]> {
  const user = await getCurrentUser()
  if (!user) return []
  const payload = await getPayload({ config })
  return listDiscoveriesCore(payload, user.id, workspaceId, filter)
}

export async function approveDiscoveries(ids: string[]): Promise<{
  success: boolean
  error?: string
  results: ApproveResult[]
}> {
  const user = await getCurrentUser()
  if (!user) return { success: false, error: 'Unauthorized', results: [] }

  // Approving an API proposal creates an `api-schemas` row whose required
  // `createdBy` is a Payload `users` id — resolve the acting member's Payload
  // doc (not the Better-Auth id) for the import actor.
  const actor = await getPayloadUserFromSession()
  if (!actor) return { success: false, error: 'Unauthorized', results: [] }

  const payload = await getPayload({ config })
  const results = await approveDiscoveriesCore(payload, user.id, String(actor.id), ids)

  revalidatePath('/catalog')
  revalidatePath('/apps')

  return { success: true, results }
}

export async function ignoreDiscoveries(ids: string[]): Promise<{
  success: boolean
  error?: string
  results: IgnoreResult[]
}> {
  const user = await getCurrentUser()
  if (!user) return { success: false, error: 'Unauthorized', results: [] }

  const payload = await getPayload({ config })
  const results = await ignoreDiscoveriesCore(payload, user.id, ids)

  return { success: true, results }
}
