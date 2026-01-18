'use client'

import { useState, useEffect, useCallback, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
import { Plus, RefreshCw, MoreHorizontal, Trash2, Check, Eye, Copy } from 'lucide-react'
import { toast } from 'sonner'
import {
  listTopicsByVirtualCluster,
  deleteTopic,
  approveTopic,
} from '@/app/actions/kafka-topics'
import { VirtualClusterCreateTopicDialog } from './VirtualClusterCreateTopicDialog'
import { ConnectionDetailsPanel } from './ConnectionDetailsPanel'
import { formatDuration } from '@/lib/utils/format'

type Topic = {
  id: string
  name: string
  description?: string | null
  partitions: number
  replicationFactor: number
  retentionMs?: number | null
  cleanupPolicy?: string | null
  status: string
  createdVia?: string | null
  fullTopicName?: string | null
  createdAt: string
}

interface TopicsPanelProps {
  virtualClusterId: string
  virtualClusterName: string
  environment: string
  canManage: boolean
  canApprove: boolean
  userId?: string
  workspaceSlug: string
  applicationSlug: string
}

const statusColors: Record<string, string> = {
  'pending-approval': 'bg-yellow-100 text-yellow-800',
  provisioning: 'bg-blue-100 text-blue-800',
  active: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  deleting: 'bg-gray-100 text-gray-800',
  deleted: 'bg-gray-200 text-gray-500',
}

const createdViaLabels: Record<string, string> = {
  'orbit-ui': 'UI',
  'gateway-passthrough': 'Gateway',
  api: 'API',
  migration: 'Migration',
}

export function TopicsPanel({
  virtualClusterId,
  virtualClusterName,
  environment,
  canManage,
  canApprove,
  userId,
  workspaceSlug,
  applicationSlug: _applicationSlug,
}: TopicsPanelProps) {
  const [topics, setTopics] = useState<Topic[]>([])
  const [loading, setLoading] = useState(true)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [approveDialogOpen, setApproveDialogOpen] = useState(false)
  const [connectionPanelOpen, setConnectionPanelOpen] = useState(false)
  const [selectedTopic, setSelectedTopic] = useState<Topic | null>(null)
  const [isPending, startTransition] = useTransition()

  const loadTopics = useCallback(async () => {
    setLoading(true)
    try {
      const result = await listTopicsByVirtualCluster(virtualClusterId)
      setTopics(result as Topic[])
    } catch {
      toast.error('Failed to load topics')
    } finally {
      setLoading(false)
    }
  }, [virtualClusterId])

  useEffect(() => {
    loadTopics()
  }, [loadTopics])

  const handleCreateSuccess = () => {
    setCreateDialogOpen(false)
    loadTopics()
    toast.success('Topic created successfully')
  }

  const handleDelete = () => {
    if (!selectedTopic) return

    startTransition(async () => {
      const result = await deleteTopic(selectedTopic.id)
      if (result.success) {
        toast.success('Topic deletion initiated')
        loadTopics()
      } else {
        toast.error(result.error || 'Failed to delete topic')
      }
      setDeleteDialogOpen(false)
      setSelectedTopic(null)
    })
  }

  const handleApprove = () => {
    if (!selectedTopic || !userId) return

    startTransition(async () => {
      const result = await approveTopic(selectedTopic.id, userId)
      if (result.success) {
        toast.success('Topic approved and provisioning started')
        loadTopics()
      } else {
        toast.error(result.error || 'Failed to approve topic')
      }
      setApproveDialogOpen(false)
      setSelectedTopic(null)
    })
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    toast.success('Copied to clipboard')
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Topics</CardTitle>
              <CardDescription>
                {topics.length} topic{topics.length !== 1 ? 's' : ''} in {virtualClusterName}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={loadTopics} disabled={loading}>
                <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
              {canManage && (
                <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
                  <Plus className="h-4 w-4 mr-1" />
                  Create Topic
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {topics.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {loading ? (
                'Loading topics...'
              ) : (
                <>
                  No topics yet.
                  {canManage && ' Create one to get started.'}
                </>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Partitions</TableHead>
                  <TableHead>Replication</TableHead>
                  <TableHead>Retention</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created Via</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topics.map((topic) => (
                  <TableRow key={topic.id}>
                    <TableCell>
                      <div>
                        <div className="font-medium flex items-center gap-1">
                          {topic.name}
                          {topic.fullTopicName && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-5 w-5 p-0"
                              onClick={() => copyToClipboard(topic.fullTopicName!)}
                              title="Copy full topic name"
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                        {topic.description && (
                          <div className="text-sm text-muted-foreground truncate max-w-[200px]">
                            {topic.description}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{topic.partitions}</TableCell>
                    <TableCell>{topic.replicationFactor}</TableCell>
                    <TableCell>{formatDuration(topic.retentionMs ?? 604800000)}</TableCell>
                    <TableCell>
                      <Badge className={statusColors[topic.status] || 'bg-gray-100'}>
                        {topic.status.replace('-', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {createdViaLabels[topic.createdVia ?? 'orbit-ui'] || topic.createdVia}
                      </span>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" disabled={isPending}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => {
                              setSelectedTopic(topic)
                              setConnectionPanelOpen(true)
                            }}
                            disabled={topic.status !== 'active'}
                          >
                            <Eye className="h-4 w-4 mr-2" />
                            View Details
                          </DropdownMenuItem>
                          {canApprove && topic.status === 'pending-approval' && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => {
                                  setSelectedTopic(topic)
                                  setApproveDialogOpen(true)
                                }}
                              >
                                <Check className="h-4 w-4 mr-2" />
                                Approve
                              </DropdownMenuItem>
                            </>
                          )}
                          {canManage &&
                            topic.status !== 'deleting' &&
                            topic.status !== 'deleted' && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-red-600"
                                  onClick={() => {
                                    setSelectedTopic(topic)
                                    setDeleteDialogOpen(true)
                                  }}
                                >
                                  <Trash2 className="h-4 w-4 mr-2" />
                                  Delete
                                </DropdownMenuItem>
                              </>
                            )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Topic</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{selectedTopic?.name}&quot;? This action cannot
              be undone and all messages in this topic will be permanently lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-red-600 hover:bg-red-700"
              disabled={isPending}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Approve Confirmation Dialog */}
      <AlertDialog open={approveDialogOpen} onOpenChange={setApproveDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve Topic</AlertDialogTitle>
            <AlertDialogDescription>
              Approve &quot;{selectedTopic?.name}&quot; for provisioning? This will create the topic
              on the Kafka cluster.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleApprove} disabled={isPending}>
              Approve
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <VirtualClusterCreateTopicDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        virtualClusterId={virtualClusterId}
        environment={environment}
        onSuccess={handleCreateSuccess}
      />

      {/* Connection Details Panel */}
      {selectedTopic && (
        <ConnectionDetailsPanel
          open={connectionPanelOpen}
          onOpenChange={(open) => {
            setConnectionPanelOpen(open)
            if (!open) setSelectedTopic(null)
          }}
          topicId={selectedTopic.id}
          isOwnTopic={true}
          workspaceSlug={workspaceSlug}
        />
      )}
    </>
  )
}
