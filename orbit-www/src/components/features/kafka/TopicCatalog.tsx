'use client'

import { useState, useEffect, useCallback, useTransition, useMemo } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import { Search, Filter, ExternalLink, Lock, Globe, Building2 } from 'lucide-react'
import {
  searchTopicCatalog,
  requestTopicAccess,
  type TopicCatalogEntry,
  type SearchTopicCatalogInput
} from '@/app/actions/kafka-topic-catalog'

interface TopicCatalogProps {
  currentWorkspaceId: string
  currentWorkspaceName: string
}

const visibilityIcons = {
  private: Lock,
  workspace: Building2,
  discoverable: Search,
  public: Globe,
}

const visibilityLabels = {
  private: 'Private',
  workspace: 'Workspace',
  discoverable: 'Discoverable',
  public: 'Public',
}

export function TopicCatalog({ currentWorkspaceId, currentWorkspaceName }: TopicCatalogProps) {
  const [topics, setTopics] = useState<TopicCatalogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('')
  const [environmentFilter, setEnvironmentFilter] = useState<string>('all')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [isPending, startTransition] = useTransition()

  // Debounce search query to avoid excessive API calls
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery)
      setPage(1) // Reset to page 1 on new search
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // Reset page when environment filter changes
  const handleEnvironmentChange = useCallback((value: string) => {
    setEnvironmentFilter(value)
    setPage(1)
  }, [])

  // Request access dialog state
  const [requestDialogOpen, setRequestDialogOpen] = useState(false)
  const [selectedTopic, setSelectedTopic] = useState<TopicCatalogEntry | null>(null)
  const [accessLevel, setAccessLevel] = useState<'read' | 'write' | 'read-write'>('read')
  const [accessReason, setAccessReason] = useState('')

  const loadTopics = useCallback(async () => {
    setLoading(true)
    try {
      const input: SearchTopicCatalogInput = {
        query: debouncedSearchQuery || undefined,
        environment: environmentFilter !== 'all' ? environmentFilter : undefined,
        page,
        limit: 20,
      }
      const result = await searchTopicCatalog(input)
      if (result.success) {
        setTopics(result.topics ?? [])
        setTotalPages(result.totalPages ?? 1)
      } else {
        toast.error(result.error || 'Failed to load topics')
      }
    } catch (error) {
      console.error('Failed to load topic catalog:', error)
      toast.error('Failed to load topic catalog')
    } finally {
      setLoading(false)
    }
  }, [debouncedSearchQuery, environmentFilter, page])

  useEffect(() => {
    loadTopics()
  }, [loadTopics])

  const handleRequestAccess = (topic: TopicCatalogEntry) => {
    setSelectedTopic(topic)
    setAccessLevel('read')
    setAccessReason('')
    setRequestDialogOpen(true)
  }

  const submitAccessRequest = async () => {
    if (!selectedTopic) return

    startTransition(async () => {
      const result = await requestTopicAccess({
        topicId: selectedTopic.id,
        accessLevel,
        reason: accessReason,
        requestingWorkspaceId: currentWorkspaceId,
      })

      if (result.success) {
        if (result.autoApproved) {
          toast.success('Access granted automatically!')
        } else {
          toast.success('Access request submitted')
        }
        setRequestDialogOpen(false)
        loadTopics()
      } else {
        toast.error(result.error || 'Failed to request access')
      }
    })
  }

  const getShareStatusBadge = (topic: TopicCatalogEntry) => {
    if (!topic.hasActiveShare) return null
    if (topic.shareStatus === 'approved') {
      return <Badge className="bg-green-100 text-green-800 border-green-200">Access Granted</Badge>
    }
    if (topic.shareStatus === 'pending') {
      return <Badge variant="secondary">Pending</Badge>
    }
    return null
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Topic Catalog</CardTitle>
        <CardDescription>
          Discover and request access to topics shared across the platform
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Search and Filters */}
        <div className="flex gap-4 mb-6">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search topics..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={environmentFilter} onValueChange={handleEnvironmentChange}>
            <SelectTrigger className="w-[180px]">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Environment" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Environments</SelectItem>
              <SelectItem value="dev">Development</SelectItem>
              <SelectItem value="stage">Staging</SelectItem>
              <SelectItem value="prod">Production</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Topics Table */}
        {loading ? (
          <div className="text-center py-8 text-muted-foreground">Loading...</div>
        ) : topics.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No topics found matching your criteria
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Topic</TableHead>
                  <TableHead>Workspace</TableHead>
                  <TableHead>Environment</TableHead>
                  <TableHead>Visibility</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topics.map((topic) => {
                  const VisibilityIcon = visibilityIcons[topic.visibility]
                  const isOwnWorkspace = topic.workspace.id === currentWorkspaceId

                  return (
                    <TableRow key={topic.id}>
                      <TableCell>
                        <div>
                          <div className="font-medium">{topic.name}</div>
                          {topic.description && (
                            <div className="text-sm text-muted-foreground truncate max-w-[300px]">
                              {topic.description}
                            </div>
                          )}
                          {topic.tags.length > 0 && (
                            <div className="flex gap-1 mt-1">
                              {topic.tags.slice(0, 3).map((tag) => (
                                <Badge key={tag} variant="outline" className="text-xs">
                                  {tag}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span>{topic.workspace.name}</span>
                          {isOwnWorkspace && (
                            <Badge variant="secondary" className="text-xs">You</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{topic.environment}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <VisibilityIcon className="h-4 w-4" />
                          <span className="text-sm">{visibilityLabels[topic.visibility]}</span>
                        </div>
                      </TableCell>
                      <TableCell>{getShareStatusBadge(topic)}</TableCell>
                      <TableCell className="text-right">
                        {isOwnWorkspace ? (
                          <Button variant="ghost" size="sm" asChild>
                            <a href={`/${topic.workspace.slug}/kafka/applications`}>
                              <ExternalLink className="h-4 w-4 mr-1" />
                              View
                            </a>
                          </Button>
                        ) : topic.hasActiveShare ? (
                          <span className="text-sm text-muted-foreground">
                            {topic.shareStatus === 'approved' ? 'Granted' : 'Requested'}
                          </span>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleRequestAccess(topic)}
                          >
                            Request Access
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex justify-center gap-2 mt-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  Previous
                </Button>
                <span className="py-2 px-4 text-sm">
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                >
                  Next
                </Button>
              </div>
            )}
          </>
        )}

        {/* Request Access Dialog */}
        <Dialog open={requestDialogOpen} onOpenChange={setRequestDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Request Topic Access</DialogTitle>
              <DialogDescription>
                Request access to <strong>{selectedTopic?.name}</strong> from{' '}
                <strong>{selectedTopic?.workspace.name}</strong>
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Access Level</Label>
                <Select value={accessLevel} onValueChange={(v) => setAccessLevel(v as 'read' | 'write' | 'read-write')}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="read">Read (Consume)</SelectItem>
                    <SelectItem value="write">Write (Produce)</SelectItem>
                    <SelectItem value="read-write">Read + Write</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Reason for Access</Label>
                <Textarea
                  placeholder="Explain why you need access to this topic..."
                  value={accessReason}
                  onChange={(e) => setAccessReason(e.target.value)}
                  rows={3}
                />
              </div>
              <div className="text-sm text-muted-foreground">
                Requesting access for: <strong>{currentWorkspaceName}</strong>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRequestDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={submitAccessRequest}
                disabled={isPending || !accessReason.trim()}
              >
                {isPending ? 'Submitting...' : 'Submit Request'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}
