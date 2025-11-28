'use server'

import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { getPayload } from 'payload'
import config from '@payload-config'

export async function getCurrentWorkspaceId(): Promise<string | null> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return null
  }

  const payload = await getPayload({ config })

  // Get user's first active workspace membership
  const membership = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { user: { equals: session.user.id } },
        { status: { equals: 'active' } },
      ],
    },
    limit: 1,
  })

  if (membership.docs.length === 0) {
    return null
  }

  const workspace = membership.docs[0].workspace
  return typeof workspace === 'string' ? workspace : workspace.id
}
