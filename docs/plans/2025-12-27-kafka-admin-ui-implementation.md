# Kafka Admin UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a platform admin interface at `/admin/kafka` for managing Kafka providers, clusters, and environment mappings.

**Architecture:** Single-page app with client-side panel state management. Uses Sheet component for slide-over panel, Tabs for navigation, Cards for entity display. Server actions call existing Kafka gRPC service.

**Tech Stack:** Next.js 15 (App Router), React 19, shadcn/ui (Sheet, Tabs, Card, Badge, Button, Input, Select), Tailwind CSS, Server Actions, Connect-ES gRPC client.

---

## Phase 1: Foundation - Server Actions

### Task 1: Create kafka-admin server actions file

**Files:**
- Create: `orbit-www/src/app/actions/kafka-admin.ts`

**Step 1: Create the server actions file with type definitions**

```typescript
'use server'

import { kafkaClient } from '@/lib/grpc/kafka-client'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { getPayload } from 'payload'
import config from '@payload-config'

// Types for admin UI
export interface KafkaProviderConfig {
  id: string
  name: string
  displayName: string
  adapterType: string
  requiredConfigFields: string[]
  capabilities: {
    schemaRegistry: boolean
    transactions: boolean
    quotasApi?: boolean
    metricsApi?: boolean
  }
  documentationUrl: string
  // Platform config (stored in Payload)
  isConfigured: boolean
  isEnabled: boolean
  credentials?: Record<string, string>
  defaults?: Record<string, string>
}

export interface KafkaClusterConfig {
  id: string
  name: string
  providerId: string
  providerName: string
  status: 'connected' | 'error' | 'validating' | 'unknown'
  statusMessage?: string
  bootstrapServers: string
  region?: string
  config: Record<string, string>
  topicsCount?: number
  createdAt: string
  lastValidatedAt?: string
  environmentMappings: string[] // environment names
}

export interface KafkaEnvironmentMapping {
  id: string
  environment: 'development' | 'staging' | 'production'
  workspaceId?: string
  workspaceName?: string
  clusterId: string
  clusterName: string
  priority: number
  description?: string
  isEnabled: boolean
}

// Helper to check admin access
async function requireAdmin() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user?.id) {
    throw new Error('Unauthorized')
  }

  const payload = await getPayload({ config })
  const user = await payload.findByID({
    collection: 'users',
    id: session.user.id,
  })

  // Check if user has admin role - adjust based on your role system
  const isAdmin = user?.roles?.includes('admin') || user?.roles?.includes('platform-admin')
  if (!isAdmin) {
    throw new Error('Admin access required')
  }

  return { session, payload, user }
}

// Provider actions
export async function getProviders(): Promise<{ providers: KafkaProviderConfig[]; error?: string }> {
  try {
    await requireAdmin()
    const response = await kafkaClient.listProviders({})

    const providers: KafkaProviderConfig[] = response.providers.map((p) => ({
      id: p.id,
      name: p.name,
      displayName: p.displayName,
      adapterType: p.adapterType,
      requiredConfigFields: p.requiredConfigFields,
      capabilities: {
        schemaRegistry: p.capabilities?.schemaRegistry ?? false,
        transactions: p.capabilities?.transactions ?? false,
        quotasApi: p.capabilities?.quotasApi,
        metricsApi: p.capabilities?.metricsApi,
      },
      documentationUrl: p.documentationUrl,
      isConfigured: false, // TODO: Check Payload for stored config
      isEnabled: true,
    }))

    return { providers }
  } catch (error) {
    return { providers: [], error: error instanceof Error ? error.message : 'Failed to fetch providers' }
  }
}

export async function saveProviderConfig(
  providerId: string,
  config: { credentials: Record<string, string>; defaults: Record<string, string>; isEnabled: boolean }
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin()
    // TODO: Store in Payload CMS - kafka-provider-configs collection
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to save provider config' }
  }
}

// Cluster actions
export async function listClusters(): Promise<{ clusters: KafkaClusterConfig[]; error?: string }> {
  try {
    await requireAdmin()
    const response = await kafkaClient.listClusters({})

    const clusters: KafkaClusterConfig[] = response.clusters.map((c) => ({
      id: c.id,
      name: c.name,
      providerId: c.providerId,
      providerName: c.providerId, // TODO: resolve provider display name
      status: 'unknown' as const,
      bootstrapServers: c.config['bootstrapServers'] || '',
      region: c.config['region'],
      config: c.config,
      createdAt: c.createdAt?.toDate().toISOString() || new Date().toISOString(),
      environmentMappings: [],
    }))

    return { clusters }
  } catch (error) {
    return { clusters: [], error: error instanceof Error ? error.message : 'Failed to fetch clusters' }
  }
}

export async function getCluster(clusterId: string): Promise<{ cluster?: KafkaClusterConfig; error?: string }> {
  try {
    await requireAdmin()
    // TODO: Implement via gRPC or Payload lookup
    return { error: 'Not implemented' }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to fetch cluster' }
  }
}

export async function createCluster(data: {
  name: string
  providerId: string
  config: Record<string, string>
}): Promise<{ cluster?: KafkaClusterConfig; error?: string }> {
  try {
    await requireAdmin()
    const response = await kafkaClient.registerCluster({
      providerId: data.providerId,
      name: data.name,
      config: data.config,
    })

    if (response.cluster) {
      return {
        cluster: {
          id: response.cluster.id,
          name: response.cluster.name,
          providerId: response.cluster.providerId,
          providerName: response.cluster.providerId,
          status: 'unknown',
          bootstrapServers: data.config['bootstrapServers'] || '',
          config: response.cluster.config,
          createdAt: new Date().toISOString(),
          environmentMappings: [],
        },
      }
    }
    return { error: 'Failed to create cluster' }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to create cluster' }
  }
}

export async function deleteCluster(clusterId: string): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin()
    await kafkaClient.deleteCluster({ clusterId })
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to delete cluster' }
  }
}

export async function validateCluster(clusterId: string): Promise<{
  isValid: boolean
  message?: string
  error?: string
}> {
  try {
    await requireAdmin()
    const response = await kafkaClient.validateCluster({ clusterId })
    return {
      isValid: response.isValid,
      message: response.message,
    }
  } catch (error) {
    return { isValid: false, error: error instanceof Error ? error.message : 'Failed to validate cluster' }
  }
}

// Mapping actions
export async function listMappings(): Promise<{ mappings: KafkaEnvironmentMapping[]; error?: string }> {
  try {
    await requireAdmin()
    const response = await kafkaClient.listEnvironmentMappings({})

    const mappings: KafkaEnvironmentMapping[] = response.mappings.map((m) => ({
      id: m.id,
      environment: m.environment as 'development' | 'staging' | 'production',
      workspaceId: m.workspaceId || undefined,
      workspaceName: undefined, // TODO: resolve workspace name
      clusterId: m.clusterId,
      clusterName: '', // TODO: resolve cluster name
      priority: m.priority,
      description: m.description || undefined,
      isEnabled: m.isDefault, // TODO: add isEnabled to proto
    }))

    return { mappings }
  } catch (error) {
    return { mappings: [], error: error instanceof Error ? error.message : 'Failed to fetch mappings' }
  }
}

export async function createMapping(data: {
  environment: string
  workspaceId?: string
  clusterId: string
  priority: number
  description?: string
  isEnabled: boolean
}): Promise<{ mapping?: KafkaEnvironmentMapping; error?: string }> {
  try {
    await requireAdmin()
    const response = await kafkaClient.createEnvironmentMapping({
      environment: data.environment,
      clusterId: data.clusterId,
      workspaceId: data.workspaceId || '',
      priority: data.priority,
      isDefault: data.isEnabled,
    })

    if (response.mapping) {
      return {
        mapping: {
          id: response.mapping.id,
          environment: data.environment as 'development' | 'staging' | 'production',
          workspaceId: data.workspaceId,
          clusterId: data.clusterId,
          clusterName: '',
          priority: data.priority,
          description: data.description,
          isEnabled: data.isEnabled,
        },
      }
    }
    return { error: 'Failed to create mapping' }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to create mapping' }
  }
}

export async function deleteMapping(mappingId: string): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin()
    await kafkaClient.deleteEnvironmentMapping({ mappingId })
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to delete mapping' }
  }
}

// Workspace list for mapping form
export async function listWorkspaces(): Promise<{ workspaces: { id: string; name: string; slug: string }[]; error?: string }> {
  try {
    const { payload } = await requireAdmin()
    const result = await payload.find({
      collection: 'workspaces',
      limit: 100,
      sort: 'name',
    })

    return {
      workspaces: result.docs.map((w) => ({
        id: w.id,
        name: w.name,
        slug: w.slug,
      })),
    }
  } catch (error) {
    return { workspaces: [], error: error instanceof Error ? error.message : 'Failed to fetch workspaces' }
  }
}
```

**Step 2: Commit**

```bash
git add orbit-www/src/app/actions/kafka-admin.ts
git commit -m "feat(kafka-admin): add server actions for admin operations"
```

---

## Phase 2: Main Page Structure

### Task 2: Create admin kafka page

**Files:**
- Create: `orbit-www/src/app/(frontend)/admin/kafka/page.tsx`

**Step 1: Create the server component page**

```typescript
import { getProviders, listClusters, listMappings } from '@/app/actions/kafka-admin'
import { KafkaAdminClient } from './kafka-admin-client'

export default async function KafkaAdminPage() {
  // Fetch initial data in parallel
  const [providersResult, clustersResult, mappingsResult] = await Promise.all([
    getProviders(),
    listClusters(),
    listMappings(),
  ])

  // Determine default tab based on whether clusters exist
  const defaultTab = clustersResult.clusters.length > 0 ? 'clusters' : 'providers'

  return (
    <KafkaAdminClient
      initialProviders={providersResult.providers}
      initialClusters={clustersResult.clusters}
      initialMappings={mappingsResult.mappings}
      defaultTab={defaultTab}
      error={providersResult.error || clustersResult.error || mappingsResult.error}
    />
  )
}
```

**Step 2: Commit**

```bash
git add orbit-www/src/app/\(frontend\)/admin/kafka/page.tsx
git commit -m "feat(kafka-admin): add main admin page server component"
```

---

### Task 3: Create kafka admin client component with panel state

**Files:**
- Create: `orbit-www/src/app/(frontend)/admin/kafka/kafka-admin-client.tsx`

**Step 1: Create the client component with state management**

```typescript
'use client'

import React, { useState, useCallback } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertCircle } from 'lucide-react'
import type { KafkaProviderConfig, KafkaClusterConfig, KafkaEnvironmentMapping } from '@/app/actions/kafka-admin'

// Import tab components (to be created)
import { ProvidersTab } from './components/ProvidersTab'
import { ClustersTab } from './components/ClustersTab'
import { MappingsTab } from './components/MappingsTab'
import { ProviderDetail } from './components/ProviderDetail'
import { ClusterDetail } from './components/ClusterDetail'
import { MappingForm } from './components/MappingForm'

type PanelView =
  | { view: 'list'; tab: 'clusters' | 'mappings' | 'providers' }
  | { view: 'provider-detail'; providerId: string }
  | { view: 'cluster-detail'; clusterId: string | null }
  | { view: 'mapping-edit'; mappingId: string | null }

interface KafkaAdminClientProps {
  initialProviders: KafkaProviderConfig[]
  initialClusters: KafkaClusterConfig[]
  initialMappings: KafkaEnvironmentMapping[]
  defaultTab: 'clusters' | 'providers'
  error?: string
}

export function KafkaAdminClient({
  initialProviders,
  initialClusters,
  initialMappings,
  defaultTab,
  error,
}: KafkaAdminClientProps) {
  const [providers, setProviders] = useState(initialProviders)
  const [clusters, setClusters] = useState(initialClusters)
  const [mappings, setMappings] = useState(initialMappings)
  const [panelState, setPanelState] = useState<PanelView>({ view: 'list', tab: defaultTab })
  const [isOpen, setIsOpen] = useState(true)

  const handleTabChange = useCallback((tab: string) => {
    setPanelState({ view: 'list', tab: tab as 'clusters' | 'mappings' | 'providers' })
  }, [])

  const handleProviderClick = useCallback((providerId: string) => {
    setPanelState({ view: 'provider-detail', providerId })
  }, [])

  const handleClusterClick = useCallback((clusterId: string | null) => {
    setPanelState({ view: 'cluster-detail', clusterId })
  }, [])

  const handleMappingClick = useCallback((mappingId: string | null) => {
    setPanelState({ view: 'mapping-edit', mappingId })
  }, [])

  const handleBack = useCallback(() => {
    if (panelState.view === 'provider-detail') {
      setPanelState({ view: 'list', tab: 'providers' })
    } else if (panelState.view === 'cluster-detail') {
      setPanelState({ view: 'list', tab: 'clusters' })
    } else if (panelState.view === 'mapping-edit') {
      setPanelState({ view: 'list', tab: 'mappings' })
    }
  }, [panelState])

  const refreshData = useCallback(async () => {
    // Re-fetch data after mutations
    const [providersResult, clustersResult, mappingsResult] = await Promise.all([
      import('@/app/actions/kafka-admin').then((m) => m.getProviders()),
      import('@/app/actions/kafka-admin').then((m) => m.listClusters()),
      import('@/app/actions/kafka-admin').then((m) => m.listMappings()),
    ])
    setProviders(providersResult.providers)
    setClusters(clustersResult.clusters)
    setMappings(mappingsResult.mappings)
  }, [])

  const renderContent = () => {
    if (panelState.view === 'provider-detail') {
      const provider = providers.find((p) => p.id === panelState.providerId)
      if (!provider) return null
      return (
        <ProviderDetail
          provider={provider}
          onBack={handleBack}
          onSave={async () => {
            await refreshData()
            handleBack()
          }}
        />
      )
    }

    if (panelState.view === 'cluster-detail') {
      const cluster = panelState.clusterId
        ? clusters.find((c) => c.id === panelState.clusterId)
        : undefined
      return (
        <ClusterDetail
          cluster={cluster}
          providers={providers.filter((p) => p.isEnabled)}
          onBack={handleBack}
          onSave={async () => {
            await refreshData()
            handleBack()
          }}
          onDelete={async () => {
            await refreshData()
            handleBack()
          }}
        />
      )
    }

    if (panelState.view === 'mapping-edit') {
      const mapping = panelState.mappingId
        ? mappings.find((m) => m.id === panelState.mappingId)
        : undefined
      return (
        <MappingForm
          mapping={mapping}
          clusters={clusters}
          onBack={handleBack}
          onSave={async () => {
            await refreshData()
            handleBack()
          }}
          onDelete={async () => {
            await refreshData()
            handleBack()
          }}
        />
      )
    }

    // List view with tabs
    return (
      <Tabs value={panelState.tab} onValueChange={handleTabChange} className="flex-1 flex flex-col">
        <TabsList className="mx-4">
          <TabsTrigger value="clusters">Clusters</TabsTrigger>
          <TabsTrigger value="mappings">Environment Mappings</TabsTrigger>
          <TabsTrigger value="providers">Providers</TabsTrigger>
        </TabsList>

        <TabsContent value="clusters" className="flex-1 overflow-auto p-4">
          <ClustersTab
            clusters={clusters}
            onClusterClick={handleClusterClick}
            onAddCluster={() => handleClusterClick(null)}
            onRefresh={refreshData}
          />
        </TabsContent>

        <TabsContent value="mappings" className="flex-1 overflow-auto p-4">
          <MappingsTab
            mappings={mappings}
            onMappingClick={handleMappingClick}
            onAddMapping={() => handleMappingClick(null)}
            onRefresh={refreshData}
          />
        </TabsContent>

        <TabsContent value="providers" className="flex-1 overflow-auto p-4">
          <ProvidersTab
            providers={providers}
            onProviderClick={handleProviderClick}
          />
        </TabsContent>
      </Tabs>
    )
  }

  return (
    <div className="container py-8">
      <h1 className="text-2xl font-bold mb-4">Kafka Administration</h1>
      <p className="text-muted-foreground mb-6">
        Manage Kafka providers, clusters, and environment mappings for your platform.
      </p>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetContent side="right" className="w-full sm:max-w-2xl flex flex-col">
          <SheetHeader>
            <SheetTitle>
              {panelState.view === 'list' && 'Kafka Management'}
              {panelState.view === 'provider-detail' && 'Configure Provider'}
              {panelState.view === 'cluster-detail' && (panelState.clusterId ? 'Edit Cluster' : 'Add Cluster')}
              {panelState.view === 'mapping-edit' && (panelState.mappingId ? 'Edit Mapping' : 'Add Mapping')}
            </SheetTitle>
          </SheetHeader>
          {renderContent()}
        </SheetContent>
      </Sheet>
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add orbit-www/src/app/\(frontend\)/admin/kafka/kafka-admin-client.tsx
git commit -m "feat(kafka-admin): add client component with panel state management"
```

---

## Phase 3: Tab Components

### Task 4: Create ProvidersTab component

**Files:**
- Create: `orbit-www/src/app/(frontend)/admin/kafka/components/ProvidersTab.tsx`

**Step 1: Create the providers tab with card grid**

```typescript
'use client'

import React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Server, Cloud, Database } from 'lucide-react'
import type { KafkaProviderConfig } from '@/app/actions/kafka-admin'

interface ProvidersTabProps {
  providers: KafkaProviderConfig[]
  onProviderClick: (providerId: string) => void
}

const providerIcons: Record<string, React.ReactNode> = {
  'apache-kafka': <Server className="h-8 w-8" />,
  'confluent-cloud': <Cloud className="h-8 w-8" />,
  'aws-msk': <Cloud className="h-8 w-8" />,
  'redpanda': <Database className="h-8 w-8" />,
}

export function ProvidersTab({ providers, onProviderClick }: ProvidersTabProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {providers.map((provider) => (
        <Card
          key={provider.id}
          className="cursor-pointer hover:border-primary transition-colors"
          onClick={() => onProviderClick(provider.id)}
        >
          <CardHeader className="flex flex-row items-center gap-4">
            <div className="text-muted-foreground">
              {providerIcons[provider.id] || <Server className="h-8 w-8" />}
            </div>
            <div className="flex-1">
              <CardTitle className="text-lg">{provider.displayName}</CardTitle>
              <Badge variant={provider.isConfigured ? 'default' : 'secondary'} className="mt-1">
                {provider.isConfigured ? 'Configured' : 'Not configured'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              {provider.capabilities.schemaRegistry && (
                <Badge variant="outline" className="text-xs">Schema Registry</Badge>
              )}
              {provider.capabilities.transactions && (
                <Badge variant="outline" className="text-xs">Transactions</Badge>
              )}
            </div>
            <div className="mt-4">
              <Button variant="outline" size="sm">
                {provider.isConfigured ? 'Edit' : 'Configure'}
              </Button>
              {provider.isConfigured && (
                <Button variant="ghost" size="sm" className="ml-2">
                  Disable
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add orbit-www/src/app/\(frontend\)/admin/kafka/components/ProvidersTab.tsx
git commit -m "feat(kafka-admin): add ProvidersTab component with card grid"
```

---

### Task 5: Create ClustersTab component

**Files:**
- Create: `orbit-www/src/app/(frontend)/admin/kafka/components/ClustersTab.tsx`

**Step 1: Create the clusters tab with card grid and empty state**

```typescript
'use client'

import React, { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Plus, RefreshCw, Server, CheckCircle, XCircle, Loader2 } from 'lucide-react'
import { validateCluster } from '@/app/actions/kafka-admin'
import { toast } from 'sonner'
import type { KafkaClusterConfig } from '@/app/actions/kafka-admin'

interface ClustersTabProps {
  clusters: KafkaClusterConfig[]
  onClusterClick: (clusterId: string) => void
  onAddCluster: () => void
  onRefresh: () => Promise<void>
}

const statusConfig = {
  connected: { icon: CheckCircle, color: 'text-green-500', badge: 'default' as const },
  error: { icon: XCircle, color: 'text-red-500', badge: 'destructive' as const },
  validating: { icon: Loader2, color: 'text-yellow-500', badge: 'secondary' as const },
  unknown: { icon: Server, color: 'text-muted-foreground', badge: 'outline' as const },
}

export function ClustersTab({ clusters, onClusterClick, onAddCluster, onRefresh }: ClustersTabProps) {
  const [validatingId, setValidatingId] = useState<string | null>(null)

  const handleValidate = async (e: React.MouseEvent, clusterId: string) => {
    e.stopPropagation()
    setValidatingId(clusterId)
    try {
      const result = await validateCluster(clusterId)
      if (result.isValid) {
        toast.success('Cluster connection validated successfully')
      } else {
        toast.error(result.message || 'Cluster validation failed')
      }
      await onRefresh()
    } catch (error) {
      toast.error('Failed to validate cluster')
    } finally {
      setValidatingId(null)
    }
  }

  if (clusters.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Server className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold mb-2">No clusters registered</h3>
        <p className="text-muted-foreground mb-4">
          Register your first cluster to start managing Kafka topics.
        </p>
        <Button onClick={onAddCluster}>
          <Plus className="h-4 w-4 mr-2" />
          Add Cluster
        </Button>
      </div>
    )
  }

  return (
    <div>
      <div className="flex justify-end mb-4">
        <Button onClick={onAddCluster}>
          <Plus className="h-4 w-4 mr-2" />
          Add Cluster
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {clusters.map((cluster) => {
          const status = statusConfig[cluster.status]
          const StatusIcon = status.icon
          const isValidating = validatingId === cluster.id

          return (
            <Card
              key={cluster.id}
              className="cursor-pointer hover:border-primary transition-colors"
              onClick={() => onClusterClick(cluster.id)}
            >
              <CardHeader className="flex flex-row items-start justify-between">
                <div>
                  <CardTitle className="text-lg">{cluster.name}</CardTitle>
                  <p className="text-sm text-muted-foreground">{cluster.providerName}</p>
                </div>
                <Badge variant={status.badge}>
                  <StatusIcon className={`h-3 w-3 mr-1 ${status.color} ${cluster.status === 'validating' ? 'animate-spin' : ''}`} />
                  {cluster.status}
                </Badge>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-2 truncate">
                  {cluster.bootstrapServers}
                </p>

                {cluster.environmentMappings.length > 0 && (
                  <div className="flex gap-1 mb-3">
                    {cluster.environmentMappings.map((env) => (
                      <Badge key={env} variant="outline" className="text-xs">
                        {env}
                      </Badge>
                    ))}
                  </div>
                )}

                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => handleValidate(e, cluster.id)}
                  disabled={isValidating}
                >
                  {isValidating ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  Validate
                </Button>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add orbit-www/src/app/\(frontend\)/admin/kafka/components/ClustersTab.tsx
git commit -m "feat(kafka-admin): add ClustersTab component with card grid"
```

---

### Task 6: Create MappingsTab component

**Files:**
- Create: `orbit-www/src/app/(frontend)/admin/kafka/components/MappingsTab.tsx`

**Step 1: Create the mappings tab with collapsible environment groups**

```typescript
'use client'

import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Plus, ChevronDown, ChevronRight, Pencil, Trash2, ArrowRight } from 'lucide-react'
import { deleteMapping } from '@/app/actions/kafka-admin'
import { toast } from 'sonner'
import type { KafkaEnvironmentMapping } from '@/app/actions/kafka-admin'

interface MappingsTabProps {
  mappings: KafkaEnvironmentMapping[]
  onMappingClick: (mappingId: string) => void
  onAddMapping: () => void
  onRefresh: () => Promise<void>
}

const environments = ['production', 'staging', 'development'] as const

export function MappingsTab({ mappings, onMappingClick, onAddMapping, onRefresh }: MappingsTabProps) {
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(['production']))
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const toggleSection = (env: string) => {
    const newSet = new Set(openSections)
    if (newSet.has(env)) {
      newSet.delete(env)
    } else {
      newSet.add(env)
    }
    setOpenSections(newSet)
  }

  const handleDelete = async (e: React.MouseEvent, mappingId: string) => {
    e.stopPropagation()
    if (!confirm('Are you sure you want to delete this mapping?')) return

    setDeletingId(mappingId)
    try {
      const result = await deleteMapping(mappingId)
      if (result.success) {
        toast.success('Mapping deleted')
        await onRefresh()
      } else {
        toast.error(result.error || 'Failed to delete mapping')
      }
    } catch (error) {
      toast.error('Failed to delete mapping')
    } finally {
      setDeletingId(null)
    }
  }

  const groupedMappings = environments.reduce((acc, env) => {
    acc[env] = mappings
      .filter((m) => m.environment === env)
      .sort((a, b) => b.priority - a.priority)
    return acc
  }, {} as Record<string, KafkaEnvironmentMapping[]>)

  return (
    <div>
      <div className="flex justify-end mb-4">
        <Button onClick={onAddMapping}>
          <Plus className="h-4 w-4 mr-2" />
          Add Mapping
        </Button>
      </div>

      <div className="space-y-2">
        {environments.map((env) => {
          const envMappings = groupedMappings[env]
          const isOpen = openSections.has(env)

          return (
            <Collapsible key={env} open={isOpen} onOpenChange={() => toggleSection(env)}>
              <CollapsibleTrigger className="flex items-center justify-between w-full p-3 bg-muted rounded-lg hover:bg-muted/80">
                <div className="flex items-center gap-2">
                  {isOpen ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  <span className="font-medium capitalize">{env}</span>
                  <Badge variant="secondary">{envMappings.length}</Badge>
                </div>
              </CollapsibleTrigger>

              <CollapsibleContent className="mt-2 space-y-2 pl-6">
                {envMappings.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-2">
                    No mappings for {env}.{' '}
                    <button
                      onClick={onAddMapping}
                      className="text-primary hover:underline"
                    >
                      Add mapping
                    </button>
                  </p>
                ) : (
                  envMappings.map((mapping) => (
                    <div
                      key={mapping.id}
                      className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm">
                          {mapping.workspaceName || 'All workspaces'}
                        </span>
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">{mapping.clusterName}</span>
                        <Badge variant="outline" className="text-xs">
                          Priority: {mapping.priority}
                        </Badge>
                        {!mapping.isEnabled && (
                          <Badge variant="secondary" className="text-xs">
                            Disabled
                          </Badge>
                        )}
                      </div>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onMappingClick(mapping.id)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => handleDelete(e, mapping.id)}
                          disabled={deletingId === mapping.id}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </CollapsibleContent>
            </Collapsible>
          )
        })}
      </div>
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add orbit-www/src/app/\(frontend\)/admin/kafka/components/MappingsTab.tsx
git commit -m "feat(kafka-admin): add MappingsTab component with collapsible groups"
```

---

## Phase 4: Detail/Form Components

### Task 7: Create ProviderDetail component

**Files:**
- Create: `orbit-www/src/app/(frontend)/admin/kafka/components/ProviderDetail.tsx`

**Step 1: Create the provider detail form**

```typescript
'use client'

import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ArrowLeft, Loader2, ExternalLink } from 'lucide-react'
import { saveProviderConfig } from '@/app/actions/kafka-admin'
import { toast } from 'sonner'
import type { KafkaProviderConfig } from '@/app/actions/kafka-admin'

interface ProviderDetailProps {
  provider: KafkaProviderConfig
  onBack: () => void
  onSave: () => Promise<void>
}

export function ProviderDetail({ provider, onBack, onSave }: ProviderDetailProps) {
  const [saving, setSaving] = useState(false)
  const [isEnabled, setIsEnabled] = useState(provider.isEnabled)
  const [credentials, setCredentials] = useState<Record<string, string>>(
    provider.credentials || {}
  )
  const [defaults, setDefaults] = useState<Record<string, string>>(
    provider.defaults || {}
  )

  const handleCredentialChange = (field: string, value: string) => {
    setCredentials((prev) => ({ ...prev, [field]: value }))
  }

  const handleDefaultChange = (field: string, value: string) => {
    setDefaults((prev) => ({ ...prev, [field]: value }))
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const result = await saveProviderConfig(provider.id, {
        credentials,
        defaults,
        isEnabled,
      })

      if (result.success) {
        toast.success('Provider configuration saved')
        await onSave()
      } else {
        toast.error(result.error || 'Failed to save configuration')
      }
    } catch (error) {
      toast.error('Failed to save configuration')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Providers
      </button>

      <div className="flex items-center gap-4 mb-6">
        <div>
          <h2 className="text-xl font-semibold">{provider.displayName}</h2>
          <a
            href={provider.documentationUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-primary hover:underline flex items-center gap-1"
          >
            Documentation <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>

      <div className="flex-1 overflow-auto space-y-6">
        {/* Enable/Disable Toggle */}
        <div className="flex items-center justify-between">
          <div>
            <Label>Enable Provider</Label>
            <p className="text-sm text-muted-foreground">
              Allow this provider to be used when registering clusters
            </p>
          </div>
          <Switch checked={isEnabled} onCheckedChange={setIsEnabled} />
        </div>

        {/* Credentials Section */}
        <div>
          <h3 className="font-medium mb-3">Credentials</h3>
          <div className="space-y-4">
            {provider.requiredConfigFields.map((field) => (
              <div key={field}>
                <Label htmlFor={field}>{formatFieldName(field)}</Label>
                <Input
                  id={field}
                  type={field.toLowerCase().includes('secret') || field.toLowerCase().includes('password') || field.toLowerCase().includes('key') ? 'password' : 'text'}
                  value={credentials[field] || ''}
                  onChange={(e) => handleCredentialChange(field, e.target.value)}
                  placeholder={`Enter ${formatFieldName(field).toLowerCase()}`}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Default Settings Section */}
        <div>
          <h3 className="font-medium mb-3">Default Settings</h3>
          <div className="space-y-4">
            <div>
              <Label htmlFor="defaultReplicationFactor">Default Replication Factor</Label>
              <Input
                id="defaultReplicationFactor"
                type="number"
                min={1}
                value={defaults['replicationFactor'] || '3'}
                onChange={(e) => handleDefaultChange('replicationFactor', e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="defaultPartitions">Default Partitions</Label>
              <Input
                id="defaultPartitions"
                type="number"
                min={1}
                value={defaults['partitions'] || '6'}
                onChange={(e) => handleDefaultChange('partitions', e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Footer Actions */}
      <div className="flex justify-end gap-2 pt-4 border-t mt-4">
        <Button variant="outline" onClick={onBack}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Save Configuration
        </Button>
      </div>
    </div>
  )
}

function formatFieldName(field: string): string {
  return field
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (str) => str.toUpperCase())
    .trim()
}
```

**Step 2: Commit**

```bash
git add orbit-www/src/app/\(frontend\)/admin/kafka/components/ProviderDetail.tsx
git commit -m "feat(kafka-admin): add ProviderDetail form component"
```

---

### Task 8: Create ClusterDetail component

**Files:**
- Create: `orbit-www/src/app/(frontend)/admin/kafka/components/ClusterDetail.tsx`

**Step 1: Create the cluster detail/edit form**

```typescript
'use client'

import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { createCluster, deleteCluster, validateCluster } from '@/app/actions/kafka-admin'
import { toast } from 'sonner'
import type { KafkaClusterConfig, KafkaProviderConfig } from '@/app/actions/kafka-admin'

interface ClusterDetailProps {
  cluster?: KafkaClusterConfig
  providers: KafkaProviderConfig[]
  onBack: () => void
  onSave: () => Promise<void>
  onDelete: () => Promise<void>
}

export function ClusterDetail({ cluster, providers, onBack, onSave, onDelete }: ClusterDetailProps) {
  const isNew = !cluster
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [validating, setValidating] = useState(false)

  const [name, setName] = useState(cluster?.name || '')
  const [providerId, setProviderId] = useState(cluster?.providerId || '')
  const [bootstrapServers, setBootstrapServers] = useState(cluster?.bootstrapServers || '')
  const [region, setRegion] = useState(cluster?.region || '')

  const selectedProvider = providers.find((p) => p.id === providerId)

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Cluster name is required')
      return
    }
    if (!providerId) {
      toast.error('Please select a provider')
      return
    }
    if (!bootstrapServers.trim()) {
      toast.error('Bootstrap servers are required')
      return
    }

    setSaving(true)
    try {
      const result = await createCluster({
        name: name.trim(),
        providerId,
        config: {
          bootstrapServers: bootstrapServers.trim(),
          region: region.trim(),
        },
      })

      if (result.cluster) {
        toast.success(isNew ? 'Cluster registered' : 'Cluster updated')
        await onSave()
      } else {
        toast.error(result.error || 'Failed to save cluster')
      }
    } catch (error) {
      toast.error('Failed to save cluster')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!cluster) return
    if (!confirm('Are you sure you want to delete this cluster? This action cannot be undone.')) return

    setDeleting(true)
    try {
      const result = await deleteCluster(cluster.id)
      if (result.success) {
        toast.success('Cluster deleted')
        await onDelete()
      } else {
        toast.error(result.error || 'Failed to delete cluster')
      }
    } catch (error) {
      toast.error('Failed to delete cluster')
    } finally {
      setDeleting(false)
    }
  }

  const handleValidate = async () => {
    if (!cluster) return

    setValidating(true)
    try {
      const result = await validateCluster(cluster.id)
      if (result.isValid) {
        toast.success('Cluster connection validated')
      } else {
        toast.error(result.message || 'Validation failed')
      }
    } catch (error) {
      toast.error('Failed to validate cluster')
    } finally {
      setValidating(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Clusters
      </button>

      <div className="flex-1 overflow-auto space-y-6">
        {/* Status (existing cluster only) */}
        {cluster && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Status:</span>
              <Badge variant={cluster.status === 'connected' ? 'default' : 'secondary'}>
                {cluster.status}
              </Badge>
            </div>
            <Button variant="outline" size="sm" onClick={handleValidate} disabled={validating}>
              {validating ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Validate Now
            </Button>
          </div>
        )}

        {/* Basic Info */}
        <div className="space-y-4">
          <div>
            <Label htmlFor="name">Cluster Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., prod-us-east-1"
            />
          </div>

          <div>
            <Label htmlFor="provider">Provider</Label>
            <Select value={providerId} onValueChange={setProviderId} disabled={!isNew}>
              <SelectTrigger>
                <SelectValue placeholder="Select a provider" />
              </SelectTrigger>
              <SelectContent>
                {providers.map((provider) => (
                  <SelectItem key={provider.id} value={provider.id}>
                    {provider.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Connection Settings */}
        <div>
          <h3 className="font-medium mb-3">Connection</h3>
          <div className="space-y-4">
            <div>
              <Label htmlFor="bootstrapServers">Bootstrap Servers</Label>
              <Input
                id="bootstrapServers"
                value={bootstrapServers}
                onChange={(e) => setBootstrapServers(e.target.value)}
                placeholder="broker1:9092,broker2:9092"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Comma-separated list of broker addresses
              </p>
            </div>

            {selectedProvider?.id === 'aws-msk' && (
              <div>
                <Label htmlFor="region">AWS Region</Label>
                <Input
                  id="region"
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  placeholder="us-east-1"
                />
              </div>
            )}
          </div>
        </div>

        {/* Info Section (existing cluster only) */}
        {cluster && (
          <div>
            <h3 className="font-medium mb-3">Information</h3>
            <dl className="space-y-2 text-sm">
              {cluster.topicsCount !== undefined && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Topics</dt>
                  <dd>{cluster.topicsCount}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Created</dt>
                <dd>{new Date(cluster.createdAt).toLocaleDateString()}</dd>
              </div>
              {cluster.lastValidatedAt && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Last Validated</dt>
                  <dd>{new Date(cluster.lastValidatedAt).toLocaleString()}</dd>
                </div>
              )}
            </dl>
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div className="flex justify-between pt-4 border-t mt-4">
        <div>
          {cluster && (
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              <Trash2 className="h-4 w-4 mr-2" />
              Delete Cluster
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onBack}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isNew ? 'Register Cluster' : 'Save Changes'}
          </Button>
        </div>
      </div>
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add orbit-www/src/app/\(frontend\)/admin/kafka/components/ClusterDetail.tsx
git commit -m "feat(kafka-admin): add ClusterDetail form component"
```

---

### Task 9: Create MappingForm component

**Files:**
- Create: `orbit-www/src/app/(frontend)/admin/kafka/components/MappingForm.tsx`

**Step 1: Create the mapping form**

```typescript
'use client'

import React, { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { ArrowLeft, Loader2, Trash2 } from 'lucide-react'
import { createMapping, deleteMapping, listWorkspaces } from '@/app/actions/kafka-admin'
import { toast } from 'sonner'
import type { KafkaClusterConfig, KafkaEnvironmentMapping } from '@/app/actions/kafka-admin'

interface MappingFormProps {
  mapping?: KafkaEnvironmentMapping
  clusters: KafkaClusterConfig[]
  onBack: () => void
  onSave: () => Promise<void>
  onDelete: () => Promise<void>
}

const environments = [
  { value: 'production', label: 'Production' },
  { value: 'staging', label: 'Staging' },
  { value: 'development', label: 'Development' },
]

export function MappingForm({ mapping, clusters, onBack, onSave, onDelete }: MappingFormProps) {
  const isNew = !mapping
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [workspaces, setWorkspaces] = useState<{ id: string; name: string; slug: string }[]>([])

  const [environment, setEnvironment] = useState(mapping?.environment || '')
  const [workspaceId, setWorkspaceId] = useState(mapping?.workspaceId || '')
  const [clusterId, setClusterId] = useState(mapping?.clusterId || '')
  const [priority, setPriority] = useState(mapping?.priority || 1)
  const [description, setDescription] = useState(mapping?.description || '')
  const [isEnabled, setIsEnabled] = useState(mapping?.isEnabled ?? true)

  useEffect(() => {
    async function fetchWorkspaces() {
      const result = await listWorkspaces()
      if (result.workspaces) {
        setWorkspaces(result.workspaces)
      }
    }
    fetchWorkspaces()
  }, [])

  const handleSave = async () => {
    if (!environment) {
      toast.error('Please select an environment')
      return
    }
    if (!clusterId) {
      toast.error('Please select a cluster')
      return
    }

    setSaving(true)
    try {
      const result = await createMapping({
        environment,
        workspaceId: workspaceId || undefined,
        clusterId,
        priority,
        description: description || undefined,
        isEnabled,
      })

      if (result.mapping) {
        toast.success(isNew ? 'Mapping created' : 'Mapping updated')
        await onSave()
      } else {
        toast.error(result.error || 'Failed to save mapping')
      }
    } catch (error) {
      toast.error('Failed to save mapping')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!mapping) return
    if (!confirm('Are you sure you want to delete this mapping?')) return

    setDeleting(true)
    try {
      const result = await deleteMapping(mapping.id)
      if (result.success) {
        toast.success('Mapping deleted')
        await onDelete()
      } else {
        toast.error(result.error || 'Failed to delete mapping')
      }
    } catch (error) {
      toast.error('Failed to delete mapping')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Mappings
      </button>

      <div className="flex-1 overflow-auto space-y-6">
        <div>
          <Label htmlFor="environment">Environment</Label>
          <Select value={environment} onValueChange={setEnvironment}>
            <SelectTrigger>
              <SelectValue placeholder="Select environment" />
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

        <div>
          <Label htmlFor="workspace">Workspace (optional)</Label>
          <Select value={workspaceId} onValueChange={setWorkspaceId}>
            <SelectTrigger>
              <SelectValue placeholder="All workspaces" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All workspaces</SelectItem>
              {workspaces.map((ws) => (
                <SelectItem key={ws.id} value={ws.id}>
                  {ws.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-1">
            Leave empty to apply to all workspaces
          </p>
        </div>

        <div>
          <Label htmlFor="cluster">Cluster</Label>
          <Select value={clusterId} onValueChange={setClusterId}>
            <SelectTrigger>
              <SelectValue placeholder="Select cluster" />
            </SelectTrigger>
            <SelectContent>
              {clusters.map((cluster) => (
                <SelectItem key={cluster.id} value={cluster.id}>
                  {cluster.name} ({cluster.providerName})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="priority">Priority</Label>
          <Input
            id="priority"
            type="number"
            min={1}
            value={priority}
            onChange={(e) => setPriority(parseInt(e.target.value) || 1)}
          />
          <p className="text-xs text-muted-foreground mt-1">
            Higher priority rules take precedence. Workspace-specific rules should have higher priority than global rules.
          </p>
        </div>

        <div>
          <Label htmlFor="description">Description (optional)</Label>
          <Textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g., Dedicated cluster for compliance team"
            rows={3}
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <Label>Enabled</Label>
            <p className="text-sm text-muted-foreground">
              Disable to temporarily exclude this mapping
            </p>
          </div>
          <Switch checked={isEnabled} onCheckedChange={setIsEnabled} />
        </div>
      </div>

      {/* Footer Actions */}
      <div className="flex justify-between pt-4 border-t mt-4">
        <div>
          {mapping && (
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              <Trash2 className="h-4 w-4 mr-2" />
              Delete Mapping
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onBack}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isNew ? 'Create Mapping' : 'Save Changes'}
          </Button>
        </div>
      </div>
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add orbit-www/src/app/\(frontend\)/admin/kafka/components/MappingForm.tsx
git commit -m "feat(kafka-admin): add MappingForm component"
```

---

## Phase 5: Component Index & Final Integration

### Task 10: Create component index file

**Files:**
- Create: `orbit-www/src/app/(frontend)/admin/kafka/components/index.ts`

**Step 1: Create barrel export**

```typescript
export { ProvidersTab } from './ProvidersTab'
export { ClustersTab } from './ClustersTab'
export { MappingsTab } from './MappingsTab'
export { ProviderDetail } from './ProviderDetail'
export { ClusterDetail } from './ClusterDetail'
export { MappingForm } from './MappingForm'
```

**Step 2: Commit**

```bash
git add orbit-www/src/app/\(frontend\)/admin/kafka/components/index.ts
git commit -m "feat(kafka-admin): add component barrel export"
```

---

### Task 11: Install missing dependencies

**Step 1: Check if Switch component exists, if not install**

```bash
cd orbit-www
# Check if switch exists
ls src/components/ui/switch.tsx || bunx shadcn@latest add switch --yes
```

**Step 2: Commit if new component added**

```bash
git add orbit-www/src/components/ui/switch.tsx orbit-www/package.json orbit-www/bun.lockb 2>/dev/null
git commit -m "chore: add switch component from shadcn" 2>/dev/null || echo "No new components to commit"
```

---

### Task 12: Final integration test

**Step 1: Type check the entire kafka admin module**

```bash
cd orbit-www
bunx tsc --noEmit 2>&1 | grep -E "admin/kafka|kafka-admin" || echo "No TypeScript errors in Kafka admin"
```

**Step 2: Start dev server and test navigation**

```bash
# In one terminal
cd orbit-www && bun run dev

# Test by navigating to http://localhost:3000/admin/kafka
```

**Step 3: Final commit with all fixes**

```bash
git add -A
git commit -m "feat(kafka-admin): complete Kafka admin UI implementation

Implements platform admin interface at /admin/kafka:
- Providers tab with card grid and configuration form
- Clusters tab with registration, validation, and deletion
- Environment Mappings tab with priority-based routing rules
- Slide-over panel with client-side state management
- Server actions calling Kafka gRPC service

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Summary

**Total Tasks:** 12

**Files Created:**
- `orbit-www/src/app/actions/kafka-admin.ts`
- `orbit-www/src/app/(frontend)/admin/kafka/page.tsx`
- `orbit-www/src/app/(frontend)/admin/kafka/kafka-admin-client.tsx`
- `orbit-www/src/app/(frontend)/admin/kafka/components/ProvidersTab.tsx`
- `orbit-www/src/app/(frontend)/admin/kafka/components/ClustersTab.tsx`
- `orbit-www/src/app/(frontend)/admin/kafka/components/MappingsTab.tsx`
- `orbit-www/src/app/(frontend)/admin/kafka/components/ProviderDetail.tsx`
- `orbit-www/src/app/(frontend)/admin/kafka/components/ClusterDetail.tsx`
- `orbit-www/src/app/(frontend)/admin/kafka/components/MappingForm.tsx`
- `orbit-www/src/app/(frontend)/admin/kafka/components/index.ts`

**Dependencies:**
- shadcn/ui: Sheet, Tabs, Card, Badge, Button, Input, Select, Switch, Textarea, Collapsible
- lucide-react icons
- sonner for toast notifications
