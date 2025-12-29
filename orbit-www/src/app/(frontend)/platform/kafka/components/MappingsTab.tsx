'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { ChevronDown, ChevronRight, Plus, RefreshCw, Trash2 } from 'lucide-react'
import type { KafkaEnvironmentMappingConfig } from '@/app/actions/kafka-admin'

interface MappingsTabProps {
  mappings: KafkaEnvironmentMappingConfig[]
  onAddMapping: () => void
  onDeleteMapping: (mappingId: string) => Promise<void>
  onRefresh: () => Promise<void>
}

// Environment display order and labels
const ENVIRONMENT_ORDER = ['development', 'staging', 'production'] as const
const ENVIRONMENT_LABELS: Record<string, string> = {
  development: 'Development',
  staging: 'Staging',
  production: 'Production',
}

// Environment badge colors
const ENVIRONMENT_COLORS: Record<string, string> = {
  development: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  staging: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  production: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
}

export function MappingsTab({
  mappings,
  onAddMapping,
  onDeleteMapping,
  onRefresh,
}: MappingsTabProps) {
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() => {
    // Default all environments with mappings to open
    const initial: Record<string, boolean> = {}
    mappings.forEach((m) => {
      initial[m.environment] = true
    })
    return initial
  })

  // Group mappings by environment
  const groupedMappings = mappings.reduce(
    (acc, mapping) => {
      const env = mapping.environment
      if (!acc[env]) acc[env] = []
      acc[env].push(mapping)
      return acc
    },
    {} as Record<string, KafkaEnvironmentMappingConfig[]>
  )

  // Sort each group by priority
  Object.values(groupedMappings).forEach((group) => {
    group.sort((a, b) => a.priority - b.priority)
  })

  // Get all environments (known + any custom ones from mappings)
  const allEnvironments = [
    ...ENVIRONMENT_ORDER,
    ...Object.keys(groupedMappings).filter(
      (env) => !ENVIRONMENT_ORDER.includes(env as (typeof ENVIRONMENT_ORDER)[number])
    ),
  ]

  const handleRefresh = async () => {
    setIsRefreshing(true)
    try {
      await onRefresh()
    } finally {
      setIsRefreshing(false)
    }
  }

  const handleDelete = async (mappingId: string) => {
    setDeletingId(mappingId)
    try {
      await onDeleteMapping(mappingId)
    } finally {
      setDeletingId(null)
    }
  }

  const toggleSection = (env: string) => {
    setOpenSections((prev) => ({
      ...prev,
      [env]: !prev[env],
    }))
  }

  const getEnvironmentLabel = (env: string): string => {
    return ENVIRONMENT_LABELS[env] || env.charAt(0).toUpperCase() + env.slice(1)
  }

  const getEnvironmentColor = (env: string): string => {
    return (
      ENVIRONMENT_COLORS[env] ||
      'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400'
    )
  }

  // Empty state
  if (mappings.length === 0) {
    return (
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Environment Mappings</h2>
            <p className="text-sm text-muted-foreground">
              Map Kafka clusters to deployment environments
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing}
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button size="sm" onClick={onAddMapping}>
              <Plus className="h-4 w-4" />
              Add Mapping
            </Button>
          </div>
        </div>

        {/* Empty state content */}
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12">
          <div className="text-center">
            <h3 className="text-lg font-medium">No environment mappings</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Create a mapping to connect a Kafka cluster to an environment
            </p>
            <Button className="mt-4" onClick={onAddMapping}>
              <Plus className="h-4 w-4" />
              Create First Mapping
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Environment Mappings</h2>
          <p className="text-sm text-muted-foreground">
            {mappings.length} mapping{mappings.length !== 1 ? 's' : ''} across{' '}
            {Object.keys(groupedMappings).length} environment
            {Object.keys(groupedMappings).length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={onAddMapping}>
            <Plus className="h-4 w-4" />
            Add Mapping
          </Button>
        </div>
      </div>

      {/* Environment sections */}
      <div className="space-y-3">
        {allEnvironments.map((env) => {
          const envMappings = groupedMappings[env]
          if (!envMappings || envMappings.length === 0) return null

          const isOpen = openSections[env] ?? true

          return (
            <Collapsible
              key={env}
              open={isOpen}
              onOpenChange={() => toggleSection(env)}
            >
              <div className="rounded-lg border">
                <CollapsibleTrigger className="flex w-full items-center justify-between p-4 hover:bg-muted/50 transition-colors">
                  <div className="flex items-center gap-3">
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                    <Badge
                      variant="secondary"
                      className={getEnvironmentColor(env)}
                    >
                      {getEnvironmentLabel(env)}
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      {envMappings.length} cluster{envMappings.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                </CollapsibleTrigger>

                <CollapsibleContent>
                  <div className="border-t">
                    {envMappings.map((mapping, index) => (
                      <div
                        key={mapping.id}
                        className={`flex items-center justify-between p-4 ${
                          index !== envMappings.length - 1 ? 'border-b' : ''
                        }`}
                      >
                        <div className="flex items-center gap-4">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{mapping.clusterName}</span>
                              {mapping.isDefault && (
                                <Badge variant="default" className="text-xs">
                                  Default
                                </Badge>
                              )}
                            </div>
                            <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
                              <span>Priority: {mapping.priority}</span>
                              <span className="text-muted-foreground/50">|</span>
                              <span className="font-mono text-xs">{mapping.clusterId}</span>
                            </div>
                          </div>
                        </div>

                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => handleDelete(mapping.id)}
                          disabled={deletingId === mapping.id}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          {deletingId === mapping.id ? (
                            <RefreshCw className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    ))}
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          )
        })}
      </div>
    </div>
  )
}
