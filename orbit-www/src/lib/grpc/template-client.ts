import { createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';
import {
  TemplateService,
  type StartInstantiationRequest,
  type StartInstantiationResponse,
  type GetProgressRequest,
  type GetProgressResponse,
} from '@/lib/proto/idp/template/v1/template_pb';

/**
 * Create a transport for the template service
 * Uses the same URL as repository service since TemplateService is hosted there
 */
const transport = createConnectTransport({
  baseUrl: process.env.NEXT_PUBLIC_REPOSITORY_URL || 'http://localhost:50051',
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
 */
export const templateClient = createClient(TemplateService, transport) as unknown as TemplateClient;
