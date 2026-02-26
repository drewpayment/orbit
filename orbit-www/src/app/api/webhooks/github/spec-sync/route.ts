export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { getPayload } from 'payload'
import config from '@payload-config'
import { Client, Connection } from '@temporalio/client'

const SPEC_FILE_PATTERNS = [
  /openapi\.(yaml|yml|json)$/i,
  /swagger\.(yaml|yml|json)$/i,
  /asyncapi\.(yaml|yml|json)$/i,
]

function isSpecFile(path: string): boolean {
  return SPEC_FILE_PATTERNS.some((pattern) => pattern.test(path))
}

export async function POST(request: NextRequest) {
  try {
    // 1. Verify signature header exists
    const signature = request.headers.get('X-Hub-Signature-256')
    if (!signature) {
      return NextResponse.json({ error: 'Missing signature' }, { status: 401 })
    }

    // 2. Only process push events
    const event = request.headers.get('X-GitHub-Event')
    if (event !== 'push') {
      return NextResponse.json({ message: 'Event ignored' }, { status: 200 })
    }

    // 3. Parse body
    const body = await request.text()

    let payloadData: {
      ref: string
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

    if (!repoFullName || !defaultBranch) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 },
      )
    }

    // 4. Only process pushes to the default branch
    if (payloadData.ref !== `refs/heads/${defaultBranch}`) {
      return NextResponse.json(
        { message: 'Not default branch' },
        { status: 200 },
      )
    }

    // 5. Collect changed spec files across all commits
    const changedPaths: string[] = []
    for (const commit of payloadData.commits || []) {
      for (const path of [
        ...(commit.added || []),
        ...(commit.modified || []),
        ...(commit.removed || []),
      ]) {
        if (isSpecFile(path) && !changedPaths.includes(path)) {
          changedPaths.push(path)
        }
      }
    }

    if (changedPaths.length === 0) {
      return NextResponse.json(
        { message: 'No spec files changed' },
        { status: 200 },
      )
    }

    // 6. Find apps linked to this repository
    const payload = await getPayload({ config })
    const apps = await payload.find({
      collection: 'apps',
      where: { 'repository.url': { contains: repoFullName } },
      overrideAccess: true,
      limit: 100,
    })

    if (apps.docs.length === 0) {
      return NextResponse.json(
        { message: 'No matching apps' },
        { status: 200 },
      )
    }

    // 7. Connect to Temporal
    const temporalAddress =
      process.env.TEMPORAL_ADDRESS || 'localhost:7233'
    const connection = await Connection.connect({
      address: temporalAddress,
    })
    const client = new Client({ connection })

    // 8. Verify signature and signal/start workflow per app
    const results: Array<{
      appId: string
      success: boolean
      error?: string
    }> = []

    for (const app of apps.docs) {
      if (!app.webhookSecret) {
        results.push({
          appId: app.id,
          success: false,
          error: 'No webhook secret configured',
        })
        continue
      }

      const expectedSig =
        'sha256=' +
        crypto
          .createHmac('sha256', app.webhookSecret)
          .update(body)
          .digest('hex')

      const isValid = crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSig),
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
        // Try to signal existing workflow
        const workflowId = `spec-sync-${app.id}`
        const handle = client.workflow.getHandle(workflowId)
        await handle.signal('webhook-push', { changedPaths })
        results.push({ appId: app.id, success: true })
      } catch {
        // Workflow doesn't exist yet — start it
        try {
          const repoUrl =
            app.repository?.owner && app.repository?.name
              ? `${app.repository.owner}/${app.repository.name}`
              : repoFullName

          const workspaceId =
            typeof app.workspace === 'string'
              ? app.workspace
              : app.workspace?.id || ''

          await client.workflow.start('RepositorySpecSyncWorkflow', {
            workflowId: `spec-sync-${app.id}`,
            taskQueue: 'orbit-workflows',
            args: [
              {
                appId: app.id,
                repoFullName: repoUrl,
                installationId: app.repository?.installationId || '',
                workspaceId,
              },
            ],
          })
          results.push({ appId: app.id, success: true })
        } catch (startError) {
          results.push({
            appId: app.id,
            success: false,
            error:
              startError instanceof Error
                ? startError.message
                : 'Failed to start workflow',
          })
        }
      }
    }

    return NextResponse.json({ success: true, results })
  } catch (error) {
    console.error('[Spec Sync Webhook] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
