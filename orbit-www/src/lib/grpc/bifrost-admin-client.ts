/**
 * Bifrost Admin gRPC Client
 *
 * Provides a configured Connect-ES client for the Bifrost Admin service.
 * This service manages virtual clusters, credentials, and consumer groups.
 *
 * Usage:
 * ```ts
 * import { bifrostAdminClient } from '@/lib/grpc/bifrost-admin-client'
 *
 * const response = await bifrostAdminClient.listConsumerGroups({ virtualClusterId: 'vc-123' })
 * ```
 */

import { createClient } from '@connectrpc/connect'
import { createGrpcTransport } from '@connectrpc/connect-node'
import { BifrostAdminService } from '@/lib/proto/idp/gateway/v1/gateway_pb'

/**
 * Transport configuration for the Bifrost Admin service.
 * Uses Connect protocol transport for compatibility with Next.js.
 * The Go service supports both gRPC and Connect protocols on the same port.
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
 * - Virtual Cluster: upsertVirtualCluster, deleteVirtualCluster, setVirtualClusterReadOnly, listVirtualClusters
 * - Credentials: upsertCredential, revokeCredential, listCredentials
 * - Consumer Groups: listConsumerGroups, describeConsumerGroup, resetConsumerGroupOffsets
 * - Config: getFullConfig, getStatus
 * - Policies: upsertPolicy, deletePolicy, listPolicies
 * - Topic ACLs: upsertTopicACL, revokeTopicACL, listTopicACLs
 */
export const bifrostAdminClient = createClient(BifrostAdminService, transport)

/**
 * Helper type for extracting request types from the client
 * Useful for component props and function signatures
 */
export type BifrostAdminClient = typeof bifrostAdminClient
