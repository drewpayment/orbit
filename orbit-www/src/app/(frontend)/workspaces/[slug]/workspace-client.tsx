'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { requestJoinWorkspace } from './actions'
import { toast } from 'sonner'

interface WorkspaceClientProps {
  workspaceId: string
  membershipStatus?: {
    isMember: boolean
    isPending: boolean
    role?: 'owner' | 'admin' | 'member'
  }
}

export function WorkspaceClient({ workspaceId, membershipStatus: initialStatus }: WorkspaceClientProps) {
  const router = useRouter()
  const { data: session } = useSession()
  const [actionLoading, setActionLoading] = useState(false)
  const [membershipStatus, setMembershipStatus] = useState(initialStatus)

  const handleJoinRequest = async () => {
    if (!session?.user) return

    setActionLoading(true)
    try {
      const result = await requestJoinWorkspace(workspaceId, session.user.id)
      
      if (result.success) {
        setMembershipStatus({
          isMember: false,
          isPending: true,
        })
        toast.success('Join request sent successfully')
      } else {
        toast.error(result.error || 'Failed to send join request')
      }
    } catch (error) {
      console.error('Failed to send join request:', error)
      toast.error('Failed to send join request')
    } finally {
      setActionLoading(false)
    }
  }

  return (
    <div>
      {membershipStatus?.isMember && (
        <Badge variant="secondary">{membershipStatus.role}</Badge>
      )}
      {!membershipStatus?.isMember && !membershipStatus?.isPending && session && (
        <Button onClick={handleJoinRequest} disabled={actionLoading}>
          {actionLoading ? 'Sending...' : 'Request to Join'}
        </Button>
      )}
      {membershipStatus?.isPending && (
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
  )
}
