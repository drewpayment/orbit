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
