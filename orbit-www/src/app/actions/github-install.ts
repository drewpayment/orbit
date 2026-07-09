'use server'

import { cookies } from 'next/headers'
import { getPayloadUserFromSession } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/access/workspace-access'
import {
  GITHUB_APP_NAME,
  GITHUB_INSTALL_STATE_COOKIE,
  GITHUB_INSTALL_STATE_TTL_SECONDS,
} from '@/lib/github/install-state'

/**
 * Build the GitHub App install/reconnect redirect URL (WI4).
 *
 * Generates a random CSRF `state` token, stores it in an HttpOnly,
 * SameSite=Lax cookie (Secure in production, ~15 min TTL), and returns the
 * install URL carrying the same token in the `state` query param. The
 * callback (`api/github/installation/callback/route.ts`) verifies the two
 * match before creating or updating any `github-installations` doc.
 *
 * Platform-admin gated: this initiates a flow that results in Orbit storing
 * GitHub installation tokens, so only platform admins may mint a state token.
 */
export async function createGithubInstallUrl(): Promise<{
  success: boolean
  url?: string
  error?: string
}> {
  const actor = await getPayloadUserFromSession()
  if (!actor || !isPlatformAdmin(actor)) {
    return { success: false, error: 'Platform admin required' }
  }

  const state = crypto.randomUUID()
  const cookieStore = await cookies()
  cookieStore.set(GITHUB_INSTALL_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: GITHUB_INSTALL_STATE_TTL_SECONDS,
    path: '/',
  })

  return {
    success: true,
    url: `https://github.com/apps/${GITHUB_APP_NAME}/installations/new?state=${state}`,
  }
}
