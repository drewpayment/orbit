'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { RefreshCw, Server, FileCode, Shield, Gauge } from 'lucide-react'
import type { KafkaProviderConfig } from '@/app/actions/kafka-admin'

interface ProvidersTabProps {
  providers: KafkaProviderConfig[]
  onSelectProvider: (providerId: string) => void
  onRefresh: () => Promise<void>
}

const featureIcons = {
  schemaRegistry: FileCode,
  topicCreation: Server,
  aclManagement: Shield,
  quotaManagement: Gauge,
} as const

const featureLabels = {
  schemaRegistry: 'Schema Registry',
  topicCreation: 'Topic Creation',
  aclManagement: 'ACL Management',
  quotaManagement: 'Quota Management',
} as const

export function ProvidersTab({ providers, onSelectProvider, onRefresh }: ProvidersTabProps) {
  const [isRefreshing, setIsRefreshing] = useState(false)

  const handleRefresh = async () => {
    setIsRefreshing(true)
    try {
      await onRefresh()
    } finally {
      setIsRefreshing(false)
    }
  }

  if (providers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Server className="h-12 w-12 text-muted-foreground/50 mb-4" />
        <h3 className="text-lg font-medium mb-2">No Providers Available</h3>
        <p className="text-muted-foreground mb-4">
          No Kafka providers are currently configured. Providers are managed by the system.
        </p>
        <Button variant="outline" onClick={handleRefresh} disabled={isRefreshing}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {providers.length} provider{providers.length !== 1 ? 's' : ''} available
        </p>
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isRefreshing}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {providers.map((provider) => {
          const enabledFeatures = Object.entries(provider.features).filter(
            ([, enabled]) => enabled
          )

          return (
            <Card
              key={provider.id}
              className="cursor-pointer hover:shadow-lg transition-shadow hover:border-primary/50"
              onClick={() => onSelectProvider(provider.id)}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <CardTitle className="text-lg">{provider.displayName}</CardTitle>
                    <p className="text-sm text-muted-foreground">{provider.name}</p>
                  </div>
                  <Badge variant={provider.enabled ? 'default' : 'secondary'}>
                    {provider.enabled ? 'Enabled' : 'Disabled'}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Features */}
                <div className="space-y-2">
                  <p className="text-sm font-medium">Features</p>
                  {enabledFeatures.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {enabledFeatures.map(([feature]) => {
                        const Icon = featureIcons[feature as keyof typeof featureIcons]
                        const label = featureLabels[feature as keyof typeof featureLabels]
                        return (
                          <Badge key={feature} variant="outline" className="gap-1">
                            {Icon && <Icon className="h-3 w-3" />}
                            {label}
                          </Badge>
                        )
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No features enabled</p>
                  )}
                </div>

                {/* Auth Methods */}
                {provider.authMethods.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Required Config</p>
                    <div className="flex flex-wrap gap-1">
                      {provider.authMethods.map((method) => (
                        <Badge key={method} variant="secondary" className="text-xs">
                          {method}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
