import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { verifyWebhookSignature } from '@/lib/github/webhooks'
import { cancelGitHubTokenRefreshWorkflow } from '@/lib/temporal/client'

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

async function handleAppUninstalled(payload: any, githubInstallationId: number) {
  // Find installation by GitHub installation ID
  const installations = await payload.find({
    collection: 'github-installations',
    where: {
      installationId: {
        equals: githubInstallationId,
      },
    },
    limit: 1,
  })

  if (installations.docs.length === 0) {
    console.warn('[GitHub Webhook] Installation not found:', githubInstallationId)
    return
  }

  const installation = installations.docs[0]

  // Cancel Temporal workflow
  if (installation.temporalWorkflowId) {
    try {
      await cancelGitHubTokenRefreshWorkflow(installation.temporalWorkflowId)
      console.log('[GitHub Webhook] Cancelled workflow:', installation.temporalWorkflowId)
    } catch (error) {
      console.error('[GitHub Webhook] Failed to cancel workflow:', error)
    }
  }

  // Update installation status
  await payload.update({
    collection: 'github-installations',
    id: installation.id,
    data: {
      status: 'suspended',
      suspendedAt: new Date(),
      suspensionReason: 'GitHub App uninstalled by user',
      temporalWorkflowStatus: 'stopped',
    },
  })

  console.log('[GitHub Webhook] Installation marked as suspended:', installation.id)
}

async function handleAppSuspended(payload: any, githubInstallationId: number) {
  // Similar to uninstalled
  await handleAppUninstalled(payload, githubInstallationId)
}

async function handleAppUnsuspended(payload: any, githubInstallationId: number) {
  const installations = await payload.find({
    collection: 'github-installations',
    where: {
      installationId: {
        equals: githubInstallationId,
      },
    },
    limit: 1,
  })

  if (installations.docs.length === 0) {
    return
  }

  const installation = installations.docs[0]

  // Reactivate installation
  await payload.update({
    collection: 'github-installations',
    id: installation.id,
    data: {
      status: 'active',
      suspendedAt: null,
      suspensionReason: null,
    },
  })

  // Restart workflow
  // TODO: Implement workflow restart logic

  console.log('[GitHub Webhook] Installation reactivated:', installation.id)
}
