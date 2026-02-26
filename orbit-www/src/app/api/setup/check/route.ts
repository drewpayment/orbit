export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { hasUsers } from '@/lib/setup'

/**
 * GET /api/setup/check
 * Returns whether initial setup has been completed.
 * Called by middleware (which runs in Edge Runtime and cannot use mongodb directly).
 */
export async function GET() {
  const usersExist = await hasUsers()
  return NextResponse.json({ setupComplete: usersExist })
}
