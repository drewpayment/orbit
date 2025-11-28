import { createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';
import { RepositoryService } from '@/lib/proto/repository_pb';

/**
 * Create a transport for the repository service
 * This uses Connect-ES to communicate with the gRPC-Web backend
 */
const transport = createConnectTransport({
  baseUrl: process.env.NEXT_PUBLIC_REPOSITORY_URL || 'http://localhost:50051',
});

/**
 * Repository service client for managing repositories
 */
export const repositoryClient = createClient(RepositoryService, transport);
