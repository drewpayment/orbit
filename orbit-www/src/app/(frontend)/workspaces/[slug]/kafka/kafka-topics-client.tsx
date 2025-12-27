'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Plus,
  MoreHorizontal,
  Trash2,
  Eye,
  Share2,
  FileCode,
  Activity,
  CheckCircle2,
  Clock,
  AlertTriangle,
  XCircle,
  Loader2,
  RefreshCw,
  Server,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatDistanceToNow } from 'date-fns'
import Link from 'next/link'
import {
  listTopics,
  deleteTopic,
  discoverTopics,
  type KafkaTopic,
  type DiscoverableTopic,
} from './actions'
import { CreateTopicDialog } from '@/components/features/kafka/CreateTopicDialog'

interface KafkaTopicsClientProps {
  workspaceId: string
  workspaceSlug: string
}

const statusConfig = {
  pending_approval: {
    icon: Clock,
    label: 'Pending Approval',
    className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  },
  provisioning: {
    icon: Loader2,
    label: 'Provisioning',
    className: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  },
  active: {
    icon: CheckCircle2,
    label: 'Active',
    className: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  },
  failed: {
    icon: XCircle,
    label: 'Failed',
    className: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  },
  deleting: {
    icon: AlertTriangle,
    label: 'Deleting',
    className: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
  },
}

export function KafkaTopicsClient({ workspaceId, workspaceSlug }: KafkaTopicsClientProps) {
  const [topics, setTopics] = useState<KafkaTopic[]>([])
  const [discoverableTopics, setDiscoverableTopics] = useState<DiscoverableTopic[]>([])
  const [loading, setLoading] = useState(true)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [topicToDelete, setTopicToDelete] = useState<KafkaTopic | null>(null)
  const [activeTab, setActiveTab] = useState('my-topics')

  const loadTopics = useCallback(async () => {
    setLoading(true)
    try {
      const result = await listTopics({ workspaceId })
      if (result.success && result.topics) {
        setTopics(result.topics)
      } else {
        toast.error(result.error || 'Failed to load topics')
      }
    } catch (error) {
      toast.error('Failed to load topics')
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  const loadDiscoverableTopics = useCallback(async () => {
    try {
      const result = await discoverTopics({ requestingWorkspaceId: workspaceId })
      if (result.success && result.topics) {
        setDiscoverableTopics(result.topics)
      }
    } catch (error) {
      console.error('Failed to load discoverable topics:', error)
    }
  }, [workspaceId])

  useEffect(() => {
    loadTopics()
    loadDiscoverableTopics()
  }, [loadTopics, loadDiscoverableTopics])

  const handleDeleteTopic = async () => {
    if (!topicToDelete) return

    try {
      const result = await deleteTopic(topicToDelete.id)
      if (result.success) {
        toast.success('Topic deletion initiated')
        loadTopics()
      } else {
        toast.error(result.error || 'Failed to delete topic')
      }
    } catch (error) {
      toast.error('Failed to delete topic')
    } finally {
      setDeleteDialogOpen(false)
      setTopicToDelete(null)
    }
  }

  const handleTopicCreated = () => {
    setCreateDialogOpen(false)
    loadTopics()
    toast.success('Topic creation initiated')
  }

  const renderStatusBadge = (status: KafkaTopic['status']) => {
    const config = statusConfig[status] || statusConfig.active
    const StatusIcon = config.icon

    return (
      <Badge variant="secondary" className={config.className}>
        <StatusIcon className={`h-3 w-3 mr-1 ${status === 'provisioning' ? 'animate-spin' : ''}`} />
        {config.label}
      </Badge>
    )
  }

  return (
    <>
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="flex items-center justify-between mb-6">
          <TabsList>
            <TabsTrigger value="my-topics" className="flex items-center gap-2">
              <Server className="h-4 w-4" />
              My Topics
            </TabsTrigger>
            <TabsTrigger value="discover" className="flex items-center gap-2">
              <Share2 className="h-4 w-4" />
              Discover
            </TabsTrigger>
          </TabsList>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={loadTopics}>
              <RefreshCw className="h-4 w-4 mr-1" />
              Refresh
            </Button>
            <Button onClick={() => setCreateDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Create Topic
            </Button>
          </div>
        </div>

        <TabsContent value="my-topics">
          {loading ? (
            <Card>
              <CardContent className="flex items-center justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
              </CardContent>
            </Card>
          ) : topics.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16">
                <Server className="h-16 w-16 text-gray-400 mb-4" />
                <h3 className="text-xl font-semibold mb-2">No Topics Yet</h3>
                <p className="text-gray-600 dark:text-gray-400 text-center max-w-md mb-4">
                  Kafka topics allow you to publish and subscribe to streams of events.
                  Create your first topic to get started.
                </p>
                <Button onClick={() => setCreateDialogOpen(true)}>
                  <Plus className="h-4 w-4 mr-1" />
                  Create Topic
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Topics</CardTitle>
                <CardDescription>
                  {topics.length} topic{topics.length !== 1 ? 's' : ''} in this workspace
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Environment</TableHead>
                      <TableHead>Partitions</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="w-[50px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {topics.map((topic) => (
                      <TableRow key={topic.id}>
                        <TableCell>
                          <div>
                            <Link
                              href={`/workspaces/${workspaceSlug}/kafka/${topic.id}`}
                              className="font-medium hover:underline"
                            >
                              {topic.name}
                            </Link>
                            {topic.description && (
                              <p className="text-sm text-gray-500 truncate max-w-xs">
                                {topic.description}
                              </p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{topic.environment}</Badge>
                        </TableCell>
                        <TableCell>{topic.partitions}</TableCell>
                        <TableCell>{renderStatusBadge(topic.status)}</TableCell>
                        <TableCell className="text-gray-500 text-sm">
                          {formatDistanceToNow(new Date(topic.createdAt), { addSuffix: true })}
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem asChild>
                                <Link href={`/workspaces/${workspaceSlug}/kafka/${topic.id}`}>
                                  <Eye className="h-4 w-4 mr-2" />
                                  View Details
                                </Link>
                              </DropdownMenuItem>
                              <DropdownMenuItem asChild>
                                <Link href={`/workspaces/${workspaceSlug}/kafka/${topic.id}/schemas`}>
                                  <FileCode className="h-4 w-4 mr-2" />
                                  Schemas
                                </Link>
                              </DropdownMenuItem>
                              <DropdownMenuItem asChild>
                                <Link href={`/workspaces/${workspaceSlug}/kafka/${topic.id}/metrics`}>
                                  <Activity className="h-4 w-4 mr-2" />
                                  Metrics
                                </Link>
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-red-600"
                                onClick={() => {
                                  setTopicToDelete(topic)
                                  setDeleteDialogOpen(true)
                                }}
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="discover">
          <Card>
            <CardHeader>
              <CardTitle>Discover Topics</CardTitle>
              <CardDescription>
                Browse topics from other workspaces that you can request access to
              </CardDescription>
            </CardHeader>
            <CardContent>
              {discoverableTopics.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <Share2 className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                  <p>No discoverable topics available</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Topic</TableHead>
                      <TableHead>Owner</TableHead>
                      <TableHead>Environment</TableHead>
                      <TableHead>Schema</TableHead>
                      <TableHead>Access</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {discoverableTopics.map((item) => (
                      <TableRow key={item.topic.id}>
                        <TableCell className="font-medium">{item.topic.name}</TableCell>
                        <TableCell>{item.owningWorkspaceName}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{item.topic.environment}</Badge>
                        </TableCell>
                        <TableCell>
                          {item.hasSchema ? (
                            <Badge variant="secondary">
                              <FileCode className="h-3 w-3 mr-1" />
                              Has Schema
                            </Badge>
                          ) : (
                            <span className="text-gray-400">None</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="secondary"
                            className={
                              item.accessStatus === 'approved'
                                ? 'bg-green-100 text-green-800'
                                : item.accessStatus === 'pending'
                                  ? 'bg-yellow-100 text-yellow-800'
                                  : 'bg-gray-100 text-gray-800'
                            }
                          >
                            {item.accessStatus || 'None'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Button variant="outline" size="sm">
                            Request Access
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Create Topic Dialog */}
      <CreateTopicDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        workspaceId={workspaceId}
        onSuccess={handleTopicCreated}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Topic</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the topic &quot;{topicToDelete?.name}&quot;? This
              action cannot be undone and will remove all data in the topic.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteTopic}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
