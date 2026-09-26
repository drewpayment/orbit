import type { Payload } from 'payload'

/**
 * Pure catalog-entity helpers that are NOT authorization. Split out of the
 * former `lib/catalog/entity-authz.ts` (Phase C, #135) when that module's
 * actual authz helpers were migrated onto `@/lib/authz`.
 */

/** True if `entityId` is an existing catalog entity of kind `team`. */
export async function isTeamEntity(payload: Payload, entityId: string): Promise<boolean> {
  try {
    const entity = await payload.findByID({
      collection: 'catalog-entities',
      id: entityId,
      depth: 0,
      overrideAccess: true,
    })
    return entity?.kind === 'team'
  } catch {
    return false
  }
}
