'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { revalidatePath } from 'next/cache'
import { getCurrentUser, getPayloadUserFromSession } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/access/workspace-access'
import { canManageTemplateDefinitions, canRunTemplateDefinition } from '@/lib/templates/authz'
import type { TemplateSkeleton } from '@/payload-types'

/**
 * Server actions backing the skeleton authoring UI (Template Authoring
 * Phase 3, Task 3 — `docs/plans/2026-09-10-template-authoring-phase-3-greenfield-content.md`
 * §3.4). Mirrors `../authoring-actions.ts`'s conventions: resolve the
 * session user, gate through `lib/templates/authz.ts` BEFORE every read and
 * write, then use `overrideAccess: true` — the gate here IS the source of
 * truth, matching the doc comment on that module.
 *
 * RBAC (plan §2.1, lead decision §7.2): edit (create/save/delete) requires
 * workspace owner/admin, matching template definitions. Read (list/get)
 * requires any active member. Reused from `lib/templates/authz.ts` rather
 * than forking a parallel authz module, per the task brief.
 *
 * Every mutation surfaces server-side errors (including the collection's
 * `beforeValidate` bundle-validation hook) as `{ ok: false, errors }` —
 * never a raw thrown Payload error to the client — while an RBAC failure or
 * unauthenticated session still throws, matching `authoring-actions.ts`'s
 * own split between "expected, recoverable" and "should never happen from
 * a well-behaved client" failures.
 */

type PayloadClient = Awaited<ReturnType<typeof getPayload>>

/** Extract a relationship id whether it arrived as a string or a populated doc. */
function relId(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value === 'object' && 'id' in (value as Record<string, unknown>)) {
    return String((value as { id: unknown }).id)
  }
  return null
}

/** Resolve + assert the session user; throws when unauthenticated. */
async function requireUserId(): Promise<string> {
  const uid = (await getCurrentUser())?.id
  if (!uid) throw new Error('Not authenticated')
  return uid
}

/** Whether the current session belongs to a platform admin (super_admin/admin). */
async function currentUserIsPlatformAdmin(): Promise<boolean> {
  return isPlatformAdmin(await getPayloadUserFromSession())
}

/**
 * Turns a thrown error (typically a Payload `ValidationError` from the
 * collection's `beforeValidate` hook) into a flat list of human-readable
 * messages, never letting the raw error escape to the caller.
 */
function extractPayloadErrors(err: unknown): string[] {
  if (err && typeof err === 'object' && 'data' in err) {
    const data = (err as { data?: { errors?: { path?: string; message?: string }[] } }).data
    if (Array.isArray(data?.errors) && data.errors.length > 0) {
      return data.errors.map((e) => {
        const message = e.message ?? 'Invalid value.'
        return e.path ? `${e.path}: ${message}` : message
      })
    }
  }
  if (err instanceof Error) return [err.message]
  return ['An unexpected error occurred.']
}

async function loadSkeletonOrNull(payload: PayloadClient, id: string): Promise<TemplateSkeleton | null> {
  try {
    return await payload.findByID({
      collection: 'template-skeletons',
      id,
      depth: 0,
      overrideAccess: true,
    })
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkeletonListItem {
  id: string
  name: string
  slug: string
  description: string | null
  fileCount: number
  totalSize: number
  version: number
  updatedAt: string
}

export interface SkeletonFileIO {
  path: string
  content: string
}

export interface SkeletonDetail {
  id: string
  workspaceId: string
  name: string
  slug: string
  description: string
  files: SkeletonFileIO[]
  version: number
  totalSize: number
}

export interface CreateSkeletonInput {
  workspaceId: string
  name: string
  slug: string
  description?: string
  files: SkeletonFileIO[]
}

export interface SaveSkeletonInput {
  name: string
  slug: string
  description?: string
  files: SkeletonFileIO[]
}

export type SkeletonActionResult<T> = { ok: true; data: T } | { ok: false; errors: string[] }

const SLUG_PATTERN = /^[a-z0-9-]+$/

function validateNameAndSlug(name: string, slug: string): string[] {
  const errors: string[] = []
  if (!name.trim()) errors.push('A name is required.')
  if (!slug.trim() || !SLUG_PATTERN.test(slug.trim())) {
    errors.push('Slug must contain only lowercase letters, numbers, and hyphens.')
  }
  return errors
}

// ---------------------------------------------------------------------------
// listSkeletons / getSkeleton
// ---------------------------------------------------------------------------

/** Lists skeletons in a workspace. Read-gated: any active member. Returns [] rather than throwing when unauthorized. */
export async function listSkeletons(workspaceId: string): Promise<SkeletonListItem[]> {
  const payload = await getPayload({ config })
  const uid = (await getCurrentUser())?.id
  if (!uid || !workspaceId) return []
  const isAdmin = await currentUserIsPlatformAdmin()

  if (!(await canRunTemplateDefinition(payload, uid, workspaceId, isAdmin))) return []

  const result = await payload.find({
    collection: 'template-skeletons',
    where: { workspace: { equals: workspaceId } },
    sort: '-updatedAt',
    limit: 200,
    depth: 0,
    overrideAccess: true,
  })

  return result.docs.map((d) => ({
    id: d.id,
    name: d.name,
    slug: d.slug,
    description: d.description ?? null,
    fileCount: Array.isArray(d.files) ? d.files.length : 0,
    totalSize: d.totalSize ?? 0,
    version: d.version ?? 1,
    updatedAt: d.updatedAt,
  }))
}

/** Loads a single skeleton with full file contents. Read-gated: any active member. Returns null (never throws) for missing/unauthorized. */
export async function getSkeleton(id: string): Promise<SkeletonDetail | null> {
  const payload = await getPayload({ config })
  const uid = (await getCurrentUser())?.id
  if (!uid) return null
  const isAdmin = await currentUserIsPlatformAdmin()

  const doc = await loadSkeletonOrNull(payload, id)
  if (!doc) return null

  const workspaceId = relId(doc.workspace)
  if (!workspaceId || !(await canRunTemplateDefinition(payload, uid, workspaceId, isAdmin))) return null

  return {
    id: doc.id,
    workspaceId,
    name: doc.name,
    slug: doc.slug,
    description: doc.description ?? '',
    files: (doc.files ?? []).map((f) => ({ path: f.path, content: f.content ?? '' })),
    version: doc.version ?? 1,
    totalSize: doc.totalSize ?? 0,
  }
}

// ---------------------------------------------------------------------------
// createSkeleton / saveSkeleton / deleteSkeleton
// ---------------------------------------------------------------------------

/** Creates a skeleton. Manage-gated: workspace owner/admin. */
export async function createSkeleton(
  input: CreateSkeletonInput,
): Promise<SkeletonActionResult<{ id: string }>> {
  const payload = await getPayload({ config })
  const uid = await requireUserId()
  const isAdmin = await currentUserIsPlatformAdmin()

  if (!(await canManageTemplateDefinitions(payload, uid, input.workspaceId, isAdmin))) {
    return { ok: false, errors: ['You do not have permission to author skeletons in this workspace.'] }
  }

  const name = input.name?.trim() ?? ''
  const slug = input.slug?.trim() ?? ''
  const fieldErrors = validateNameAndSlug(name, slug)
  if (fieldErrors.length > 0) return { ok: false, errors: fieldErrors }

  try {
    const created = await payload.create({
      collection: 'template-skeletons',
      data: {
        workspace: input.workspaceId,
        name,
        slug,
        description: input.description?.trim() || undefined,
        files: input.files,
        createdBy: uid,
      },
      overrideAccess: true,
    })
    revalidatePath('/self-service/templates/skeletons')
    return { ok: true, data: { id: created.id } }
  } catch (err) {
    return { ok: false, errors: extractPayloadErrors(err) }
  }
}

/** Saves an existing skeleton's fields + file bundle. Manage-gated: workspace owner/admin (checked against the doc's OWN workspace). */
export async function saveSkeleton(
  id: string,
  input: SaveSkeletonInput,
): Promise<SkeletonActionResult<{ id: string }>> {
  const payload = await getPayload({ config })
  const uid = await requireUserId()
  const isAdmin = await currentUserIsPlatformAdmin()

  const existing = await loadSkeletonOrNull(payload, id)
  if (!existing) return { ok: false, errors: ['Skeleton not found.'] }

  const workspaceId = relId(existing.workspace)
  if (!workspaceId || !(await canManageTemplateDefinitions(payload, uid, workspaceId, isAdmin))) {
    return { ok: false, errors: ['You do not have permission to edit this skeleton.'] }
  }

  const name = input.name?.trim() ?? ''
  const slug = input.slug?.trim() ?? ''
  const fieldErrors = validateNameAndSlug(name, slug)
  if (fieldErrors.length > 0) return { ok: false, errors: fieldErrors }

  try {
    const updated = await payload.update({
      collection: 'template-skeletons',
      id,
      data: {
        name,
        slug,
        description: input.description?.trim() || undefined,
        files: input.files,
      },
      overrideAccess: true,
    })
    revalidatePath(`/self-service/templates/skeletons/${id}/edit`)
    revalidatePath('/self-service/templates/skeletons')
    return { ok: true, data: { id: updated.id } }
  } catch (err) {
    return { ok: false, errors: extractPayloadErrors(err) }
  }
}

/** Deletes a skeleton. Manage-gated: workspace owner/admin (checked against the doc's OWN workspace). */
export async function deleteSkeleton(id: string): Promise<SkeletonActionResult<{ id: string }>> {
  const payload = await getPayload({ config })
  const uid = await requireUserId()
  const isAdmin = await currentUserIsPlatformAdmin()

  const existing = await loadSkeletonOrNull(payload, id)
  if (!existing) return { ok: false, errors: ['Skeleton not found.'] }

  const workspaceId = relId(existing.workspace)
  if (!workspaceId || !(await canManageTemplateDefinitions(payload, uid, workspaceId, isAdmin))) {
    return { ok: false, errors: ['You do not have permission to delete this skeleton.'] }
  }

  try {
    await payload.delete({ collection: 'template-skeletons', id, overrideAccess: true })
    revalidatePath('/self-service/templates/skeletons')
    return { ok: true, data: { id } }
  } catch (err) {
    return { ok: false, errors: extractPayloadErrors(err) }
  }
}
