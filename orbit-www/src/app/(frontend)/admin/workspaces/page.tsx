import { redirect } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { getActor, check } from '@/lib/authz'
import { countWorkspaceMembers } from '@/lib/workspaces/members'
import { WorkspaceManager } from '@/components/features/workspace/WorkspaceManager'

// Platform-admin only: this page lists and manages EVERY workspace in the
// install, not just the caller's own. (This route previously had no auth
// check at all — SEMANTIC CHANGE, see migration report.)
export default async function WorkspacesPage() {
  const actor = await getActor()
  if (!actor) redirect('/login')
  const d = await check('read', { kind: 'platform' }, actor)
  if (!d.allowed) redirect('/dashboard')

  const payload = await getPayload({ config })

  // Fetch all workspaces
  const workspacesResult = await payload.find({
    collection: 'workspaces',
    limit: 100,
    sort: '-createdAt',
  })

  // Fetch member counts for each workspace
  const workspacesWithCounts = await Promise.all(
    workspacesResult.docs.map(async (workspace) => ({
      ...workspace,
      memberCount: await countWorkspaceMembers(payload, String(workspace.id)),
    }))
  )

  return <WorkspaceManager initialWorkspaces={workspacesWithCounts} />
}
