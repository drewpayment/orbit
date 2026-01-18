/**
 * Kafka gRPC Client
 *
 * Provides a configured Connect-ES client for the Orbit Kafka service.
 * This service manages Kafka topics, schemas, and cross-workspace sharing.
 *
 * Usage:
 * ```ts
 * import { kafkaClient } from '@/lib/grpc/kafka-client'
 *
 * const response = await kafkaClient.listTopics({ workspaceId: 'ws-123' })
 * ```
 */

import { createClient } from '@connectrpc/connect'
import { createGrpcTransport } from '@connectrpc/connect-node'
import { KafkaService } from '@/lib/proto/idp/kafka/v1/kafka_pb'

/**
 * Transport configuration for the Kafka gRPC service.
 * Uses gRPC transport for server-side calls to native gRPC services.
 * Defaults to localhost:50055 for development.
 * Override with KAFKA_SERVICE_URL environment variable.
 */
const transport = createGrpcTransport({
  baseUrl: process.env.KAFKA_SERVICE_URL || 'http://localhost:50055',
})

/**
 * Singleton client instance for the Kafka service.
 *
 * Available methods:
 * - Cluster Management: listProviders, registerCluster, validateCluster, listClusters, deleteCluster
 * - Topic Management: createTopic, listTopics, getTopic, updateTopic, deleteTopic, approveTopic
 * - Schema Management: registerSchema, listSchemas, getSchema, checkSchemaCompatibility
 * - Sharing: requestTopicAccess, approveTopicAccess, revokeTopicAccess, listTopicShares, discoverTopics
 * - Service Accounts: createServiceAccount, listServiceAccounts, revokeServiceAccount
 * - Metrics: getTopicMetrics, getTopicLineage
 */
export const kafkaClient = createClient(KafkaService, transport)

/**
 * Helper type for extracting request types from the client
 * Useful for component props and function signatures
 */
export type KafkaClient = typeof kafkaClient
