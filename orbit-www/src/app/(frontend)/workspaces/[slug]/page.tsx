import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
import { WorkspaceClient } from './workspace-client'
import { checkMembershipStatus } from './actions'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'

interface PageProps {
  params: {
    slug: string
  }
}

export default async function WorkspacePage({ params }: PageProps) {
  const { slug } = params
  const payload = await getPayload({ config })

  // Get current user session
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  // Fetch workspace
  const workspaceResult = await payload.find({
    collection: 'workspaces',
    where: {
      slug: {
        equals: slug,
      },
    },
    limit: 1,
  })

  if (!workspaceResult.docs.length) {
    notFound()
  }

  const workspace = workspaceResult.docs[0]

  // Fetch members
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
    limit: 100,
  })

  const members = membersResult.docs

  // Check membership status for current user
  let membershipStatus
  if (session?.user) {
    membershipStatus = await checkMembershipStatus(workspace.id, session.user.id)
  }

  const ownerMembers = members.filter(m => m.role === 'owner')
  const adminMembers = members.filter(m => m.role === 'admin')
  const regularMembers = members.filter(m => m.role === 'member')

  return (
    <div className="container mx-auto py-8 px-4">
      {/* Workspace Header */}
      <div className="mb-8">
        <div className="flex items-start gap-6">
          {workspace.avatar && typeof workspace.avatar === 'object' && 'url' in workspace.avatar && workspace.avatar.url && (
            <Avatar className="h-24 w-24">
              <AvatarImage src={workspace.avatar.url} alt={workspace.name} />
              <AvatarFallback>{workspace.name.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
          )}
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-4xl font-bold text-gray-900 dark:text-white">
                {workspace.name}
              </h1>
            </div>
            <p className="text-lg text-gray-600 dark:text-gray-400 mb-4">
              /{workspace.slug}
            </p>
            {workspace.description && (
              <p className="text-gray-700 dark:text-gray-300">{workspace.description}</p>
            )}
          </div>
          <WorkspaceClient workspaceId={workspace.id} membershipStatus={membershipStatus} />
        </div>
      </div>

      <Separator className="mb-8" />

      {/* Workspace Content */}
      <div className="grid gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Welcome</CardTitle>
              <CardDescription>
                This workspace is part of the Orbit Internal Developer Portal
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-gray-700 dark:text-gray-300">
                This is the default landing page for the <strong>{workspace.name}</strong> workspace.
                Workspace members can customize this page with wikis, documentation, and other
                content to help their team collaborate effectively.
              </p>
            </CardContent>
          </Card>
        </div>

        <div>
          <Card>
            <CardHeader>
              <CardTitle>Members ({members.length})</CardTitle>
              <CardDescription>
                People in this workspace
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {ownerMembers.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">
                      Owners
                    </p>
                    <div className="space-y-2">
                      {ownerMembers.map((member) => {
                        const user = typeof member.user === 'object' ? member.user : null
                        if (!user) return null
                        return (
                          <div key={member.id} className="flex items-center gap-3">
                            <Avatar className="h-8 w-8">
                              {user.avatar && typeof user.avatar === 'object' && 'url' in user.avatar && user.avatar.url && (
                                <AvatarImage src={user.avatar.url} />
                              )}
                              <AvatarFallback>
                                {(user.name || user.email)?.slice(0, 2).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">
                                {user.name || user.email}
                              </p>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {adminMembers.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">
                      Admins
                    </p>
                    <div className="space-y-2">
                      {adminMembers.map((member) => {
                        const user = typeof member.user === 'object' ? member.user : null
                        if (!user) return null
                        return (
                          <div key={member.id} className="flex items-center gap-3">
                            <Avatar className="h-8 w-8">
                              {user.avatar && typeof user.avatar === 'object' && 'url' in user.avatar && user.avatar.url && (
                                <AvatarImage src={user.avatar.url} />
                              )}
                              <AvatarFallback>
                                {(user.name || user.email)?.slice(0, 2).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">
                                {user.name || user.email}
                              </p>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {regularMembers.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">
                      Members
                    </p>
                    <div className="space-y-2">
                      {regularMembers.slice(0, 5).map((member) => {
                        const user = typeof member.user === 'object' ? member.user : null
                        if (!user) return null
                        return (
                          <div key={member.id} className="flex items-center gap-3">
                            <Avatar className="h-8 w-8">
                              {user.avatar && typeof user.avatar === 'object' && 'url' in user.avatar && user.avatar.url && (
                                <AvatarImage src={user.avatar.url} />
                              )}
                              <AvatarFallback>
                                {(user.name || user.email)?.slice(0, 2).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">
                                {user.name || user.email}
                              </p>
                            </div>
                          </div>
                        )
                      })}
                      {regularMembers.length > 5 && (
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          +{regularMembers.length - 5} more
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
