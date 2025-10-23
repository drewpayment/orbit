/**
 * Plugins gRPC Client
 *
 * Provides a configured Connect-ES client for the Orbit Plugins service.
 * This service acts as a proxy to Backstage community plugins with workspace isolation.
 *
 * Usage:
 * ```ts
 * import { pluginsClient } from '@/lib/grpc/plugins-client'
 *
 * const response = await pluginsClient.listPlugins({ workspaceId: 'ws-123' })
 * ```
 */

import { createClient } from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-web'
import { PluginsService } from '@/lib/proto/idp/plugins/v1/plugins_connect'

/**
 * Transport configuration for the Plugins gRPC service.
 * Defaults to localhost:50053 for development.
 * Override with NEXT_PUBLIC_PLUGINS_API_URL environment variable.
 */
const transport = createConnectTransport({
  baseUrl: process.env.NEXT_PUBLIC_PLUGINS_API_URL || 'http://localhost:50053',
  // Include credentials for authenticated requests
  // This will forward cookies/auth headers from the browser
  useBinaryFormat: false, // Use JSON for better debugging in development
})

/**
 * Singleton client instance for the Plugins service.
 *
 * Available methods:
 * - `listPlugins(req)` - List all available plugins for a workspace
 * - `getPlugin(req)` - Get details for a specific plugin
 * - `proxyPluginRequest(req)` - Generic proxy for plugin API calls
 * - `getPluginSchema(req)` - Get schema for dynamic rendering
 * - `enablePlugin(req)` - Enable a plugin for a workspace
 * - `disablePlugin(req)` - Disable a plugin for a workspace
 * - `updatePluginConfig(req)` - Update plugin configuration
 */
export const pluginsClient = createClient(PluginsService, transport)

/**
 * Helper type for extracting request types from the client
 * Useful for component props and function signatures
 */
export type PluginsClient = typeof pluginsClient

/**
 * Re-export proto types for convenience
 * This allows consumers to import both client and types from the same module
 */
export type {
  Plugin,
  PluginMetadata,
  PluginStatus,
  ListPluginsRequest,
  ListPluginsResponse,
  GetPluginRequest,
  GetPluginResponse,
  ProxyPluginRequestMessage,
  ProxyPluginResponse,
  GetPluginSchemaRequest,
  GetPluginSchemaResponse,
  EnablePluginRequest,
  EnablePluginResponse,
  DisablePluginRequest,
  DisablePluginResponse,
  UpdatePluginConfigRequest,
  UpdatePluginConfigResponse,
} from '@/lib/proto/idp/plugins/v1/plugins_pb'
