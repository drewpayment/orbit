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
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Save, Trash2, CheckCircle, AlertCircle } from 'lucide-react'
import type {
  KafkaClusterConfig,
  KafkaProviderConfig,
} from '@/app/actions/kafka-admin'

interface ClusterDetailProps {
  cluster: KafkaClusterConfig | null // null for new cluster
  providers: KafkaProviderConfig[]
  onBack: () => void
  onSave: (data: Partial<KafkaClusterConfig>) => Promise<void>
  onDelete?: (clusterId: string) => Promise<void>
  onValidate?: (clusterId: string) => Promise<{ valid: boolean; error?: string }>
}

const ENVIRONMENTS = ['development', 'staging', 'production'] as const

/**
 * Gets the appropriate badge variant and label for a cluster status.
 */
function getStatusBadge(status: KafkaClusterConfig['status']): {
  variant: 'default' | 'secondary' | 'destructive' | 'outline'
  label: string
  className?: string
} {
  switch (status) {
    case 'valid':
      return {
        variant: 'default',
        label: 'Healthy',
        className: 'bg-green-500 hover:bg-green-500/80 text-white',
      }
    case 'pending':
      return {
        variant: 'secondary',
        label: 'Pending',
        className: 'bg-yellow-500 hover:bg-yellow-500/80 text-white',
      }
    case 'invalid':
      return {
        variant: 'destructive',
        label: 'Offline',
      }
    case 'unknown':
    default:
      return {
        variant: 'outline',
        label: 'Unknown',
      }
  }
}

export function ClusterDetail({
  cluster,
  providers,
  onBack,
  onSave,
  onDelete,
  onValidate,
}: ClusterDetailProps) {
  const isNew = !cluster

  const [name, setName] = useState(cluster?.name || '')
  const [providerId, setProviderId] = useState(cluster?.providerId || '')
  const [bootstrapServers, setBootstrapServers] = useState(
    cluster?.bootstrapServers || ''
  )
  const [environment, setEnvironment] = useState(
    cluster?.environment || 'development'
  )
  const [schemaRegistryUrl, setSchemaRegistryUrl] = useState(
    cluster?.schemaRegistryUrl || ''
  )
  const [consoleUrl, setConsoleUrl] = useState(cluster?.consoleUrl || '')
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isValidating, setIsValidating] = useState(false)
  const [validationResult, setValidationResult] = useState<{
    valid: boolean
    error?: string
  } | null>(null)
  const [currentStatus, setCurrentStatus] = useState<KafkaClusterConfig['status'] | undefined>(cluster?.status)

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await onSave({
        id: cluster?.id,
        name,
        providerId,
        bootstrapServers,
        environment,
        schemaRegistryUrl: schemaRegistryUrl || undefined,
        consoleUrl: consoleUrl || undefined,
      })
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!cluster?.id || !onDelete) return

    setIsDeleting(true)
    try {
      await onDelete(cluster.id)
    } finally {
      setIsDeleting(false)
    }
  }

  const handleValidate = async () => {
    if (!cluster?.id || !onValidate) return

    setIsValidating(true)
    try {
      const result = await onValidate(cluster.id)
      setValidationResult(result)
      setCurrentStatus(result.valid ? 'valid' : 'invalid')
    } finally {
      setIsValidating(false)
    }
  }

  const enabledProviders = providers.filter((p) => p.enabled)
  const statusBadge = currentStatus ? getStatusBadge(currentStatus) : null

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h2 className="text-xl font-semibold">
              {isNew ? 'New Cluster' : cluster.name}
            </h2>
            {!isNew && statusBadge && (
              <Badge variant={statusBadge.variant} className={statusBadge.className}>
                {statusBadge.label}
              </Badge>
            )}
          </div>
        </div>

        {!isNew && onDelete && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" disabled={isDeleting}>
                <Trash2 className="h-4 w-4 mr-2" />
                {isDeleting ? 'Deleting...' : 'Delete'}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Cluster?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete the cluster &quot;{cluster?.name}&quot;.
                  This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDelete}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      {/* Form */}
      <Card>
        <CardHeader>
          <CardTitle>{isNew ? 'Create Cluster' : 'Cluster Settings'}</CardTitle>
          <CardDescription>
            {isNew
              ? 'Configure your new Kafka cluster'
              : 'Manage cluster configuration'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="name">Cluster Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-kafka-cluster"
            />
          </div>

          {/* Provider */}
          <div className="space-y-2">
            <Label htmlFor="provider">Provider</Label>
            <Select value={providerId} onValueChange={setProviderId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a provider" />
              </SelectTrigger>
              <SelectContent>
                {enabledProviders.map((provider) => (
                  <SelectItem key={provider.id} value={provider.name}>
                    {provider.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Bootstrap Servers */}
          <div className="space-y-2">
            <Label htmlFor="bootstrapServers">Bootstrap Servers</Label>
            <Input
              id="bootstrapServers"
              value={bootstrapServers}
              onChange={(e) => setBootstrapServers(e.target.value)}
              placeholder="localhost:9092"
            />
            <p className="text-xs text-muted-foreground">
              Comma-separated list of broker addresses
            </p>
          </div>

          {/* Environment */}
          <div className="space-y-2">
            <Label htmlFor="environment">Environment</Label>
            <Select value={environment} onValueChange={setEnvironment}>
              <SelectTrigger>
                <SelectValue />
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

          {/* Schema Registry URL */}
          <div className="space-y-2">
            <Label htmlFor="schemaRegistryUrl">Schema Registry URL (Optional)</Label>
            <Input
              id="schemaRegistryUrl"
              value={schemaRegistryUrl}
              onChange={(e) => setSchemaRegistryUrl(e.target.value)}
              placeholder="http://localhost:8081"
            />
          </div>

          {/* Console URL */}
          <div className="space-y-2">
            <Label htmlFor="consoleUrl">Console URL (Optional)</Label>
            <Input
              id="consoleUrl"
              value={consoleUrl}
              onChange={(e) => setConsoleUrl(e.target.value)}
              placeholder="http://localhost:8083"
            />
            <p className="text-xs text-muted-foreground">
              URL to the cluster management console (e.g., Redpanda Console)
            </p>
          </div>

          {/* Validation result */}
          {validationResult && (
            <div
              className={`p-4 rounded-lg ${
                validationResult.valid
                  ? 'bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200'
                  : 'bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200'
              }`}
            >
              {validationResult.valid ? (
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4" />
                  Cluster connection validated successfully
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" />
                  {validationResult.error || 'Validation failed'}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex justify-between">
        <div>
          {!isNew && onValidate && (
            <Button
              variant="outline"
              onClick={handleValidate}
              disabled={isValidating}
            >
              {isValidating ? 'Validating...' : 'Validate Connection'}
            </Button>
          )}
        </div>
        <Button
          onClick={handleSave}
          disabled={isSaving || !name || !providerId || !bootstrapServers}
        >
          <Save className="h-4 w-4 mr-2" />
          {isSaving ? 'Saving...' : isNew ? 'Create Cluster' : 'Save Changes'}
        </Button>
      </div>
    </div>
  )
}
