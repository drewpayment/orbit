'use client'

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
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
import { Badge } from '@/components/ui/badge'
import { Loader2, X } from 'lucide-react'
import type { KafkaProviderConfig } from '@/app/actions/kafka-admin'

interface ProviderFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  provider?: KafkaProviderConfig | null
  onSave: (data: ProviderFormData) => Promise<void>
}

export interface ProviderFormData {
  name: string
  displayName: string
  adapterType: 'apache' | 'confluent' | 'msk'
  requiredConfigFields: string[]
  capabilities: {
    schemaRegistry: boolean
    transactions: boolean
    quotasApi: boolean
    metricsApi: boolean
  }
  documentationUrl: string
}

const adapterOptions = [
  { value: 'apache', label: 'Apache Kafka' },
  { value: 'confluent', label: 'Confluent Cloud' },
  { value: 'msk', label: 'AWS MSK' },
]

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function ProviderForm({ open, onOpenChange, provider, onSave }: ProviderFormProps) {
  const isEdit = !!provider

  const [displayName, setDisplayName] = useState('')
  const [name, setName] = useState('')
  const [nameManuallyEdited, setNameManuallyEdited] = useState(false)
  const [adapterType, setAdapterType] = useState<'apache' | 'confluent' | 'msk'>('apache')
  const [configFieldInput, setConfigFieldInput] = useState('')
  const [requiredConfigFields, setRequiredConfigFields] = useState<string[]>([])
  const [capabilities, setCapabilities] = useState({
    schemaRegistry: true,
    transactions: true,
    quotasApi: false,
    metricsApi: false,
  })
  const [documentationUrl, setDocumentationUrl] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset form when dialog opens/closes or provider changes
  useEffect(() => {
    if (open) {
      if (provider) {
        setDisplayName(provider.displayName)
        setName(provider.name)
        setNameManuallyEdited(true) // Don't auto-update name in edit mode
        // Map adapterType - provider.name might contain hints
        const detectedAdapter = provider.name.includes('confluent')
          ? 'confluent'
          : provider.name.includes('msk')
            ? 'msk'
            : 'apache'
        setAdapterType(detectedAdapter)
        setRequiredConfigFields(provider.authMethods || [])
        setCapabilities({
          schemaRegistry: provider.features.schemaRegistry,
          transactions: true, // Not exposed in current type
          quotasApi: provider.features.quotaManagement,
          metricsApi: false, // Not exposed in current type
        })
        setDocumentationUrl('')
      } else {
        // Reset for new provider
        setDisplayName('')
        setName('')
        setNameManuallyEdited(false)
        setAdapterType('apache')
        setRequiredConfigFields([])
        setCapabilities({
          schemaRegistry: true,
          transactions: true,
          quotasApi: false,
          metricsApi: false,
        })
        setDocumentationUrl('')
      }
      setConfigFieldInput('')
      setError(null)
    }
  }, [open, provider])

  // Auto-generate name from displayName
  useEffect(() => {
    if (!nameManuallyEdited && displayName) {
      setName(slugify(displayName))
    }
  }, [displayName, nameManuallyEdited])

  const handleNameChange = (value: string) => {
    setName(value)
    setNameManuallyEdited(true)
  }

  const handleAddConfigField = () => {
    const field = configFieldInput.trim()
    if (field && !requiredConfigFields.includes(field)) {
      setRequiredConfigFields([...requiredConfigFields, field])
      setConfigFieldInput('')
    }
  }

  const handleConfigFieldKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAddConfigField()
    }
  }

  const handleRemoveConfigField = (field: string) => {
    setRequiredConfigFields(requiredConfigFields.filter((f) => f !== field))
  }

  const handleCapabilityChange = (key: keyof typeof capabilities, checked: boolean) => {
    setCapabilities((prev) => ({ ...prev, [key]: checked }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    // Validation
    if (!displayName.trim()) {
      setError('Display name is required')
      return
    }
    if (!name.trim()) {
      setError('Identifier is required')
      return
    }
    if (requiredConfigFields.length === 0) {
      setError('At least one required config field is needed')
      return
    }

    setIsSaving(true)
    try {
      await onSave({
        name: name.trim(),
        displayName: displayName.trim(),
        adapterType,
        requiredConfigFields,
        capabilities,
        documentationUrl: documentationUrl.trim(),
      })
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save provider')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEdit ? 'Edit Provider' : 'Add Provider'}</DialogTitle>
            <DialogDescription>
              {isEdit
                ? 'Update the provider configuration.'
                : 'Create a new Kafka provider type for your platform.'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {error && (
              <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                {error}
              </div>
            )}

            {/* Display Name */}
            <div className="grid gap-2">
              <Label htmlFor="displayName">Display Name *</Label>
              <Input
                id="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="My Custom Kafka"
                disabled={isSaving}
              />
            </div>

            {/* Identifier */}
            <div className="grid gap-2">
              <Label htmlFor="name">
                Identifier *
                {!nameManuallyEdited && displayName && (
                  <span className="text-xs text-muted-foreground ml-2">(auto-generated)</span>
                )}
              </Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="my-custom-kafka"
                disabled={isSaving || isEdit}
              />
              {isEdit && (
                <p className="text-xs text-muted-foreground">
                  Identifier cannot be changed after creation
                </p>
              )}
            </div>

            {/* Adapter Type */}
            <div className="grid gap-2">
              <Label htmlFor="adapterType">Adapter Type *</Label>
              <Select
                value={adapterType}
                onValueChange={(v) => setAdapterType(v as 'apache' | 'confluent' | 'msk')}
                disabled={isSaving}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select adapter type" />
                </SelectTrigger>
                <SelectContent>
                  {adapterOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Required Config Fields */}
            <div className="grid gap-2">
              <Label htmlFor="configField">Required Config Fields *</Label>
              <div className="flex gap-2">
                <Input
                  id="configField"
                  value={configFieldInput}
                  onChange={(e) => setConfigFieldInput(e.target.value)}
                  onKeyDown={handleConfigFieldKeyDown}
                  placeholder="e.g., bootstrapServers"
                  disabled={isSaving}
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleAddConfigField}
                  disabled={isSaving || !configFieldInput.trim()}
                >
                  Add
                </Button>
              </div>
              {requiredConfigFields.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {requiredConfigFields.map((field) => (
                    <Badge key={field} variant="secondary" className="gap-1">
                      {field}
                      <button
                        type="button"
                        onClick={() => handleRemoveConfigField(field)}
                        className="ml-1 hover:text-destructive"
                        disabled={isSaving}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Fields required when creating clusters with this provider
              </p>
            </div>

            {/* Capabilities */}
            <div className="grid gap-2">
              <Label>Capabilities</Label>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="schemaRegistry"
                    checked={capabilities.schemaRegistry}
                    onCheckedChange={(checked) =>
                      handleCapabilityChange('schemaRegistry', checked === true)
                    }
                    disabled={isSaving}
                  />
                  <Label htmlFor="schemaRegistry" className="text-sm font-normal">
                    Schema Registry
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="transactions"
                    checked={capabilities.transactions}
                    onCheckedChange={(checked) =>
                      handleCapabilityChange('transactions', checked === true)
                    }
                    disabled={isSaving}
                  />
                  <Label htmlFor="transactions" className="text-sm font-normal">
                    Transactions
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="quotasApi"
                    checked={capabilities.quotasApi}
                    onCheckedChange={(checked) =>
                      handleCapabilityChange('quotasApi', checked === true)
                    }
                    disabled={isSaving}
                  />
                  <Label htmlFor="quotasApi" className="text-sm font-normal">
                    Quotas API
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="metricsApi"
                    checked={capabilities.metricsApi}
                    onCheckedChange={(checked) =>
                      handleCapabilityChange('metricsApi', checked === true)
                    }
                    disabled={isSaving}
                  />
                  <Label htmlFor="metricsApi" className="text-sm font-normal">
                    Metrics API
                  </Label>
                </div>
              </div>
            </div>

            {/* Documentation URL */}
            <div className="grid gap-2">
              <Label htmlFor="documentationUrl">Documentation URL</Label>
              <Input
                id="documentationUrl"
                type="url"
                value={documentationUrl}
                onChange={(e) => setDocumentationUrl(e.target.value)}
                placeholder="https://kafka.apache.org/documentation"
                disabled={isSaving}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {isEdit ? 'Save Changes' : 'Create Provider'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
