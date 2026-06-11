export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { listProviders } from '@/app/(frontend)/workspaces/[slug]/kafka/actions'
import { getPayloadUserFromSession } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/access/workspace-access'

/**
 * GET /api/kafka/admin/providers
 * List available Kafka providers (admin only)
 */
export async function GET() {
  const payloadUser = await getPayloadUserFromSession()
  if (!payloadUser) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }
  if (!isPlatformAdmin(payloadUser)) {
    return NextResponse.json({ error: 'Forbidden: platform admin required' }, { status: 403 })
  }

  const result = await listProviders()

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  return NextResponse.json({ providers: result.providers })
}
