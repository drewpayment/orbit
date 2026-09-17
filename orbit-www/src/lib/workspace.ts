'use server'

import { memberWorkspaceIds } from '@/lib/authz/server'

/** First workspace the current actor is an active member of, or null. */
export async function getCurrentWorkspaceId(): Promise<string | null> {
  const ids = await memberWorkspaceIds('member')
  return ids[0] ?? null
}

/** All workspace ids the current actor is an active member of. */
export async function getAllWorkspaceIds(): Promise<string[]> {
  return memberWorkspaceIds('member')
}
