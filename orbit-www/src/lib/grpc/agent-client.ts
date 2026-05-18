/**
 * AgentService Connect-ES Client
 *
 * Server-side client used by Next.js server actions to talk to the Go
 * Repository service's AgentService. Uses the gRPC transport so we can
 * consume the StreamAgentEvents server-streaming RPC. Browser-facing
 * streaming (SSE) is layered on top by an internal API route that proxies
 * this stream.
 */

import { createClient } from '@connectrpc/connect'
import { createGrpcTransport } from '@connectrpc/connect-node'
import { AgentService } from '@/lib/proto/idp/agent/v1/agent_pb'

const transport = createGrpcTransport({
  baseUrl: process.env.AGENT_SERVICE_URL || process.env.REPOSITORY_SERVICE_URL || 'http://localhost:50051',
})

export const agentClient = createClient(AgentService, transport)
