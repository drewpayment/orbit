'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { AlertCircle, Inbox, Loader2, Send } from 'lucide-react'
import { useTopicMessages } from '@/hooks/useTopicMessages'
import { MessageFilterToolbar } from './MessageFilterToolbar'
import { MessagesTable } from './MessagesTable'
import { ProduceMessageSheet } from './ProduceMessageSheet'

interface TopicMessagesPanelProps {
  topicId: string
  workspaceId: string
  workspaceSlug: string
  partitionCount: number
}

export function TopicMessagesPanel({
  topicId,
  workspaceId,
  workspaceSlug,
  partitionCount,
}: TopicMessagesPanelProps) {
  const {
    messages,
    loading,
    loadingMore,
    error,
    hasMore,
    canProduce,
    seekMode,
    partition,
    startOffset,
    setSeekMode,
    setPartition,
    setStartOffset,
    fetchMessages,
    loadMore,
    refresh,
  } = useTopicMessages({ topicId, workspaceId })

  const [produceOpen, setProduceOpen] = useState(false)

  // Fetch on mount and when filters change
  useEffect(() => {
    fetchMessages()
  }, [fetchMessages])

  const handleProduceSuccess = () => {
    setProduceOpen(false)
    refresh()
  }

  if (loading && messages.length === 0) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error && messages.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16">
          <AlertCircle className="h-12 w-12 mb-4 text-destructive" />
          <h3 className="text-lg font-semibold mb-2">Unable to Load Messages</h3>
          <p className="text-muted-foreground text-sm mb-4">{error}</p>
          <Button variant="outline" onClick={refresh}>
            Try Again
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <MessageFilterToolbar
        seekMode={seekMode}
        onSeekModeChange={setSeekMode}
        partition={partition}
        onPartitionChange={setPartition}
        startOffset={startOffset}
        onStartOffsetChange={setStartOffset}
        partitionCount={partitionCount}
        canProduce={canProduce}
        onRefresh={refresh}
        onProduce={() => setProduceOpen(true)}
        loading={loading}
      />

      {messages.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Inbox className="h-12 w-12 mb-4 text-muted-foreground" />
            <h3 className="text-lg font-semibold mb-2">No Messages</h3>
            <p className="text-muted-foreground text-sm mb-4">
              This topic doesn&apos;t have any messages yet.
            </p>
            {canProduce && (
              <Button onClick={() => setProduceOpen(true)} size="sm">
                <Send className="h-4 w-4 mr-2" />
                Produce Your First Message
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <MessagesTable
          messages={messages}
          hasMore={hasMore}
          loadingMore={loadingMore}
          onLoadMore={loadMore}
        />
      )}

      {canProduce && (
        <ProduceMessageSheet
          topicId={topicId}
          workspaceId={workspaceId}
          open={produceOpen}
          onOpenChange={setProduceOpen}
          onSuccess={handleProduceSuccess}
        />
      )}
    </div>
  )
}
