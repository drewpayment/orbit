'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { ArrowLeft } from 'lucide-react'
import type { VirtualClusterConfig } from '@/app/actions/bifrost-admin'

interface VirtualClusterFormProps {
  cluster: VirtualClusterConfig | null
  onCancel: () => void
  onSuccess: () => void
}

export function VirtualClusterForm({
  cluster,
  onCancel,
  onSuccess,
}: VirtualClusterFormProps) {
  const isEditing = !!cluster

  const [formData, setFormData] = useState({
    id: cluster?.id || '',
    workspaceSlug: cluster?.workspaceSlug || '',
    environment: cluster?.environment || 'dev',
    topicPrefix: cluster?.topicPrefix || '',
    groupPrefix: cluster?.groupPrefix || '',
    transactionIdPrefix: cluster?.transactionIdPrefix || '',
    advertisedHost: cluster?.advertisedHost || '',
    advertisedPort: cluster?.advertisedPort || 9092,
    physicalBootstrapServers: cluster?.physicalBootstrapServers || 'redpanda:9092',
  })

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Auto-generate prefixes and host based on workspace + environment
  const generateDefaults = (workspace: string, env: string) => {
    if (!workspace) return

    const prefix = `${workspace}-${env}-`
    const host = `${workspace}-${env}.dev.kafka.orbit.io`

    setFormData((prev) => ({
      ...prev,
      topicPrefix: prefix,
      groupPrefix: prefix,
      transactionIdPrefix: prefix,
      advertisedHost: host,
    }))
  }

  // Update defaults when workspace or environment changes (only for new clusters)
  const handleWorkspaceChange = (value: string) => {
    setFormData({ ...formData, workspaceSlug: value })
    if (!isEditing) {
      generateDefaults(value, formData.environment)
    }
  }

  const handleEnvironmentChange = (value: string) => {
    setFormData({ ...formData, environment: value })
    if (!isEditing) {
      generateDefaults(formData.workspaceSlug, value)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)

    try {
      const { createVirtualCluster } = await import('@/app/actions/bifrost-admin')
      const result = await createVirtualCluster({
        id: formData.id || undefined,
        workspaceSlug: formData.workspaceSlug,
        environment: formData.environment,
        topicPrefix: formData.topicPrefix,
        groupPrefix: formData.groupPrefix,
        transactionIdPrefix: formData.transactionIdPrefix,
        advertisedHost: formData.advertisedHost,
        advertisedPort: formData.advertisedPort,
        physicalBootstrapServers: formData.physicalBootstrapServers,
      })

      if (result.success) {
        onSuccess()
      } else {
        setError(result.error || 'Failed to save virtual cluster')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save virtual cluster')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <CardTitle>{isEditing ? 'Edit Virtual Cluster' : 'Create Virtual Cluster'}</CardTitle>
            <CardDescription>
              {isEditing
                ? 'Update virtual cluster configuration'
                : 'Select a workspace and environment to create a virtual cluster'}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="p-4 bg-destructive/10 text-destructive rounded-lg text-sm">
              {error}
            </div>
          )}

          {!isEditing && (
            <div className="p-4 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg">
              <p className="text-sm text-blue-900 dark:text-blue-100">
                <strong>Note:</strong> All configuration will be automatically generated based on your workspace and environment selection.
                IDs, prefixes, and hostnames follow Orbit&apos;s naming conventions.
              </p>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">

            <div className="space-y-2">
              <Label htmlFor="workspaceSlug">Workspace Slug *</Label>
              <Input
                id="workspaceSlug"
                value={formData.workspaceSlug}
                onChange={(e) => handleWorkspaceChange(e.target.value)}
                placeholder="my-workspace"
                required
                disabled={isEditing}
                className={isEditing ? 'bg-muted cursor-not-allowed' : ''}
              />
              {isEditing && (
                <p className="text-xs text-muted-foreground">
                  Workspace cannot be changed. Delete and recreate the cluster to move it to a different workspace.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="environment">Environment *</Label>
              <Select
                value={formData.environment}
                onValueChange={handleEnvironmentChange}
                disabled={isEditing}
              >
                <SelectTrigger className={isEditing ? 'bg-muted cursor-not-allowed' : ''}>
                  <SelectValue placeholder="Select environment" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="dev">Development</SelectItem>
                  <SelectItem value="staging">Staging</SelectItem>
                  <SelectItem value="prod">Production</SelectItem>
                </SelectContent>
              </Select>
              {isEditing && (
                <p className="text-xs text-muted-foreground">
                  Environment cannot be changed after creation.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="physicalBootstrapServers">Physical Bootstrap Servers *</Label>
              <Input
                id="physicalBootstrapServers"
                value={formData.physicalBootstrapServers}
                onChange={(e) => setFormData({ ...formData, physicalBootstrapServers: e.target.value })}
                placeholder="redpanda:9092"
                required
              />
              <p className="text-xs text-muted-foreground">
                Physical Kafka/Redpanda cluster bootstrap servers
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="topicPrefix">Topic Prefix (auto-generated)</Label>
              <Input
                id="topicPrefix"
                value={formData.topicPrefix}
                onChange={(e) => setFormData({ ...formData, topicPrefix: e.target.value })}
                placeholder="Automatically generated from workspace + environment"
                required
                readOnly={!isEditing}
                className={!isEditing ? 'bg-muted' : ''}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="groupPrefix">Group Prefix (auto-generated)</Label>
              <Input
                id="groupPrefix"
                value={formData.groupPrefix}
                onChange={(e) => setFormData({ ...formData, groupPrefix: e.target.value })}
                placeholder="Automatically generated from workspace + environment"
                required
                readOnly={!isEditing}
                className={!isEditing ? 'bg-muted' : ''}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="transactionIdPrefix">Transaction ID Prefix (auto-generated)</Label>
              <Input
                id="transactionIdPrefix"
                value={formData.transactionIdPrefix}
                onChange={(e) => setFormData({ ...formData, transactionIdPrefix: e.target.value })}
                placeholder="Automatically generated from workspace + environment"
                readOnly={!isEditing}
                className={!isEditing ? 'bg-muted' : ''}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="advertisedHost">Advertised Host (auto-generated)</Label>
              <Input
                id="advertisedHost"
                value={formData.advertisedHost}
                onChange={(e) => setFormData({ ...formData, advertisedHost: e.target.value })}
                placeholder="Automatically generated from workspace + environment"
                required
                readOnly={!isEditing}
                className={!isEditing ? 'bg-muted' : ''}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="advertisedPort">Advertised Port *</Label>
              <Input
                id="advertisedPort"
                type="number"
                value={formData.advertisedPort}
                onChange={(e) => setFormData({ ...formData, advertisedPort: parseInt(e.target.value) || 9092 })}
                placeholder="9092"
                required
                readOnly={!isEditing}
                className={!isEditing ? 'bg-muted' : ''}
              />
            </div>
          </div>

          <div className="flex items-center gap-4 pt-4">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : isEditing ? 'Update Virtual Cluster' : 'Create Virtual Cluster'}
            </Button>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
