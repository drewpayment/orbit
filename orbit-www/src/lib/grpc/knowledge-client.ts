import { createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';
import { KnowledgeService } from '@/lib/proto/knowledge_pb';

/**
 * Create a transport for the knowledge service
 * This uses Connect-ES to communicate with the gRPC-Web backend
 */
const transport = createConnectTransport({
  baseUrl: process.env.NEXT_PUBLIC_KNOWLEDGE_URL || 'http://localhost:50053',
});

/**
 * Knowledge service client for managing knowledge spaces and pages
 */
export const knowledgeClient = createClient(KnowledgeService, transport);
