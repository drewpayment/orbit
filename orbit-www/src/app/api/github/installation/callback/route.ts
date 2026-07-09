export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { encrypt } from '@/lib/encryption'
import { getInstallation, createInstallationToken } from '@/lib/github/octokit'
import { ensureGitHubTokenRefreshWorkflow } from '@/lib/temporal/client'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { isPlatformAdmin } from '@/lib/access/workspace-access'
import { GITHUB_INSTALL_STATE_COOKIE } from '@/lib/github/install-state'

/**
 * GitHub App install/update callback (WI4 — CSRF + auth policy).
 *
 * - Orbit-initiated installs/reconnects carry a `state` query param that must
 *   match the HttpOnly `github_install_state` cookie set by
 *   `app/actions/github-install.ts` when the redirect URL was built. A
 *   present `state` with a missing or mismatched cookie is rejected outright
 *   — no session lookup, no Payload writes, no GitHub API calls — since
 *   that's the shape of a forged or replayed callback.
 * - GitHub can also invoke this callback with no `state` at all: an org
 *   admin installing/configuring the app directly from GitHub's side, with
 *   no Orbit redirect involved. That legitimate case must not hard-fail, so
 *   instead of requiring `state` we require the caller be an authenticated
 *   platform admin and log the installation as unsolicited.
 * - Every path — state-matched or no-state — requires an authenticated
 *   platform-admin session. Previously this route only checked for *any*
 *   logged-in session, which let any authenticated (non-admin) user create a
 *   `github-installations` doc by hitting this endpoint directly.
 */
function clearStateCookie(res: NextResponse): NextResponse {
  res.cookies.delete(GITHUB_INSTALL_STATE_COOKIE)
  return res
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const installationId = searchParams.get('installation_id')
  const setupAction = searchParams.get('setup_action')
  const state = searchParams.get('state')

  if (!installationId) {
    return clearStateCookie(
      NextResponse.json({ error: 'Missing installation_id parameter' }, { status: 400 }),
    )
  }

  if (setupAction !== 'install' && setupAction !== 'update') {
    return clearStateCookie(NextResponse.json({ error: 'Invalid setup_action' }, { status: 400 }))
  }

  // CSRF state verification — reject before touching session/Payload/GitHub.
  if (state) {
    const cookieState = request.cookies.get(GITHUB_INSTALL_STATE_COOKIE)?.value
    if (!cookieState || cookieState !== state) {
      return clearStateCookie(
        NextResponse.redirect(new URL('/settings/connections?error=state_mismatch', request.url)),
      )
    }
  }

  try {
    const payload = await getPayload({ config: configPromise })

    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) {
      return clearStateCookie(
        NextResponse.redirect(new URL('/login?redirectTo=/settings/connections', request.url)),
      )
    }

    const payloadUserResult = await payload.find({
      collection: 'users',
      where: { email: { equals: session.user.email } },
      limit: 1,
    })
    const payloadUser = payloadUserResult.docs[0]

    if (!payloadUser || !isPlatformAdmin(payloadUser)) {
      return clearStateCookie(
        NextResponse.redirect(new URL('/settings/connections?error=unauthorized', request.url)),
      )
    }

    if (!state) {
      console.warn(
        `[GitHub Installation Callback] No Orbit-issued state token for installation_id=${installationId} — proceeding as an unsolicited GitHub-initiated install for platform admin ${session.user.email}.`,
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

      // Backstop: ensure the refresh workflow is running (idempotent). The
      // afterChange hook only starts it on create, so a reinstall/update relies
      // on this to recover a workflow that was cancelled on a prior uninstall.
      await ensureGitHubTokenRefreshWorkflow(existing.docs[0].id)

      // Land reconnects/updates on the unified Connections page, same as new
      // installs — not the Payload admin UI.
      return clearStateCookie(
        NextResponse.redirect(new URL('/settings/connections', request.url)),
      )
    }

    // Create new installation record
    const account = installation.account
    if (!account) {
      return clearStateCookie(
        NextResponse.json({ error: 'Installation has no account associated' }, { status: 400 }),
      )
    }

    // Account can be either a User or an Enterprise - handle both types
    const accountLogin = 'login' in account ? account.login : account.slug
    const accountType = 'type' in account ? (account.type as 'Organization' | 'User') : 'Organization'

    await payload.create({
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
        installedBy: payloadUser.id,
        installedAt: new Date().toISOString(),
        // temporalWorkflowStatus will be set after starting workflow
      },
    })

    // The github-installations afterChange (create) hook starts the token
    // refresh workflow and records temporalWorkflowId — single authoritative
    // start site, so no inline start is needed here.

    // Redirect to workspace configuration page
    return clearStateCookie(NextResponse.redirect(new URL(`/settings/connections`, request.url)))
  } catch (error) {
    console.error('[GitHub Installation Callback] Error:', error)
    return clearStateCookie(
      NextResponse.json({ error: 'Failed to process GitHub App installation' }, { status: 500 }),
    )
  }
}
