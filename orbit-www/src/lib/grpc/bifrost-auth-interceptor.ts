/**
 * Connect-ES interceptor for the Bifrost admin API's two server-side callers.
 *
 * Bifrost's admin gRPC server authenticates every call with the service-auth
 * JWT and applies a per-RPC policy (services/bifrost/internal/admin/authz.go):
 * control-plane RPCs need the `adm` claim; the consumer-group RPCs also admit a
 * token whose `wid` is a workspace the user belongs to.
 *
 * Bifrost does not record which workspace owns a virtual cluster, so it cannot
 * check that `wid` owns the cluster named in a consumer-group request. This
 * interceptor is that check: it resolves the cluster's workspace from Payload
 * and refuses to sign a token for anyone who is not a member of it.
 *
 * Server-only; the secret never reaches the browser.
 */
import 'server-only'
import type { Interceptor } from '@connectrpc/connect'
import { getActor, workspaceRole } from '@/lib/authz'
import { mintServiceToken } from './svc-auth-token'
import { virtualClusterWorkspace } from './object-workspace'

/** RPCs scoped to one virtual cluster and open to its workspace's members. */
const CONSUMER_GROUP_METHODS = new Set([
  'ListConsumerGroups',
  'DescribeConsumerGroup',
  'ResetConsumerGroupOffsets',
])

/** The one RPC the consumer-group actions use to re-push config from our DB. */
const SYNC_METHOD = 'UpsertVirtualCluster'

/**
 * Tokens for `bifrostAdminClient` (consumer-group actions).
 *
 * UpsertVirtualCluster is reached here only through ensureVirtualClusterSynced,
 * which rebuilds the config from the kafka-virtual-clusters row because Bifrost
 * keeps config in memory and loses it on restart. It is a server-trusted sync of
 * data we already hold, not a user-supplied write, so it is signed with the
 * admin claim for any authenticated user. Do NOT route a user-controlled
 * UpsertVirtualCluster body through this client.
 */
export const bifrostConsumerGroupInterceptor: Interceptor = (next) => async (req) => {
  const actor = await getActor()
  if (!actor) {
    throw new Error('bifrostConsumerGroupInterceptor: no authenticated user for outbound service call')
  }

  const method = req.method?.name ?? ''
  let workspaceId = ''
  let platformAdmin = actor.isPlatformAdmin

  if (CONSUMER_GROUP_METHODS.has(method)) {
    // A platform admin is admitted by the `adm` claim; everyone else must be a
    // member of the workspace that owns the virtual cluster.
    if (!platformAdmin) {
      const message = req.message as { virtualClusterId?: unknown }
      const virtualClusterId =
        typeof message?.virtualClusterId === 'string' ? message.virtualClusterId : ''
      const owner = await virtualClusterWorkspace(virtualClusterId)
      if (!owner) {
        throw new Error(
          `bifrostConsumerGroupInterceptor: cannot determine the workspace of virtual cluster ${virtualClusterId || '(none)'}`,
        )
      }
      const role = await workspaceRole(owner, actor)
      if (!role) {
        throw new Error(
          `bifrostConsumerGroupInterceptor: user ${actor.betterAuthId} is not a member of workspace ${owner}`,
        )
      }
      workspaceId = owner
    }
  } else if (method === SYNC_METHOD) {
    platformAdmin = true
  }

  const token = await mintServiceToken(actor.betterAuthId, workspaceId, { platformAdmin })
  req.header.set('Authorization', `Bearer ${token}`)
  return next(req)
}
