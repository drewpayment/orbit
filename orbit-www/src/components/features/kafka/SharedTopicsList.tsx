'use client'

import { useState, useEffect, useCallback, useTransition } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import { MoreHorizontal, Check, X, Trash2, Link2 } from 'lucide-react'
import {
  listPendingShares,
  approveShare,
  rejectShare,
  revokeShare,
  type ShareListItem
} from '@/app/actions/kafka-topic-shares'
import { ConnectionDetailsPanel } from './ConnectionDetailsPanel'

interface SharedTopicsListProps {
  workspaceId: string
  workspaceSlug: string
  type: 'incoming' | 'outgoing'
  canManage: boolean
}

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  revoked: 'bg-gray-100 text-gray-800',
}

export function SharedTopicsList({ workspaceId, workspaceSlug, type, canManage }: SharedTopicsListProps) {
  const [shares, setShares] = useState<ShareListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [isPending, startTransition] = useTransition()

  // Dialog states
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false)
  const [revokeDialogOpen, setRevokeDialogOpen] = useState(false)
  const [selectedShare, setSelectedShare] = useState<ShareListItem | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  // Connection details panel state
  const [connectionPanelOpen, setConnectionPanelOpen] = useState(false)
  const [selectedShareForConnection, setSelectedShareForConnection] = useState<ShareListItem | null>(null)

  const loadShares = useCallback(async () => {
    setLoading(true)
    try {
      const result = await listPendingShares({ workspaceId, type })
      if (result.success) {
        setShares(result.shares ?? [])
      } else {
        toast.error(result.error || 'Failed to load shares')
      }
    } catch {
      toast.error('Failed to load shares')
    } finally {
      setLoading(false)
    }
  }, [workspaceId, type])

  useEffect(() => {
    loadShares()
  }, [loadShares])

  const handleApprove = async (share: ShareListItem) => {
    startTransition(async () => {
      const result = await approveShare({ shareId: share.id })
      if (result.success) {
        toast.success('Access approved')
        loadShares()
      } else {
        toast.error(result.error || 'Failed to approve')
      }
    })
  }

  const handleReject = async () => {
    if (!selectedShare) return
    startTransition(async () => {
      const result = await rejectShare({ shareId: selectedShare.id, reason: rejectReason })
      if (result.success) {
        toast.success('Request rejected')
        setRejectDialogOpen(false)
        setRejectReason('')
        loadShares()
      } else {
        toast.error(result.error || 'Failed to reject')
      }
    })
  }

  const handleRevoke = async () => {
    if (!selectedShare) return
    startTransition(async () => {
      const result = await revokeShare({ shareId: selectedShare.id })
      if (result.success) {
        toast.success('Access revoked')
        setRevokeDialogOpen(false)
        loadShares()
      } else {
        toast.error(result.error || 'Failed to revoke')
      }
    })
  }

  const openRejectDialog = (share: ShareListItem) => {
    setSelectedShare(share)
    setRejectReason('')
    setRejectDialogOpen(true)
  }

  const openRevokeDialog = (share: ShareListItem) => {
    setSelectedShare(share)
    setRevokeDialogOpen(true)
  }

  const handleViewConnectionDetails = (share: ShareListItem) => {
    setSelectedShareForConnection(share)
    setConnectionPanelOpen(true)
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>
            {type === 'incoming' ? 'Incoming Share Requests' : 'Outgoing Share Requests'}
          </CardTitle>
          <CardDescription>
            {type === 'incoming'
              ? 'Topics other workspaces are requesting access to'
              : 'Your requests for access to topics from other workspaces'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">Loading...</div>
          ) : shares.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No {type === 'incoming' ? 'pending requests' : 'active requests'}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Topic</TableHead>
                  <TableHead>{type === 'incoming' ? 'Requester' : 'Owner'}</TableHead>
                  <TableHead>Access Level</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reason</TableHead>
                  {(canManage && type === 'incoming') || type === 'outgoing' ? (
                    <TableHead className="text-right">Actions</TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {shares.map((share) => (
                  <TableRow key={share.id}>
                    <TableCell>
                      <div>
                        <div className="font-medium">{share.topic.name}</div>
                        <div className="text-sm text-muted-foreground">
                          {share.topic.environment}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {type === 'incoming' ? share.targetWorkspace.name : share.ownerWorkspace.name}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{share.accessLevel}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={statusColors[share.status]}>{share.status}</Badge>
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate">
                      {share.reason || '-'}
                    </TableCell>
                    {canManage && type === 'incoming' && (
                      <TableCell className="text-right">
                        {share.status === 'pending' && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => handleApprove(share)}>
                                <Check className="h-4 w-4 mr-2" />
                                Approve
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openRejectDialog(share)}>
                                <X className="h-4 w-4 mr-2" />
                                Reject
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                        {share.status === 'approved' && (
                          <div className="flex gap-1 justify-end">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleViewConnectionDetails(share)}
                              title="View connection details"
                            >
                              <Link2 className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openRevokeDialog(share)}
                              title="Revoke access"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    )}
                    {type === 'outgoing' && (
                      <TableCell className="text-right">
                        {share.status === 'approved' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleViewConnectionDetails(share)}
                            title="View connection details"
                          >
                            <Link2 className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Reject Dialog */}
      <AlertDialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject Access Request</AlertDialogTitle>
            <AlertDialogDescription>
              Please provide a reason for rejecting this request.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            placeholder="Reason for rejection..."
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            rows={3}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleReject}
              disabled={isPending || !rejectReason.trim()}
            >
              {isPending ? 'Rejecting...' : 'Reject'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Revoke Dialog */}
      <AlertDialog open={revokeDialogOpen} onOpenChange={setRevokeDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke Access</AlertDialogTitle>
            <AlertDialogDescription>
              This will immediately remove access to the topic. The other workspace will no longer be able to consume or produce to this topic.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRevoke}
              disabled={isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isPending ? 'Revoking...' : 'Revoke Access'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Connection Details Panel */}
      {selectedShareForConnection && (
        <ConnectionDetailsPanel
          open={connectionPanelOpen}
          onOpenChange={setConnectionPanelOpen}
          shareId={selectedShareForConnection.id}
          workspaceSlug={workspaceSlug}
        />
      )}
    </>
  )
}
