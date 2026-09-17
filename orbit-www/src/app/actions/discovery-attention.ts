'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { getActor } from '@/lib/authz'
import { getDiscoveryAttention, type DiscoveryAttention } from '@/lib/discovery/attention-core'

/**
 * Server action for the dashboard Attention Hub discovery card (WP7, Phase 1.5,
 * docs/plans/2026-07-06-catalog-discovery.md).
 *
 * Thin session glue over `lib/discovery/attention-core.ts`: resolve the
 * Better-Auth id (RBAC key) and — to know whether to fold in the global queue —
 * the Payload `users` doc for the platform-admin role, then delegate. Returns an
 * empty aggregate for a signed-out caller so the card can safely render nothing.
 */
export async function getDiscoveryAttentionAction(): Promise<DiscoveryAttention> {
  const actor = await getActor()
  if (!actor) return { total: 0, groups: [] }

  const payload = await getPayload({ config })
  return getDiscoveryAttention(payload, actor.betterAuthId, actor.isPlatformAdmin)
}
