'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { getActor } from '@/lib/authz'
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
  const actor = await getActor()
  if (!actor) return []
  const payload = await getPayload({ config })
  return getTeamsForWorkspace(payload, actor.betterAuthId, workspaceId)
}

export async function listEntitiesForPicker(
  workspaceId: string,
  kind: EntityKind | string,
): Promise<PickerOption[]> {
  const actor = await getActor()
  if (!actor) return []
  const payload = await getPayload({ config })
  return getEntitiesForWorkspace(payload, actor.betterAuthId, workspaceId, kind)
}

export async function listReposForPicker(
  workspaceId: string,
  connectionId: string,
): Promise<PickerOption[]> {
  const actor = await getActor()
  if (!actor) return []
  const payload = await getPayload({ config })
  return getReposForConnection(payload, actor.betterAuthId, workspaceId, connectionId)
}

export async function listSkeletonsForPicker(workspaceId: string): Promise<SkeletonPickerOption[]> {
  const actor = await getActor()
  if (!actor) return []
  const payload = await getPayload({ config })
  return getSkeletonsForWorkspace(payload, actor.betterAuthId, workspaceId)
}

export type { PickerOption, SkeletonPickerOption }
