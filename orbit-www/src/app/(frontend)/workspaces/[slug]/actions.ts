'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { revalidatePath } from 'next/cache'

export async function requestJoinWorkspace(workspaceId: string, userId: string) {
  try {
    const payload = await getPayload({ config })

    // Check if a request already exists
    const existing = await payload.find({
      collection: 'workspace-members',
      where: {
        and: [
          {
            workspace: {
              equals: workspaceId,
            },
          },
          {
            user: {
              equals: userId,
            },
          },
        ],
      },
      limit: 1,
    })

    if (existing.docs.length > 0) {
      const status = existing.docs[0].status
      if (status === 'active') {
        return { success: false, error: 'You are already a member of this workspace' }
      }
      if (status === 'pending') {
        return { success: false, error: 'You already have a pending request' }
      }
    }

    // Create join request
    await payload.create({
      collection: 'workspace-members',
      data: {
        workspace: workspaceId,
        user: userId,
        role: 'member',
        status: 'pending',
        requestedAt: new Date().toISOString(),
      },
    })

    revalidatePath(`/workspaces/[slug]`, 'page')
    
    return { success: true }
  } catch (error) {
    console.error('Failed to create join request:', error)
    return { success: false, error: 'Failed to create join request' }
  }
}

export async function checkMembershipStatus(workspaceId: string, userId: string) {
  try {
    const payload = await getPayload({ config })

    const result = await payload.find({
      collection: 'workspace-members',
      where: {
        and: [
          {
            workspace: {
              equals: workspaceId,
            },
          },
          {
            user: {
              equals: userId,
            },
          },
        ],
      },
      limit: 1,
    })

    if (result.docs.length === 0) {
      return { isMember: false, isPending: false }
    }

    const member = result.docs[0]
    return {
      isMember: member.status === 'active',
      isPending: member.status === 'pending',
      role: member.role,
    }
  } catch (error) {
    console.error('Failed to check membership status:', error)
    return { isMember: false, isPending: false }
  }
}
