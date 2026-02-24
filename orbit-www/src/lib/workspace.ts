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

  const membership = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { user: { equals: session.user.id } },
        { status: { equals: 'active' } },
      ],
    },
    limit: 1,
    overrideAccess: true,
  })

  if (membership.docs.length === 0) {
    return null
  }

  const workspace = membership.docs[0].workspace
  return typeof workspace === 'string' ? workspace : workspace.id
}

export async function getAllWorkspaceIds(): Promise<string[]> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return []
  }

  const payload = await getPayload({ config })

  const memberships = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { user: { equals: session.user.id } },
        { status: { equals: 'active' } },
      ],
    },
    limit: 100,
    overrideAccess: true,
  })

  return memberships.docs.map(m => {
    const workspace = m.workspace
    return typeof workspace === 'string' ? workspace : workspace.id
  })
}
