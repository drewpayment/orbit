'use client'

import { useState, useEffect, useCallback } from 'react'
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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import {
  RefreshCw,
  MoreHorizontal,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  Users,
  AlertTriangle,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  listConsumerGroups,
  describeConsumerGroup,
  resetConsumerGroupOffsets,
  ConsumerGroupSummary,
  ConsumerGroupDetail,
  PartitionLag,
} from '@/app/actions/kafka-consumer-groups'

interface ConsumerGroupsPanelProps {
  virtualClusterId: string
  canManage?: boolean
}

const stateConfig: Record<string, { label: string; className: string }> = {
  Stable: {
    label: 'Stable',
    className: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-200',
  },
  PreparingRebalance: {
    label: 'Rebalancing',
    className: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-200',
  },
  CompletingRebalance: {
    label: 'Rebalancing',
    className: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-200',
  },
  Empty: {
    label: 'Empty',
    className: 'bg-gray-100 text-gray-700 dark:bg-gray-900 dark:text-gray-200',
  },
  Dead: {
    label: 'Dead',
    className: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200',
  },
  Unknown: {
    label: 'Unknown',
    className: 'bg-gray-100 text-gray-700 dark:bg-gray-900 dark:text-gray-200',
  },
}

function formatLag(lag: number): string {
  if (lag === 0) return '0'
  if (lag < 1000) return lag.toString()
  if (lag < 1000000) return `${(lag / 1000).toFixed(1)}K`
  return `${(lag / 1000000).toFixed(1)}M`
}

function getLagSeverity(lag: number): 'ok' | 'warning' | 'critical' {
  if (lag === 0) return 'ok'
  if (lag < 1000) return 'ok'
  if (lag < 10000) return 'warning'
  return 'critical'
}

const lagColors = {
  ok: 'text-green-600 dark:text-green-400',
  warning: 'text-yellow-600 dark:text-yellow-400',
  critical: 'text-red-600 dark:text-red-400',
}

export function ConsumerGroupsPanel({ virtualClusterId, canManage = false }: ConsumerGroupsPanelProps) {
  const [groups, setGroups] = useState<ConsumerGroupSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)
  const [groupDetails, setGroupDetails] = useState<ConsumerGroupDetail | null>(null)
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [resetDialogOpen, setResetDialogOpen] = useState(false)
  const [selectedGroup, setSelectedGroup] = useState<ConsumerGroupSummary | null>(null)
  const [selectedTopic, setSelectedTopic] = useState<string>('')
  const [resetType, setResetType] = useState<'earliest' | 'latest'>('earliest')
  const [resetting, setResetting] = useState(false)

  const loadGroups = useCallback(async () => {
    setLoading(true)
    try {
      const result = await listConsumerGroups(virtualClusterId)
      if (result.success && result.data) {
        setGroups(result.data)
      } else {
        toast.error(result.error || 'Failed to load consumer groups')
      }
    } catch {
      toast.error('Failed to load consumer groups')
    } finally {
      setLoading(false)
    }
  }, [virtualClusterId])

  useEffect(() => {
    loadGroups()
  }, [loadGroups])

  const toggleExpand = async (groupId: string) => {
    if (expandedGroup === groupId) {
      setExpandedGroup(null)
      setGroupDetails(null)
      return
    }

    setExpandedGroup(groupId)
    setLoadingDetails(true)
    try {
      const result = await describeConsumerGroup(virtualClusterId, groupId)
      if (result.success && result.data) {
        setGroupDetails(result.data)
      } else {
        toast.error(result.error || 'Failed to load group details')
        setExpandedGroup(null)
      }
    } catch {
      toast.error('Failed to load group details')
      setExpandedGroup(null)
    } finally {
      setLoadingDetails(false)
    }
  }

  const handleResetOffsets = async () => {
    if (!selectedGroup || !selectedTopic) return

    setResetting(true)
    try {
      const result = await resetConsumerGroupOffsets(
        virtualClusterId,
        selectedGroup.groupId,
        selectedTopic,
        resetType
      )
      if (result.success) {
        toast.success('Offsets reset successfully')
        setResetDialogOpen(false)
        // Refresh the group details
        if (expandedGroup === selectedGroup.groupId) {
          const detailResult = await describeConsumerGroup(virtualClusterId, selectedGroup.groupId)
          if (detailResult.success && detailResult.data) {
            setGroupDetails(detailResult.data)
          }
        }
        loadGroups()
      } else {
        toast.error(result.error || 'Failed to reset offsets')
      }
    } catch {
      toast.error('Failed to reset offsets')
    } finally {
      setResetting(false)
    }
  }

  const openResetDialog = (group: ConsumerGroupSummary) => {
    setSelectedGroup(group)
    setSelectedTopic(group.topics[0] || '')
    setResetType('earliest')
    setResetDialogOpen(true)
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Consumer Groups</CardTitle>
              <CardDescription>Active consumer groups in this virtual cluster</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={loadGroups} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {groups.length === 0 ? (
            <div className="text-center py-12">
              <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Consumer Groups</h3>
              <p className="text-muted-foreground max-w-md mx-auto">
                No consumer groups are currently active in this virtual cluster.
                Consumer groups will appear here when clients start consuming messages.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[30px]"></TableHead>
                  <TableHead>Group ID</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead className="text-right">Members</TableHead>
                  <TableHead className="text-right">Total Lag</TableHead>
                  <TableHead>Topics</TableHead>
                  {canManage && <TableHead className="w-[50px]"></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((group) => (
                  <>
                    <TableRow
                      key={group.groupId}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => toggleExpand(group.groupId)}
                    >
                      <TableCell>
                        {expandedGroup === group.groupId ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </TableCell>
                      <TableCell className="font-medium font-mono text-sm">
                        {group.groupId}
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={stateConfig[group.state]?.className || stateConfig.Unknown.className}
                        >
                          {stateConfig[group.state]?.label || group.state}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{group.memberCount}</TableCell>
                      <TableCell className={`text-right font-mono ${lagColors[getLagSeverity(group.totalLag)]}`}>
                        {formatLag(group.totalLag)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {group.topics.slice(0, 3).map((topic) => (
                            <Badge key={topic} variant="outline" className="font-mono text-xs">
                              {topic}
                            </Badge>
                          ))}
                          {group.topics.length > 3 && (
                            <Badge variant="outline" className="text-xs">
                              +{group.topics.length - 3} more
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      {canManage && (
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={group.state !== 'Empty'}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openResetDialog(group)}>
                                <RotateCcw className="h-4 w-4 mr-2" />
                                Reset Offsets
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      )}
                    </TableRow>
                    {expandedGroup === group.groupId && (
                      <TableRow>
                        <TableCell colSpan={canManage ? 7 : 6} className="bg-muted/30 p-0">
                          {loadingDetails ? (
                            <div className="flex items-center justify-center py-8">
                              <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
                            </div>
                          ) : groupDetails ? (
                            <PartitionLagTable partitions={groupDetails.partitions} />
                          ) : null}
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Reset Offsets Dialog */}
      <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Consumer Group Offsets</DialogTitle>
            <DialogDescription>
              Reset offsets for group &quot;{selectedGroup?.groupId}&quot;. The consumer group must
              be empty (no active consumers) for this to work.
            </DialogDescription>
          </DialogHeader>
          {selectedGroup?.state !== 'Empty' && (
            <div className="flex items-center gap-2 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md">
              <AlertTriangle className="h-5 w-5 text-yellow-600" />
              <p className="text-sm text-yellow-700 dark:text-yellow-300">
                This consumer group has active members. Stop all consumers before resetting offsets.
              </p>
            </div>
          )}
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Topic</Label>
              <Select value={selectedTopic} onValueChange={setSelectedTopic}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a topic" />
                </SelectTrigger>
                <SelectContent>
                  {selectedGroup?.topics.map((topic) => (
                    <SelectItem key={topic} value={topic}>
                      {topic}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Reset To</Label>
              <Select value={resetType} onValueChange={(v) => setResetType(v as 'earliest' | 'latest')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="earliest">Earliest (beginning)</SelectItem>
                  <SelectItem value="latest">Latest (end)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleResetOffsets}
              disabled={!selectedTopic || selectedGroup?.state !== 'Empty' || resetting}
            >
              {resetting ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Resetting...
                </>
              ) : (
                'Reset Offsets'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

interface PartitionLagTableProps {
  partitions: PartitionLag[]
}

function PartitionLagTable({ partitions }: PartitionLagTableProps) {
  // Group partitions by topic
  const byTopic = partitions.reduce(
    (acc, p) => {
      if (!acc[p.topic]) acc[p.topic] = []
      acc[p.topic].push(p)
      return acc
    },
    {} as Record<string, PartitionLag[]>
  )

  return (
    <div className="p-4 space-y-4">
      {Object.entries(byTopic).map(([topic, topicPartitions]) => (
        <div key={topic}>
          <h4 className="font-medium text-sm mb-2 font-mono">{topic}</h4>
          <div className="border rounded-md overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[100px]">Partition</TableHead>
                  <TableHead className="text-right">Current Offset</TableHead>
                  <TableHead className="text-right">End Offset</TableHead>
                  <TableHead className="text-right">Lag</TableHead>
                  <TableHead>Consumer ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topicPartitions
                  .sort((a, b) => a.partition - b.partition)
                  .map((p) => (
                    <TableRow key={p.partition}>
                      <TableCell className="font-mono">{p.partition}</TableCell>
                      <TableCell className="text-right font-mono">
                        {p.currentOffset.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {p.endOffset.toLocaleString()}
                      </TableCell>
                      <TableCell
                        className={`text-right font-mono ${lagColors[getLagSeverity(p.lag)]}`}
                      >
                        {p.lag.toLocaleString()}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground truncate max-w-[200px]">
                        {p.consumerId || '-'}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        </div>
      ))}
    </div>
  )
}
