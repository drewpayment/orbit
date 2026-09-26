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
import { getActor, workspaceRole } from '@/lib/authz'
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
  const actor = await getActor()
  if (!actor) {
    throw new Error('authInterceptor: no authenticated user for outbound service call')
  }

  const requestedWorkspaceId = workspaceIdFromMessage(req.message)

  // Only sign a `wid` the user is actually authorized for. If the request
  // targets a workspace, confirm membership; refuse to mint a cross-tenant
  // token. RPCs with no workspace scope sign an empty `wid`.
  //
  // Deliberately NOT using authorize()/check() here: those apply the
  // platform-admin bypass, but this gate historically required actual
  // workspace membership even for platform admins (the `adm` claim below is
  // the separate, intentional admin bypass for platform-scoped RPCs). Use
  // workspaceRole(), which resolves membership only, to preserve that.
  let workspaceId = ''
  if (requestedWorkspaceId) {
    const role = await workspaceRole(requestedWorkspaceId, actor)
    if (!role) {
      throw new Error(
        `authInterceptor: user ${actor.betterAuthId} is not a member of workspace ${requestedWorkspaceId}`,
      )
    }
    workspaceId = requestedWorkspaceId
  }

  // Platform-admin status is derived from the server-side Actor (backed by the
  // Payload users doc's role field) — never from the request message — so a
  // client cannot self-elevate. It gates the Go services' platform-scoped RPCs
  // (Kafka cluster management) via the `adm` claim.
  const platformAdmin = actor.isPlatformAdmin

  const token = await mintServiceToken(actor.betterAuthId, workspaceId, { platformAdmin })
  req.header.set('Authorization', `Bearer ${token}`)

  return next(req)
}
