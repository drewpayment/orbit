'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Loader2, HelpCircle } from 'lucide-react'
import { toast } from 'sonner'
import { createTopic } from '@/app/(frontend)/workspaces/[slug]/kafka/actions'

/**
 * Label with an info icon tooltip
 */
function LabelWithTooltip({
  htmlFor,
  label,
  tooltip,
}: {
  htmlFor: string
  label: string
  tooltip: string
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      <Tooltip>
        <TooltipTrigger asChild>
          <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[250px]">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}

interface CreateTopicDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  onSuccess: () => void
}

export function CreateTopicDialog({
  open,
  onOpenChange,
  workspaceId,
  onSuccess,
}: CreateTopicDialogProps) {
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    environment: 'development',
    partitions: 3,
    replicationFactor: 3,
    retentionMs: 604800000, // 7 days
    cleanupPolicy: 'delete',
    compression: 'none',
    description: '',
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.name.trim()) {
      toast.error('Topic name is required')
      return
    }

    // Validate topic name format (lowercase, alphanumeric, dots, underscores, hyphens)
    const nameRegex = /^[a-z0-9][a-z0-9._-]*$/
    if (!nameRegex.test(formData.name)) {
      toast.error(
        'Topic name must start with a letter or number and contain only lowercase letters, numbers, dots, underscores, and hyphens'
      )
      return
    }

    setLoading(true)
    try {
      const result = await createTopic({
        workspaceId,
        name: formData.name,
        environment: formData.environment,
        partitions: formData.partitions,
        replicationFactor: formData.replicationFactor,
        retentionMs: formData.retentionMs,
        cleanupPolicy: formData.cleanupPolicy,
        compression: formData.compression,
        description: formData.description,
      })

      if (result.success) {
        onSuccess()
        // Reset form
        setFormData({
          name: '',
          environment: 'development',
          partitions: 3,
          replicationFactor: 3,
          retentionMs: 604800000,
          cleanupPolicy: 'delete',
          compression: 'none',
          description: '',
        })
      } else {
        toast.error(result.error || 'Failed to create topic')
      }
    } catch (error) {
      toast.error('Failed to create topic')
    } finally {
      setLoading(false)
    }
  }

  const retentionOptions = [
    { value: 3600000, label: '1 hour' },
    { value: 86400000, label: '1 day' },
    { value: 604800000, label: '7 days' },
    { value: 2592000000, label: '30 days' },
    { value: 7776000000, label: '90 days' },
    { value: -1, label: 'Forever' },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Create Kafka Topic</DialogTitle>
          <DialogDescription>
            Create a new Kafka topic for publishing and subscribing to events.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Topic Name</Label>
            <Input
              id="name"
              placeholder="my-topic-name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              disabled={loading}
            />
            <p className="text-xs text-gray-500">
              Use lowercase letters, numbers, dots, underscores, and hyphens
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="environment">Environment</Label>
            <Select
              value={formData.environment}
              onValueChange={(value) => setFormData({ ...formData, environment: value })}
              disabled={loading}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select environment" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="development">Development</SelectItem>
                <SelectItem value="staging">Staging</SelectItem>
                <SelectItem value="production">Production</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <LabelWithTooltip
                htmlFor="partitions"
                label="Partitions"
                tooltip="Number of partitions for parallel processing. More partitions allow higher throughput but use more resources. Cannot be decreased after creation."
              />
              <Input
                id="partitions"
                type="number"
                min={1}
                max={100}
                value={formData.partitions}
                onChange={(e) =>
                  setFormData({ ...formData, partitions: parseInt(e.target.value) || 1 })
                }
                disabled={loading}
              />
            </div>

            <div className="space-y-2">
              <LabelWithTooltip
                htmlFor="replicationFactor"
                label="Replication Factor"
                tooltip="Number of copies of each partition stored across different brokers. Higher values improve fault tolerance but require more storage. Cannot be changed after creation."
              />
              <Input
                id="replicationFactor"
                type="number"
                min={1}
                max={5}
                value={formData.replicationFactor}
                onChange={(e) =>
                  setFormData({ ...formData, replicationFactor: parseInt(e.target.value) || 1 })
                }
                disabled={loading}
              />
            </div>
          </div>

          <div className="space-y-2">
            <LabelWithTooltip
              htmlFor="retention"
              label="Retention Period"
              tooltip="How long messages are kept before being deleted. Longer retention uses more storage. Choose based on how long consumers need to access historical data."
            />
            <Select
              value={formData.retentionMs.toString()}
              onValueChange={(value) =>
                setFormData({ ...formData, retentionMs: parseInt(value) })
              }
              disabled={loading}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select retention" />
              </SelectTrigger>
              <SelectContent>
                {retentionOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value.toString()}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <LabelWithTooltip
                htmlFor="cleanupPolicy"
                label="Cleanup Policy"
                tooltip="Delete: Remove old messages after retention period. Compact: Keep only the latest value per key. Compact & Delete: Compact first, then delete after retention."
              />
              <Select
                value={formData.cleanupPolicy}
                onValueChange={(value) => setFormData({ ...formData, cleanupPolicy: value })}
                disabled={loading}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select policy" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="delete">Delete</SelectItem>
                  <SelectItem value="compact">Compact</SelectItem>
                  <SelectItem value="compact,delete">Compact & Delete</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <LabelWithTooltip
                htmlFor="compression"
                label="Compression"
                tooltip="Compress messages to reduce storage and network usage. LZ4 and Snappy are fast with moderate compression. Zstd offers best compression. Gzip is widely compatible."
              />
              <Select
                value={formData.compression}
                onValueChange={(value) => setFormData({ ...formData, compression: value })}
                disabled={loading}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select compression" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="gzip">Gzip</SelectItem>
                  <SelectItem value="snappy">Snappy</SelectItem>
                  <SelectItem value="lz4">LZ4</SelectItem>
                  <SelectItem value="zstd">Zstandard</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea
              id="description"
              placeholder="Describe the purpose of this topic..."
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              disabled={loading}
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create Topic
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
