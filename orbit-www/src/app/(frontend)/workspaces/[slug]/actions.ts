'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { revalidatePath } from 'next/cache'
import { requireActor } from '@/lib/authz'
import { findMembership, requestWorkspaceMembership } from '@/lib/workspaces/members'

/**
 * Self-service join request: any authenticated user may request to join any
 * workspace (there is no workspace role to check yet — that's the point of a
 * join request), so this only needs an authenticated actor, not `authorize()`.
 * `_userId` is accepted for source compatibility with the client caller
 * (`workspace-client.tsx`, outside this migration's file list) but ignored —
 * identity for the write comes from the actor's own session, never a
 * client-supplied id (SEMANTIC CHANGE: previously trusted the caller's id).
 */
export async function requestJoinWorkspace(workspaceId: string, _userId?: string) {
  try {
    const actor = await requireActor()

    // Check if a request already exists
    const payload = await getPayload({ config })
    const existing = await findMembership(payload, actor.betterAuthId, workspaceId)

    if (existing) {
      if (existing.status === 'active') {
        return { success: false, error: 'You are already a member of this workspace' }
      }
      if (existing.status === 'pending') {
        return { success: false, error: 'You already have a pending request' }
      }
    }

    // Create join request
    await requestWorkspaceMembership(payload, { workspaceId, betterAuthId: actor.betterAuthId })

    revalidatePath(`/workspaces/[slug]`, 'page')

    return { success: true }
  } catch (error) {
    console.error('Failed to create join request:', error)
    return { success: false, error: 'Failed to create join request' }
  }
}

export async function checkMembershipStatus(workspaceId: string) {
  try {
    const actor = await requireActor()
    const payload = await getPayload({ config })
    const member = await findMembership(payload, actor.betterAuthId, workspaceId)

    if (!member) {
      return { isMember: false, isPending: false }
    }

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
