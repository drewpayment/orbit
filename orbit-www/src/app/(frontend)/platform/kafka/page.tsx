import { getProviders, listClusters, listMappings } from '@/app/actions/kafka-admin'
import {
  listVirtualClusters,
  listCredentials,
  getGatewayStatus,
  type VirtualClusterConfig,
  type CredentialConfig,
  type GatewayStatus,
} from '@/app/actions/bifrost-admin'
import { KafkaAdminClient } from './components/KafkaAdminClient'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'

export const metadata = {
  title: 'Kafka Management - Orbit Admin',
  description: 'Manage Kafka clusters and environment mappings',
}

export default async function KafkaAdminPage() {
  // Fetch initial data in parallel for better performance
  const [providersResult, clustersResult, mappingsResult] = await Promise.all([
    getProviders(),
    listClusters(),
    listMappings(),
  ])

  // Fetch gateway data separately (non-critical - may fail if Bifrost is not running)
  let virtualClusters: VirtualClusterConfig[] = []
  let credentials: CredentialConfig[] = []
  let gatewayStatus: GatewayStatus | null = null
  let gatewayConnectionError: string | undefined

  try {
    const [vcResult, credResult, statusResult] = await Promise.all([
      listVirtualClusters(),
      listCredentials(),
      getGatewayStatus(),
    ])

    if (vcResult.success && vcResult.data) {
      virtualClusters = vcResult.data
    }
    if (credResult.success && credResult.data) {
      credentials = credResult.data
    }
    if (statusResult.success && statusResult.data) {
      gatewayStatus = statusResult.data
    }
  } catch {
    gatewayConnectionError = 'Unable to connect to Bifrost gateway'
  }

  // Collect any errors from data fetching
  const errors: string[] = []
  if (!providersResult.success) {
    errors.push(`Providers: ${providersResult.error}`)
  }
  if (!clustersResult.success) {
    errors.push(`Clusters: ${clustersResult.error}`)
  }
  if (!mappingsResult.success) {
    errors.push(`Mappings: ${mappingsResult.error}`)
  }

  // Show error state if any critical data fails
  if (errors.length > 0) {
    return (
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <SiteHeader />
          <div className="flex flex-1 flex-col p-6">
            <div className="bg-destructive/10 text-destructive rounded-lg p-4">
              <h3 className="font-semibold mb-2">Failed to load Kafka data</h3>
              <ul className="list-disc list-inside">
                {errors.map((error, i) => (
                  <li key={i}>{error}</li>
                ))}
              </ul>
            </div>
          </div>
        </SidebarInset>
      </SidebarProvider>
    )
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col">
          <KafkaAdminClient
            initialProviders={providersResult.data || []}
            initialClusters={clustersResult.data || []}
            initialMappings={mappingsResult.data || []}
            initialVirtualClusters={virtualClusters}
            initialCredentials={credentials}
            initialGatewayStatus={gatewayStatus}
            gatewayConnectionError={gatewayConnectionError}
          />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
