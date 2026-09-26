'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { revalidatePath } from 'next/cache'
import { getBetterAuthUserByEmail, getBetterAuthUsers } from '@/lib/data/cached-queries'
import { getActor, check } from '@/lib/authz'
import {
  listWorkspaceMembers,
  findMembership,
  addWorkspaceMember,
  updateWorkspaceMemberRole,
  removeWorkspaceMember,
  deleteWorkspaceMembers,
  getMembershipById,
} from '@/lib/workspaces/members'

export async function getWorkspaceMembers(workspaceId: string) {
  try {
    const d = await check('read', { kind: 'workspace', id: workspaceId })
    if (!d.allowed) {
      return { success: false, error: d.reason, members: [] }
    }

    const payload = await getPayload({ config })
    const members = await listWorkspaceMembers(payload, workspaceId, { limit: 100 })

    // Batch-fetch Better Auth user details for all members
    const userIds = members
      .map((m) => (typeof m.user === 'string' ? m.user : ''))
      .filter(Boolean)
    const baUsers = await getBetterAuthUsers(userIds)
    const userMap = new Map(baUsers.map((u) => [u.id, u]))

    return {
      success: true,
      members: members.map((member) => {
        const baUserId = typeof member.user === 'string' ? member.user : ''
        const baUser = userMap.get(baUserId)
        return {
          id: member.id,
          workspaceId: typeof member.workspace === 'string' ? member.workspace : member.workspace.id,
          userId: baUserId,
          userEmail: baUser?.email || '',
          userName: baUser?.name || baUser?.email || '',
          userAvatar: baUser?.image || undefined,
          role: member.role,
          status: member.status,
          joinedAt: member.approvedAt || member.createdAt,
        }
      }),
    }
  } catch (error) {
    console.error('Failed to fetch workspace members:', error)
    return {
      success: false,
      error: 'Failed to fetch workspace members',
      members: [],
    }
  }
}

export async function inviteWorkspaceMember(
  workspaceId: string,
  email: string,
  role: 'owner' | 'admin' | 'member'
) {
  try {
    const d = await check('manage', { kind: 'workspace', id: workspaceId })
    if (!d.allowed) return { success: false, error: d.reason }

    const payload = await getPayload({ config })

    // Find user by email in Better Auth user collection
    const baUser = await getBetterAuthUserByEmail(email)

    if (!baUser) {
      return {
        success: false,
        error: 'User not found with that email address',
      }
    }

    // Check if user is already a member
    const existing = await findMembership(payload, baUser.id, workspaceId)
    if (existing) {
      return {
        success: false,
        error: 'User is already a member of this workspace',
      }
    }

    await addWorkspaceMember(payload, { workspaceId, betterAuthId: baUser.id, role })

    revalidatePath('/workspaces')
    revalidatePath('/admin/workspaces')

    return {
      success: true,
    }
  } catch (error) {
    console.error('Failed to invite member:', error)
    return {
      success: false,
      error: 'Failed to invite member',
    }
  }
}

export async function updateMemberRole(
  memberId: string,
  newRole: 'owner' | 'admin' | 'member'
) {
  try {
    const payload = await getPayload({ config })

    const membership = await getMembershipById(payload, memberId)
    if (!membership) return { success: false, error: 'Membership not found' }

    const d = await check('manage', { kind: 'workspace', id: membership.workspaceId })
    if (!d.allowed) return { success: false, error: d.reason }

    await updateWorkspaceMemberRole(payload, memberId, newRole)

    revalidatePath('/workspaces')
    revalidatePath('/admin/workspaces')

    return {
      success: true,
    }
  } catch (error) {
    console.error('Failed to update member role:', error)
    return {
      success: false,
      error: 'Failed to update member role',
    }
  }
}

export async function removeMember(memberId: string) {
  try {
    const payload = await getPayload({ config })

    const membership = await getMembershipById(payload, memberId)
    if (!membership) return { success: false, error: 'Membership not found' }

    const d = await check('manage', { kind: 'workspace', id: membership.workspaceId })
    if (!d.allowed) return { success: false, error: d.reason }

    await removeWorkspaceMember(payload, memberId)

    revalidatePath('/workspaces')
    revalidatePath('/admin/workspaces')

    return {
      success: true,
    }
  } catch (error) {
    console.error('Failed to remove member:', error)
    return {
      success: false,
      error: 'Failed to remove member',
    }
  }
}

export async function createWorkspace(data: {
  name: string
  slug: string
  description?: string
}) {
  try {
    const actor = await getActor()
    if (!actor) {
      return { success: false, error: 'Not authenticated' }
    }

    const payload = await getPayload({ config })

    // Check for duplicate slug
    const existing = await payload.find({
      collection: 'workspaces',
      where: { slug: { equals: data.slug } },
      limit: 1,
      overrideAccess: true,
    })

    if (existing.docs.length > 0) {
      return {
        success: false,
        error: 'A workspace with this slug already exists',
      }
    }

    const workspace = await payload.create({
      collection: 'workspaces',
      data: {
        name: data.name,
        slug: data.slug,
        description: data.description || null,
      },
      overrideAccess: true,
    })

    // Add the creating user as workspace owner
    await addWorkspaceMember(payload, {
      workspaceId: String(workspace.id),
      betterAuthId: actor.betterAuthId,
      role: 'owner',
    })

    revalidatePath('/workspaces')
    revalidatePath('/admin/workspaces')

    return {
      success: true,
      workspace: {
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
      },
    }
  } catch (error) {
    console.error('Failed to create workspace:', error)
    return {
      success: false,
      error: 'Failed to create workspace',
    }
  }
}

export async function updateWorkspaceSettings(
  workspaceId: string,
  data: {
    name: string
    description?: string
    slug?: string
  }
) {
  try {
    const d = await check('update', { kind: 'workspace', id: workspaceId })
    if (!d.allowed) return { success: false, error: d.reason }

    const payload = await getPayload({ config })

    await payload.update({
      collection: 'workspaces',
      id: workspaceId,
      data: {
        name: data.name,
        description: data.description || null,
        ...(data.slug && { slug: data.slug }),
      },
      overrideAccess: true,
    })

    revalidatePath('/workspaces')
    revalidatePath('/admin/workspaces')

    return {
      success: true,
    }
  } catch (error) {
    console.error('Failed to update workspace settings:', error)
    return {
      success: false,
      error: 'Failed to update workspace settings',
    }
  }
}

export async function deleteWorkspace(workspaceId: string) {
  try {
    const d = await check('delete', { kind: 'workspace', id: workspaceId, roles: ['owner'] })
    if (!d.allowed) return { success: false, error: d.reason }

    const payload = await getPayload({ config })

    // First, delete all workspace members
    await deleteWorkspaceMembers(payload, workspaceId)

    // Then delete the workspace
    await payload.delete({
      collection: 'workspaces',
      id: workspaceId,
      overrideAccess: true,
    })

    revalidatePath('/workspaces')
    revalidatePath('/admin/workspaces')

    return {
      success: true,
    }
  } catch (error) {
    console.error('Failed to delete workspace:', error)
    return {
      success: false,
      error: 'Failed to delete workspace',
    }
  }
}
