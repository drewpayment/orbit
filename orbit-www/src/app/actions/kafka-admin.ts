'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { kafkaClient } from '@/lib/grpc/kafka-client'

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
  consoleUrl?: string
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

  if (data.consoleUrl && !isValidUrl(data.consoleUrl)) {
    errors.push({
      field: 'consoleUrl',
      message: 'Console URL must be a valid HTTP or HTTPS URL',
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
  consoleUrl?: string
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
  // We fetch all assignments with depth to populate relationships, then filter by user
  const roleAssignments = await payload.find({
    collection: 'user-workspace-roles' as 'users', // Type workaround for custom collection
    depth: 2,
    limit: 1000,
  })

  const isAdmin = roleAssignments.docs.some((assignment: unknown) => {
    const typedAssignment = assignment as WorkspaceRoleAssignment

    // Check if this assignment belongs to our user
    const assignmentUserId = typeof typedAssignment.user === 'object'
      ? (typedAssignment.user as { id?: string })?.id
      : typedAssignment.user
    if (assignmentUserId !== payloadUser.id) return false

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

// ============================================================================
// Provider Actions
// ============================================================================

/**
 * Payload KafkaProvider document type
 */
interface PayloadKafkaProvider {
  id: string
  name: string
  displayName: string
  adapterType: 'apache' | 'confluent' | 'msk'
  requiredConfigFields: string[]
  capabilities?: {
    schemaRegistry?: boolean
    transactions?: boolean
    quotasApi?: boolean
    metricsApi?: boolean
  }
  documentationUrl?: string
  createdAt?: string
  updatedAt?: string
}

/**
 * Maps a Payload KafkaProvider document to KafkaProviderConfig.
 */
function mapPayloadProviderToConfig(provider: PayloadKafkaProvider): KafkaProviderConfig {
  return {
    id: provider.id,
    name: provider.name,
    displayName: provider.displayName,
    authMethods: provider.requiredConfigFields || [],
    features: {
      schemaRegistry: provider.capabilities?.schemaRegistry ?? false,
      topicCreation: true,
      aclManagement: false,
      quotaManagement: provider.capabilities?.quotasApi ?? false,
    },
    defaultSettings: {},
    enabled: true,
  }
}

/**
 * Lists all available Kafka providers from Payload CMS.
 * Providers are managed entirely through the UI - no auto-seeding.
 */
export async function getProviders(): Promise<{
  success: boolean
  data?: KafkaProviderConfig[]
  error?: string
}> {
  try {
    await requireAdmin()

    const payload = await getPayload({ config })

    // Query providers from Payload - no auto-seeding, providers are managed via UI
    const providersResult = await payload.find({
      collection: 'kafka-providers' as 'users', // Type workaround
      limit: 100,
      sort: 'displayName',
    })

    const providers = providersResult.docs.map((doc) =>
      mapPayloadProviderToConfig(doc as unknown as PayloadKafkaProvider)
    )

    return { success: true, data: providers }
  } catch (error) {
    console.error('Failed to get Kafka providers:', error)
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to get Kafka providers'
    return { success: false, error: errorMessage }
  }
}

/**
 * Creates a new Kafka provider in Payload CMS.
 */
export async function createProvider(data: {
  name: string
  displayName: string
  adapterType: 'apache' | 'confluent' | 'msk'
  requiredConfigFields: string[]
  capabilities?: {
    schemaRegistry?: boolean
    transactions?: boolean
    quotasApi?: boolean
    metricsApi?: boolean
  }
  documentationUrl?: string
}): Promise<{ success: boolean; data?: KafkaProviderConfig; error?: string }> {
  try {
    await requireAdmin()

    const payload = await getPayload({ config })

// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const created = await (payload.create as any)({
      collection: 'kafka-providers',
      data: {
        name: data.name,
        displayName: data.displayName,
        adapterType: data.adapterType,
        requiredConfigFields: data.requiredConfigFields,
        capabilities: data.capabilities || {
          schemaRegistry: true,
          transactions: true,
          quotasApi: false,
          metricsApi: false,
        },
        documentationUrl: data.documentationUrl || '',
      },
    })

    return {
      success: true,
      data: mapPayloadProviderToConfig(created as unknown as PayloadKafkaProvider)
    }
  } catch (error) {
    console.error('Failed to create Kafka provider:', error)
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to create Kafka provider'
    return { success: false, error: errorMessage }
  }
}

/**
 * Updates a Kafka provider in Payload CMS.
 */
export async function saveProviderConfig(
  providerId: string,
  providerConfig: Partial<KafkaProviderConfig>
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin()

    const payload = await getPayload({ config })

// eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (payload.update as any)({
      collection: 'kafka-providers',
      id: providerId,
      data: {
        ...(providerConfig.displayName && { displayName: providerConfig.displayName }),
        ...(providerConfig.authMethods && { requiredConfigFields: providerConfig.authMethods }),
        ...(providerConfig.features && {
          capabilities: {
            schemaRegistry: providerConfig.features.schemaRegistry,
            quotasApi: providerConfig.features.quotaManagement,
          },
        }),
      },
    })

    return { success: true }
  } catch (error) {
    console.error('Failed to save provider config:', error)
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to save provider config'
    return { success: false, error: errorMessage }
  }
}

/**
 * Deletes a Kafka provider from Payload CMS.
 */
export async function deleteProvider(providerId: string): Promise<{
  success: boolean
  error?: string
}> {
  try {
    await requireAdmin()

    const payload = await getPayload({ config })

// eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (payload.delete as any)({
      collection: 'kafka-providers',
      id: providerId,
    })

    return { success: true }
  } catch (error) {
    console.error('Failed to delete Kafka provider:', error)
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to delete Kafka provider'
    return { success: false, error: errorMessage }
  }
}

// ============================================================================
// Cluster Actions (stored in Payload CMS)
// ============================================================================

/**
 * Payload KafkaCluster document type
 */
interface PayloadKafkaCluster {
  id: string
  name: string
  provider: string | { id: string; name: string }
  connectionConfig: Record<string, string>
  credentials?: Record<string, string>
  validationStatus: 'pending' | 'valid' | 'invalid'
  lastValidatedAt?: string
  consoleUrl?: string
  description?: string
  createdAt?: string
  updatedAt?: string
}

/**
 * Maps a Payload KafkaCluster document to KafkaClusterConfig.
 */
function mapPayloadClusterToConfig(cluster: PayloadKafkaCluster): KafkaClusterConfig {
  const providerId = typeof cluster.provider === 'object'
    ? cluster.provider.name
    : cluster.provider

  return {
    id: cluster.id,
    name: cluster.name,
    providerId,
    bootstrapServers: cluster.connectionConfig?.['bootstrap.servers'] || '',
    environment: cluster.connectionConfig?.['environment'] || 'development',
    status: cluster.validationStatus || 'unknown',
    schemaRegistryUrl: cluster.connectionConfig?.['schema.registry.url'],
    consoleUrl: cluster.consoleUrl,
    credentials: {}, // Don't expose credentials
    config: cluster.connectionConfig || {},
  }
}

/**
 * Lists all registered Kafka clusters from Payload CMS.
 */
export async function listClusters(): Promise<{
  success: boolean
  data?: KafkaClusterConfig[]
  error?: string
}> {
  try {
    await requireAdmin()

    const payload = await getPayload({ config })

    const clustersResult = await payload.find({
      collection: 'kafka-clusters' as 'users', // Type workaround
      limit: 100,
      sort: 'name',
      depth: 1, // Populate provider relationship
    })

    const clusters = clustersResult.docs.map((doc) =>
      mapPayloadClusterToConfig(doc as unknown as PayloadKafkaCluster)
    )

    return { success: true, data: clusters }
  } catch (error) {
    console.error('Failed to list Kafka clusters:', error)
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to list Kafka clusters'
    return { success: false, error: errorMessage }
  }
}

/**
 * Lists all workspaces from Payload CMS.
 * Used for workspace selection dropdowns in admin interfaces.
 */
export async function getWorkspaces(): Promise<{
  success: boolean
  data?: Array<{ id: string; name: string; slug: string }>
  error?: string
}> {
  try {
    await requireAdmin()

    const payload = await getPayload({ config })

    const result = await payload.find({
      collection: 'workspaces',
      limit: 1000,
      sort: 'name',
    })

    const workspaces = result.docs.map((doc) => ({
      id: doc.id,
      name: doc.name,
      slug: doc.slug,
    }))

    return { success: true, data: workspaces }
  } catch (error) {
    console.error('Failed to get workspaces:', error)
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to get workspaces'
    return { success: false, error: errorMessage }
  }
}

/**
 * Gets a single Kafka cluster by ID from Payload CMS.
 */
export async function getCluster(clusterId: string): Promise<{
  success: boolean
  data?: KafkaClusterConfig
  error?: string
}> {
  try {
    await requireAdmin()

    const payload = await getPayload({ config })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cluster = await (payload.findByID as any)({
      collection: 'kafka-clusters',
      id: clusterId,
      depth: 1,
    })

    if (!cluster) {
      return { success: false, error: 'Cluster not found' }
    }

    return { success: true, data: mapPayloadClusterToConfig(cluster as PayloadKafkaCluster) }
  } catch (error) {
    console.error('Failed to get Kafka cluster:', error)
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to get Kafka cluster'
    return { success: false, error: errorMessage }
  }
}

/**
 * Creates a new Kafka cluster in Payload CMS.
 */
export async function createCluster(data: {
  name: string
  providerId: string
  bootstrapServers: string
  environment?: string
  schemaRegistryUrl?: string
  consoleUrl?: string
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

    const payload = await getPayload({ config })

    // Look up the provider by name to get its Payload ID for the relationship
    const providersResult = await payload.find({
      collection: 'kafka-providers' as 'users',
      where: { name: { equals: data.providerId } },
      limit: 1,
    })

    if (providersResult.docs.length === 0) {
      return { success: false, error: `Provider '${data.providerId}' not found` }
    }

    const providerPayloadId = providersResult.docs[0].id

    // Build connection config
    const connectionConfig: Record<string, string> = {
      'bootstrap.servers': data.bootstrapServers,
      ...(data.environment && { environment: data.environment }),
      ...(data.schemaRegistryUrl && { 'schema.registry.url': data.schemaRegistryUrl }),
      ...(data.config || {}),
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const created = await (payload.create as any)({
      collection: 'kafka-clusters',
      data: {
        name: data.name,
        provider: providerPayloadId,
        connectionConfig,
        consoleUrl: data.consoleUrl || undefined,
        credentials: data.credentials || {},
        validationStatus: 'pending',
      },
    })

    return {
      success: true,
      data: mapPayloadClusterToConfig(created as PayloadKafkaCluster),
    }
  } catch (error) {
    console.error('Failed to create Kafka cluster:', error)
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to create Kafka cluster'
    return { success: false, error: errorMessage }
  }
}

/**
 * Deletes a Kafka cluster from Payload CMS.
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

    const payload = await getPayload({ config })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (payload.delete as any)({
      collection: 'kafka-clusters',
      id: clusterId,
    })

    return { success: true }
  } catch (error) {
    console.error('Failed to delete Kafka cluster:', error)
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to delete Kafka cluster'
    return { success: false, error: errorMessage }
  }
}

/**
 * Updates an existing Kafka cluster in Payload CMS.
 */
export async function updateCluster(
  clusterId: string,
  data: {
    name?: string
    providerId?: string
    bootstrapServers?: string
    environment?: string
    schemaRegistryUrl?: string
    consoleUrl?: string
  }
): Promise<{
  success: boolean
  data?: KafkaClusterConfig
  error?: string
}> {
  try {
    if (!isNonEmptyString(clusterId)) {
      return { success: false, error: 'Cluster ID is required' }
    }

    await requireAdmin()

    const payload = await getPayload({ config })

    // Build the update data
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: Record<string, any> = {}

    if (data.name !== undefined) {
      updateData.name = data.name
    }

    if (data.providerId !== undefined) {
      // Look up the provider by name to get its Payload ID for the relationship
      const providersResult = await payload.find({
        collection: 'kafka-providers' as 'users',
        where: { name: { equals: data.providerId } },
        limit: 1,
      })

      if (providersResult.docs.length === 0) {
        return { success: false, error: `Provider '${data.providerId}' not found` }
      }

      updateData.provider = providersResult.docs[0].id
    }

    // Build connectionConfig from the provided fields
    if (data.bootstrapServers !== undefined || data.environment !== undefined || data.schemaRegistryUrl !== undefined) {
      // First, get the existing cluster to merge connectionConfig
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const existingCluster = await (payload.findByID as any)({
        collection: 'kafka-clusters',
        id: clusterId,
        depth: 0,
      }) as PayloadKafkaCluster | null

      if (!existingCluster) {
        return { success: false, error: 'Cluster not found' }
      }

      const existingConfig = existingCluster.connectionConfig || {}
      const newConfig: Record<string, string> = { ...existingConfig }

      if (data.bootstrapServers !== undefined) {
        newConfig['bootstrap.servers'] = data.bootstrapServers
      }

      if (data.environment !== undefined) {
        newConfig['environment'] = data.environment
      }

      if (data.schemaRegistryUrl !== undefined) {
        if (data.schemaRegistryUrl) {
          newConfig['schema.registry.url'] = data.schemaRegistryUrl
        } else {
          delete newConfig['schema.registry.url']
        }
      }

      updateData.connectionConfig = newConfig

      // Reset validation status when connection config changes
      if (data.bootstrapServers !== undefined) {
        updateData.validationStatus = 'pending'
      }
    }

    if (data.consoleUrl !== undefined) {
      updateData.consoleUrl = data.consoleUrl || undefined
    }

    // Perform the update
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updated = await (payload.update as any)({
      collection: 'kafka-clusters',
      id: clusterId,
      data: updateData,
      depth: 1,
    })

    return {
      success: true,
      data: mapPayloadClusterToConfig(updated as PayloadKafkaCluster),
    }
  } catch (error) {
    console.error('Failed to update Kafka cluster:', error)
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to update Kafka cluster'
    return { success: false, error: errorMessage }
  }
}

/**
 * Validates a Kafka cluster's connectivity by testing the connection.
 *
 * This function:
 * 1. Reads cluster config from Payload CMS
 * 2. Calls the Go Kafka service to test the connection
 * 3. Updates the validation status in Payload CMS
 *
 * @param clusterId - The Payload ID of the cluster to validate
 * @returns Response with the following contract:
 *   - `success: true, valid: true` - Validation succeeded, cluster is reachable
 *   - `success: true, valid: false, error: string` - Validation succeeded but cluster is unreachable (error describes why)
 *   - `success: false, error: string` - Validation operation failed (e.g., network error, auth error)
 */
export async function validateCluster(clusterId: string): Promise<{
  success: boolean
  valid?: boolean
  error?: string
}> {
  try {
    await requireAdmin()

    const payload = await getPayload({ config })

    // Get cluster from Payload
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cluster = await (payload.findByID as any)({
      collection: 'kafka-clusters',
      id: clusterId,
      depth: 1,
    }) as PayloadKafkaCluster | null

    if (!cluster) {
      return { success: false, error: 'Cluster not found' }
    }

    // Call Go service to validate the connection
    // The Go service needs bootstrap servers and credentials to test
    const response = await kafkaClient.validateClusterConnection({
      connectionConfig: cluster.connectionConfig || {},
      credentials: cluster.credentials || {},
    })

    // Update validation status in Payload
    const newStatus = response.valid ? 'valid' : 'invalid'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (payload.update as any)({
      collection: 'kafka-clusters',
      id: clusterId,
      data: {
        validationStatus: newStatus,
        lastValidatedAt: new Date().toISOString(),
      },
    })

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
// Environment Mapping Actions (stored in Payload CMS)
// ============================================================================

/**
 * Payload KafkaEnvironmentMapping document type
 */
interface PayloadKafkaEnvironmentMapping {
  id: string
  environment: string
  cluster: string | { id: string; name: string }
  routingRule?: Record<string, string>
  priority: number
  isDefault: boolean
  createdAt?: string
  updatedAt?: string
}

/**
 * Maps a Payload KafkaEnvironmentMapping document to KafkaEnvironmentMappingConfig.
 */
function mapPayloadMappingToConfig(mapping: PayloadKafkaEnvironmentMapping): KafkaEnvironmentMappingConfig {
  const clusterId = typeof mapping.cluster === 'object'
    ? mapping.cluster.id
    : mapping.cluster
  const clusterName = typeof mapping.cluster === 'object'
    ? mapping.cluster.name
    : mapping.cluster

  return {
    id: mapping.id,
    environment: mapping.environment,
    clusterId,
    clusterName,
    priority: mapping.priority,
    isDefault: mapping.isDefault,
    createdAt: mapping.createdAt,
  }
}

/**
 * Lists environment mappings from Payload CMS, optionally filtered by environment.
 */
export async function listMappings(environment?: string): Promise<{
  success: boolean
  data?: KafkaEnvironmentMappingConfig[]
  error?: string
}> {
  try {
    await requireAdmin()

    const payload = await getPayload({ config })

    // Build query with optional environment filter
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const query: any = {
      collection: 'kafka-environment-mappings',
      limit: 100,
      sort: 'environment',
      depth: 1, // Populate cluster relationship
    }

    if (environment) {
      query.where = { environment: { equals: environment } }
    }

    const mappingsResult = await payload.find(query)

    const mappings = mappingsResult.docs.map((doc) =>
      mapPayloadMappingToConfig(doc as unknown as PayloadKafkaEnvironmentMapping)
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
 * Creates a new environment mapping in Payload CMS.
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

    const payload = await getPayload({ config })

    // Verify the cluster exists
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cluster = await (payload.findByID as any)({
      collection: 'kafka-clusters',
      id: data.clusterId,
    })

    if (!cluster) {
      return { success: false, error: 'Cluster not found' }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const created = await (payload.create as any)({
      collection: 'kafka-environment-mappings',
      data: {
        environment: data.environment,
        cluster: data.clusterId,
        priority: data.priority ?? 0,
        isDefault: data.isDefault ?? false,
        routingRule: data.routingRule || {},
      },
    })

    // Re-fetch with depth to get cluster name
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const createdWithCluster = await (payload.findByID as any)({
      collection: 'kafka-environment-mappings',
      id: created.id,
      depth: 1,
    })

    return {
      success: true,
      data: mapPayloadMappingToConfig(createdWithCluster as PayloadKafkaEnvironmentMapping),
    }
  } catch (error) {
    console.error('Failed to create environment mapping:', error)
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to create environment mapping'
    return { success: false, error: errorMessage }
  }
}

/**
 * Deletes an environment mapping from Payload CMS.
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

    const payload = await getPayload({ config })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (payload.delete as any)({
      collection: 'kafka-environment-mappings',
      id: mappingId,
    })

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
