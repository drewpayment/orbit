'use client'

import { useState, useCallback } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type {
  KafkaProviderConfig,
  KafkaClusterConfig,
  KafkaEnvironmentMappingConfig,
} from '@/app/actions/kafka-admin'

// Import tab components
import { ProvidersTab } from './ProvidersTab'
import { ClustersTab } from './ClustersTab'
import { MappingsTab } from './MappingsTab'
import { ProviderDetail } from './ProviderDetail'
import { ProviderForm, type ProviderFormData } from './ProviderForm'
import { ClusterDetail } from './ClusterDetail'
import { MappingForm } from './MappingForm'

interface KafkaAdminClientProps {
  initialProviders: KafkaProviderConfig[]
  initialClusters: KafkaClusterConfig[]
  initialMappings: KafkaEnvironmentMappingConfig[]
}

type PanelContent = 'list' | 'provider-detail' | 'cluster-detail' | 'cluster-form' | 'mapping-form'
type SelectedItemId = string | null

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
  const [selectedItemId, setSelectedItemId] = useState<SelectedItemId>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Provider form dialog state
  const [providerFormOpen, setProviderFormOpen] = useState(false)
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null)

  // Navigation functions
  const showProviderDetail = useCallback((providerId: string) => {
    setSelectedItemId(providerId)
    setPanelContent('provider-detail')
  }, [])

  const showClusterDetail = useCallback((clusterId: string) => {
    setSelectedItemId(clusterId)
    setPanelContent('cluster-detail')
  }, [])

  const showClusterForm = useCallback(() => {
    setSelectedItemId(null)
    setPanelContent('cluster-form')
  }, [])

  const showMappingForm = useCallback(() => {
    setSelectedItemId(null)
    setPanelContent('mapping-form')
  }, [])

  const backToList = useCallback(() => {
    setSelectedItemId(null)
    setPanelContent('list')
  }, [])

  // Refresh functions
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

  // Provider dialog handlers
  const handleAddProvider = useCallback(() => {
    setEditingProviderId(null)
    setProviderFormOpen(true)
  }, [])

  const handleCreateOrUpdateProvider = useCallback(async (data: ProviderFormData) => {
    setError(null)
    try {
      if (editingProviderId) {
        // Update existing provider
        const { saveProviderConfig } = await import('@/app/actions/kafka-admin')
        const result = await saveProviderConfig(editingProviderId, {
          displayName: data.displayName,
          authMethods: data.requiredConfigFields,
          features: {
            schemaRegistry: data.capabilities.schemaRegistry,
            topicCreation: true,
            aclManagement: false,
            quotaManagement: data.capabilities.quotasApi,
          },
        })
        if (!result.success) {
          throw new Error(result.error || 'Failed to update provider')
        }
      } else {
        // Create new provider
        const { createProvider } = await import('@/app/actions/kafka-admin')
        const result = await createProvider({
          name: data.name,
          displayName: data.displayName,
          adapterType: data.adapterType,
          requiredConfigFields: data.requiredConfigFields,
          capabilities: data.capabilities,
          documentationUrl: data.documentationUrl,
        })
        if (!result.success) {
          throw new Error(result.error || 'Failed to create provider')
        }
      }
      await refreshProviders()
      setProviderFormOpen(false)
    } catch (err) {
      throw err // Re-throw to let ProviderForm handle the error
    }
  }, [editingProviderId, refreshProviders])

  const handleDeleteProvider = useCallback(async (providerId: string) => {
    setError(null)
    try {
      const { deleteProvider } = await import('@/app/actions/kafka-admin')
      const result = await deleteProvider(providerId)
      if (result.success) {
        await refreshProviders()
        backToList()
      } else {
        setError(result.error || 'Failed to delete provider')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete provider')
    }
  }, [refreshProviders, backToList])

  // Action handlers
  const handleSaveProvider = useCallback(async (providerId: string, config: Partial<KafkaProviderConfig>) => {
    setIsLoading(true)
    setError(null)
    try {
      const { saveProviderConfig } = await import('@/app/actions/kafka-admin')
      const result = await saveProviderConfig(providerId, config)
      if (result.success) {
        await refreshProviders()
        backToList()
      } else {
        setError(result.error || 'Failed to save provider')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save provider')
    } finally {
      setIsLoading(false)
    }
  }, [refreshProviders, backToList])

  const handleSaveCluster = useCallback(async (data: Partial<KafkaClusterConfig>) => {
    setIsLoading(true)
    setError(null)
    try {
      if (data.id) {
        // Update existing cluster
        const { updateCluster } = await import('@/app/actions/kafka-admin')
        const result = await updateCluster(data.id, {
          name: data.name,
          providerId: data.providerId,
          bootstrapServers: data.bootstrapServers,
          environment: data.environment,
          schemaRegistryUrl: data.schemaRegistryUrl,
        })
        if (result.success) {
          await refreshClusters()
          backToList()
        } else {
          setError(result.error || 'Failed to update cluster')
        }
      } else {
        // Create new cluster
        const { createCluster } = await import('@/app/actions/kafka-admin')
        const result = await createCluster({
          name: data.name!,
          providerId: data.providerId!,
          bootstrapServers: data.bootstrapServers!,
          environment: data.environment,
          schemaRegistryUrl: data.schemaRegistryUrl,
        })
        if (result.success) {
          await refreshClusters()
          backToList()
        } else {
          setError(result.error || 'Failed to create cluster')
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save cluster')
    } finally {
      setIsLoading(false)
    }
  }, [refreshClusters, backToList])

  const handleDeleteCluster = useCallback(async (clusterId: string) => {
    setIsLoading(true)
    setError(null)
    try {
      const { deleteCluster } = await import('@/app/actions/kafka-admin')
      const result = await deleteCluster(clusterId)
      if (result.success) {
        await refreshClusters()
        backToList()
      } else {
        setError(result.error || 'Failed to delete cluster')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete cluster')
    } finally {
      setIsLoading(false)
    }
  }, [refreshClusters, backToList])

  const handleValidateCluster = useCallback(async (clusterId: string) => {
    try {
      const { validateCluster } = await import('@/app/actions/kafka-admin')
      const result = await validateCluster(clusterId)
      if (result.success) {
        return { valid: result.valid ?? false, error: result.error }
      }
      return { valid: false, error: result.error || 'Validation failed' }
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : 'Validation failed' }
    }
  }, [])

  const handleSaveMapping = useCallback(async (data: {
    environment: string
    clusterId: string
    priority: number
    isDefault: boolean
  }) => {
    setIsLoading(true)
    setError(null)
    try {
      const { createMapping } = await import('@/app/actions/kafka-admin')
      const result = await createMapping(data)
      if (result.success) {
        await refreshMappings()
        backToList()
      } else {
        setError(result.error || 'Failed to create mapping')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create mapping')
    } finally {
      setIsLoading(false)
    }
  }, [refreshMappings, backToList])

  const handleDeleteMapping = useCallback(async (mappingId: string) => {
    setIsLoading(true)
    setError(null)
    try {
      const { deleteMapping } = await import('@/app/actions/kafka-admin')
      const result = await deleteMapping(mappingId)
      if (result.success) {
        await refreshMappings()
      } else {
        setError(result.error || 'Failed to delete mapping')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete mapping')
    } finally {
      setIsLoading(false)
    }
  }, [refreshMappings])

  // Get selected items
  const selectedProvider = selectedItemId
    ? providers.find(p => p.id === selectedItemId)
    : null
  const selectedCluster = selectedItemId
    ? clusters.find(c => c.id === selectedItemId)
    : null

  // Calculate cluster count for selected provider (for delete warning)
  const selectedProviderClusterCount = selectedProvider
    ? clusters.filter(c => c.providerId === selectedProvider.id).length
    : 0

  // Get the provider being edited in the form
  const editingProvider = editingProviderId
    ? providers.find(p => p.id === editingProviderId)
    : null

  // Render detail/form views
  if (panelContent === 'provider-detail' && selectedProvider) {
    return (
      <div className="p-6">
        {/* Error display for detail view */}
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
        <ProviderDetail
          provider={selectedProvider}
          onBack={backToList}
          onSave={handleSaveProvider}
          onDelete={handleDeleteProvider}
          clusterCount={selectedProviderClusterCount}
        />
      </div>
    )
  }

  if (panelContent === 'cluster-detail') {
    return (
      <div className="p-6">
        {/* Error display for detail view */}
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
        <ClusterDetail
          cluster={selectedCluster ?? null}
          providers={providers}
          onBack={backToList}
          onSave={handleSaveCluster}
          onDelete={selectedCluster ? handleDeleteCluster : undefined}
          onValidate={selectedCluster ? handleValidateCluster : undefined}
        />
      </div>
    )
  }

  if (panelContent === 'cluster-form') {
    return (
      <div className="p-6">
        {/* Error display for form view */}
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
        <ClusterDetail
          cluster={null}
          providers={providers}
          onBack={backToList}
          onSave={handleSaveCluster}
        />
      </div>
    )
  }

  if (panelContent === 'mapping-form') {
    return (
      <div className="p-6">
        {/* Error display for form view */}
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
        <MappingForm
          clusters={clusters}
          onBack={backToList}
          onSave={handleSaveMapping}
        />
      </div>
    )
  }

  // Main list view with tabs
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
          <ClustersTab
            clusters={clusters}
            providers={providers}
            onSelectCluster={showClusterDetail}
            onAddCluster={showClusterForm}
            onRefresh={refreshClusters}
          />
        </TabsContent>

        <TabsContent value="mappings" className="mt-6">
          <MappingsTab
            mappings={mappings}
            onAddMapping={showMappingForm}
            onDeleteMapping={handleDeleteMapping}
            onRefresh={refreshMappings}
          />
        </TabsContent>

        <TabsContent value="providers" className="mt-6">
          <ProvidersTab
            providers={providers}
            onSelectProvider={showProviderDetail}
            onAddProvider={handleAddProvider}
            onRefresh={refreshProviders}
          />
        </TabsContent>
      </Tabs>

      {/* Provider Form Dialog */}
      <ProviderForm
        open={providerFormOpen}
        onOpenChange={setProviderFormOpen}
        provider={editingProvider}
        onSave={handleCreateOrUpdateProvider}
      />
    </div>
  )
}

// Export types for use by other components if needed
export type { PanelContent, SelectedItemId, KafkaAdminClientProps }
