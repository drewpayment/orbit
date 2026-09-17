export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { requireActor, memberWorkspaceIds, authzErrorResponse } from '@/lib/authz'

export async function GET() {
  let actor
  try {
    actor = await requireActor()
  } catch (err) {
    return authzErrorResponse(err) ?? NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }

  const payload = await getPayload({ config: configPromise })

  const workspaceIds = await memberWorkspaceIds('member', actor)

  if (workspaceIds.length === 0) {
    return NextResponse.json({ docs: [], totalDocs: 0, page: 1, totalPages: 0 })
  }

  const workspaces = await payload.find({
    collection: 'workspaces',
    where: { id: { in: workspaceIds } },
    sort: 'name',
    overrideAccess: true,
  })

  return NextResponse.json(workspaces)
}
