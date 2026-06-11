/**
 * Server-side Repository service client.
 *
 * The browser-facing client (src/lib/grpc/repository-client.ts) cannot carry
 * the service-auth interceptor — it would leak ORBIT_SVC_AUTH_SECRET to the
 * client bundle. This module is the server-only counterpart: it attaches the
 * auth interceptor so calls from server actions are authenticated, and the
 * secret never reaches the browser.
 *
 * Use this from a server action (e.g. src/app/actions/repository.ts), never
 * from a 'use client' component. See
 * docs/plans/2026-06-10-grpc-auth-interceptor-design.md §4.
 */
import 'server-only'
import { createClient } from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-web'
import { RepositoryService } from '@/lib/proto/repository_pb'
import { authInterceptor } from '../grpc/auth-interceptor'

const transport = createConnectTransport({
  // Server-to-server URL (not NEXT_PUBLIC): this client runs server-side only.
  baseUrl: process.env.REPOSITORY_SERVICE_URL || 'http://localhost:50051',
  interceptors: [authInterceptor],
})

export const repositoryServerClient = createClient(RepositoryService, transport)
export type RepositoryServerClient = typeof repositoryServerClient
