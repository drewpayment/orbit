export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { authorize, authzErrorResponse } from '@/lib/authz'

// Platform-admin only: installation inventory (account logins, repo selection,
// workspace grants) is operational metadata, not something any authenticated —
// let alone anonymous — caller should enumerate. (This route previously had no
// auth at all.)
export async function GET() {
  try {
    await authorize('read', { kind: 'platform' })
  } catch (err) {
    return authzErrorResponse(err) ?? NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }

  const payload = await getPayload({ config: configPromise })

  const installations = await payload.find({
    collection: 'github-installations',
    sort: '-installedAt',
  })

  return NextResponse.json(installations)
}
