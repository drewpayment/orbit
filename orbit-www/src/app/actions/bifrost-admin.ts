'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import {
  PermissionTemplate,
  type VirtualClusterConfig as ProtoVirtualClusterConfig,
  type CredentialConfig as ProtoCredentialConfig,
  type CustomPermission as ProtoCustomPermission,
  type PolicyConfig as ProtoPolicy,
} from '@/lib/proto/idp/gateway/v1/gateway_pb'
import { bifrostClient } from '@/lib/grpc/bifrost-client'

// ============================================================================
// Payload Type Definitions (for internal use)
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

// ============================================================================
// Type Definitions (exported for UI consumption)
// ============================================================================

/**
 * Configuration for a Bifrost virtual cluster.
 * Virtual clusters provide tenant isolation for Kafka applications.
 */
export interface VirtualClusterConfig {
  /** Unique identifier for the virtual cluster */
  id: string
  /** The application ID this virtual cluster belongs to */
  applicationId: string
  /** URL-safe slug for the application */
  applicationSlug: string
  /** URL-safe slug for the workspace */
  workspaceSlug: string
  /** Environment (dev, staging, production) */
  environment: string
  /** Prefix applied to all topic names */
  topicPrefix: string
  /** Prefix applied to all consumer group IDs */
  groupPrefix: string
  /** Prefix applied to all transactional IDs */
  transactionIdPrefix: string
  /** The host clients connect to */
  advertisedHost: string
  /** The port clients connect to */
  advertisedPort: number
  /** Underlying physical Kafka bootstrap servers */
  physicalBootstrapServers: string
  /** Whether the cluster is in read-only mode */
  readOnly: boolean
}

/**
 * Permission template types for service account credentials.
 */
export type PermissionTemplateType = 'producer' | 'consumer' | 'admin' | 'custom'

/**
 * Custom permission definition for fine-grained access control.
 */
export interface CustomPermission {
  /** Type of resource (topic, group, transactional_id) */
  resourceType: string
  /** Pattern to match resources (literal or regex) */
  resourcePattern: string
  /** List of allowed operations (read, write, create, delete, alter) */
  operations: string[]
}

/**
 * Configuration for a service account credential.
 */
export interface CredentialConfig {
  /** Unique identifier for the credential */
  id: string
  /** The virtual cluster this credential belongs to */
  virtualClusterId: string
  /** Username for SASL authentication */
  username: string
  /** Hashed password (never store plaintext) */
  passwordHash: string
  /** Permission template applied to this credential */
  template: PermissionTemplateType
  /** Custom permissions (used when template is 'custom') */
  customPermissions: CustomPermission[]
}

/**
 * Gateway status information.
 */
export interface GatewayStatus {
  /** Current status (healthy, degraded, unhealthy) */
  status: string
  /** Number of active client connections */
  activeConnections: number
  /** Number of configured virtual clusters */
  virtualClusterCount: number
  /** Version and build information */
  versionInfo: Record<string, string>
}

/**
 * Policy configuration for topic creation constraints.
 */
export interface PolicyConfig {
  /** Unique identifier for the policy */
  id: string
  /** Environment this policy applies to */
  environment: string
  /** Maximum allowed partitions */
  maxPartitions: number
  /** Minimum required partitions */
  minPartitions: number
  /** Maximum retention time in milliseconds */
  maxRetentionMs: bigint
  /** Minimum required replication factor */
  minReplicationFactor: number
  /** List of allowed cleanup policies */
  allowedCleanupPolicies: string[]
  /** Regex pattern for valid topic names */
  namingPattern: string
  /** Maximum length for topic names */
  maxNameLength: number
}

/**
 * Complete gateway configuration snapshot.
 */
export interface FullConfig {
  /** All configured virtual clusters */
  virtualClusters: VirtualClusterConfig[]
  /** All configured credentials */
  credentials: CredentialConfig[]
  /** All configured policies */
  policies: PolicyConfig[]
}

// ============================================================================
// Mapping Functions (proto types to our interfaces)
// ============================================================================

/**
 * Maps a proto VirtualClusterConfig to our interface.
 */
export function mapProtoToVirtualCluster(proto: ProtoVirtualClusterConfig): VirtualClusterConfig {
  return {
    id: proto.id,
    applicationId: proto.applicationId,
    applicationSlug: proto.applicationSlug,
    workspaceSlug: proto.workspaceSlug,
    environment: proto.environment,
    topicPrefix: proto.topicPrefix,
    groupPrefix: proto.groupPrefix,
    transactionIdPrefix: proto.transactionIdPrefix,
    advertisedHost: proto.advertisedHost,
    advertisedPort: proto.advertisedPort,
    physicalBootstrapServers: proto.physicalBootstrapServers,
    readOnly: proto.readOnly,
  }
}

/**
 * Maps a proto PermissionTemplate enum to our string type.
 */
export function mapPermissionTemplate(proto: PermissionTemplate): PermissionTemplateType {
  switch (proto) {
    case PermissionTemplate.PRODUCER:
      return 'producer'
    case PermissionTemplate.CONSUMER:
      return 'consumer'
    case PermissionTemplate.ADMIN:
      return 'admin'
    case PermissionTemplate.CUSTOM:
      return 'custom'
    case PermissionTemplate.UNSPECIFIED:
    default:
      return 'custom'
  }
}

/**
 * Maps our string type to a proto PermissionTemplate enum.
 */
export function mapPermissionTemplateToProto(template: PermissionTemplateType): PermissionTemplate {
  switch (template) {
    case 'producer':
      return PermissionTemplate.PRODUCER
    case 'consumer':
      return PermissionTemplate.CONSUMER
    case 'admin':
      return PermissionTemplate.ADMIN
    case 'custom':
      return PermissionTemplate.CUSTOM
  }
}

/**
 * Maps a proto CustomPermission to our interface.
 */
function mapProtoCustomPermission(proto: ProtoCustomPermission): CustomPermission {
  return {
    resourceType: proto.resourceType,
    resourcePattern: proto.resourcePattern,
    operations: [...proto.operations],
  }
}

/**
 * Maps a proto CredentialConfig to our interface.
 */
export function mapProtoToCredential(proto: ProtoCredentialConfig): CredentialConfig {
  return {
    id: proto.id,
    virtualClusterId: proto.virtualClusterId,
    username: proto.username,
    passwordHash: proto.passwordHash,
    template: mapPermissionTemplate(proto.template),
    customPermissions: proto.customPermissions.map(mapProtoCustomPermission),
  }
}

/**
 * Maps a proto PolicyConfig to our interface.
 */
export function mapProtoToPolicy(proto: ProtoPolicy): PolicyConfig {
  return {
    id: proto.id,
    environment: proto.environment,
    maxPartitions: proto.maxPartitions,
    minPartitions: proto.minPartitions,
    maxRetentionMs: proto.maxRetentionMs,
    minReplicationFactor: proto.minReplicationFactor,
    allowedCleanupPolicies: [...proto.allowedCleanupPolicies],
    namingPattern: proto.namingPattern,
    maxNameLength: proto.maxNameLength,
  }
}

// ============================================================================
// Authentication Helper
// ============================================================================

/**
 * Checks if the current user has admin privileges.
 * Throws an error if the user is not authenticated or not an admin.
 *
 * This function follows the same pattern as kafka-admin.ts requireAdmin.
 */
export async function requireAdmin(): Promise<{ userId: string }> {
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
// Virtual Cluster Server Actions
// ============================================================================

/**
 * Lists all virtual clusters from Bifrost.
 */
export async function listVirtualClusters(): Promise<{
  success: boolean
  data?: VirtualClusterConfig[]
  error?: string
}> {
  try {
    await requireAdmin()

    const response = await bifrostClient.listVirtualClusters({})

    const virtualClusters = response.virtualClusters.map(mapProtoToVirtualCluster)

    return { success: true, data: virtualClusters }
  } catch (error) {
    console.error('Failed to list virtual clusters:', error)
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to list virtual clusters'
    return { success: false, error: errorMessage }
  }
}

/**
 * Creates or updates a virtual cluster in Bifrost.
 */
export async function createVirtualCluster(data: {
  id?: string
  workspaceSlug: string
  environment: string
  topicPrefix: string
  groupPrefix: string
  transactionIdPrefix: string
  advertisedHost: string
  advertisedPort: number
  physicalBootstrapServers: string
  applicationId?: string
  applicationSlug?: string
}): Promise<{
  success: boolean
  data?: VirtualClusterConfig
  error?: string
}> {
  try {
    await requireAdmin()

    const id = data.id || `vc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

    const response = await bifrostClient.upsertVirtualCluster({
      config: {
        id,
        applicationId: data.applicationId || '',
        applicationSlug: data.applicationSlug || '',
        workspaceSlug: data.workspaceSlug,
        environment: data.environment,
        topicPrefix: data.topicPrefix,
        groupPrefix: data.groupPrefix,
        transactionIdPrefix: data.transactionIdPrefix,
        advertisedHost: data.advertisedHost,
        advertisedPort: data.advertisedPort,
        physicalBootstrapServers: data.physicalBootstrapServers,
        readOnly: false,
      },
    })

    if (!response.success) {
      return { success: false, error: 'Failed to create virtual cluster' }
    }

    // Return the created config
    return {
      success: true,
      data: {
        id,
        applicationId: data.applicationId || '',
        applicationSlug: data.applicationSlug || '',
        workspaceSlug: data.workspaceSlug,
        environment: data.environment,
        topicPrefix: data.topicPrefix,
        groupPrefix: data.groupPrefix,
        transactionIdPrefix: data.transactionIdPrefix,
        advertisedHost: data.advertisedHost,
        advertisedPort: data.advertisedPort,
        physicalBootstrapServers: data.physicalBootstrapServers,
        readOnly: false,
      },
    }
  } catch (error) {
    console.error('Failed to create virtual cluster:', error)
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to create virtual cluster'
    return { success: false, error: errorMessage }
  }
}

/**
 * Deletes a virtual cluster from Bifrost.
 */
export async function deleteVirtualCluster(id: string): Promise<{
  success: boolean
  error?: string
}> {
  try {
    await requireAdmin()

    const response = await bifrostClient.deleteVirtualCluster({
      virtualClusterId: id,
    })

    if (!response.success) {
      return { success: false, error: 'Failed to delete virtual cluster' }
    }

    return { success: true }
  } catch (error) {
    console.error('Failed to delete virtual cluster:', error)
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to delete virtual cluster'
    return { success: false, error: errorMessage }
  }
}

/**
 * Toggles read-only mode for a virtual cluster.
 */
export async function setVirtualClusterReadOnly(
  id: string,
  readOnly: boolean
): Promise<{
  success: boolean
  error?: string
}> {
  try {
    await requireAdmin()

    const response = await bifrostClient.setVirtualClusterReadOnly({
      virtualClusterId: id,
      readOnly,
    })

    if (!response.success) {
      return { success: false, error: 'Failed to update virtual cluster' }
    }

    return { success: true }
  } catch (error) {
    console.error('Failed to set virtual cluster read-only:', error)
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to update virtual cluster'
    return { success: false, error: errorMessage }
  }
}

// ============================================================================
// Credential Server Actions
// ============================================================================

/**
 * Lists credentials, optionally filtered by virtual cluster.
 */
export async function listCredentials(virtualClusterId?: string): Promise<{
  success: boolean
  data?: CredentialConfig[]
  error?: string
}> {
  try {
    await requireAdmin()

    const response = await bifrostClient.listCredentials({
      virtualClusterId: virtualClusterId || '',
    })

    const credentials = response.credentials.map(mapProtoToCredential)

    return { success: true, data: credentials }
  } catch (error) {
    console.error('Failed to list credentials:', error)
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to list credentials'
    return { success: false, error: errorMessage }
  }
}

/**
 * Creates a new credential in Bifrost.
 * Returns the plaintext password (only shown once).
 */
export async function createCredential(data: {
  virtualClusterId: string
  username: string
  password: string
  template: PermissionTemplateType
  customPermissions?: CustomPermission[]
}): Promise<{
  success: boolean
  data?: { id: string; username: string; password: string }
  error?: string
}> {
  try {
    await requireAdmin()

    const id = `cred-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

    // Hash the password before sending (using simple hash for demo - production should use bcrypt)
    const encoder = new TextEncoder()
    const passwordData = encoder.encode(data.password)
    const hashBuffer = await crypto.subtle.digest('SHA-256', passwordData)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const passwordHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')

    const response = await bifrostClient.upsertCredential({
      config: {
        id,
        virtualClusterId: data.virtualClusterId,
        username: data.username,
        passwordHash,
        template: mapPermissionTemplateToProto(data.template),
        customPermissions: (data.customPermissions || []).map(p => ({
          resourceType: p.resourceType,
          resourcePattern: p.resourcePattern,
          operations: p.operations,
        })),
      },
    })

    if (!response.success) {
      return { success: false, error: 'Failed to create credential' }
    }

    return {
      success: true,
      data: {
        id,
        username: data.username,
        password: data.password, // Return plaintext for user to save
      },
    }
  } catch (error) {
    console.error('Failed to create credential:', error)
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to create credential'
    return { success: false, error: errorMessage }
  }
}

/**
 * Revokes (deletes) a credential from Bifrost.
 */
export async function revokeCredential(id: string): Promise<{
  success: boolean
  error?: string
}> {
  try {
    await requireAdmin()

    const response = await bifrostClient.revokeCredential({
      credentialId: id,
    })

    if (!response.success) {
      return { success: false, error: 'Failed to revoke credential' }
    }

    return { success: true }
  } catch (error) {
    console.error('Failed to revoke credential:', error)
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to revoke credential'
    return { success: false, error: errorMessage }
  }
}
