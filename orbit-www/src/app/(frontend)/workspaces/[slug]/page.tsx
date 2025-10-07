'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useSession } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'

interface Workspace {
  id: string
  name: string
  slug: string
  description?: string
  avatar?: {
    url: string
  }
  createdAt: string
}

interface Member {
  id: string
  user: {
    id: string
    name?: string
    email: string
    avatar?: {
      url: string
    }
  }
  role: 'owner' | 'admin' | 'member'
  status: 'active' | 'pending' | 'rejected'
}

interface MembershipStatus {
  isMember: boolean
  isPending: boolean
  role?: 'owner' | 'admin' | 'member'
}

export default function WorkspacePage() {
  const params = useParams()
  const router = useRouter()
  const { data: session } = useSession()
  const slug = params.slug as string

  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [membershipStatus, setMembershipStatus] = useState<MembershipStatus>({
    isMember: false,
    isPending: false,
  })
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)

  useEffect(() => {
    fetchWorkspace()
  }, [slug])

  const fetchWorkspace = async () => {
    try {
      const response = await fetch(`/api/workspaces?where[slug][equals]=${slug}`)
      if (response.ok) {
        const data = await response.json()
        if (data.docs && data.docs.length > 0) {
          setWorkspace(data.docs[0])
          await fetchMembers(data.docs[0].id)
        }
      }
    } catch (error) {
      console.error('Failed to fetch workspace:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchMembers = async (workspaceId: string) => {
    try {
      const response = await fetch(
        `/api/workspace-members?where[workspace][equals]=${workspaceId}&where[status][equals]=active`
      )
      if (response.ok) {
        const data = await response.json()
        setMembers(data.docs || [])

        // Check if current user is a member
        if (session?.user) {
          const userMembership = data.docs.find(
            (m: Member) => m.user.id === session.user.id
          )
          if (userMembership) {
            setMembershipStatus({
              isMember: true,
              isPending: false,
              role: userMembership.role,
            })
          } else {
            // Check for pending request
            const pendingResponse = await fetch(
              `/api/workspace-members?where[workspace][equals]=${workspaceId}&where[user][equals]=${session.user.id}&where[status][equals]=pending`
            )
            if (pendingResponse.ok) {
              const pendingData = await pendingResponse.json()
              setMembershipStatus({
                isMember: false,
                isPending: pendingData.docs.length > 0,
              })
            }
          }
        }
      }
    } catch (error) {
      console.error('Failed to fetch members:', error)
    }
  }

  const handleJoinRequest = async () => {
    if (!workspace || !session?.user) return

    setActionLoading(true)
    try {
      const response = await fetch('/api/workspace-members', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workspace: workspace.id,
          user: session.user.id,
          role: 'member',
          status: 'pending',
        }),
      })

      if (response.ok) {
        setMembershipStatus({
          isMember: false,
          isPending: true,
        })
      }
    } catch (error) {
      console.error('Failed to send join request:', error)
    } finally {
      setActionLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 dark:border-white mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-400">Loading workspace...</p>
        </div>
      </div>
    )
  }

  if (!workspace) {
    return (
      <div className="container mx-auto py-8 px-4">
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-gray-600 dark:text-gray-400">Workspace not found</p>
            <Button onClick={() => router.push('/workspaces')} className="mt-4">
              Back to Workspaces
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const ownerMembers = members.filter(m => m.role === 'owner')
  const adminMembers = members.filter(m => m.role === 'admin')
  const regularMembers = members.filter(m => m.role === 'member')

  return (
    <div className="container mx-auto py-8 px-4">
      {/* Workspace Header */}
      <div className="mb-8">
        <div className="flex items-start gap-6">
          {workspace.avatar && (
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
              {membershipStatus.isMember && (
                <Badge variant="secondary">{membershipStatus.role}</Badge>
              )}
            </div>
            <p className="text-lg text-gray-600 dark:text-gray-400 mb-4">
              /{workspace.slug}
            </p>
            {workspace.description && (
              <p className="text-gray-700 dark:text-gray-300">{workspace.description}</p>
            )}
          </div>
          <div>
            {!membershipStatus.isMember && !membershipStatus.isPending && session && (
              <Button onClick={handleJoinRequest} disabled={actionLoading}>
                {actionLoading ? 'Sending...' : 'Request to Join'}
              </Button>
            )}
            {membershipStatus.isPending && (
              <Button disabled variant="secondary">
                Request Pending
              </Button>
            )}
            {!session && (
              <Button onClick={() => router.push('/login')}>
                Sign in to Join
              </Button>
            )}
          </div>
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
              {membershipStatus.isMember && (
                <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                  <h3 className="font-semibold text-blue-900 dark:text-blue-100 mb-2">
                    Member Features Coming Soon
                  </h3>
                  <ul className="text-sm text-blue-800 dark:text-blue-200 space-y-1">
                    <li>• Wiki and documentation editing</li>
                    <li>• Plugin management</li>
                    <li>• Custom workspace settings</li>
                    <li>• Repository integration</li>
                  </ul>
                </div>
              )}
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
                      {ownerMembers.map((member) => (
                        <div key={member.id} className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={member.user.avatar?.url} />
                            <AvatarFallback>
                              {(member.user.name || member.user.email).slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {member.user.name || member.user.email}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {adminMembers.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">
                      Admins
                    </p>
                    <div className="space-y-2">
                      {adminMembers.map((member) => (
                        <div key={member.id} className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={member.user.avatar?.url} />
                            <AvatarFallback>
                              {(member.user.name || member.user.email).slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {member.user.name || member.user.email}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {regularMembers.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">
                      Members
                    </p>
                    <div className="space-y-2">
                      {regularMembers.slice(0, 5).map((member) => (
                        <div key={member.id} className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={member.user.avatar?.url} />
                            <AvatarFallback>
                              {(member.user.name || member.user.email).slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {member.user.name || member.user.email}
                            </p>
                          </div>
                        </div>
                      ))}
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
