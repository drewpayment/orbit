/**
 * Health Service gRPC Client
 *
 * Uses @connectrpc/connect-web (NOT connect-node) to avoid Next.js webpack bundling issues.
 * The Go service supports both gRPC and Connect protocols on the same port.
 */

import { createClient } from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-web'
import { HealthService } from '@/lib/proto/idp/health/v1/health_pb'

const transport = createConnectTransport({
  baseUrl: process.env.REPOSITORY_SERVICE_URL || 'http://localhost:50051',
})

export const healthClient = createClient(HealthService, transport)
