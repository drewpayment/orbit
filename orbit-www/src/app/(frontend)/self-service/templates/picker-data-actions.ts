'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { getCurrentUser } from '@/lib/auth/session'
import type { EntityKind } from '@/collections/catalog/constants'
import {
  getEntitiesForWorkspace,
  getReposForConnection,
  getSkeletonsForWorkspace,
  getTeamsForWorkspace,
  type PickerOption,
  type SkeletonPickerOption,
} from './picker-data'

/**
 * `'use server'` entry points the `SchemaForm` Orbit pickers call. Thin
 * wrappers: resolve the caller's session + a real Payload client, then
 * delegate to the pure, RBAC-scoped functions in `picker-data.ts` (unit
 * tested there without a real Payload instance).
 */

export async function listTeamsForPicker(workspaceId: string): Promise<PickerOption[]> {
  const user = await getCurrentUser()
  if (!user) return []
  const payload = await getPayload({ config })
  return getTeamsForWorkspace(payload, user.id, workspaceId)
}

export async function listEntitiesForPicker(
  workspaceId: string,
  kind: EntityKind | string,
): Promise<PickerOption[]> {
  const user = await getCurrentUser()
  if (!user) return []
  const payload = await getPayload({ config })
  return getEntitiesForWorkspace(payload, user.id, workspaceId, kind)
}

export async function listReposForPicker(
  workspaceId: string,
  connectionId: string,
): Promise<PickerOption[]> {
  const user = await getCurrentUser()
  if (!user) return []
  const payload = await getPayload({ config })
  return getReposForConnection(payload, user.id, workspaceId, connectionId)
}

export async function listSkeletonsForPicker(workspaceId: string): Promise<SkeletonPickerOption[]> {
  const user = await getCurrentUser()
  if (!user) return []
  const payload = await getPayload({ config })
  return getSkeletonsForWorkspace(payload, user.id, workspaceId)
}

export type { PickerOption, SkeletonPickerOption }
