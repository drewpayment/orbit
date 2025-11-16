import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { encrypt } from '@/lib/encryption'
import { getInstallation, createInstallationToken } from '@/lib/github/octokit'
import { startGitHubTokenRefreshWorkflow } from '@/lib/temporal/client'

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
          selectedRepositories: installation.repositories?.map(repo => ({
            fullName: repo.full_name,
            id: repo.id,
            private: repo.private,
          })),
          status: 'active',
        },
      })

      // Redirect to configuration page
      return NextResponse.redirect(
        new URL(`/admin/collections/github-installations/${existing.docs[0].id}`, request.url)
      )
    }

    // Get current user from session
    // TODO: Implement proper session management
    // For now, assume admin user ID is available
    const adminUserId = 'admin-user-id' // Replace with actual user ID from session

    // Create new installation record
    const githubInstallation = await payload.create({
      collection: 'github-installations',
      data: {
        installationId: Number(installationId),
        accountLogin: installation.account.login,
        accountId: installation.account.id,
        accountType: installation.account.type as 'Organization' | 'User',
        accountAvatarUrl: installation.account.avatar_url,
        installationToken: encryptedToken,
        tokenExpiresAt: expiresAt.toISOString(),
        tokenLastRefreshedAt: new Date().toISOString(),
        repositorySelection: installation.repository_selection,
        selectedRepositories: installation.repositories?.map(repo => ({
          fullName: repo.full_name,
          id: repo.id,
          private: repo.private,
        })),
        allowedWorkspaces: [], // Admin will configure
        status: 'active',
        installedBy: adminUserId,
        installedAt: new Date().toISOString(),
        temporalWorkflowStatus: 'starting',
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
