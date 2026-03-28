'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { RefreshCw, Send } from 'lucide-react'
import type { SeekMode } from '@/app/actions/kafka-messages'

interface MessageFilterToolbarProps {
  seekMode: SeekMode
  onSeekModeChange: (mode: SeekMode) => void
  partition: number | null
  onPartitionChange: (partition: number | null) => void
  startOffset: number
  onStartOffsetChange: (offset: number) => void
  partitionCount: number
  canProduce: boolean
  onRefresh: () => void
  onProduce: () => void
  loading: boolean
}

export function MessageFilterToolbar({
  seekMode,
  onSeekModeChange,
  partition,
  onPartitionChange,
  startOffset,
  onStartOffsetChange,
  partitionCount,
  canProduce,
  onRefresh,
  onProduce,
  loading,
}: MessageFilterToolbarProps) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <Select
        value={seekMode}
        onValueChange={(v) => onSeekModeChange(v as SeekMode)}
      >
        <SelectTrigger className="w-[140px]">
          <SelectValue placeholder="Seek mode" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="NEWEST">Newest</SelectItem>
          <SelectItem value="OLDEST">Oldest</SelectItem>
          <SelectItem value="OFFSET">From Offset</SelectItem>
        </SelectContent>
      </Select>

      {seekMode === 'OFFSET' && (
        <Input
          type="number"
          min={0}
          value={startOffset}
          onChange={(e) => onStartOffsetChange(Number(e.target.value))}
          placeholder="Offset"
          className="w-[120px]"
        />
      )}

      <Select
        value={partition === null ? 'all' : String(partition)}
        onValueChange={(v) =>
          onPartitionChange(v === 'all' ? null : Number(v))
        }
      >
        <SelectTrigger className="w-[150px]">
          <SelectValue placeholder="Partition" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Partitions</SelectItem>
          {Array.from({ length: partitionCount }, (_, i) => (
            <SelectItem key={i} value={String(i)}>
              Partition {i}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        variant="outline"
        size="icon"
        onClick={onRefresh}
        disabled={loading}
      >
        <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
      </Button>

      <div className="flex-1" />

      {canProduce && (
        <Button onClick={onProduce} size="sm">
          <Send className="h-4 w-4 mr-2" />
          Produce Message
        </Button>
      )}
    </div>
  )
}
