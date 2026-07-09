'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { getCurrentUser, getPayloadUserFromSession } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/access/workspace-access'
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
  const user = await getCurrentUser()
  if (!user) return { total: 0, groups: [] }

  // Platform-admin detection matches the other dashboard/admin paths: the role
  // lives on the Payload `users` doc, not the Better-Auth session user.
  const payloadUser = await getPayloadUserFromSession()
  const admin = isPlatformAdmin(payloadUser)

  const payload = await getPayload({ config })
  return getDiscoveryAttention(payload, user.id, admin)
}
