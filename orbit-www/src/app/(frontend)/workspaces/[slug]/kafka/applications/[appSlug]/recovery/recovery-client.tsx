'use client'

import { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  ArrowLeft,
  Database,
  Clock,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  ChevronRight,
} from 'lucide-react'
import {
  getConsumerGroupsForApplication,
  getCheckpointsForConsumerGroup,
  restoreOffsets,
  type ConsumerGroupSummary,
  type CheckpointSummary,
} from '@/app/actions/kafka-offset-recovery'

interface OffsetRecoveryClientProps {
  workspaceSlug: string
  application: {
    id: string
    name: string
    slug: string
  }
}

function formatTimeSince(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()

  const diffMinutes = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays > 0) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`
  if (diffHours > 0) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`
  if (diffMinutes > 0) return `${diffMinutes} minute${diffMinutes > 1 ? 's' : ''} ago`
  return 'Just now'
}

function formatDateTime(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function ConsumerGroupStateBadge({ state }: { state: string | null }) {
  if (!state) return <Badge variant="outline">Unknown</Badge>

  const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
    stable: 'default',
    dead: 'destructive',
    empty: 'outline',
    'preparing-rebalance': 'secondary',
    'completing-rebalance': 'secondary',
  }

  const labels: Record<string, string> = {
    stable: 'Stable',
    dead: 'Dead',
    empty: 'Empty',
    unknown: 'Unknown',
    'preparing-rebalance': 'Rebalancing',
    'completing-rebalance': 'Rebalancing',
  }

  return <Badge variant={variants[state] || 'outline'}>{labels[state] || state}</Badge>
}

export function OffsetRecoveryClient({ workspaceSlug, application }: OffsetRecoveryClientProps) {
  const [isPending, startTransition] = useTransition()
  const [consumerGroups, setConsumerGroups] = useState<ConsumerGroupSummary[]>([])
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [checkpoints, setCheckpoints] = useState<CheckpointSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [isLoadingCheckpoints, setIsLoadingCheckpoints] = useState(false)
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false)
  const [selectedCheckpoint, setSelectedCheckpoint] = useState<CheckpointSummary | null>(null)
  const [isRestoring, setIsRestoring] = useState(false)

  // Load consumer groups on mount
  useEffect(() => {
    startTransition(async () => {
      setError(null)
      const result = await getConsumerGroupsForApplication(application.id)

      if (!result.success) {
        setError(result.error || 'Failed to load consumer groups')
        return
      }

      setConsumerGroups(result.consumerGroups || [])
    })
  }, [application.id])

  // Load checkpoints when a consumer group is selected
  useEffect(() => {
    if (!selectedGroupId) {
      setCheckpoints([])
      return
    }

    setIsLoadingCheckpoints(true)
    setError(null)
    setSuccessMessage(null)

    startTransition(async () => {
      const result = await getCheckpointsForConsumerGroup({
        consumerGroupId: selectedGroupId,
        limit: 20,
      })

      setIsLoadingCheckpoints(false)

      if (!result.success) {
        setError(result.error || 'Failed to load checkpoints')
        return
      }

      setCheckpoints(result.checkpoints || [])
    })
  }, [selectedGroupId])

  const handleRestoreClick = (checkpoint: CheckpointSummary) => {
    setSelectedCheckpoint(checkpoint)
    setRestoreDialogOpen(true)
  }

  const handleRestoreConfirm = async () => {
    if (!selectedCheckpoint || !selectedGroupId) return

    setIsRestoring(true)
    setError(null)
    setSuccessMessage(null)

    const result = await restoreOffsets({
      checkpointId: selectedCheckpoint.id,
      consumerGroupId: selectedGroupId,
    })

    setIsRestoring(false)
    setRestoreDialogOpen(false)
    setSelectedCheckpoint(null)

    if (!result.success) {
      setError(result.error || 'Failed to restore offsets')
      return
    }

    setSuccessMessage(result.message || 'Offsets restored successfully')
  }

  const selectedGroup = consumerGroups.find((g) => g.id === selectedGroupId)

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href={`/workspaces/${workspaceSlug}`}>Workspace</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink href={`/workspaces/${workspaceSlug}/kafka/applications`}>
              Applications
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink
              href={`/workspaces/${workspaceSlug}/kafka/applications/${application.slug}`}
            >
              {application.name}
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Offset Recovery</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/workspaces/${workspaceSlug}/kafka/applications/${application.slug}`}>
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5 text-muted-foreground" />
              <h1 className="text-2xl font-bold">Offset Recovery</h1>
            </div>
            <p className="text-muted-foreground">
              Restore consumer group offsets from checkpoint snapshots
            </p>
          </div>
        </div>
      </div>

      {/* Success Message */}
      {successMessage && (
        <Alert className="border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950">
          <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
          <AlertDescription className="text-green-800 dark:text-green-200">
            {successMessage}
          </AlertDescription>
        </Alert>
      )}

      {/* Error Message */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Main Content */}
      {isPending && consumerGroups.length === 0 ? (
        <div className="space-y-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              Consumer Group Checkpoints
            </CardTitle>
            <CardDescription>
              Select a consumer group to view and restore offset checkpoints
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Consumer Group Selector */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Consumer Group</label>
              {consumerGroups.length === 0 ? (
                <div className="text-sm text-muted-foreground py-4 text-center border rounded-md">
                  No consumer groups found for this application
                </div>
              ) : (
                <Select
                  value={selectedGroupId || ''}
                  onValueChange={(value) => setSelectedGroupId(value || null)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a consumer group..." />
                  </SelectTrigger>
                  <SelectContent>
                    {consumerGroups.map((group) => (
                      <SelectItem key={group.id} value={group.id}>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm">{group.groupId}</span>
                          <ChevronRight className="h-3 w-3 text-muted-foreground" />
                          <span className="text-muted-foreground text-sm">{group.topicName}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Selected Group Info */}
            {selectedGroup && (
              <div className="flex items-center gap-4 p-3 bg-muted/50 rounded-md">
                <div className="flex-1">
                  <div className="font-mono text-sm font-medium">{selectedGroup.groupId}</div>
                  <div className="text-sm text-muted-foreground">
                    Topic: {selectedGroup.topicName}
                  </div>
                </div>
                <ConsumerGroupStateBadge state={selectedGroup.state} />
                {selectedGroup.members !== null && (
                  <Badge variant="outline">{selectedGroup.members} members</Badge>
                )}
                {selectedGroup.totalLag !== null && (
                  <Badge variant="outline">Lag: {selectedGroup.totalLag.toLocaleString()}</Badge>
                )}
              </div>
            )}

            {/* Checkpoints Table */}
            {selectedGroupId && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium">Available Checkpoints</h3>
                  {isLoadingCheckpoints && (
                    <Badge variant="outline" className="font-normal">
                      Loading...
                    </Badge>
                  )}
                </div>

                {isLoadingCheckpoints ? (
                  <div className="space-y-2">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                ) : checkpoints.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground border rounded-md">
                    <Clock className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>No checkpoints available for this consumer group</p>
                    <p className="text-sm mt-2">
                      Checkpoints are created automatically at regular intervals
                    </p>
                  </div>
                ) : (
                  <div className="border rounded-md">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Checkpoint Time</TableHead>
                          <TableHead>Time Since</TableHead>
                          <TableHead className="text-center">Partitions</TableHead>
                          <TableHead className="text-right">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {checkpoints.map((checkpoint) => (
                          <TableRow key={checkpoint.id}>
                            <TableCell className="font-mono text-sm">
                              {formatDateTime(checkpoint.checkpointedAt)}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              <div className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {formatTimeSince(checkpoint.checkpointedAt)}
                              </div>
                            </TableCell>
                            <TableCell className="text-center">
                              <Badge variant="secondary">{checkpoint.partitionCount}</Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleRestoreClick(checkpoint)}
                              >
                                <RefreshCw className="h-3 w-3 mr-1" />
                                Restore
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Restore Confirmation Dialog */}
      <AlertDialog open={restoreDialogOpen} onOpenChange={setRestoreDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore Consumer Group Offsets</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to restore offsets to this checkpoint?
              {selectedCheckpoint && (
                <div className="mt-4 p-3 bg-muted rounded-md space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Checkpoint Time:</span>
                    <span className="font-mono">
                      {formatDateTime(selectedCheckpoint.checkpointedAt)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Partitions:</span>
                    <span>{selectedCheckpoint.partitionCount}</span>
                  </div>
                </div>
              )}
              <p className="mt-4 text-amber-600 dark:text-amber-400">
                Warning: This operation will reset offsets for all partitions. Consumers will
                reprocess messages from the checkpoint position.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRestoring}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRestoreConfirm} disabled={isRestoring}>
              {isRestoring ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Restoring...
                </>
              ) : (
                'Restore Offsets'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
