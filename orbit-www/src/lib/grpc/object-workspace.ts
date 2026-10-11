/**
 * Resolve the workspace that owns the object an id-addressed RPC acts on.
 *
 * Some Go-service RPCs carry no workspace field — they name a launch, a
 * deployment workflow or a virtual cluster by id. The Go services authorize
 * those against the caller's signed `wid`, so for the token to carry the right
 * workspace, orbit-www has to work out which workspace owns the object (from
 * its own database, never from anything the caller sent) and sign that — after
 * verifying the user is a member of it (see auth-interceptor.ts).
 *
 * Server-only: reads Payload with overrideAccess because the lookup is a
 * trusted tenancy resolution, not a user-visible query.
 */
import 'server-only'
import { getPayload } from 'payload'
import config from '@payload-config'

type Message = Record<string, unknown>

/** A relationship value is either a bare id or a populated doc. */
function idOf(rel: unknown): string | null {
  if (typeof rel === 'string' && rel) return rel
  if (rel && typeof rel === 'object') {
    const id = (rel as { id?: unknown }).id
    if (typeof id === 'string' && id) return id
  }
  return null
}

function str(message: Message, key: string): string {
  const v = message[key]
  return typeof v === 'string' ? v : ''
}

async function launchByWorkflowId(message: Message): Promise<string | null> {
  const workflowId = str(message, 'workflowId')
  if (!workflowId) return null
  const payload = await getPayload({ config })
  const res = await payload.find({
    collection: 'launches',
    where: { workflowId: { equals: workflowId } },
    depth: 0,
    limit: 1,
    overrideAccess: true,
  })
  return idOf(res.docs[0]?.workspace)
}

async function launchById(message: Message): Promise<string | null> {
  const launchId = str(message, 'launchId')
  if (!launchId) return null
  const payload = await getPayload({ config })
  try {
    const doc = await payload.findByID({
      collection: 'launches',
      id: launchId,
      depth: 0,
      overrideAccess: true,
    })
    return idOf(doc?.workspace)
  } catch {
    return null
  }
}

async function deploymentByWorkflowId(message: Message): Promise<string | null> {
  const workflowId = str(message, 'workflowId')
  if (!workflowId) return null
  const payload = await getPayload({ config })
  const res = await payload.find({
    collection: 'deployments',
    where: { workflowId: { equals: workflowId } },
    depth: 1, // populate app so its workspace is readable
    limit: 1,
    overrideAccess: true,
  })
  const app = res.docs[0]?.app
  if (app && typeof app === 'object') return idOf((app as { workspace?: unknown }).workspace)
  return null
}

/** Keyed by "<service typeName>/<method name>". */
const resolvers: Record<string, (message: Message) => Promise<string | null>> = {
  'idp.launch.v1.LaunchService/GetLaunchProgress': launchByWorkflowId,
  'idp.launch.v1.LaunchService/ApproveLaunch': launchByWorkflowId,
  'idp.launch.v1.LaunchService/DeorbitLaunch': launchByWorkflowId,
  'idp.launch.v1.LaunchService/AbortLaunch': launchByWorkflowId,
  'idp.launch.v1.LaunchService/DeployToLaunch': launchById,
  'idp.deployment.v1.DeploymentService/GetDeploymentProgress': deploymentByWorkflowId,
}

/**
 * Returns the owning workspace id for an id-addressed RPC, or null when the RPC
 * is not one we resolve or the object cannot be found. Callers must treat null
 * as "unknown" — the Go service then fails closed for non-admin callers.
 */
export async function resolveOwningWorkspace(
  serviceTypeName: string | undefined,
  methodName: string | undefined,
  message: unknown,
): Promise<string | null> {
  if (!serviceTypeName || !methodName || !message || typeof message !== 'object') return null
  const resolver = resolvers[`${serviceTypeName}/${methodName}`]
  if (!resolver) return null
  return resolver(message as Message)
}

/**
 * Workspace that owns a Kafka virtual cluster: its direct `workspace`, or the
 * workspace of its (legacy) parent application.
 */
export async function virtualClusterWorkspace(virtualClusterId: string): Promise<string | null> {
  if (!virtualClusterId) return null
  const payload = await getPayload({ config })
  try {
    const vc = await payload.findByID({
      collection: 'kafka-virtual-clusters',
      id: virtualClusterId,
      depth: 1,
      overrideAccess: true,
    })
    const direct = idOf(vc?.workspace)
    if (direct) return direct
    const app = vc?.application
    if (app && typeof app === 'object') return idOf((app as { workspace?: unknown }).workspace)
    return null
  } catch {
    return null
  }
}
