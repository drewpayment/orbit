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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Button } from '@/components/ui/button'
import { ChevronDown, ChevronUp, FileText } from 'lucide-react'
import { RequestStatusBadge } from './RequestStatusBadge'
import { getMyRequests, type ApplicationRequestData } from '@/app/actions/kafka-application-requests'

interface MyRequestsListProps {
  workspaceId: string
}

export function MyRequestsList({ workspaceId }: MyRequestsListProps) {
  const [requests, setRequests] = useState<ApplicationRequestData[]>([])
  const [loading, setLoading] = useState(true)
  const [isOpen, setIsOpen] = useState(true)

  const loadRequests = useCallback(async () => {
    try {
      const result = await getMyRequests(workspaceId)
      if (result.success && result.requests) {
        // Filter to only show pending and recently rejected (within 30 days)
        const thirtyDaysAgo = new Date()
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

        const filteredRequests = result.requests.filter((r) => {
          if (r.status === 'pending_workspace' || r.status === 'pending_platform') {
            return true
          }
          if (r.status === 'rejected' && r.rejectedAt) {
            return new Date(r.rejectedAt) > thirtyDaysAgo
          }
          // Don't show approved (they become apps) or old rejected
          return false
        })

        setRequests(filteredRequests)
      }
    } catch {
      // Silently fail - this is a non-critical section
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
    })
  }

  // Don't render if no requests or still loading
  if (loading || requests.length === 0) {
    return null
  }

  return (
    <Card className="mb-6">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-muted-foreground" />
              <div>
                <CardTitle className="text-lg">My Requests</CardTitle>
                <CardDescription>
                  {requests.length} pending or recent request{requests.length !== 1 ? 's' : ''}
                </CardDescription>
              </div>
            </div>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm">
                {isOpen ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </Button>
            </CollapsibleTrigger>
          </div>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="pt-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Application</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Details</TableHead>
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
                      <div className="text-sm text-muted-foreground">
                        {formatDate(request.createdAt)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <RequestStatusBadge status={request.status} />
                    </TableCell>
                    <TableCell>
                      {request.status === 'rejected' && request.rejectionReason ? (
                        <div className="text-sm text-muted-foreground max-w-xs truncate">
                          {request.rejectionReason}
                        </div>
                      ) : request.status === 'pending_workspace' ? (
                        <div className="text-sm text-muted-foreground">
                          Waiting for workspace admin
                        </div>
                      ) : request.status === 'pending_platform' ? (
                        <div className="text-sm text-muted-foreground">
                          Waiting for platform admin
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}
