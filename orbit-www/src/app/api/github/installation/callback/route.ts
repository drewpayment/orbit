import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { encrypt } from '@/lib/encryption'
import { getInstallation, createInstallationToken } from '@/lib/github/octokit'
import { startGitHubTokenRefreshWorkflow } from '@/lib/temporal/client'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const installationId = searchParams.get('installation_id')
  const setupAction = searchParams.get('setup_action')
  const state = searchParams.get('state')

  // Verify state (CSRF protection)
  // TODO: Implement state verification with session storage

  if (!installationId) {
    return NextResponse.json(
      { error: 'Missing installation_id parameter' },
      { status: 400 }
    )
  }

  if (setupAction !== 'install' && setupAction !== 'update') {
    return NextResponse.json(
      { error: 'Invalid setup_action' },
      { status: 400 }
    )
  }

  try {
    const payload = await getPayload({ config: configPromise })

    // Get current user from session
    const session = await auth.api.getSession({
      headers: await headers(),
    })

    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized - please log in first' },
        { status: 401 }
      )
    }

    // Get installation details from GitHub
    const installation = await getInstallation(Number(installationId))

    // Generate installation access token
    const { token, expiresAt } = await createInstallationToken(Number(installationId))

    // Encrypt token before storing
    const encryptedToken = encrypt(token)

    // Check if installation already exists (for updates)
    const existing = await payload.find({
      collection: 'github-installations',
      where: {
        installationId: {
          equals: Number(installationId),
        },
      },
      limit: 1,
    })

    if (existing.docs.length > 0 && setupAction === 'update') {
      // Update existing installation
      await payload.update({
        collection: 'github-installations',
        id: existing.docs[0].id,
        data: {
          installationToken: encryptedToken,
          tokenExpiresAt: expiresAt.toISOString(),
          tokenLastRefreshedAt: new Date().toISOString(),
          repositorySelection: installation.repository_selection,
          // Repositories are fetched separately via the installations API
          status: 'active',
        },
      })

      // Redirect to configuration page
      return NextResponse.redirect(
        new URL(`/admin/collections/github-installations/${existing.docs[0].id}`, request.url)
      )
    }

    // Find the Payload user record for this better-auth user
    const payloadUser = await payload.find({
      collection: 'users',
      where: {
        email: {
          equals: session.user.email,
        },
      },
      limit: 1,
    })

    if (!payloadUser.docs[0]) {
      return NextResponse.json(
        { error: 'User not found in Payload CMS' },
        { status: 404 }
      )
    }

    // Create new installation record
    const account = installation.account
    if (!account) {
      return NextResponse.json(
        { error: 'Installation has no account associated' },
        { status: 400 }
      )
    }

    // Account can be either a User or an Enterprise - handle both types
    const accountLogin = 'login' in account ? account.login : account.slug
    const accountType = 'type' in account ? (account.type as 'Organization' | 'User') : 'Organization'

    const githubInstallation = await payload.create({
      collection: 'github-installations',
      data: {
        installationId: Number(installationId),
        accountLogin,
        accountId: account.id,
        accountType,
        accountAvatarUrl: account.avatar_url,
        installationToken: encryptedToken,
        tokenExpiresAt: expiresAt.toISOString(),
        tokenLastRefreshedAt: new Date().toISOString(),
        repositorySelection: installation.repository_selection,
        // Repositories are fetched separately via the installations API
        allowedWorkspaces: [], // Admin will configure
        status: 'active',
        installedBy: payloadUser.docs[0].id,
        installedAt: new Date().toISOString(),
        // temporalWorkflowStatus will be set after starting workflow
      },
    })

    // Start Temporal token refresh workflow
    let workflowId: string
    try {
      workflowId = await startGitHubTokenRefreshWorkflow(githubInstallation.id)

      // Update installation with workflow ID
      await payload.update({
        collection: 'github-installations',
        id: githubInstallation.id,
        data: {
          temporalWorkflowId: workflowId,
          temporalWorkflowStatus: 'running',
        },
      })
    } catch (workflowError) {
      console.error('[GitHub Installation] Failed to start workflow:', workflowError)

      // Mark workflow as failed but don't fail installation
      await payload.update({
        collection: 'github-installations',
        id: githubInstallation.id,
        data: {
          temporalWorkflowStatus: 'failed',
        },
      })
    }

    // Redirect to workspace configuration page
    return NextResponse.redirect(
      new URL(`/settings/github/${githubInstallation.id}/configure`, request.url)
    )

  } catch (error) {
    console.error('[GitHub Installation Callback] Error:', error)
    return NextResponse.json(
      { error: 'Failed to process GitHub App installation' },
      { status: 500 }
    )
  }
}
