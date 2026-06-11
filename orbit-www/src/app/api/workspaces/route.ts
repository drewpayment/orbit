export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { getMemberWorkspaceIds } from '@/lib/access/workspace-access'

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const payload = await getPayload({ config: configPromise })

  // session.user.id is the Better Auth ID, which is what workspace-members.user stores.
  const betterAuthId = session.user.id
  const memberWorkspaceIds = await getMemberWorkspaceIds(payload, betterAuthId)

  if (memberWorkspaceIds.length === 0) {
    return NextResponse.json({ docs: [], totalDocs: 0, page: 1, totalPages: 0 })
  }

  const workspaces = await payload.find({
    collection: 'workspaces',
    where: { id: { in: memberWorkspaceIds } },
    sort: 'name',
    overrideAccess: true,
  })

  return NextResponse.json(workspaces)
}
