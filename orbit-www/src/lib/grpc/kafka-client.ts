import { createClient } from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-web'
import { KafkaService } from '@/lib/proto/idp/kafka/v1/kafka_connect'

/**
 * Create a transport for the Kafka service
 * This uses Connect-ES to communicate with the gRPC-Web backend
 */
const transport = createConnectTransport({
  baseUrl: process.env.NEXT_PUBLIC_KAFKA_SERVICE_URL || 'http://localhost:50055',
})

/**
 * Kafka service client for managing Kafka topics, schemas, and access
 */
export const kafkaClient = createClient(KafkaService, transport)
