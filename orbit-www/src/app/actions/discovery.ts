'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { revalidatePath } from 'next/cache'
import type { DiscoveredEntity } from '@/payload-types'
import { getCurrentUser, getPayloadUserFromSession } from '@/lib/auth/session'
import { getWorkspaceMembership, isPlatformAdmin } from '@/lib/access/workspace-access'
import { getWorkspaceGitHubInstallations } from './github'
import { startCatalogScanWorkflow, describeCatalogScanWorkflow } from '@/lib/temporal/client'
import {
  listDiscoveriesCore,
  listGlobalDiscoveriesCore,
  approveDiscoveriesCore,
  ignoreDiscoveriesCore,
  renameDiscoveryCore,
  startWorkspaceScanCore,
  startInstallationScanCore,
  type DiscoveryFilter,
  type ApproveResult,
  type ApproveOptions,
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

  // Membership gate BEFORE resolving installations, so non-members learn
  // nothing about the workspace's GitHub wiring (the core re-checks too).
  const membership = await getWorkspaceMembership(payload, user.id, workspaceId)
  if (!membership) return { success: false, error: 'Not a member of this workspace', started: [] }

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

export async function approveDiscoveries(
  ids: string[],
  opts: ApproveOptions = {},
): Promise<{
  success: boolean
  error?: string
  results: ApproveResult[]
}> {
  // Resolve the Payload user doc: `betterAuthId` keys RBAC, `id` is the
  // `api-schemas` import actor (createdBy), `role` gates global proposals.
  const actor = await getPayloadUserFromSession()
  if (!actor) return { success: false, error: 'Unauthorized', results: [] }

  const payload = await getPayload({ config })
  const results = await approveDiscoveriesCore(
    payload,
    actor.betterAuthId ?? '',
    String(actor.id),
    isPlatformAdmin(actor),
    ids,
    opts,
  )

  revalidatePath('/catalog')
  revalidatePath('/apps')
  revalidatePath('/discovery')

  return { success: true, results }
}

/**
 * Rename a single proposal before import (Phase 3, inline rename in the review
 * queue — no confirm dialog on approve, so the entity name must be fixable
 * up-front). Same auth-resolution pattern as `approveDiscoveries`: the Payload
 * user id is threaded through for call-shape symmetry even though the core
 * doesn't persist it (there's no "renamed by" field on the proposal).
 */
export async function renameDiscovery(id: string, name: string): Promise<{
  success: boolean
  error?: string
}> {
  const actor = await getPayloadUserFromSession()
  if (!actor) return { success: false, error: 'Unauthorized' }

  const payload = await getPayload({ config })
  const result = await renameDiscoveryCore(
    payload,
    actor.betterAuthId ?? '',
    String(actor.id),
    isPlatformAdmin(actor),
    id,
    name,
  )

  if (!result.ok) return { success: false, error: result.reason }
  return { success: true }
}

export async function ignoreDiscoveries(ids: string[]): Promise<{
  success: boolean
  error?: string
  results: IgnoreResult[]
}> {
  const actor = await getPayloadUserFromSession()
  if (!actor) return { success: false, error: 'Unauthorized', results: [] }

  const payload = await getPayload({ config })
  const results = await ignoreDiscoveriesCore(
    payload,
    actor.betterAuthId ?? '',
    isPlatformAdmin(actor),
    ids,
  )

  return { success: true, results }
}

/**
 * Start a GLOBAL installation scan (WP8) — platform admin only. Empty
 * workspaceId ⇒ workspace-less proposals in the global review queue.
 */
export async function startInstallationScan(installationId: string): Promise<{
  success: boolean
  error?: string
  started: StartedScan | null
}> {
  const actor = await getPayloadUserFromSession()
  if (!actor) return { success: false, error: 'Unauthorized', started: null }
  if (!isPlatformAdmin(actor)) return { success: false, error: 'Platform admin required', started: null }

  try {
    const { started } = await startInstallationScanCore(true, installationId, (input) =>
      startCatalogScanWorkflow(input),
    )
    return { success: true, started }
  } catch (e) {
    return { success: false, error: errMessage(e), started: null }
  }
}

/** Global (workspace-less) proposals for the platform review queue — admin only. */
export async function listGlobalDiscoveries(
  filter: DiscoveryFilter = {},
): Promise<DiscoveredEntity[]> {
  const actor = await getPayloadUserFromSession()
  if (!actor) return []
  const payload = await getPayload({ config })
  return listGlobalDiscoveriesCore(payload, isPlatformAdmin(actor), filter)
}

/** Scan status for a single installation (global page banner) — admin only. */
export async function getInstallationScanStatus(installationId: string): Promise<{
  success: boolean
  error?: string
  status: ScanStatusEntry['status']
  lastRunAt?: string
}> {
  const actor = await getPayloadUserFromSession()
  if (!actor) return { success: false, error: 'Unauthorized', status: 'none' }
  if (!isPlatformAdmin(actor)) return { success: false, error: 'Platform admin required', status: 'none' }

  const res = await describeCatalogScanWorkflow(String(installationId))
  return { success: true, status: res.status, lastRunAt: res.lastRunAt }
}
