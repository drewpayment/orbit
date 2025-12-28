'use client'

import { useState, useCallback } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type {
  KafkaProviderConfig,
  KafkaClusterConfig,
  KafkaEnvironmentMappingConfig,
} from '@/app/actions/kafka-admin'

// These will be created in later tasks - for now stub them
// import { ProvidersTab } from './ProvidersTab'
// import { ClustersTab } from './ClustersTab'
// import { MappingsTab } from './MappingsTab'

interface KafkaAdminClientProps {
  initialProviders: KafkaProviderConfig[]
  initialClusters: KafkaClusterConfig[]
  initialMappings: KafkaEnvironmentMappingConfig[]
}

type PanelContent = 'list' | 'detail' | 'form'
type SelectedItemType =
  | { type: 'provider'; id: string }
  | { type: 'cluster'; id: string }
  | { type: 'mapping'; id: string }
  | null

export function KafkaAdminClient({
  initialProviders,
  initialClusters,
  initialMappings,
}: KafkaAdminClientProps) {
  // Default to providers tab if no clusters exist
  const defaultTab = initialClusters.length === 0 ? 'providers' : 'clusters'

  const [activeTab, setActiveTab] = useState(defaultTab)
  const [providers, setProviders] = useState(initialProviders)
  const [clusters, setClusters] = useState(initialClusters)
  const [mappings, setMappings] = useState(initialMappings)
  const [panelContent, setPanelContent] = useState<PanelContent>('list')
  const [selectedItem, setSelectedItem] = useState<SelectedItemType>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Navigation functions
  const showDetail = useCallback((item: SelectedItemType) => {
    setSelectedItem(item)
    setPanelContent('detail')
  }, [])

  const showForm = useCallback((type: 'cluster' | 'mapping') => {
    setSelectedItem({ type, id: 'new' } as SelectedItemType)
    setPanelContent('form')
  }, [])

  const backToList = useCallback(() => {
    setSelectedItem(null)
    setPanelContent('list')
  }, [])

  // Refresh functions for tabs with error handling
  const refreshProviders = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const { getProviders } = await import('@/app/actions/kafka-admin')
      const result = await getProviders()
      if (result.success && result.data) {
        setProviders(result.data)
      } else {
        setError(result.error || 'Failed to refresh providers')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh providers')
    } finally {
      setIsLoading(false)
    }
  }, [])

  const refreshClusters = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const { listClusters } = await import('@/app/actions/kafka-admin')
      const result = await listClusters()
      if (result.success && result.data) {
        setClusters(result.data)
      } else {
        setError(result.error || 'Failed to refresh clusters')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh clusters')
    } finally {
      setIsLoading(false)
    }
  }, [])

  const refreshMappings = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const { listMappings } = await import('@/app/actions/kafka-admin')
      const result = await listMappings()
      if (result.success && result.data) {
        setMappings(result.data)
      } else {
        setError(result.error || 'Failed to refresh mappings')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh mappings')
    } finally {
      setIsLoading(false)
    }
  }, [])

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Kafka Management</h1>
        <p className="text-muted-foreground">
          Manage Kafka clusters, environment mappings, and provider configurations
        </p>
      </div>

      {/* Error display */}
      {error && (
        <div className="mb-4 p-4 bg-destructive/10 text-destructive rounded-lg flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="text-destructive hover:text-destructive/80"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Loading indicator */}
      {isLoading && (
        <div className="mb-4 p-4 bg-muted rounded-lg text-muted-foreground">
          Loading...
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="clusters">
            Clusters
            {clusters.length > 0 && (
              <span className="ml-2 text-xs bg-muted px-2 py-0.5 rounded-full">
                {clusters.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="mappings">
            Environment Mappings
            {mappings.length > 0 && (
              <span className="ml-2 text-xs bg-muted px-2 py-0.5 rounded-full">
                {mappings.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="providers">
            Providers
            {providers.length > 0 && (
              <span className="ml-2 text-xs bg-muted px-2 py-0.5 rounded-full">
                {providers.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="clusters" className="mt-6">
          {/* TODO: ClustersTab component */}
          <div className="text-muted-foreground">
            Clusters tab - {clusters.length} clusters
            <pre className="mt-2 text-xs">{JSON.stringify(clusters, null, 2)}</pre>
          </div>
        </TabsContent>

        <TabsContent value="mappings" className="mt-6">
          {/* TODO: MappingsTab component */}
          <div className="text-muted-foreground">
            Mappings tab - {mappings.length} mappings
            <pre className="mt-2 text-xs">{JSON.stringify(mappings, null, 2)}</pre>
          </div>
        </TabsContent>

        <TabsContent value="providers" className="mt-6">
          {/* TODO: ProvidersTab component */}
          <div className="text-muted-foreground">
            Providers tab - {providers.length} providers
            <pre className="mt-2 text-xs">{JSON.stringify(providers, null, 2)}</pre>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

// Export navigation state and functions for use by tab components
export type { PanelContent, SelectedItemType, KafkaAdminClientProps }
