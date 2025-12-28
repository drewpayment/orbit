'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Save, Server, FileCode, Shield, Gauge } from 'lucide-react'
import type { KafkaProviderConfig } from '@/app/actions/kafka-admin'

interface ProviderDetailProps {
  provider: KafkaProviderConfig
  onBack: () => void
  onSave: (providerId: string, config: Partial<KafkaProviderConfig>) => Promise<void>
}

const featureIcons = {
  schemaRegistry: FileCode,
  topicCreation: Server,
  aclManagement: Shield,
  quotaManagement: Gauge,
} as const

const featureDescriptions = {
  schemaRegistry: 'Enable Schema Registry integration for schema management',
  topicCreation: 'Allow creating and managing Kafka topics',
  aclManagement: 'Enable Access Control List management',
  quotaManagement: 'Enable quota configuration and management',
} as const

export function ProviderDetail({ provider, onBack, onSave }: ProviderDetailProps) {
  const [isEnabled, setIsEnabled] = useState(provider.enabled)
  const [features, setFeatures] = useState(provider.features)
  const [isSaving, setIsSaving] = useState(false)

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await onSave(provider.id, {
        enabled: isEnabled,
        features,
      })
    } finally {
      setIsSaving(false)
    }
  }

  const hasChanges =
    isEnabled !== provider.enabled ||
    Object.entries(features).some(
      ([key, value]) =>
        value !== provider.features[key as keyof typeof provider.features]
    )

  return (
    <div className="space-y-6">
      {/* Header with back button */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h2 className="text-xl font-semibold">{provider.displayName}</h2>
          <p className="text-sm text-muted-foreground">{provider.name}</p>
        </div>
        <Badge variant={isEnabled ? 'default' : 'secondary'}>
          {isEnabled ? 'Enabled' : 'Disabled'}
        </Badge>
      </div>

      {/* Provider settings */}
      <Card>
        <CardHeader>
          <CardTitle>Provider Settings</CardTitle>
          <CardDescription>Configure this Kafka provider</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Enabled toggle */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="enabled">Enabled</Label>
              <p className="text-sm text-muted-foreground">
                Allow clusters to use this provider
              </p>
            </div>
            <Switch
              id="enabled"
              checked={isEnabled}
              onCheckedChange={setIsEnabled}
            />
          </div>
        </CardContent>
      </Card>

      {/* Features card */}
      <Card>
        <CardHeader>
          <CardTitle>Features</CardTitle>
          <CardDescription>
            Enable or disable provider capabilities
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {Object.entries(features).map(([key, value]) => {
            const featureKey = key as keyof typeof featureIcons
            const Icon = featureIcons[featureKey]
            const description = featureDescriptions[featureKey]

            return (
              <div
                key={key}
                className="flex items-center justify-between py-2 border-b border-border last:border-0"
              >
                <div className="flex items-start gap-3">
                  {Icon && (
                    <div className="mt-0.5 p-2 rounded-md bg-muted">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                    </div>
                  )}
                  <div className="space-y-0.5">
                    <Label htmlFor={key}>{formatFeatureName(key)}</Label>
                    {description && (
                      <p className="text-sm text-muted-foreground">
                        {description}
                      </p>
                    )}
                  </div>
                </div>
                <Switch
                  id={key}
                  checked={value}
                  onCheckedChange={(checked) =>
                    setFeatures((prev) => ({ ...prev, [key]: checked }))
                  }
                />
              </div>
            )
          })}
        </CardContent>
      </Card>

      {/* Authentication methods card */}
      {provider.authMethods.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Required Configuration Fields</CardTitle>
            <CardDescription>
              These fields are required when connecting clusters to this provider
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {provider.authMethods.map((method) => (
                <Badge key={method} variant="secondary">
                  {method}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Default settings card */}
      {Object.keys(provider.defaultSettings).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Default Settings</CardTitle>
            <CardDescription>
              Default configuration applied to new clusters using this provider
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Object.entries(provider.defaultSettings).map(([key, value]) => (
                <div
                  key={key}
                  className="flex items-center justify-between py-2 border-b border-border last:border-0"
                >
                  <span className="font-mono text-sm">{key}</span>
                  <span className="text-sm text-muted-foreground">
                    {String(value)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Save button */}
      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={onBack}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={isSaving || !hasChanges}>
          <Save className="h-4 w-4 mr-2" />
          {isSaving ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>
    </div>
  )
}

function formatFeatureName(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (str) => str.toUpperCase())
}
