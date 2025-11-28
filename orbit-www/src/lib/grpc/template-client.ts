import { createClient } from '@connectrpc/connect';
import { createGrpcTransport } from '@connectrpc/connect-node';
import {
  TemplateService,
  type StartInstantiationRequest,
  type StartInstantiationResponse,
  type GetProgressRequest,
  type GetProgressResponse,
} from '@/lib/proto/idp/template/v1/template_pb';

/**
 * Create a gRPC transport for the template service (server-side)
 * Uses REPOSITORY_SERVICE_URL for Docker networking, falls back to localhost
 */
const transport = createGrpcTransport({
  baseUrl: process.env.REPOSITORY_SERVICE_URL || 'http://localhost:50051',
  httpVersion: '2',
});

/**
 * Template service client type
 */
export interface TemplateClient {
  startInstantiation(request: Partial<StartInstantiationRequest>): Promise<StartInstantiationResponse>;
  getInstantiationProgress(request: Partial<GetProgressRequest>): Promise<GetProgressResponse>;
}

/**
 * Template service client for template instantiation operations
 * This client uses gRPC transport and should only be used server-side (server actions, API routes)
 */
export const templateClient = createClient(TemplateService, transport) as unknown as TemplateClient;
