'use server'

import { memberWorkspaceIds } from '@/lib/authz'

/**
 * All workspace ids the current actor is an active member of. A thin server
 * action so client components (e.g. `GitHubHealthProviderWrapper`) can fetch
 * this without importing `@/lib/authz` (which pulls in `next/headers`)
 * directly into a client bundle. Replaces the former `lib/workspace.ts` shim
 * (Phase C, #135).
 */
export async function getMyWorkspaceIds(): Promise<string[]> {
  return memberWorkspaceIds('member')
}
