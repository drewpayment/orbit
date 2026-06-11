/**
 * Connect-ES client interceptor that attaches a service-auth bearer token to
 * every outbound gRPC/Connect call from orbit-www to the Go services.
 *
 * Per request it:
 *   1. resolves the current betterAuth user (server session),
 *   2. determines the workspace this request targets (from the request message),
 *   3. verifies the user is a member of that workspace (so `wid` is always an
 *      authorized workspace, making the Go-side body-vs-wid check a real tenant
 *      boundary rather than a tautology),
 *   4. mints a short-TTL HS256 token and sets the Authorization header.
 *
 * One interceptor serves both transports (createGrpcTransport for kafka,
 * createConnectTransport for the repository family) since both accept the
 * Connect-ES `interceptors` option. Server-only; the secret never reaches the
 * browser.
 *
 * See docs/plans/2026-06-10-grpc-auth-interceptor-design.md §4.
 */
import 'server-only'
import type { Interceptor } from '@connectrpc/connect'
import { getPayload } from 'payload'
import config from '@payload-config'
import { getCurrentUser } from '@/lib/auth/session'
import { isWorkspaceMember } from '@/lib/access/workspace-access'
import { mintServiceToken } from './svc-auth-token'

/**
 * Pull a workspace id out of a request message regardless of which field the
 * RPC uses. Returns "" when the RPC carries no workspace scope.
 */
function workspaceIdFromMessage(message: unknown): string {
  if (!message || typeof message !== 'object') return ''
  const m = message as Record<string, unknown>
  const candidate = m.workspaceId ?? m.requestingWorkspaceId
  return typeof candidate === 'string' ? candidate : ''
}

export const authInterceptor: Interceptor = (next) => async (req) => {
  const user = await getCurrentUser()
  if (!user?.id) {
    throw new Error('authInterceptor: no authenticated user for outbound service call')
  }

  const requestedWorkspaceId = workspaceIdFromMessage(req.message)

  // Only sign a `wid` the user is actually authorized for. If the request
  // targets a workspace, confirm membership; refuse to mint a cross-tenant
  // token. RPCs with no workspace scope sign an empty `wid`.
  let workspaceId = ''
  if (requestedWorkspaceId) {
    const payload = await getPayload({ config })
    const isMember = await isWorkspaceMember(payload, user.id, requestedWorkspaceId)
    if (!isMember) {
      throw new Error(
        `authInterceptor: user ${user.id} is not a member of workspace ${requestedWorkspaceId}`,
      )
    }
    workspaceId = requestedWorkspaceId
  }

  const token = await mintServiceToken(user.id, workspaceId)
  req.header.set('Authorization', `Bearer ${token}`)

  return next(req)
}
