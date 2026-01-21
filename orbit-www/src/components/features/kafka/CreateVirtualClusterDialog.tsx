'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { createVirtualCluster } from '@/app/actions/kafka-virtual-clusters'

interface CreateVirtualClusterDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  workspaceSlug: string
  onSuccess: () => void
}

const environments = [
  { value: 'dev', label: 'Development' },
  { value: 'staging', label: 'Staging' },
  { value: 'qa', label: 'QA' },
  { value: 'prod', label: 'Production' },
]

export function CreateVirtualClusterDialog({
  open,
  onOpenChange,
  workspaceId,
  workspaceSlug,
  onSuccess,
}: CreateVirtualClusterDialogProps) {
  const [name, setName] = useState('')
  const [nameManuallyEdited, setNameManuallyEdited] = useState(false)
  const [environment, setEnvironment] = useState('')
  const [loading, setLoading] = useState(false)

  const handleEnvironmentChange = (value: string) => {
    setEnvironment(value)
    if (!nameManuallyEdited) {
      setName(`${workspaceSlug}-${value}`)
    }
  }

  const handleNameChange = (value: string) => {
    setName(value)
    setNameManuallyEdited(true)
  }

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error('Name is required')
      return
    }
    if (!environment) {
      toast.error('Environment is required')
      return
    }
    if (!/^[a-z][a-z0-9-]*$/.test(name)) {
      toast.error(
        'Name must start with a letter and contain only lowercase letters, numbers, and hyphens'
      )
      return
    }

    setLoading(true)
    try {
      const result = await createVirtualCluster({
        name: name.trim(),
        environment,
        workspaceId,
      })
      if (result.success) {
        resetForm()
        onSuccess()
      } else {
        toast.error(result.error || 'Failed to create virtual cluster')
      }
    } catch {
      toast.error('Failed to create virtual cluster')
    } finally {
      setLoading(false)
    }
  }

  const resetForm = () => {
    setName('')
    setEnvironment('')
    setNameManuallyEdited(false)
  }

  const previewHost = name && environment
    ? `${name}.${environment}.kafka.orbit.io`
    : 'your-cluster.env.kafka.orbit.io'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Create Virtual Cluster</DialogTitle>
          <DialogDescription>
            Create a new isolated Kafka environment. Choose an environment and name for your cluster.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="environment">Environment</Label>
            <Select value={environment} onValueChange={handleEnvironmentChange} disabled={loading}>
              <SelectTrigger>
                <SelectValue placeholder="Select an environment" />
              </SelectTrigger>
              <SelectContent>
                {environments.map((env) => (
                  <SelectItem key={env.value} value={env.value}>
                    {env.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="name">Cluster Name</Label>
            <Input
              id="name"
              placeholder="e.g., payments-dev"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              disabled={loading}
            />
            <p className="text-sm text-muted-foreground">
              Endpoint: <code className="text-xs">{previewHost}</code>
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={loading || !name || !environment}>
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create Virtual Cluster
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
