'use client'

import { useState, useCallback, useRef } from 'react'
import {
  browseTopicMessages,
  type BrowseMessagesInput,
  type MessageItem,
  type SeekMode,
} from '@/app/actions/kafka-messages'

interface UseTopicMessagesOptions {
  topicId: string
  workspaceId: string
}

interface UseTopicMessagesReturn {
  messages: MessageItem[]
  loading: boolean
  loadingMore: boolean
  error: string | null
  hasMore: boolean
  canProduce: boolean
  seekMode: SeekMode
  partition: number | null
  startOffset: number
  setSeekMode: (mode: SeekMode) => void
  setPartition: (partition: number | null) => void
  setStartOffset: (offset: number) => void
  fetchMessages: () => Promise<void>
  loadMore: () => Promise<void>
  refresh: () => Promise<void>
}

export function useTopicMessages({
  topicId,
  workspaceId,
}: UseTopicMessagesOptions): UseTopicMessagesReturn {
  const [messages, setMessages] = useState<MessageItem[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [canProduce, setCanProduce] = useState(false)
  const [seekMode, setSeekMode] = useState<SeekMode>('NEWEST')
  const [partition, setPartition] = useState<number | null>(null)
  const [startOffset, setStartOffset] = useState(0)
  const cursorRef = useRef<string | null>(null)

  const fetchMessages = useCallback(async () => {
    setLoading(true)
    setError(null)
    cursorRef.current = null

    const input: BrowseMessagesInput = {
      topicId,
      workspaceId,
      seekType: seekMode,
      startOffset: seekMode === 'OFFSET' ? startOffset : undefined,
      partition,
      cursor: null,
    }

    const result = await browseTopicMessages(input)

    if (result.success && result.messages) {
      setMessages(result.messages)
      setHasMore(result.hasMore ?? false)
      setCanProduce(result.canProduce ?? false)
      cursorRef.current = result.nextCursor ?? null
    } else {
      setError(result.error ?? 'Failed to fetch messages')
      setMessages([])
    }

    setLoading(false)
  }, [topicId, workspaceId, seekMode, startOffset, partition])

  const loadMore = useCallback(async () => {
    if (!cursorRef.current || loadingMore) return

    setLoadingMore(true)

    const input: BrowseMessagesInput = {
      topicId,
      workspaceId,
      seekType: seekMode,
      partition,
      cursor: cursorRef.current,
    }

    const result = await browseTopicMessages(input)

    if (result.success && result.messages) {
      setMessages((prev) => [...prev, ...result.messages!])
      setHasMore(result.hasMore ?? false)
      cursorRef.current = result.nextCursor ?? null
    } else {
      setError(result.error ?? 'Failed to load more messages')
    }

    setLoadingMore(false)
  }, [topicId, workspaceId, seekMode, partition, loadingMore])

  const refresh = useCallback(async () => {
    await fetchMessages()
  }, [fetchMessages])

  return {
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
  }
}
