/**
 * Bifrost Admin gRPC Client
 *
 * Provides a configured Connect-ES client for the Bifrost Admin service.
 * This service manages virtual clusters, credentials, and gateway configuration
 * for the Kafka gateway proxy.
 *
 * Usage:
 * ```ts
 * import { bifrostClient } from '@/lib/grpc/bifrost-client'
 *
 * const response = await bifrostClient.listVirtualClusters({})
 * ```
 */

import { createClient } from '@connectrpc/connect'
import { createGrpcTransport } from '@connectrpc/connect-node'
import { BifrostAdminService } from '@/lib/proto/idp/gateway/v1/gateway_pb'

/**
 * Transport configuration for the Bifrost Admin gRPC service.
 * Uses gRPC transport for server-side calls to native gRPC services.
 * Defaults to localhost:50060 for development.
 * Override with BIFROST_ADMIN_URL environment variable.
 */
const transport = createGrpcTransport({
  baseUrl: process.env.BIFROST_ADMIN_URL || 'http://localhost:50060',
})

/**
 * Singleton client instance for the Bifrost Admin service.
 *
 * Available methods:
 * - Virtual Cluster Management: listVirtualClusters, upsertVirtualCluster, deleteVirtualCluster, setVirtualClusterReadOnly
 * - Credential Management: listCredentials, upsertCredential, revokeCredential
 * - Policy Management: listPolicies, upsertPolicy, deletePolicy
 * - Topic ACL Management: listTopicACLs, upsertTopicACL, revokeTopicACL
 * - Configuration & Status: getFullConfig, getStatus
 */
export const bifrostClient = createClient(BifrostAdminService, transport)

/**
 * Helper type for extracting request types from the client
 * Useful for component props and function signatures
 */
export type BifrostClient = typeof bifrostClient
