'use client'

import { useState, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertCircle } from 'lucide-react'
import type { VirtualClusterConfig, CredentialConfig, GatewayStatus } from '@/app/actions/bifrost-admin'
import { VirtualClustersTab } from './VirtualClustersTab'
import { CredentialsTab } from './CredentialsTab'
import { GatewayStatusTab } from './GatewayStatusTab'

interface GatewayTabProps {
  initialVirtualClusters: VirtualClusterConfig[]
  initialCredentials: CredentialConfig[]
  initialStatus: GatewayStatus | null
  connectionError?: string
}

export function GatewayTab({
  initialVirtualClusters,
  initialCredentials,
  initialStatus,
  connectionError,
}: GatewayTabProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  // Get initial sub-tab from URL or default to virtual-clusters
  const initialSubTab = searchParams.get('subtab') || 'virtual-clusters'

  const [activeSubTab, setActiveSubTab] = useState(initialSubTab)
  const [virtualClusters, setVirtualClusters] = useState(initialVirtualClusters)
  const [credentials, setCredentials] = useState(initialCredentials)
  const [status, setStatus] = useState(initialStatus)
  const [error, setError] = useState<string | null>(connectionError || null)

  // Update URL when sub-tab changes
  const handleSubTabChange = useCallback((newSubTab: string) => {
    setActiveSubTab(newSubTab)
    const params = new URLSearchParams(searchParams.toString())
    params.set('subtab', newSubTab)
    router.push(`?${params.toString()}`, { scroll: false })
  }, [router, searchParams])

  // Refresh functions
  const refreshVirtualClusters = async () => {
    try {
      const { listVirtualClusters } = await import('@/app/actions/bifrost-admin')
      const result = await listVirtualClusters()
      if (result.success && result.data) {
        setVirtualClusters(result.data)
        setError(null)
      } else {
        setError(result.error || 'Failed to refresh virtual clusters')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh virtual clusters')
    }
  }

  const refreshCredentials = async () => {
    try {
      const { listCredentials } = await import('@/app/actions/bifrost-admin')
      const result = await listCredentials()
      if (result.success && result.data) {
        setCredentials(result.data)
        setError(null)
      } else {
        setError(result.error || 'Failed to refresh credentials')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh credentials')
    }
  }

  const refreshStatus = async () => {
    try {
      const { getGatewayStatus } = await import('@/app/actions/bifrost-admin')
      const result = await getGatewayStatus()
      if (result.success && result.data) {
        setStatus(result.data)
        setError(null)
      } else {
        setError(result.error || 'Failed to refresh status')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh status')
    }
  }

  return (
    <div className="space-y-6">
      {/* Connection error banner */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            <span>{error}</span>
            <button
              onClick={() => setError(null)}
              className="text-sm underline hover:no-underline"
            >
              Dismiss
            </button>
          </AlertDescription>
        </Alert>
      )}

      <Tabs value={activeSubTab} onValueChange={handleSubTabChange}>
        <TabsList>
          <TabsTrigger value="virtual-clusters">
            Virtual Clusters
            {virtualClusters.length > 0 && (
              <span className="ml-2 text-xs bg-muted px-2 py-0.5 rounded-full">
                {virtualClusters.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="credentials">
            Credentials
            {credentials.length > 0 && (
              <span className="ml-2 text-xs bg-muted px-2 py-0.5 rounded-full">
                {credentials.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="status">
            Status
          </TabsTrigger>
        </TabsList>

        <TabsContent value="virtual-clusters" className="mt-6">
          <VirtualClustersTab
            virtualClusters={virtualClusters}
            onRefresh={refreshVirtualClusters}
            onVirtualClustersChange={setVirtualClusters}
          />
        </TabsContent>

        <TabsContent value="credentials" className="mt-6">
          <CredentialsTab
            credentials={credentials}
            virtualClusters={virtualClusters}
            onRefresh={refreshCredentials}
            onCredentialsChange={setCredentials}
          />
        </TabsContent>

        <TabsContent value="status" className="mt-6">
          <GatewayStatusTab
            status={status}
            onRefresh={refreshStatus}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
