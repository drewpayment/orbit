'use server'

/**
 * Consumer-run-only server actions for `/self-service/templates/[slug]/run/**`
 * (Phase 2 plan Tasks 16-17). Deliberately kept in its OWN file rather than
 * folded into `authoring-actions.ts`: that file is also being edited by the
 * authoring-shell worktree and the scaffolder-dispatch branch, so a new
 * small helper here avoids stacking merge conflicts onto a large shared
 * file. `startDryRun`/`planRun`/`startRun`/`getRun` (the run lifecycle
 * itself) still live in `authoring-actions.ts` — this file only adds the
 * slug→definition lookup the consumer routes need that no existing action
 * provides (everything else there addresses a definition by Payload id).
 *
 * Mirrors `authoring-actions.ts#getTemplateDefinition`'s gating exactly:
 * `draft`/`deprecated` rows require `canManageTemplateDefinitions` on the
 * row's workspace, `published` rows require `canRunTemplateDefinition`.
 * Returns `null` on denial or not-found so callers 404 rather than leak
 * existence.
 */

import { getPayload } from 'payload'
import config from '@payload-config'
import { getCurrentUser, getPayloadUserFromSession } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/access/workspace-access'
import { canManageTemplateDefinitions, canRunTemplateDefinition } from '@/lib/templates/authz'
import type { TemplateDefinition as TemplateDefinitionDoc } from '@/payload-types'

function relId(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value === 'object' && 'id' in (value as Record<string, unknown>)) {
    return String((value as { id: unknown }).id)
  }
  return null
}

async function requireUserId(): Promise<string> {
  const uid = (await getCurrentUser())?.id
  if (!uid) throw new Error('Not authenticated')
  return uid
}

async function currentUserIsPlatformAdmin(): Promise<boolean> {
  const user = await getPayloadUserFromSession()
  return isPlatformAdmin(user)
}

/**
 * Loads a single template-definition by its (globally unique) `slug`, with
 * `currentVersion` populated. See module docblock for the gating rules.
 */
export async function getTemplateDefinitionByIdOrSlug(
  idOrSlug: string,
): Promise<TemplateDefinitionDoc | null> {
  const payload = await getPayload({ config })
  const uid = await requireUserId()
  const isAdmin = await currentUserIsPlatformAdmin()

  // The route segment is `[id]`, shared with `[id]/edit` — Next.js forbids two
  // different slug names at the same dynamic path. A document id is tried
  // first so the catalog's own links resolve in one lookup; the slug fallback
  // keeps human-typed and previously-shared `/templates/<slug>/run` URLs
  // working. Resolution order never widens access: the RBAC gate below runs
  // on whichever row was found, exactly as before.
  let definition: TemplateDefinitionDoc | undefined
  try {
    definition = await payload.findByID({
      collection: 'template-definitions',
      id: idOrSlug,
      depth: 1,
      overrideAccess: true,
    })
  } catch {
    const found = await payload.find({
      collection: 'template-definitions',
      where: { slug: { equals: idOrSlug } },
      depth: 1,
      limit: 1,
      overrideAccess: true,
    })
    definition = found.docs[0]
  }
  if (!definition) return null

  const workspaceId = relId(definition.workspace)
  const allowed =
    definition.status === 'published'
      ? await canRunTemplateDefinition(payload, uid, workspaceId, isAdmin)
      : await canManageTemplateDefinitions(payload, uid, workspaceId, isAdmin)
  if (!allowed) return null

  return definition
}
