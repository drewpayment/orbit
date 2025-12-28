'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { kafkaClient } from '@/lib/grpc/kafka-client'
import type {
  KafkaProvider,
  KafkaCluster,
  KafkaEnvironmentMapping,
  ClusterValidationStatus,
} from '@/lib/proto/idp/kafka/v1/kafka_pb'

// ============================================================================
// Type Definitions
// ============================================================================

export interface KafkaProviderConfig {
  id: string
  name: string
  displayName: string
  authMethods: string[]
  features: {
    schemaRegistry: boolean
    topicCreation: boolean
    aclManagement: boolean
    quotaManagement: boolean
  }
  defaultSettings: Record<string, unknown>
  enabled: boolean
}

export interface KafkaClusterConfig {
  id: string
  name: string
  providerId: string
  bootstrapServers: string
  environment: string
  status: 'pending' | 'valid' | 'invalid' | 'unknown'
  schemaRegistryUrl?: string
  credentials: Record<string, string>
  config: Record<string, string>
}

export interface KafkaEnvironmentMappingConfig {
  id: string
  environment: string
  clusterId: string
  clusterName: string
  priority: number
  isDefault: boolean
  createdAt?: string
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Checks if the current user has admin privileges.
 * Throws an error if the user is not authenticated or not an admin.
 */
async function requireAdmin(): Promise<{ userId: string }> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    throw new Error('Unauthorized: Authentication required')
  }

  const payload = await getPayload({ config })

  // Check for platform-level admin role
  const roleAssignments = await payload.find({
    collection: 'user-workspace-roles' as any,
    where: {
      user: { equals: session.user.id },
    },
    depth: 2,
    limit: 100,
  })

  const isAdmin = roleAssignments.docs.some((assignment: any) => {
    const role = typeof assignment.role === 'object' ? assignment.role : null
    if (!role) return false
    // Check if user has platform admin role or any admin role
    return (
      role.scope === 'platform' &&
      (role.slug === 'admin' || role.slug === 'platform-admin')
    )
  })

  if (!isAdmin) {
    throw new Error('Unauthorized: Admin privileges required')
  }

  return { userId: session.user.id }
}

/**
 * Converts ClusterValidationStatus enum to a string status.
 */
function mapValidationStatus(status: ClusterValidationStatus): KafkaClusterConfig['status'] {
  // Use number comparison since enum values are numbers
  switch (status) {
    case 1: // PENDING
      return 'pending'
    case 2: // VALID
      return 'valid'
    case 3: // INVALID
      return 'invalid'
    default:
      return 'unknown'
  }
}

/**
 * Converts a proto KafkaCluster to KafkaClusterConfig.
 */
function mapClusterToConfig(cluster: KafkaCluster): KafkaClusterConfig {
  return {
    id: cluster.id,
    name: cluster.name,
    providerId: cluster.providerId,
    bootstrapServers: cluster.connectionConfig?.['bootstrap.servers'] || '',
    environment: cluster.connectionConfig?.['environment'] || 'development',
    status: mapValidationStatus(cluster.validationStatus),
    schemaRegistryUrl: cluster.connectionConfig?.['schema.registry.url'],
    credentials: {}, // Credentials are not exposed in the response for security
    config: cluster.connectionConfig || {},
  }
}

/**
 * Converts a proto KafkaProvider to KafkaProviderConfig.
 */
function mapProviderToConfig(provider: KafkaProvider): KafkaProviderConfig {
  return {
    id: provider.id,
    name: provider.name,
    displayName: provider.displayName,
    authMethods: provider.requiredConfigFields || [],
    features: {
      schemaRegistry: provider.capabilities?.schemaRegistry ?? false,
      topicCreation: true, // Default to true
      aclManagement: false, // Not in current proto
      quotaManagement: provider.capabilities?.quotasApi ?? false,
    },
    defaultSettings: {},
    enabled: true,
  }
}

/**
 * Converts a proto KafkaEnvironmentMapping to KafkaEnvironmentMappingConfig.
 */
function mapMappingToConfig(
  mapping: KafkaEnvironmentMapping,
  clusterName?: string
): KafkaEnvironmentMappingConfig {
  return {
    id: mapping.id,
    environment: mapping.environment,
    clusterId: mapping.clusterId,
    clusterName: clusterName || mapping.clusterId,
    priority: mapping.priority,
    isDefault: mapping.isDefault,
    createdAt: undefined, // Not in current proto
  }
}

// ============================================================================
// Provider Actions
// ============================================================================

/**
 * Lists all available Kafka providers.
 */
export async function getProviders(): Promise<{
  success: boolean
  data?: KafkaProviderConfig[]
  error?: string
}> {
  try {
    await requireAdmin()

    const response = await kafkaClient.listProviders({})

    const providers = response.providers.map(mapProviderToConfig)

    return { success: true, data: providers }
  } catch (error) {
    console.error('Failed to get Kafka providers:', error)
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to get Kafka providers'
    return { success: false, error: errorMessage }
  }
}

/**
 * Saves provider configuration.
 * Note: This is a placeholder - provider configuration is typically static.
 */
export async function saveProviderConfig(
  providerId: string,
  providerConfig: Partial<KafkaProviderConfig>
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin()

    // Log the save attempt - provider config is typically managed externally
    console.log(`[kafka-admin] saveProviderConfig called for provider: ${providerId}`, {
      config: providerConfig,
    })

    // In a real implementation, this might update provider settings in the database
    // For now, we just acknowledge the save request
    return { success: true }
  } catch (error) {
    console.error('Failed to save provider config:', error)
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to save provider config'
    return { success: false, error: errorMessage }
  }
}

// ============================================================================
// Cluster Actions
// ============================================================================

/**
 * Lists all registered Kafka clusters.
 */
export async function listClusters(): Promise<{
  success: boolean
  data?: KafkaClusterConfig[]
  error?: string
}> {
  try {
    await requireAdmin()

    const response = await kafkaClient.listClusters({})

    const clusters = response.clusters.map(mapClusterToConfig)

    return { success: true, data: clusters }
  } catch (error) {
    console.error('Failed to list Kafka clusters:', error)
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to list Kafka clusters'
    return { success: false, error: errorMessage }
  }
}

/**
 * Gets a single Kafka cluster by ID.
 */
export async function getCluster(clusterId: string): Promise<{
  success: boolean
  data?: KafkaClusterConfig
  error?: string
}> {
  try {
    await requireAdmin()

    const response = await kafkaClient.listClusters({})

    const cluster = response.clusters.find((c) => c.id === clusterId)

    if (!cluster) {
      return { success: false, error: 'Cluster not found' }
    }

    return { success: true, data: mapClusterToConfig(cluster) }
  } catch (error) {
    console.error('Failed to get Kafka cluster:', error)
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to get Kafka cluster'
    return { success: false, error: errorMessage }
  }
}

/**
 * Creates a new Kafka cluster.
 */
export async function createCluster(data: {
  name: string
  providerId: string
  bootstrapServers: string
  environment?: string
  schemaRegistryUrl?: string
  credentials?: Record<string, string>
  config?: Record<string, string>
}): Promise<{
  success: boolean
  data?: KafkaClusterConfig
  error?: string
}> {
  try {
    await requireAdmin()

    // Build connection config
    const connectionConfig: Record<string, string> = {
      'bootstrap.servers': data.bootstrapServers,
      ...(data.environment && { environment: data.environment }),
      ...(data.schemaRegistryUrl && { 'schema.registry.url': data.schemaRegistryUrl }),
      ...(data.config || {}),
    }

    const response = await kafkaClient.registerCluster({
      name: data.name,
      providerId: data.providerId,
      connectionConfig,
      credentials: data.credentials || {},
    })

    if (response.error) {
      return { success: false, error: response.error }
    }

    if (!response.cluster) {
      return { success: false, error: 'No cluster returned from registration' }
    }

    return { success: true, data: mapClusterToConfig(response.cluster) }
  } catch (error) {
    console.error('Failed to create Kafka cluster:', error)
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to create Kafka cluster'
    return { success: false, error: errorMessage }
  }
}

/**
 * Deletes a Kafka cluster.
 */
export async function deleteCluster(clusterId: string): Promise<{
  success: boolean
  error?: string
}> {
  try {
    await requireAdmin()

    const response = await kafkaClient.deleteCluster({ clusterId })

    if (!response.success) {
      return { success: false, error: response.error || 'Failed to delete cluster' }
    }

    return { success: true }
  } catch (error) {
    console.error('Failed to delete Kafka cluster:', error)
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to delete Kafka cluster'
    return { success: false, error: errorMessage }
  }
}

/**
 * Validates a Kafka cluster's connectivity.
 */
export async function validateCluster(clusterId: string): Promise<{
  success: boolean
  valid?: boolean
  error?: string
}> {
  try {
    await requireAdmin()

    const response = await kafkaClient.validateCluster({ clusterId })

    if (response.error) {
      return { success: true, valid: false, error: response.error }
    }

    return { success: true, valid: response.valid }
  } catch (error) {
    console.error('Failed to validate Kafka cluster:', error)
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to validate Kafka cluster'
    return { success: false, error: errorMessage }
  }
}

// ============================================================================
// Environment Mapping Actions
// ============================================================================

/**
 * Lists environment mappings, optionally filtered by environment.
 */
export async function listMappings(environment?: string): Promise<{
  success: boolean
  data?: KafkaEnvironmentMappingConfig[]
  error?: string
}> {
  try {
    await requireAdmin()

    const response = await kafkaClient.listEnvironmentMappings({
      environment: environment || '',
    })

    // Get cluster names for better display
    const clustersResponse = await kafkaClient.listClusters({})
    const clusterMap = new Map(
      clustersResponse.clusters.map((c) => [c.id, c.name])
    )

    const mappings = response.mappings.map((m) =>
      mapMappingToConfig(m, clusterMap.get(m.clusterId))
    )

    return { success: true, data: mappings }
  } catch (error) {
    console.error('Failed to list environment mappings:', error)
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to list environment mappings'
    return { success: false, error: errorMessage }
  }
}

/**
 * Creates a new environment mapping.
 */
export async function createMapping(data: {
  environment: string
  clusterId: string
  priority?: number
  isDefault?: boolean
  routingRule?: Record<string, string>
}): Promise<{
  success: boolean
  data?: KafkaEnvironmentMappingConfig
  error?: string
}> {
  try {
    await requireAdmin()

    const response = await kafkaClient.createEnvironmentMapping({
      environment: data.environment,
      clusterId: data.clusterId,
      priority: data.priority ?? 0,
      isDefault: data.isDefault ?? false,
      routingRule: data.routingRule || {},
    })

    if (response.error) {
      return { success: false, error: response.error }
    }

    if (!response.mapping) {
      return { success: false, error: 'No mapping returned from creation' }
    }

    // Get cluster name for display
    const clustersResponse = await kafkaClient.listClusters({})
    const cluster = clustersResponse.clusters.find((c) => c.id === data.clusterId)

    return {
      success: true,
      data: mapMappingToConfig(response.mapping, cluster?.name),
    }
  } catch (error) {
    console.error('Failed to create environment mapping:', error)
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to create environment mapping'
    return { success: false, error: errorMessage }
  }
}

/**
 * Deletes an environment mapping.
 */
export async function deleteMapping(mappingId: string): Promise<{
  success: boolean
  error?: string
}> {
  try {
    await requireAdmin()

    const response = await kafkaClient.deleteEnvironmentMapping({ mappingId })

    if (!response.success) {
      return { success: false, error: response.error || 'Failed to delete mapping' }
    }

    return { success: true }
  } catch (error) {
    console.error('Failed to delete environment mapping:', error)
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to delete environment mapping'
    return { success: false, error: errorMessage }
  }
}

// ============================================================================
// Workspace Helper
// ============================================================================

/**
 * Lists all workspaces for admin selection.
 */
export async function listWorkspaces(): Promise<{
  success: boolean
  data?: Array<{ id: string; name: string; slug: string }>
  error?: string
}> {
  try {
    await requireAdmin()

    const payload = await getPayload({ config })

    const workspaces = await payload.find({
      collection: 'workspaces',
      limit: 1000,
      sort: 'name',
    })

    const data = workspaces.docs.map((w: any) => ({
      id: w.id,
      name: w.name,
      slug: w.slug,
    }))

    return { success: true, data }
  } catch (error) {
    console.error('Failed to list workspaces:', error)
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to list workspaces'
    return { success: false, error: errorMessage }
  }
}
