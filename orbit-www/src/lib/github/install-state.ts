/**
 * Shared constants for the GitHub App install CSRF-state cookie.
 *
 * The cookie is set server-side by `app/actions/github-install.ts` (when
 * Orbit initiates an install/reconnect redirect) and read by
 * `app/api/github/installation/callback/route.ts` (to verify the `state`
 * query param GitHub echoes back). Kept in its own module — not a Server
 * Action file — so both the action and the route handler can import it.
 */
export const GITHUB_APP_NAME = process.env.NEXT_PUBLIC_GITHUB_APP_NAME || 'orbit-idp-dev'
export const GITHUB_INSTALL_STATE_COOKIE = 'github_install_state'
export const GITHUB_INSTALL_STATE_TTL_SECONDS = 15 * 60
