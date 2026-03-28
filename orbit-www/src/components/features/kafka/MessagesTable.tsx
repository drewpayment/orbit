'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { MessageDetail } from './MessageDetail'
import type { MessageItem } from '@/app/actions/kafka-messages'

interface MessagesTableProps {
  messages: MessageItem[]
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
}

export function MessagesTable({
  messages,
  hasMore,
  loadingMore,
  onLoadMore,
}: MessagesTableProps) {
  const [expandedRow, setExpandedRow] = useState<string | null>(null)

  const toggleRow = (key: string) => {
    setExpandedRow((prev) => (prev === key ? null : key))
  }

  return (
    <div className="rounded-md border">
      <table className="w-full">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="w-8 p-2" />
            <th className="text-left text-xs font-medium text-muted-foreground p-2 w-[80px]">
              Partition
            </th>
            <th className="text-left text-xs font-medium text-muted-foreground p-2 w-[100px]">
              Offset
            </th>
            <th className="text-left text-xs font-medium text-muted-foreground p-2 w-[160px]">
              Timestamp
            </th>
            <th className="text-left text-xs font-medium text-muted-foreground p-2 w-[150px]">
              Key
            </th>
            <th className="text-left text-xs font-medium text-muted-foreground p-2">
              Value
            </th>
            <th className="text-left text-xs font-medium text-muted-foreground p-2 w-[80px]">
              Size
            </th>
          </tr>
        </thead>
        <tbody>
          {messages.map((msg) => {
            const rowKey = `${msg.partition}-${msg.offset}`
            const isExpanded = expandedRow === rowKey
            const timestamp = new Date(msg.timestamp)

            return (
              <MessageRow
                key={rowKey}
                rowKey={rowKey}
                message={msg}
                timestamp={timestamp}
                isExpanded={isExpanded}
                onToggle={toggleRow}
              />
            )
          })}
        </tbody>
      </table>

      {hasMore && (
        <div className="flex justify-center p-3 border-t">
          <Button
            variant="outline"
            size="sm"
            onClick={onLoadMore}
            disabled={loadingMore}
          >
            {loadingMore && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Load More
          </Button>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// MessageRow
// ============================================================================

interface MessageRowProps {
  rowKey: string
  message: MessageItem
  timestamp: Date
  isExpanded: boolean
  onToggle: (key: string) => void
}

function MessageRow({
  rowKey,
  message,
  timestamp,
  isExpanded,
  onToggle,
}: MessageRowProps) {
  return (
    <>
      <tr
        className="border-b hover:bg-muted/30 cursor-pointer transition-colors"
        onClick={() => onToggle(rowKey)}
      >
        <td className="p-2 text-center">
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </td>
        <td className="p-2">
          <span className="inline-flex items-center justify-center h-5 min-w-[20px] px-1.5 rounded bg-muted text-xs font-mono">
            {message.partition}
          </span>
        </td>
        <td className="p-2 font-mono text-xs">{message.offset}</td>
        <td className="p-2 text-xs text-muted-foreground" title={timestamp.toISOString()}>
          {formatDistanceToNow(timestamp, { addSuffix: true })}
        </td>
        <td className="p-2">
          <pre className="text-xs font-mono truncate max-w-[150px]">
            {message.key ?? <span className="text-muted-foreground italic">null</span>}
          </pre>
        </td>
        <td className="p-2">
          <pre className="text-xs font-mono truncate max-w-[400px]">
            {message.value ?? <span className="text-muted-foreground italic">null</span>}
          </pre>
        </td>
        <td className="p-2 text-xs text-muted-foreground">
          {formatBytes(message.valueSize)}
        </td>
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={7}>
            <MessageDetail message={message} />
          </td>
        </tr>
      )}
    </>
  )
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}
