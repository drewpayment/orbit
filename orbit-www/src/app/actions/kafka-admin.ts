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
// Payload Type Definitions
// ============================================================================

/**
 * Represents a workspace role assignment from the Payload CMS.
 */
interface WorkspaceRoleAssignment {
  id: string
  user: string | { id: string }
  workspace: string | { id: string }
  role:
    | string
    | {
        id: string
        name: string
        slug: string
        scope: 'platform' | 'workspace'
      }
  createdAt?: string
  updatedAt?: string
}

/**
 * Represents a workspace document from the Payload CMS.
 */
interface WorkspaceDoc {
  id: string
  name: string
  slug: string
  client?: string | { id: string; name: string }
  createdAt?: string
  updatedAt?: string
}

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Validates that a string is non-empty after trimming.
 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Validates bootstrap servers format (comma-separated hostname:port pairs).
 * Examples of valid formats:
 * - "localhost:9092"
 * - "broker1:9092,broker2:9092"
 * - "kafka.example.com:9092"
 */
function isValidBootstrapServers(value: string): boolean {
  if (!isNonEmptyString(value)) return false

  const servers = value.split(',').map((s) => s.trim())
  if (servers.length === 0) return false

  // Pattern: hostname or IP followed by colon and port number
  const hostPortPattern = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*:\d{1,5}$/

  return servers.every((server) => {
    if (!hostPortPattern.test(server)) return false
    // Validate port range
    const port = parseInt(server.split(':').pop() || '', 10)
    return port >= 1 && port <= 65535
  })
}

/**
 * Validates a URL format (http or https).
 */
function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Validates credentials format - ensures all keys and values are non-empty strings.
 */
function isValidCredentials(credentials: unknown): credentials is Record<string, string> {
  if (credentials === null || credentials === undefined) return true
  if (typeof credentials !== 'object') return false

  return Object.entries(credentials as Record<string, unknown>).every(
    ([key, value]) => isNonEmptyString(key) && typeof value === 'string'
  )
}

/**
 * Validates environment name format.
 * Allowed: lowercase letters, numbers, hyphens.
 */
function isValidEnvironmentName(value: string): boolean {
  if (!isNonEmptyString(value)) return false
  return /^[a-z0-9-]+$/.test(value)
}

interface ValidationError {
  field: string
  message: string
}

/**
 * Validates cluster creation input and returns validation errors.
 */
function validateClusterInput(data: {
  name: string
  providerId: string
  bootstrapServers: string
  environment?: string
  schemaRegistryUrl?: string
  credentials?: Record<string, string>
}): ValidationError[] {
  const errors: ValidationError[] = []

  if (!isNonEmptyString(data.name)) {
    errors.push({ field: 'name', message: 'Cluster name is required' })
  } else if (data.name.length > 255) {
    errors.push({ field: 'name', message: 'Cluster name must be 255 characters or less' })
  }

  if (!isNonEmptyString(data.providerId)) {
    errors.push({ field: 'providerId', message: 'Provider ID is required' })
  }

  if (!isNonEmptyString(data.bootstrapServers)) {
    errors.push({ field: 'bootstrapServers', message: 'Bootstrap servers are required' })
  } else if (!isValidBootstrapServers(data.bootstrapServers)) {
    errors.push({
      field: 'bootstrapServers',
      message: 'Bootstrap servers must be in format "hostname:port" (comma-separated for multiple)',
    })
  }

  if (data.environment && !isValidEnvironmentName(data.environment)) {
    errors.push({
      field: 'environment',
      message: 'Environment must contain only lowercase letters, numbers, and hyphens',
    })
  }

  if (data.schemaRegistryUrl && !isValidUrl(data.schemaRegistryUrl)) {
    errors.push({
      field: 'schemaRegistryUrl',
      message: 'Schema registry URL must be a valid HTTP or HTTPS URL',
    })
  }

  if (data.credentials && !isValidCredentials(data.credentials)) {
    errors.push({
      field: 'credentials',
      message: 'Credentials must be an object with string keys and values',
    })
  }

  return errors
}

/**
 * Validates environment mapping creation input and returns validation errors.
 */
function validateMappingInput(data: {
  environment: string
  clusterId: string
  priority?: number
  isDefault?: boolean
}): ValidationError[] {
  const errors: ValidationError[] = []

  if (!isNonEmptyString(data.environment)) {
    errors.push({ field: 'environment', message: 'Environment is required' })
  } else if (!isValidEnvironmentName(data.environment)) {
    errors.push({
      field: 'environment',
      message: 'Environment must contain only lowercase letters, numbers, and hyphens',
    })
  }

  if (!isNonEmptyString(data.clusterId)) {
    errors.push({ field: 'clusterId', message: 'Cluster ID is required' })
  }

  if (data.priority !== undefined && (data.priority < 0 || !Number.isInteger(data.priority))) {
    errors.push({ field: 'priority', message: 'Priority must be a non-negative integer' })
  }

  return errors
}

/**
 * Formats validation errors into a single error message.
 */
function formatValidationErrors(errors: ValidationError[]): string {
  return errors.map((e) => `${e.field}: ${e.message}`).join('; ')
}

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

  // First, find the Payload user by email (bridges Better-Auth and Payload user systems)
  const payloadUsers = await payload.find({
    collection: 'users',
    where: {
      email: { equals: session.user.email },
    },
    limit: 1,
  })

  const payloadUser = payloadUsers.docs[0]
  if (!payloadUser) {
    throw new Error('Unauthorized: User not found in system')
  }

  // Check for platform-level admin role using the Payload user ID
  // Note: Using type assertion for collection name since Payload types may not include custom collections
  const roleAssignments = await payload.find({
    collection: 'user-workspace-roles' as 'users', // Type workaround for custom collection
    where: {
      user: { equals: payloadUser.id },
    },
    depth: 2,
    limit: 100,
  })

  const isAdmin = roleAssignments.docs.some((assignment: unknown) => {
    const typedAssignment = assignment as WorkspaceRoleAssignment
    const role = typeof typedAssignment.role === 'object' ? typedAssignment.role : null
    if (!role) return false
    // Check if user has platform admin role (super-admin, admin, or platform-admin)
    return (
      role.scope === 'platform' &&
      (role.slug === 'admin' || role.slug === 'platform-admin' || role.slug === 'super-admin')
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

/**
 * Fetches all clusters and returns a Map of cluster ID to cluster name.
 * Use this helper to avoid duplicate listClusters calls in operations
 * that need cluster name lookups.
 */
async function getClustersMap(): Promise<Map<string, string>> {
  const response = await kafkaClient.listClusters({})
  return new Map(response.clusters.map((c) => [c.id, c.name]))
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
 *
 * TODO: This implementation fetches all clusters and filters client-side.
 * If the gRPC service adds a direct getCluster(clusterId) method in the future,
 * this should be updated to use that for better performance.
 */
export async function getCluster(clusterId: string): Promise<{
  success: boolean
  data?: KafkaClusterConfig
  error?: string
}> {
  try {
    await requireAdmin()

    // Note: The gRPC service doesn't have a direct getCluster method,
    // so we fetch all and filter. See TODO above for potential optimization.
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
    // Validate input before authentication to fail fast
    const validationErrors = validateClusterInput(data)
    if (validationErrors.length > 0) {
      return { success: false, error: formatValidationErrors(validationErrors) }
    }

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
    if (!isNonEmptyString(clusterId)) {
      return { success: false, error: 'Cluster ID is required' }
    }

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
 * Validates a Kafka cluster's connectivity by testing the connection.
 *
 * @param clusterId - The ID of the cluster to validate
 * @returns Response with the following contract:
 *   - `success: true, valid: true` - Validation succeeded, cluster is reachable
 *   - `success: true, valid: false, error: string` - Validation succeeded but cluster is unreachable (error describes why)
 *   - `success: false, error: string` - Validation operation failed (e.g., network error, auth error)
 *
 * Note: When `success: true`, the `valid` field indicates cluster connectivity status.
 * When `success: false`, the validation operation itself failed (not the cluster).
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

    // Get cluster names for better display using the helper
    const clusterMap = await getClustersMap()

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
    // Validate input before authentication to fail fast
    const validationErrors = validateMappingInput(data)
    if (validationErrors.length > 0) {
      return { success: false, error: formatValidationErrors(validationErrors) }
    }

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

    // Get cluster name for display using the helper
    const clusterMap = await getClustersMap()

    return {
      success: true,
      data: mapMappingToConfig(response.mapping, clusterMap.get(data.clusterId)),
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
    if (!isNonEmptyString(mappingId)) {
      return { success: false, error: 'Mapping ID is required' }
    }

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

    const data = workspaces.docs.map((w: unknown) => {
      const workspace = w as WorkspaceDoc
      return {
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
      }
    })

    return { success: true, data }
  } catch (error) {
    console.error('Failed to list workspaces:', error)
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to list workspaces'
    return { success: false, error: errorMessage }
  }
}
