import 'server-only'
import { getPayload } from 'payload'
import config from '@payload-config'
import { decrypt } from '@/lib/encryption'

/**
 * Resolve an app's decrypted environment variables (workspace-level, with
 * app-level overrides) for a build or deployment.
 *
 * NO AUTHORIZATION: this returns plaintext secrets. It lives outside any
 * `'use server'` module on purpose so it is not a client-callable endpoint;
 * only server code that has ALREADY authorized the caller against the app's
 * workspace may call it (startBuild / startDeployToLaunch check membership
 * first). There is intentionally no client-reachable wrapper.
 */
export async function resolveEnvironmentVariablesUnchecked(
  appId: string,
  usage: 'build' | 'deployment'
): Promise<{ success: boolean; error?: string; variables?: Record<string, string> }> {
  const payload = await getPayload({ config })

  try {
    // Get app to find workspace
    const app = await payload.findByID({
      collection: 'apps',
      id: appId,
      overrideAccess: true,
    })

    if (!app) {
      return { success: false, error: 'App not found' }
    }

    const workspaceId = typeof app.workspace === 'string'
      ? app.workspace
      : app.workspace.id

    // 1. Get workspace-level variables
    const workspaceVars = await payload.find({
      collection: 'environment-variables',
      where: {
        and: [
          { workspace: { equals: workspaceId } },
          { app: { exists: false } },
          usage === 'build'
            ? { useInBuilds: { equals: true } }
            : { useInDeployments: { equals: true } },
        ],
      },
      limit: 1000,
      overrideAccess: true,
    })

    // 2. Get app-level overrides
    const appVars = await payload.find({
      collection: 'environment-variables',
      where: {
        and: [
          { app: { equals: appId } },
          usage === 'build'
            ? { useInBuilds: { equals: true } }
            : { useInDeployments: { equals: true } },
        ],
      },
      limit: 1000,
      overrideAccess: true,
    })

    console.log('[ResolveEnv] Found variables:', {
      workspaceVarsCount: workspaceVars.docs.length,
      appVarsCount: appVars.docs.length,
      workspaceVarNames: workspaceVars.docs.map(v => v.name),
      appVarNames: appVars.docs.map(v => v.name),
    })

    // 3. Merge (app overrides workspace)
    const result: Record<string, string> = {}

    for (const v of workspaceVars.docs) {
      try {
        result[v.name] = decrypt(v.value)
      } catch (e) {
        console.error(`Failed to decrypt workspace variable ${v.name}:`, e)
      }
    }

    for (const v of appVars.docs) {
      try {
        result[v.name] = decrypt(v.value)
      } catch (e) {
        console.error(`Failed to decrypt app variable ${v.name}:`, e)
      }
    }

    return { success: true, variables: result }
  } catch (error) {
    console.error('Failed to resolve environment variables:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to resolve environment variables',
    }
  }
}
