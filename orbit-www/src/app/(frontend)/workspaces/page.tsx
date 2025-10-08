import { getPayload } from 'payload'
import config from '@payload-config'
import { WorkspaceManager } from '@/components/features/workspace/WorkspaceManager'

export default async function WorkspacesPage() {
  const payload = await getPayload({ config })

  // Fetch all workspaces
  const workspacesResult = await payload.find({
    collection: 'workspaces',
    limit: 100,
    sort: '-createdAt',
  })

  // Fetch member counts for each workspace
  const workspacesWithCounts = await Promise.all(
    workspacesResult.docs.map(async (workspace) => {
      const membersResult = await payload.find({
        collection: 'workspace-members',
        where: {
          workspace: {
            equals: workspace.id,
          },
          status: {
            equals: 'active',
          },
        },
        limit: 0, // Just get the count
      })

      return {
        ...workspace,
        memberCount: membersResult.totalDocs,
      }
    })
  )

  return <WorkspaceManager initialWorkspaces={workspacesWithCounts} />
}
