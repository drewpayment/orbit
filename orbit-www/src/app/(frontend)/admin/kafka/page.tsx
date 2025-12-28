import { getProviders, listClusters, listMappings } from '@/app/actions/kafka-admin'
import { KafkaAdminClient } from './components/KafkaAdminClient'

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

  // Handle errors - show error state if any critical data fails
  if (!providersResult.success) {
    return (
      <div className="p-6">
        <div className="bg-destructive/10 text-destructive rounded-lg p-4">
          Failed to load providers: {providersResult.error}
        </div>
      </div>
    )
  }

  return (
    <KafkaAdminClient
      initialProviders={providersResult.data || []}
      initialClusters={clustersResult.data || []}
      initialMappings={mappingsResult.data || []}
    />
  )
}
