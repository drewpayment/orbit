'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { getBetterAuthUserByEmail, getBetterAuthUsers } from '@/lib/data/cached-queries'
import { auth } from '@/lib/auth'

export async function getWorkspaceMembers(workspaceId: string) {
  try {
    const payload = await getPayload({ config })

    const membersResult = await payload.find({
      collection: 'workspace-members',
      where: {
        workspace: {
          equals: workspaceId,
        },
        status: {
          equals: 'active',
        },
      },
      limit: 100,
      sort: '-createdAt',
      overrideAccess: true,
    })

    // Batch-fetch Better Auth user details for all members
    const userIds = membersResult.docs
      .map((m) => (typeof m.user === 'string' ? m.user : ''))
      .filter(Boolean)
    const baUsers = await getBetterAuthUsers(userIds)
    const userMap = new Map(baUsers.map((u) => [u.id, u]))

    return {
      success: true,
      members: membersResult.docs.map((member) => {
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
    const payload = await getPayload({ config })

    // Find user by email in Better Auth user collection
    const baUser = await getBetterAuthUserByEmail(email)

    if (!baUser) {
      return {
        success: false,
        error: 'User not found with that email address',
      }
    }

    const user = baUser

    // Check if user is already a member
    const existingMember = await payload.find({
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
              equals: user.id,
            },
          },
        ],
      },
      limit: 1,
    })

    if (existingMember.docs.length > 0) {
      return {
        success: false,
        error: 'User is already a member of this workspace',
      }
    }

    // Create membership
    await payload.create({
      collection: 'workspace-members',
      data: {
        workspace: workspaceId,
        user: user.id,
        role,
        status: 'active',
        requestedAt: new Date().toISOString(),
        approvedAt: new Date().toISOString(),
      },
    })

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

    await payload.update({
      collection: 'workspace-members',
      id: memberId,
      data: {
        role: newRole,
      },
    })

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

    await payload.delete({
      collection: 'workspace-members',
      id: memberId,
    })

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
    const session = await auth.api.getSession({
      headers: await headers(),
    })

    if (!session?.user) {
      return { success: false, error: 'Not authenticated' }
    }

    const payload = await getPayload({ config })

    // Check for duplicate slug
    const existing = await payload.find({
      collection: 'workspaces',
      where: { slug: { equals: data.slug } },
      limit: 1,
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
    await payload.create({
      collection: 'workspace-members',
      data: {
        workspace: workspace.id,
        user: session.user.id,
        role: 'owner',
        status: 'active',
        requestedAt: new Date().toISOString(),
        approvedAt: new Date().toISOString(),
      },
      overrideAccess: true,
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
    const payload = await getPayload({ config })

    await payload.update({
      collection: 'workspaces',
      id: workspaceId,
      data: {
        name: data.name,
        description: data.description || null,
        ...(data.slug && { slug: data.slug }),
      },
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
    const payload = await getPayload({ config })

    // First, delete all workspace members
    const membersResult = await payload.find({
      collection: 'workspace-members',
      where: {
        workspace: {
          equals: workspaceId,
        },
      },
      limit: 1000,
    })

    // Delete all members
    await Promise.all(
      membersResult.docs.map((member) =>
        payload.delete({
          collection: 'workspace-members',
          id: member.id,
        })
      )
    )

    // Then delete the workspace
    await payload.delete({
      collection: 'workspaces',
      id: workspaceId,
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
