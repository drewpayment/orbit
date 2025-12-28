'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { ArrowLeft, Save } from 'lucide-react'
import type { KafkaClusterConfig } from '@/app/actions/kafka-admin'

interface MappingFormProps {
  clusters: KafkaClusterConfig[]
  onBack: () => void
  onSave: (data: {
    environment: string
    clusterId: string
    priority: number
    isDefault: boolean
  }) => Promise<void>
}

const ENVIRONMENTS = ['development', 'staging', 'production'] as const

export function MappingForm({ clusters, onBack, onSave }: MappingFormProps) {
  const [environment, setEnvironment] = useState<string>('')
  const [clusterId, setClusterId] = useState<string>('')
  const [priority, setPriority] = useState<number>(0)
  const [isDefault, setIsDefault] = useState<boolean>(false)
  const [isSaving, setIsSaving] = useState(false)

  const handleSave = async () => {
    if (!environment || !clusterId) return

    setIsSaving(true)
    try {
      await onSave({
        environment,
        clusterId,
        priority,
        isDefault,
      })
    } finally {
      setIsSaving(false)
    }
  }

  const isValid = environment && clusterId

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h2 className="text-xl font-semibold">New Environment Mapping</h2>
          <p className="text-sm text-muted-foreground">
            Map a Kafka cluster to a deployment environment
          </p>
        </div>
      </div>

      {/* Form */}
      <Card>
        <CardHeader>
          <CardTitle>Mapping Configuration</CardTitle>
          <CardDescription>
            Select an environment and cluster to create the mapping
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Environment */}
          <div className="space-y-2">
            <Label htmlFor="environment">Environment</Label>
            <Select value={environment} onValueChange={setEnvironment}>
              <SelectTrigger>
                <SelectValue placeholder="Select environment" />
              </SelectTrigger>
              <SelectContent>
                {ENVIRONMENTS.map((env) => (
                  <SelectItem key={env} value={env}>
                    {env.charAt(0).toUpperCase() + env.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Cluster */}
          <div className="space-y-2">
            <Label htmlFor="cluster">Kafka Cluster</Label>
            <Select value={clusterId} onValueChange={setClusterId}>
              <SelectTrigger>
                <SelectValue placeholder="Select cluster" />
              </SelectTrigger>
              <SelectContent>
                {clusters.map((cluster) => (
                  <SelectItem key={cluster.id} value={cluster.id}>
                    {cluster.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {clusters.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No clusters available. Create a cluster first.
              </p>
            )}
          </div>

          {/* Priority */}
          <div className="space-y-2">
            <Label htmlFor="priority">Priority</Label>
            <Input
              id="priority"
              type="number"
              min="0"
              value={priority}
              onChange={(e) => setPriority(parseInt(e.target.value) || 0)}
            />
            <p className="text-xs text-muted-foreground">
              Lower numbers have higher priority (0 is highest)
            </p>
          </div>

          {/* Is Default */}
          <div className="flex items-center space-x-2">
            <Checkbox
              id="isDefault"
              checked={isDefault}
              onCheckedChange={(checked) => setIsDefault(checked === true)}
            />
            <Label htmlFor="isDefault">Set as default for this environment</Label>
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onBack}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={isSaving || !isValid}>
          <Save className="h-4 w-4 mr-2" />
          {isSaving ? 'Creating...' : 'Create Mapping'}
        </Button>
      </div>
    </div>
  )
}
