'use client'

import { useState, useTransition } from 'react'
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
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertCircle, Loader2, HelpCircle } from 'lucide-react'
import { createTopic, PolicyViolation } from '@/app/actions/kafka-topics'

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

interface VirtualClusterCreateTopicDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  virtualClusterId: string
  environment: string
  onSuccess: () => void
}

export function VirtualClusterCreateTopicDialog({
  open,
  onOpenChange,
  virtualClusterId,
  environment,
  onSuccess,
}: VirtualClusterCreateTopicDialogProps) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [violations, setViolations] = useState<PolicyViolation[]>([])

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [partitions, setPartitions] = useState(3)
  const [replicationFactor, setReplicationFactor] = useState(3)
  const [retentionMs, setRetentionMs] = useState(604800000) // 7 days
  const [cleanupPolicy, setCleanupPolicy] = useState<'delete' | 'compact' | 'compact,delete'>(
    'delete'
  )
  const [compression, setCompression] = useState<'none' | 'gzip' | 'snappy' | 'lz4' | 'zstd'>(
    'none'
  )
  const [visibility, setVisibility] = useState<'private' | 'workspace' | 'discoverable' | 'public'>('private')

  const resetForm = () => {
    setName('')
    setDescription('')
    setPartitions(3)
    setReplicationFactor(3)
    setRetentionMs(604800000)
    setCleanupPolicy('delete')
    setCompression('none')
    setVisibility('private')
    setError(null)
    setViolations([])
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setViolations([])

    // Basic validation
    if (!name.trim()) {
      setError('Topic name is required')
      return
    }

    const nameRegex = /^[a-z][a-z0-9-]*$/
    if (!nameRegex.test(name)) {
      setError('Topic name must start with a lowercase letter and contain only lowercase letters, numbers, and hyphens')
      return
    }

    startTransition(async () => {
      const result = await createTopic({
        virtualClusterId,
        name,
        description: description || undefined,
        partitions,
        replicationFactor,
        retentionMs,
        cleanupPolicy,
        compression,
        visibility,
      })

      if (result.success) {
        resetForm()
        onSuccess()
      } else {
        setError(result.error || 'Failed to create topic')
        if (result.policyViolations) {
          setViolations(result.policyViolations)
        }
      }
    })
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
          <DialogTitle>Create Topic</DialogTitle>
          <DialogDescription>
            Create a new Kafka topic in the {environment} environment.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && !violations.length && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {violations.length > 0 && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <div className="font-medium mb-1">Policy violations:</div>
                <ul className="list-disc list-inside text-sm space-y-1">
                  {violations.map((v, i) => (
                    <li key={i}>{v.message}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="name">Topic Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-topic"
              disabled={isPending}
            />
            <p className="text-xs text-muted-foreground">
              Lowercase letters, numbers, and hyphens only. Must start with a letter.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the purpose of this topic..."
              rows={2}
              disabled={isPending}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <LabelWithTooltip
                htmlFor="partitions"
                label="Partitions"
                tooltip="Number of partitions for parallel processing. More partitions allow higher throughput but use more resources."
              />
              <Input
                id="partitions"
                type="number"
                value={partitions}
                onChange={(e) => setPartitions(parseInt(e.target.value) || 1)}
                min={1}
                max={100}
                disabled={isPending}
              />
            </div>

            <div className="space-y-2">
              <LabelWithTooltip
                htmlFor="replication"
                label="Replication Factor"
                tooltip="Number of copies stored across different brokers. Higher values improve fault tolerance."
              />
              <Input
                id="replication"
                type="number"
                value={replicationFactor}
                onChange={(e) => setReplicationFactor(parseInt(e.target.value) || 1)}
                min={1}
                max={5}
                disabled={isPending}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <LabelWithTooltip
                htmlFor="retention"
                label="Retention"
                tooltip="How long messages are kept before being deleted. Longer retention uses more storage."
              />
              <Select
                value={retentionMs.toString()}
                onValueChange={(v) => setRetentionMs(parseInt(v))}
                disabled={isPending}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {retentionOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value.toString()}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <LabelWithTooltip
                htmlFor="cleanup"
                label="Cleanup Policy"
                tooltip="Delete: Remove old messages after retention. Compact: Keep only latest value per key."
              />
              <Select
                value={cleanupPolicy}
                onValueChange={(v) => setCleanupPolicy(v as typeof cleanupPolicy)}
                disabled={isPending}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="delete">Delete</SelectItem>
                  <SelectItem value="compact">Compact</SelectItem>
                  <SelectItem value="compact,delete">Compact + Delete</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <LabelWithTooltip
              htmlFor="compression"
              label="Compression"
              tooltip="Compress messages to reduce storage and network usage. LZ4 and Snappy are fast. Zstd offers best compression."
            />
            <Select
              value={compression}
              onValueChange={(v) => setCompression(v as typeof compression)}
              disabled={isPending}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="gzip">Gzip</SelectItem>
                <SelectItem value="snappy">Snappy</SelectItem>
                <SelectItem value="lz4">LZ4</SelectItem>
                <SelectItem value="zstd">Zstd</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <LabelWithTooltip
              htmlFor="visibility"
              label="Visibility"
              tooltip="Controls who can discover and request access to this topic. Private is only the owning application, Discoverable allows others to find it in the catalog."
            />
            <Select
              value={visibility}
              onValueChange={(v) => setVisibility(v as typeof visibility)}
              disabled={isPending}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="private">Private (Owning Application)</SelectItem>
                <SelectItem value="workspace">Workspace (Same Workspace)</SelectItem>
                <SelectItem value="discoverable">Discoverable (Catalog Listed)</SelectItem>
                <SelectItem value="public">Public (All Applications)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Controls who can discover and request access to this topic
            </p>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || !name}>
              {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create Topic
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
