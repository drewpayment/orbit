import { createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';
import { APICatalogService } from '@/lib/proto/api_catalog_pb';

// Re-export types from proto for convenience
export { SchemaType } from '@/lib/proto/api_catalog_pb';

/**
 * Create a transport for the API catalog service
 * This uses Connect-ES to communicate with the gRPC-Web backend
 */
const transport = createConnectTransport({
  baseUrl: process.env.NEXT_PUBLIC_API_CATALOG_URL || 'http://localhost:50052',
});

/**
 * API Catalog service client for managing API schemas
 */
export const apiCatalogClient = createClient(APICatalogService, transport);
