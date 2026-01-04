'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'

/**
 * Check if the current user has platform admin privileges.
 * Platform admins have access to platform-level settings like Kafka clusters,
 * providers, and environment mappings.
 */
export async function checkPlatformAdmin(): Promise<{
  isAdmin: boolean
  userId?: string
}> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user?.email) {
    return { isAdmin: false }
  }

  const payload = await getPayload({ config })

  // Find the Payload user by email (Better-Auth stores email)
  const payloadUsers = await payload.find({
    collection: 'users',
    where: {
      email: { equals: session.user.email },
    },
    limit: 1,
  })

  const payloadUser = payloadUsers.docs[0]
  if (!payloadUser) {
    return { isAdmin: false }
  }

  // Check for platform-level admin role using the user-workspace-roles collection
  // This collection stores role assignments with scope (platform vs workspace)
  try {
    const roleAssignments = await payload.find({
      collection: 'user-workspace-roles' as 'users', // Type workaround for custom collection
      depth: 2,
      limit: 1000,
    })

    interface WorkspaceRoleAssignment {
      user: string | { id?: string }
      role: { scope?: string; slug?: string } | string
    }

    const isAdmin = roleAssignments.docs.some((assignment: unknown) => {
      const typedAssignment = assignment as WorkspaceRoleAssignment

      // Check if this assignment belongs to our user
      const assignmentUserId =
        typeof typedAssignment.user === 'object'
          ? typedAssignment.user?.id
          : typedAssignment.user
      if (assignmentUserId !== payloadUser.id) return false

      const role = typeof typedAssignment.role === 'object' ? typedAssignment.role : null
      if (!role) return false

      // Check if user has platform admin role (super-admin, admin, or platform-admin)
      return (
        role.scope === 'platform' &&
        (role.slug === 'admin' || role.slug === 'platform-admin' || role.slug === 'super-admin')
      )
    })

    return { isAdmin, userId: session.user.id }
  } catch {
    // If the collection doesn't exist yet or there's an error,
    // fall back to checking if user is in a specific list or has admin flag
    // For now, return false - proper role setup is required
    return { isAdmin: false, userId: session.user.id }
  }
}
