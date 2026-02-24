import { cache } from 'react'
import { getPayload } from 'payload'
import config from '@payload-config'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getMongoClient } from '@/lib/mongodb'

/**
 * Cached data fetchers using React.cache() for request-level deduplication.
 *
 * React.cache() memoizes the result of a function for the duration of a single
 * server request. This means that if multiple components in the same request
 * call the same cached function with the same arguments, the actual fetch
 * only happens once.
 *
 * This is particularly useful for:
 * - Layout/page hierarchies where both need the same data
 * - Multiple components on the same page needing the same workspace/user data
 */

/**
 * Get the Payload CMS instance (cached per request)
 */
export const getPayloadClient = cache(async () => {
  return getPayload({ config })
})

/**
 * Get the current user session (cached per request)
 */
export const getSession = cache(async () => {
  const reqHeaders = await headers()
  return auth.api.getSession({ headers: reqHeaders })
})

/**
 * Get a workspace by slug (cached per request)
 */
export const getWorkspaceBySlug = cache(async (slug: string, depth: number = 1) => {
  const payload = await getPayloadClient()
  const result = await payload.find({
    collection: 'workspaces',
    where: { slug: { equals: slug } },
    limit: 1,
    depth,
  })
  return result.docs[0] ?? null
})

/**
 * Get a knowledge space by slug and workspace ID (cached per request)
 */
export const getKnowledgeSpaceBySlug = cache(async (spaceSlug: string, workspaceId: string) => {
  const payload = await getPayloadClient()
  const result = await payload.find({
    collection: 'knowledge-spaces',
    where: {
      slug: { equals: spaceSlug },
      workspace: { equals: workspaceId },
    },
    limit: 1,
  })
  return result.docs[0] ?? null
})

/**
 * Get all knowledge pages for a space (cached per request)
 */
export const getKnowledgePagesBySpace = cache(async (spaceId: string) => {
  const payload = await getPayloadClient()
  const result = await payload.find({
    collection: 'knowledge-pages',
    where: { knowledgeSpace: { equals: spaceId } },
    limit: 1000,
    sort: 'sortOrder',
  })
  return result.docs
})

/**
 * Get a specific knowledge page by slug and space ID (cached per request)
 */
export const getKnowledgePageBySlug = cache(async (pageSlug: string, spaceId: string, depth: number = 2) => {
  const payload = await getPayloadClient()
  const result = await payload.find({
    collection: 'knowledge-pages',
    where: {
      slug: { equals: pageSlug },
      knowledgeSpace: { equals: spaceId },
    },
    limit: 1,
    depth,
  })
  return result.docs[0] ?? null
})

/**
 * Check workspace membership for a user (cached per request)
 */
export const getWorkspaceMembership = cache(async (
  workspaceId: string,
  userId: string,
  options?: { roles?: string[]; overrideAccess?: boolean }
) => {
  const payload = await getPayloadClient()

  const result = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: workspaceId } },
        { user: { equals: userId } },
        { status: { equals: 'active' } },
        ...(options?.roles?.length ? [{ role: { in: options.roles } }] : []),
      ],
    },
    limit: 1,
    overrideAccess: options?.overrideAccess ?? false,
  })

  return result.docs[0] ?? null
})

export interface BetterAuthUser {
  id: string
  name: string
  email: string
  image?: string | null
}

/**
 * Look up a single Better Auth user by ID from the BA `user` collection.
 */
export const getBetterAuthUser = cache(async (userId: string): Promise<BetterAuthUser | null> => {
  const client = await getMongoClient()
  const doc = await client.db().collection('user').findOne({ id: userId })
  if (!doc) return null
  return {
    id: doc.id as string,
    name: (doc.name as string) || '',
    email: (doc.email as string) || '',
    image: (doc.image as string) || null,
  }
})

/**
 * Batch lookup Better Auth users by IDs from the BA `user` collection.
 */
export const getBetterAuthUsers = cache(async (userIds: string[]): Promise<BetterAuthUser[]> => {
  if (userIds.length === 0) return []
  const client = await getMongoClient()
  const docs = await client
    .db()
    .collection('user')
    .find({ id: { $in: userIds } })
    .toArray()
  return docs.map((doc) => ({
    id: doc.id as string,
    name: (doc.name as string) || '',
    email: (doc.email as string) || '',
    image: (doc.image as string) || null,
  }))
})

/**
 * Look up a Better Auth user by email.
 */
export const getBetterAuthUserByEmail = cache(async (email: string): Promise<BetterAuthUser | null> => {
  const client = await getMongoClient()
  const doc = await client.db().collection('user').findOne({ email })
  if (!doc) return null
  return {
    id: doc.id as string,
    name: (doc.name as string) || '',
    email: (doc.email as string) || '',
    image: (doc.image as string) || null,
  }
})

/**
 * Get all workspace memberships for a user (cached per request).
 * Accepts a Better Auth user ID directly since workspace-members.user
 * now stores Better Auth user IDs.
 */
export const getUserWorkspaceMemberships = cache(async (userId: string) => {
  const payload = await getPayloadClient()
  const result = await payload.find({
    collection: 'workspace-members',
    where: {
      user: { equals: userId },
      status: { equals: 'active' },
    },
    depth: 1,
    limit: 100,
    overrideAccess: true,
  })
  return result.docs
})
