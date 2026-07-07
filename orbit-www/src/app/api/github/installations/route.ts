export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { getPayloadUserFromSession } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/access/workspace-access'

// Platform-admin only: installation inventory (account logins, repo selection,
// workspace grants) is operational metadata, not something any authenticated —
// let alone anonymous — caller should enumerate. (This route previously had no
// auth at all.)
export async function GET() {
  const user = await getPayloadUserFromSession()
  if (!user || !isPlatformAdmin(user)) {
    return NextResponse.json({ error: 'Platform admin required' }, { status: 403 })
  }

  const payload = await getPayload({ config: configPromise })

  const installations = await payload.find({
    collection: 'github-installations',
    sort: '-installedAt',
  })

  return NextResponse.json(installations)
}
