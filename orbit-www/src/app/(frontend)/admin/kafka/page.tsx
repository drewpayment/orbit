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
      <div className="p-6">
        <div className="bg-destructive/10 text-destructive rounded-lg p-4">
          <h3 className="font-semibold mb-2">Failed to load Kafka data</h3>
          <ul className="list-disc list-inside">
            {errors.map((error, i) => (
              <li key={i}>{error}</li>
            ))}
          </ul>
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
