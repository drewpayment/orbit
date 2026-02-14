import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { getPayload } from 'payload'
import config from '@payload-config'
import {
  parseAppManifest,
  mapManifestToAppFields,
  type AppSyncFields,
} from '@/lib/app-manifest'
import { fetchManifestContent } from '@/lib/github-manifest'
import { createInstallationToken } from '@/lib/github/octokit'
import type { App } from '@/payload-types'

type HealthMethod = NonNullable<NonNullable<App['healthConfig']>['method']>
const VALID_HEALTH_METHODS: HealthMethod[] = ['GET', 'HEAD', 'POST']

/**
 * Convert AppSyncFields into a shape compatible with the Payload App update type.
 * Handles:
 *  - `healthConfig.method` narrowing from `string` to the enum union
 *  - Stripping top-level `null` from object groups (Payload wants `undefined`)
 */
function toPayloadAppData(
  fields: Partial<AppSyncFields>,
): Partial<
  Pick<App, 'name' | 'description' | 'healthConfig' | 'buildConfig'>
> {
  const result: Partial<
    Pick<App, 'name' | 'description' | 'healthConfig' | 'buildConfig'>
  > = {}

  if (fields.name !== undefined) result.name = fields.name
  if (fields.description !== undefined) result.description = fields.description

  if (fields.healthConfig) {
    const method = fields.healthConfig.method
    result.healthConfig = {
      ...fields.healthConfig,
      method:
        method && VALID_HEALTH_METHODS.includes(method as HealthMethod)
          ? (method as HealthMethod)
          : undefined,
    }
  }

  if (fields.buildConfig) {
    result.buildConfig = fields.buildConfig
  }

  return result
}

export async function POST(request: NextRequest) {
  try {
    // 1. Get signature header
    const signature = request.headers.get('X-Hub-Signature-256')
    if (!signature) {
      return NextResponse.json({ error: 'Missing signature' }, { status: 401 })
    }

    // 2. Get event type — only process push events
    const event = request.headers.get('X-GitHub-Event')
    if (event !== 'push') {
      return NextResponse.json({ message: 'Event ignored' }, { status: 200 })
    }

    // 3. Get raw body for signature verification
    const body = await request.text()

    // 4. Parse payload
    let payloadData: {
      ref: string
      after: string
      before: string
      repository: { full_name: string; default_branch: string }
      commits?: Array<{
        added?: string[]
        modified?: string[]
        removed?: string[]
      }>
    }

    try {
      payloadData = JSON.parse(body)
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const repoFullName = payloadData.repository?.full_name
    const defaultBranch = payloadData.repository?.default_branch
    const pushedRef = payloadData.ref

    if (!repoFullName || !defaultBranch || !pushedRef) {
      return NextResponse.json(
        { error: 'Missing required fields in payload' },
        { status: 400 },
      )
    }

    // 5. Only process pushes to the default branch
    if (pushedRef !== `refs/heads/${defaultBranch}`) {
      return NextResponse.json(
        {
          message: 'Not default branch',
          branch: pushedRef,
          defaultBranch: `refs/heads/${defaultBranch}`,
        },
        { status: 200 },
      )
    }

    const [owner, repo] = repoFullName.split('/')

    const payload = await getPayload({ config })

    // 6. Find apps linked to this repository
    const apps = await payload.find({
      collection: 'apps',
      where: {
        'repository.url': { contains: repoFullName },
      },
      overrideAccess: true,
      limit: 100,
    })

    if (apps.docs.length === 0) {
      return NextResponse.json(
        { message: 'No matching apps', repository: repoFullName },
        { status: 200 },
      )
    }

    // 7. Process each matching app
    const results: Array<{
      appId: string
      success: boolean
      action?: string
      error?: string
    }> = []

    for (const app of apps.docs) {
      // Verify webhook signature for this app
      if (!app.webhookSecret) {
        results.push({
          appId: app.id,
          success: false,
          error: 'No webhook secret configured',
        })
        continue
      }

      const expectedSignature =
        'sha256=' +
        crypto
          .createHmac('sha256', app.webhookSecret)
          .update(body)
          .digest('hex')

      // Use timing-safe comparison to prevent timing attacks
      const isValid = crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature),
      )

      if (!isValid) {
        results.push({
          appId: app.id,
          success: false,
          error: 'Invalid signature',
        })
        continue
      }

      try {
        const result = await processAppSync(
          app,
          payloadData,
          owner,
          repo,
          defaultBranch,
          payload,
        )
        results.push({ appId: app.id, ...result })
      } catch (error) {
        results.push({
          appId: app.id,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }

    const successCount = results.filter((r) => r.success).length
    const failureCount = results.filter((r) => !r.success).length

    return NextResponse.json({
      success: true,
      processed: results.length,
      successful: successCount,
      failed: failureCount,
      results,
    })
  } catch (error) {
    console.error('[App Sync Webhook] Error processing webhook:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}

/**
 * Process manifest sync for a single app.
 *
 * Handles three scenarios:
 *  1. Manifest removed  -> disable sync
 *  2. Manifest added    -> auto-activate sync
 *  3. Manifest modified -> conflict detection or clean sync
 */
async function processAppSync(
  app: {
    id: string
    syncEnabled?: boolean | null
    manifestSha?: string | null
    manifestPath?: string | null
    repository?: {
      installationId?: string | null
      branch?: string | null
    } | null
  },
  payloadData: {
    after: string
    before: string
    commits?: Array<{
      added?: string[]
      modified?: string[]
      removed?: string[]
    }>
  },
  owner: string,
  repo: string,
  defaultBranch: string,
  payload: Awaited<ReturnType<typeof getPayload>>,
): Promise<{ success: boolean; action?: string; error?: string }> {
  const manifestPath = app.manifestPath || '.orbit.yaml'

  // --- Manifest removed ---
  const manifestRemoved = payloadData.commits?.some((c) =>
    c.removed?.includes(manifestPath),
  )

  if (manifestRemoved) {
    await payload.update({
      collection: 'apps',
      id: app.id,
      data: {
        syncEnabled: false,
        manifestSha: null,
        lastSyncAt: new Date().toISOString(),
      },
      overrideAccess: true,
      context: { _syncSource: 'webhook' },
    })
    return { success: true, action: 'disabled' }
  }

  // --- Manifest not touched in this push ---
  const manifestTouched = payloadData.commits?.some(
    (c) =>
      c.added?.includes(manifestPath) || c.modified?.includes(manifestPath),
  )

  if (!manifestTouched) {
    return { success: true, action: 'skipped' }
  }

  // --- Fetch manifest content from the repo ---
  const installationId = app.repository?.installationId
  if (!installationId) {
    return { success: false, error: 'No installation ID on app' }
  }

  let accessToken: string
  try {
    const tokenResult = await createInstallationToken(Number(installationId))
    accessToken = tokenResult.token
  } catch (error) {
    console.error(
      `[App Sync Webhook] Failed to get installation token for app ${app.id}:`,
      error,
    )
    return { success: false, error: 'Failed to obtain installation token' }
  }

  const content = await fetchManifestContent(
    owner,
    repo,
    defaultBranch,
    manifestPath,
    accessToken,
  )

  if (!content) {
    return { success: false, error: 'Manifest file not found in repository' }
  }

  // Parse and validate
  const { manifest, errors } = parseAppManifest(content)
  if (!manifest || errors.length > 0) {
    const errorMessages = errors.map((e) => e.message).join(', ')
    console.error(
      `[App Sync Webhook] Invalid manifest in ${owner}/${repo}/${manifestPath}:`,
      errorMessages,
    )
    return { success: false, error: `Invalid manifest: ${errorMessages}` }
  }

  // --- Auto-activate sync if manifest was just added ---
  if (!app.syncEnabled) {
    const fields = toPayloadAppData(mapManifestToAppFields(manifest))
    await payload.update({
      collection: 'apps',
      id: app.id,
      data: {
        ...fields,
        syncEnabled: true,
        manifestSha: payloadData.after,
        lastSyncAt: new Date().toISOString(),
        lastSyncDirection: 'inbound',
      },
      overrideAccess: true,
      context: { _syncSource: 'webhook' },
    })
    return { success: true, action: 'activated' }
  }

  // --- Conflict detection ---
  // If the stored manifestSha doesn't match the push's "before" SHA,
  // that means Orbit wrote a manifest commit itself that GitHub is not
  // aware of — flag this as a conflict rather than silently overwriting.
  if (app.manifestSha && payloadData.before !== app.manifestSha) {
    await payload.update({
      collection: 'apps',
      id: app.id,
      data: {
        conflictDetected: true,
        conflictManifestContent: content,
      },
      overrideAccess: true,
      context: { _syncSource: 'webhook' },
    })
    return { success: true, action: 'conflict' }
  }

  // --- Clean sync — update DB from manifest ---
  const fields = toPayloadAppData(mapManifestToAppFields(manifest))
  await payload.update({
    collection: 'apps',
    id: app.id,
    data: {
      ...fields,
      manifestSha: payloadData.after,
      lastSyncAt: new Date().toISOString(),
      lastSyncDirection: 'inbound',
      conflictDetected: false,
      conflictManifestContent: null,
    },
    overrideAccess: true,
    context: { _syncSource: 'webhook' },
  })

  return { success: true, action: 'synced' }
}
