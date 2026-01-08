'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Loader2, FileQuestion } from 'lucide-react'
import { RequestStatusBadge, ApprovalActionsDropdown } from '@/components/features/kafka'
import {
  getPendingWorkspaceApprovals,
  type ApplicationRequestData,
} from '@/app/actions/kafka-application-requests'

interface PendingApprovalsClientProps {
  workspaceId: string
  workspaceSlug: string
}

export function PendingApprovalsClient({
  workspaceId,
  workspaceSlug,
}: PendingApprovalsClientProps) {
  const [requests, setRequests] = useState<ApplicationRequestData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadRequests = useCallback(async () => {
    try {
      const result = await getPendingWorkspaceApprovals(workspaceId)
      if (result.success && result.requests) {
        setRequests(result.requests)
      } else {
        setError(result.error || 'Failed to load requests')
      }
    } catch {
      setError('Failed to load requests')
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    loadRequests()
  }, [loadRequests])

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="text-center text-muted-foreground">
            <p>{error}</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Pending Approvals</h1>
        <p className="text-muted-foreground">
          Review and approve Kafka application requests from workspace members.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Application Requests</CardTitle>
          <CardDescription>
            These requests are waiting for your approval before being forwarded to platform admins.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {requests.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FileQuestion className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium">No pending requests</h3>
              <p className="text-muted-foreground mt-1">
                There are no application requests waiting for your approval.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Application</TableHead>
                  <TableHead>Requested By</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.map((request) => (
                  <TableRow key={request.id}>
                    <TableCell>
                      <div>
                        <div className="font-medium">{request.applicationName}</div>
                        <div className="text-sm text-muted-foreground">
                          {request.applicationSlug}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        {request.requestedBy.name || request.requestedBy.email || 'Unknown'}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm text-muted-foreground">
                        {formatDate(request.createdAt)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <RequestStatusBadge status={request.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <ApprovalActionsDropdown
                        requestId={request.id}
                        tier="workspace"
                        onActionComplete={loadRequests}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
