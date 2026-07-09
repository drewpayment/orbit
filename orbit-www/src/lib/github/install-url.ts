const GITHUB_APP_NAME = process.env.NEXT_PUBLIC_GITHUB_APP_NAME || 'orbit-idp-dev'

/**
 * Build the GitHub App install/reconnect redirect URL, stashing a best-effort
 * CSRF `state` token in sessionStorage.
 *
 * NOTE: the state generation is intentionally client-side for now — WI4
 * (CSRF callback verification) will replace this with a server-issued,
 * cookie-backed token. Do not change the generation here without updating the
 * callback route in lockstep.
 */
export function githubInstallUrl(): string {
  const state = crypto.randomUUID()
  try {
    sessionStorage.setItem('github_install_state', state)
  } catch {
    // sessionStorage may be unavailable; the state param is best-effort CSRF.
  }
  return `https://github.com/apps/${GITHUB_APP_NAME}/installations/new?state=${state}`
}
