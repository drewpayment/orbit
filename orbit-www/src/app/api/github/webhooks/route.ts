export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { verifyWebhookSignature } from '@/lib/github/webhooks'
import { cancelGitHubTokenRefreshWorkflow, ensureGitHubTokenRefreshWorkflow } from '@/lib/temporal/client'

export async function POST(request: NextRequest) {
  const signature = request.headers.get('x-hub-signature-256')
  const payload = await request.text()

  // Verify webhook signature
  if (!signature || !verifyWebhookSignature(payload, signature)) {
    console.error('[GitHub Webhook] Invalid signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const event = JSON.parse(payload)
  const action = event.action

  console.log('[GitHub Webhook] Received event:', action, 'for installation:', event.installation?.id)

  const payloadCMS = await getPayload({ config: configPromise })

  try {
    switch (action) {
      case 'deleted': {
        // GitHub App uninstalled
        await handleAppUninstalled(payloadCMS, event.installation.id)
        break
      }

      case 'suspend': {
        // GitHub App suspended
        await handleAppSuspended(payloadCMS, event.installation.id)
        break
      }

      case 'unsuspend': {
        // GitHub App unsuspended
        await handleAppUnsuspended(payloadCMS, event.installation.id)
        break
      }

      case 'new_permissions_accepted': {
        // Permissions updated
        console.log('[GitHub Webhook] Permissions updated for installation:', event.installation.id)
        break
      }

      default:
        console.log('[GitHub Webhook] Unhandled action:', action)
    }

    return NextResponse.json({ status: 'ok' })

  } catch (error) {
    console.error('[GitHub Webhook] Error handling webhook:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

async function findInstallation(payload: any, githubInstallationId: number) {
  const installations = await payload.find({
    collection: 'github-installations',
    where: {
      installationId: {
        equals: githubInstallationId,
      },
    },
    limit: 1,
  })
  return installations.docs[0] ?? null
}

async function stopRefreshWorkflow(installation: any) {
  if (installation.temporalWorkflowId) {
    try {
      await cancelGitHubTokenRefreshWorkflow(installation.temporalWorkflowId)
      console.log('[GitHub Webhook] Cancelled workflow:', installation.temporalWorkflowId)
    } catch (error) {
      console.error('[GitHub Webhook] Failed to cancel workflow:', error)
    }
  }
}

async function handleAppUninstalled(payload: any, githubInstallationId: number) {
  const installation = await findInstallation(payload, githubInstallationId)
  if (!installation) {
    console.warn('[GitHub Webhook] Installation not found:', githubInstallationId)
    return
  }

  await stopRefreshWorkflow(installation)

  await payload.update({
    collection: 'github-installations',
    id: installation.id,
    data: {
      status: 'suspended',
      suspendedAt: new Date(),
      // Distinct from a GitHub-side suspend: uninstall does not auto-recover.
      suspensionReason: 'GitHub App uninstalled',
      temporalWorkflowStatus: 'stopped',
    },
  })

  console.log('[GitHub Webhook] Installation marked uninstalled:', installation.id)
}

async function handleAppSuspended(payload: any, githubInstallationId: number) {
  const installation = await findInstallation(payload, githubInstallationId)
  if (!installation) {
    console.warn('[GitHub Webhook] Installation not found:', githubInstallationId)
    return
  }

  await stopRefreshWorkflow(installation)

  await payload.update({
    collection: 'github-installations',
    id: installation.id,
    data: {
      status: 'suspended',
      suspendedAt: new Date(),
      // Temporary, recoverable: an unsuspend webhook restores it automatically.
      suspensionReason: 'GitHub App suspended by GitHub',
      temporalWorkflowStatus: 'stopped',
    },
  })

  console.log('[GitHub Webhook] Installation marked suspended:', installation.id)
}

async function handleAppUnsuspended(payload: any, githubInstallationId: number) {
  const installation = await findInstallation(payload, githubInstallationId)
  if (!installation) {
    return
  }

  // Restart the refresh workflow (idempotent) so the token starts refreshing
  // again, then reactivate. If Temporal is unreachable the sweeper recovers it.
  const workflowId = await ensureGitHubTokenRefreshWorkflow(installation.id)

  await payload.update({
    collection: 'github-installations',
    id: installation.id,
    data: {
      status: 'active',
      suspendedAt: null,
      suspensionReason: null,
      temporalWorkflowId: workflowId ?? installation.temporalWorkflowId,
      temporalWorkflowStatus: workflowId ? 'running' : 'failed',
    },
  })

  console.log('[GitHub Webhook] Installation reactivated and refresh restarted:', installation.id)
}
